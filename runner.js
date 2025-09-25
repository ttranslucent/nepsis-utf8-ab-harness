// --- strict baseline config ---
const EXPECT = ['é', 'é', '한'];
const RE_DECOMP = /e\u0301/g;

function buildNakedPrompt(llmLabel = '') {
  const clause = llmLabel.toLowerCase().includes('claude')
    ? 'Return only code. No prose.'
    : 'Return only code (no markdown fences, no comments).';
  return `You are implementing a streaming UTF-8 validator + NFC normalizer.

Return ONLY the Python code for solution.py that defines:
class Utf8StreamNormalizer:
    def push(self, chunk: bytes) -> str
    def finish(self) -> str
    errors: list[tuple[int,int]]

Constraints (RFC-3629 exact):
- Reject overlongs; forbid U+D800–U+DFFF; forbid >U+10FFFF; reject lone continuation/truncated; reject noncharacters in all planes.
- On invalid subsequence, emit exactly one U+FFFD and append (start,end) byte indices in GLOBAL coordinates to self.errors.
- Streaming NFC: Do NOT normalize per chunk. Buffer canonical segment; flush only on a starter (combining class 0) or at finish(). Assume ≤64 consecutive non-starters.
- No cheats: never use bytes.decode(..., errors=...); implement a UTF-8 state machine to find precise error spans.

Output: ${clause}
`;
}

const NEPSIS_SCAFFOLD_PROMPT = `Nepsis Scaffold (Lite v0.1)

Implement solution.py with a single class:

class Utf8StreamNormalizer:
    def __init__(self): ...
    def push(self, chunk: bytes) -> str
    def finish(self) -> str
    # After finish(), self.errors is list[tuple[int,int]] of GLOBAL byte ranges for each invalid UTF-8 subsequence

NON-NEGOTIABLES (RFC-3629 exact)
1) Reject: overlong encodings; lone continuation bytes; truncated sequences; 5/6-byte forms; code points > U+10FFFF; UTF-16 surrogates U+D800–U+DFFF; and noncharacters (U+FDD0..U+FDEF or any U+FFFE/U+FFFF in any plane).
2) On any invalid subsequence emit exactly ONE U+FFFD and append ONE span [start,end) in GLOBAL byte coords to self.errors. Do NOT emit multiple U+FFFD for one invalid subsequence. Truncated tail at finish() → one span covering the remaining bytes.
3) Streaming semantics: handle code points split across chunks. Keep a small pending-bytes buffer for incomplete sequences.
4) Normalization: Output MUST be NFC, respecting cross-chunk sequences. Do NOT normalize per chunk. Buffer the current canonical segment and flush only on seeing a starter (combining class 0) or at finish().
   • Hangul guard: do not flush if the segment tail is Hangul Jamo L or V (it may still compose with upcoming Jamo).
5) No cheats: NEVER use bytes.decode(..., errors=...) on the stream or chunks. Implement a UTF-8 state machine to get precise spans and overlong checks.

REQUIRED IMPLEMENTATION SHAPE
- Track: self.byte_offset (global), self.pending (bytes) for split sequences, self.segment (list[str]) for the current canonical run, self.errors (list[tuple[int,int]]).
- UTF-8 decode: minimal-advance on error (record span, emit U+FFFD, skip the offending lead only unless followers are clearly part of the same invalid subsequence). Lead-byte boundary checks:
  • 3-byte: E0 ⇒ 0xA0..0xBF; ED ⇒ 0x80..0x9F; otherwise 0x80..0xBF followers.
  • 4-byte: F0 ⇒ 0x90..0xBF; F4 ⇒ 0x80..0x8F; otherwise 0x80..0xBF followers.
- Reject noncharacters and surrogates even if structurally well-formed.
- Compose NFC via unicodedata.normalize('NFC'); starters via unicodedata.combining(ch) == 0.
- Flushing rule:
  def _accept(ch):
      if starter and segment non-empty and last char is NOT Hangul L/V ⇒ flush normalize(segment), clear, then start new.
      else: append to segment.
- finish(): if pending exists ⇒ record one span [offset, offset+len(pending)], emit one U+FFFD, clear; then flush normalize(segment).

Return ONLY valid Python code for solution.py (no markdown fences, no prose).
`;

const PY_TEST_SCRIPT = `
import json, io, contextlib

code = USER_CODE
result = {"cases": []}
stdout = io.StringIO()

TESTS = [
    ("ascii_split", [b"Hel", b"lo ", b"Wor", b"ld"], "Hello World", []),
    ("multibyte_split", [bytes([0xC3]), bytes([0xA9])], "é", []),
    ("combining_across_chunks", [b"A", bytes([0xCC, 0x81])], "Á", []),
    ("hangul_jamo_cross_chunk", [bytes([0xE1, 0x84, 0x92]), bytes([0xE1, 0x85, 0xA1, 0xE1, 0x86, 0xAB])], "한", []),
    ("overlong_rejected", [bytes([0xC0, 0xAF])], "�", [(0, 2)]),
    ("surrogate_rejected", [bytes([0xED, 0xA0, 0x80])], "�", [(0, 3)]),
    ("noncharacter_rejected", [bytes([0xEF, 0xBF, 0xBE])], "�", [(0, 3)]),
    ("lone_continuation_mid_text", [b"a" + bytes([0x80]) + b"b"], "a�b", [(1, 2)]),
    ("valid_4byte", [bytes([0xF0, 0x9F, 0x98, 0x80])], "😀", []),
    ("truncated_at_end", [bytes([0xE2, 0x82])], "�", [(0, 2)]),
    ("cross_chunk_canonical_reorder", [b"a", bytes([0xCC, 0x81]), bytes([0xCC, 0x80])], "\u00E1\u0300", []),
]

with contextlib.redirect_stdout(stdout):
    ns = {}
    try:
        exec(code, ns)
    except Exception as exc:
        result["fatal"] = f"{exc.__class__.__name__}: {exc}"
    else:
        cls = ns.get("Utf8StreamNormalizer")
        if cls is None:
            result["fatal"] = "Utf8StreamNormalizer class not found."
        else:
            for name, chunks, want_out, want_errs in TESTS:
                case = {"name": name, "ok": False, "msg": ""}
                try:
                    inst = cls()
                except Exception as exc:
                    case["msg"] = f"init failed: {exc.__class__.__name__}: {exc}"
                    result["cases"].append(case)
                    continue
                pieces = []
                try:
                    for chunk in chunks:
                        pieces.append(inst.push(chunk))
                    pieces.append(inst.finish())
                except Exception as exc:
                    case["msg"] = f"exception: {exc.__class__.__name__}: {exc}"
                    result["cases"].append(case)
                    continue
                text = "".join(pieces)
                errs = getattr(inst, "errors", [])
                try:
                    errs_list = list(errs)
                except Exception:
                    errs_list = [str(errs)]
                if text != want_out:
                    case["msg"] = f"out={text!r} expected {want_out!r}"
                elif errs_list != want_errs:
                    case["msg"] = f"errors={errs_list!r} expected {want_errs!r}"
                else:
                    case["ok"] = True
                result["cases"].append(case)

result["stdout"] = stdout.getvalue()
json.dumps(result)
`;

// ---- helpers ----
const get = (id) => document.getElementById(id);
const cp = (ch) => 'U+' + (ch.codePointAt(0).toString(16).toUpperCase());

function stripFences(text = '') {
  return text.replace(/```[\s\S]*?```/g, '').trim();
}

function firstNCharsPrintable(text, count) {
  const result = [];
  if (!text) return result;
  for (const ch of stripFences(text)) {
    if (/\s|["'`]/.test(ch)) continue;
    result.push(ch);
    if (result.length === count) break;
  }
  return result;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch] || ch));
}

function showToast(msg, ok = true) {
  const el = get('toast');
  if (!el) return;
  el.textContent = msg;
  el.style.borderColor = ok ? 'rgba(16,185,129,.4)' : 'rgba(239,68,68,.4)';
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 1400);
}

function flashCopy(btn, ok = true, label = 'Copied!') {
  const original = btn.textContent;
  btn.textContent = label;
  btn.classList.add('pulse');
  showToast(ok ? 'Copied to clipboard' : 'Copy failed', ok);
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove('pulse');
  }, 900);
}

async function copy(text, btn) {
  try {
    await navigator.clipboard.writeText(text || '');
    flashCopy(btn, true);
  } catch (err) {
    console.error(err);
    flashCopy(btn, false, 'Copy failed');
  }
}

// ---- shared state & storage ----
const K_CONSISTENCY = 3;
const SEEDS = [137, 991, 2401];
const SEED_STRATEGY = 'fixed_set_v2';
const RUN_STORAGE_KEY = 'nepsis_runs_v2';

let currentMode = 'baseline';
let currentDifficulty = 'standard';

function loadRuns() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RUN_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('Failed to parse stored runs', err);
    return [];
  }
}

function saveRuns(runs) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RUN_STORAGE_KEY, JSON.stringify(runs));
  } catch (err) {
    console.warn('Failed to persist runs', err);
  }
}

function generateRunId() {
  return `run_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

const percentage = (num, den) => (den > 0 ? Math.round((100 * num) / den) : 0);

function sanitizeReason(value) {
  if (!value) return '';
  return String(value).replace(/[\r\n]+/g, ' ').replace(/,/g, ';');
}

let runHistory = loadRuns();

function recordRun(mode, difficulty, cases, meta = {}) {
  if (!cases || !cases.length) return;
  const ts = Date.now();
  const run = {
    run_id: meta.run_id || generateRunId(),
    ts,
    mode,
    difficulty,
    k: meta.k ?? K_CONSISTENCY,
    seeds: meta.seeds ?? [...SEEDS],
    latency_ms: meta.latency ?? null,
    items: cases.map((c) => ({
      prompt_id: c.prompt_id,
      pass: Boolean(c.pass),
      reason: c.reason || '',
    })),
  };
  runHistory = [run, ...runHistory].slice(0, 300);
  saveRuns(runHistory);
  renderMetrics();
  renderRunHistory();
  window._lastCases = cases;
}

function renderMetrics() {
  const metricsTable = get('metricsTable');
  const consistencyChip = get('consistencyChip');
  if (!metricsTable) return;
  const body = metricsTable.querySelector('tbody');
  if (!body) return;

  const buckets = new Map();
  for (const run of runHistory) {
    const key = `${run.mode}|${run.difficulty}`;
    const bucket = buckets.get(key) || { runs: 0, total: 0, pass: 0 };
    bucket.runs += 1;
    bucket.total += run.items.length;
    bucket.pass += run.items.filter((item) => item.pass).length;
    buckets.set(key, bucket);
  }

  const rows = [];
  for (const difficulty of ['standard', 'hard']) {
    const baselineKey = `baseline|${difficulty}`;
    const nepsisKey = `nepsis|${difficulty}`;
    const baseBucket = buckets.get(baselineKey) || { runs: 0, total: 0, pass: 0 };
    const nepsisBucket = buckets.get(nepsisKey) || { runs: 0, total: 0, pass: 0 };
    const baseRate = baseBucket.total ? percentage(baseBucket.pass, baseBucket.total) : null;
    const nepsisRate = nepsisBucket.total ? percentage(nepsisBucket.pass, nepsisBucket.total) : null;
    const delta = baseRate !== null && nepsisRate !== null ? nepsisRate - baseRate : null;

    rows.push(renderMetricRow('Strict Baseline', difficulty, baseBucket, baseRate, null));
    rows.push(renderMetricRow('Nepsis Lite', difficulty, nepsisBucket, nepsisRate, delta));
  }

  body.innerHTML = rows.join('');
  if (consistencyChip) {
    consistencyChip.textContent = `Consistency check: k=${K_CONSISTENCY} • seeds ${SEEDS.join(' / ')} • runs ${runHistory.length}`;
  }
}

function renderMetricRow(label, difficulty, bucket, rate, delta) {
  const passText = `${bucket.pass || 0} / ${bucket.total || 0}`;
  const passRate = rate !== null ? `${rate}%` : '—';
  const deltaText = delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta}%`;
  return `<tr>
    <td>${label}</td>
    <td class="capitalize">${difficulty}</td>
    <td>${bucket.runs || 0}</td>
    <td>${passRate}</td>
    <td>${passText}</td>
    <td>${deltaText}</td>
  </tr>`;
}

function renderRunHistory() {
  const table = get('runsTable');
  if (!table) return;
  const body = table.querySelector('tbody');
  if (!body) return;
  const rows = runHistory.slice(0, 12).map((run) => {
    const passed = run.items.filter((item) => item.pass).length;
    const total = run.items.length;
    return `<tr>
      <td>${new Date(run.ts).toLocaleString()}</td>
      <td class="capitalize">${run.mode}</td>
      <td class="capitalize">${run.difficulty}</td>
      <td>${passed}</td>
      <td>${total}</td>
      <td>${percentage(passed, total)}%</td>
      <td class="text-xs">${run.run_id.slice(0, 10)}</td>
    </tr>`;
  }).join('');
  body.innerHTML = rows || '<tr><td colspan="7" style="color:var(--muted)">No runs recorded yet.</td></tr>';
}

renderMetrics();
renderRunHistory();

// ---- prompt copy buttons ----
const copyNakedBtn = get('btnCopyNaked');
const copyScaffoldBtn = get('btnCopyScaffold');
const promptToast = get('promptToast');

async function handlePromptCopy(text, button, label) {
  if (!button) return;
  try {
    await copy(text, button);
    if (promptToast) {
      promptToast.textContent = label;
      promptToast.style.display = 'inline';
      setTimeout(() => { promptToast.style.display = 'none'; }, 1600);
    }
  } catch (err) {
    console.error(err);
    showToast('Prompt copy failed', false);
  }
}

if (copyNakedBtn) {
  copyNakedBtn.addEventListener('click', () => {
    currentMode = 'baseline';
    copyNakedBtn.classList.add('active');
    if (copyScaffoldBtn) copyScaffoldBtn.classList.remove('active');
    handlePromptCopy(buildNakedPrompt('Claude'), copyNakedBtn, 'Copied Naked prompt');
  });
}

if (copyScaffoldBtn) {
  copyScaffoldBtn.addEventListener('click', () => {
    currentMode = 'nepsis';
    copyScaffoldBtn.classList.add('active');
    if (copyNakedBtn) copyNakedBtn.classList.remove('active');
    handlePromptCopy(NEPSIS_SCAFFOLD_PROMPT, copyScaffoldBtn, 'Copied Scaffold (Lite) prompt');
  });
}

if (copyNakedBtn) copyNakedBtn.classList.add('active');

const codePane = get('codePane');
const outputPane = get('outputPane');
const tabCode = get('tabCode');
const tabOutput = get('tabOutput');
const difficultyToggle = get('difficultyToggle');

function setDifficulty(value) {
  if (!value) return;
  currentDifficulty = value;
  if (difficultyToggle) {
    difficultyToggle.querySelectorAll('button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.difficulty === value);
    });
  }
}

if (difficultyToggle) {
  difficultyToggle.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => setDifficulty(btn.dataset.difficulty));
  });
}
setDifficulty(currentDifficulty);

function activatePane(which) {
  const showCode = which === 'code';
  if (codePane) codePane.style.display = showCode ? 'block' : 'none';
  if (outputPane) outputPane.style.display = showCode ? 'none' : 'block';
  if (tabCode) {
    tabCode.classList.toggle('active', showCode);
  }
  if (tabOutput) {
    tabOutput.classList.toggle('active', !showCode);
  }
}

activatePane('code');
if (tabCode) tabCode.addEventListener('click', () => activatePane('code'));
if (tabOutput) tabOutput.addEventListener('click', () => activatePane('output'));

// ---- scoring ----
function scoreBlobStrict(text, label) {
  const rows = [];
  let score = 0;
  const source = text ?? '';
  const got = firstNCharsPrintable(source, 3);

  const cases = [
    { name: 'Combining marks split over chunks', idx: 0 },
    { name: 'Idempotent NFC', idx: 1 },
    { name: 'Hangul Jamo compose', idx: 2 },
  ];

  const posComposed = source.indexOf('é');
  const posDecomp = source.search(RE_DECOMP);
  const decomposedFirst = posDecomp !== -1 && (posComposed === -1 || posDecomp < posComposed);

  for (const cfg of cases) {
    const want = EXPECT[cfg.idx];
    const ch = got[cfg.idx];
    let pass = ch === want;
    let note = '';

    if (cfg.idx === 0 && decomposedFirst) {
      pass = false;
      note = 'Decomposed e+◌́ appears before composed é';
    } else if (!pass) {
      const gotDesc = ch ? `${cp(ch)} '${ch}'` : '∅';
      note = `got ${gotDesc} want ${cp(want)} '${want}'`;
    }

    rows.push({ check: cfg.name, label, pass, note });
    if (pass) score += 1;
  }

  const hasReplacement = /\uFFFD/.test(source);
  rows.push({
    check: 'No replacement characters',
    label,
    pass: !hasReplacement,
    note: hasReplacement ? 'Found U+FFFD (�)' : '',
  });
  if (!hasReplacement) score += 1;

  return { rows, score };
}

function renderEvalTables(nakedEval, nepsisEval) {
  const container = get('evalTables');
  if (!container) return;

  const cardFor = (title, data) => {
    const rows = data.rows.map((check) => {
      const status = check.pass ? 'PASS' : 'FAIL';
      const color = check.pass ? 'var(--ok)' : 'var(--bad)';
      const note = check.note ? escapeHtml(check.note) : '';
      return `<tr>
        <td style="padding:8px;border-bottom:1px solid rgba(255,255,255,.05)">${escapeHtml(check.check)}</td>
        <td style="padding:8px;border-bottom:1px solid rgba(255,255,255,.05);font-weight:700;color:${color}">${status}</td>
        <td style="padding:8px;border-bottom:1px solid rgba(255,255,255,.05);color:var(--muted)">${note}</td>
      </tr>`;
    }).join('');
    return `<div class="card" style="padding:1rem">
      <h4 style="margin:0 0 .5rem">${escapeHtml(title)}</h4>
      <div style="margin-bottom:.5rem;color:var(--muted)">Score ${data.score}/4</div>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr>
            <th style="text-align:left;padding:10px;border-bottom:1px solid rgba(255,255,255,.1)">Check</th>
            <th style="text-align:left;padding:10px;border-bottom:1px solid rgba(255,255,255,.1)">Result</th>
            <th style="text-align:left;padding:10px;border-bottom:1px solid rgba(255,255,255,.1)">Notes</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  };

  container.innerHTML = [
    cardFor('Naked Output', nakedEval),
    cardFor('Nepsis-Scaffold Output', nepsisEval),
  ].join('\n');

  window._lastScoreRows = [...nakedEval.rows, ...nepsisEval.rows];
}

function rowsToCases(rows) {
  return rows.map((row) => ({
    prompt_id: row.check,
    pass: row.pass,
    reason: row.note || '',
  }));
}

function looksLikeCode(txt = '') {
  return /class\s+\w+|def\s+\w+\(|import\s+\w+|^\s*#/.test(txt);
}

const evaluateBtn = get('btnEvaluate');
if (evaluateBtn) {
  evaluateBtn.addEventListener('click', () => {
    const nakedText = get('nakedOut')?.value ?? '';
    const nepsisText = get('nepsisOut')?.value ?? '';

    if (looksLikeCode(nakedText) || looksLikeCode(nepsisText)) {
      showToast('Looks like you pasted code. Use the code tab to run tests directly.', false);
    }

    const eN = scoreBlobStrict(nakedText, 'naked');
    const eS = scoreBlobStrict(nepsisText, 'nepsis');

    renderEvalTables(eN, eS);
    const baselineCases = rowsToCases(eN.rows);
    if (baselineCases.length) recordRun('baseline', currentDifficulty, baselineCases, { latency: 0 });
    const nepsisCases = rowsToCases(eS.rows);
    if (nepsisCases.length) recordRun('nepsis', currentDifficulty, nepsisCases, { latency: 0 });
    showToast('Outputs evaluated');
  });
}

const downloadBtn = get('btnDownload');
if (downloadBtn) {
  downloadBtn.addEventListener('click', () => {
    if (!runHistory.length) {
      showToast('No runs recorded yet', false);
      return;
    }
    const header = ['run_id','ts','mode','difficulty','prompt_id','pass','reason','k','votes_passed','seeds','latency_ms','seed_strategy'];
    const lines = [header.join(',')];
    for (const run of runHistory) {
      for (const item of run.items) {
        lines.push([
          run.run_id,
          new Date(run.ts).toISOString(),
          run.mode,
          run.difficulty,
          item.prompt_id,
          item.pass ? '1' : '0',
          sanitizeReason(item.reason),
          String(run.k ?? K_CONSISTENCY),
          item.pass ? String(run.k ?? K_CONSISTENCY) : '0',
          JSON.stringify(run.seeds ?? SEEDS),
          run.latency_ms ?? '',
          SEED_STRATEGY,
        ].join(','));
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: 'scorecard.csv',
    });
    a.click();
    URL.revokeObjectURL(a.href);
    downloadBtn.classList.add('pulse');
    setTimeout(() => downloadBtn.classList.remove('pulse'), 350);
    showToast('Scorecard downloaded');
  });
}

let pyodideInstance = null;
let pyodideScriptPromise = null;

async function ensurePyodide() {
  if (!window.loadPyodide) {
    if (!pyodideScriptPromise) {
      pyodideScriptPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.js';
        script.onload = resolve;
        script.onerror = () => reject(new Error('Failed to load Pyodide runtime'));
        document.head.appendChild(script);
      });
    }
    await pyodideScriptPromise;
  }
  if (!window.loadPyodide) throw new Error('Pyodide loader unavailable');
  if (!pyodideInstance) {
    pyodideInstance = await window.loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.25.1/full/' });
  }
  return pyodideInstance;
}

function renderHarnessResults(payload) {
  const rawOutput = get('rawOutput');
  const tableOutput = get('tableOutput');
  const headline = get('headline');
  if (!rawOutput || !tableOutput) return;

  const stdout = (payload && payload.stdout) ? payload.stdout.trim() : '';
  if (stdout) {
    rawOutput.style.display = 'block';
    rawOutput.textContent = stdout;
  } else {
    rawOutput.style.display = 'none';
    rawOutput.textContent = '';
  }

  if (!payload) {
    tableOutput.innerHTML = '';
    if (headline) headline.textContent = '';
    return;
  }

  if (payload.fatal) {
    if (headline) {
      headline.textContent = 'Fatal error executing tests';
      headline.style.color = 'var(--bad)';
    }
    tableOutput.innerHTML = `<div class="card" style="padding:1rem"><strong class="bad">Fatal:</strong> ${escapeHtml(payload.fatal)}</div>`;
    return;
  }

  const cases = Array.isArray(payload.cases) ? payload.cases : [];
  if (!cases.length) {
    if (headline) {
      headline.textContent = 'No test results produced';
      headline.style.color = 'var(--muted)';
    }
    tableOutput.innerHTML = '<p style="color:var(--muted)">No results produced. Did the class run?</p>';
    return;
  }

  const passed = cases.filter((c) => c.ok).length;
  if (headline) {
    headline.textContent = `Code path: ${passed}/${cases.length} acceptance checks passed`;
    headline.style.color = passed === cases.length ? 'var(--ok)' : 'var(--bad)';
  }
  const rows = cases.map(({ name, ok, msg }) => {
    const statusLabel = ok ? 'PASS' : 'FAIL';
    const color = ok ? 'var(--ok)' : 'var(--bad)';
    return `<tr>
      <td style="padding:8px;border-bottom:1px solid rgba(255,255,255,.05)">${escapeHtml(name)}</td>
      <td style="padding:8px;border-bottom:1px solid rgba(255,255,255,.05);font-weight:700;color:${color}">${statusLabel}</td>
      <td style="padding:8px;border-bottom:1px solid rgba(255,255,255,.05);color:var(--muted)">${ok ? '' : escapeHtml(msg || '')}</td>
    </tr>`;
  }).join('');

  window._lastCases = cases;
  tableOutput.innerHTML = `
    <div style="margin:10px 0 6px;color:var(--muted)">Total: ${passed}/${cases.length} passed</div>
    <div style="padding:0;border:1px solid var(--line);border-radius:.8rem;background:rgba(15,27,45,.4);overflow:hidden">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr>
            <th style="text-align:left;padding:10px;border-bottom:1px solid rgba(255,255,255,.1)">Check</th>
            <th style="text-align:left;padding:10px;border-bottom:1px solid rgba(255,255,255,.1)">Result</th>
            <th style="text-align:left;padding:10px;border-bottom:1px solid rgba(255,255,255,.1)">Notes</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

const runBtn = get('runBtn');
if (runBtn) {
  const loader = get('loader');
  const solutionArea = get('solutionCode');
  runBtn.addEventListener('click', async () => {
    const code = solutionArea?.value ?? '';
    if (!code.trim()) {
      showToast('Paste your Utf8StreamNormalizer implementation first.', false);
      return;
    }
    renderHarnessResults(null);
    const headline = get('headline');
    if (headline) {
      headline.textContent = 'Running tests…';
      headline.style.color = 'var(--muted)';
    }
    const start = performance.now();
    runBtn.disabled = true;
    runBtn.textContent = 'Running…';
    if (loader) loader.style.display = 'inline';
    let pyRuntime = null;
    try {
      pyRuntime = await ensurePyodide();
      pyRuntime.globals.set('USER_CODE', code);
      const raw = await pyRuntime.runPythonAsync(PY_TEST_SCRIPT);
      try {
        pyRuntime.globals.delete('USER_CODE');
      } catch (cleanupErr) {
        try { pyRuntime.globals.set('USER_CODE', undefined); } catch (_ignore) {}
      }
      const data = JSON.parse(raw);
      renderHarnessResults(data);
      const normalizedCases = Array.isArray(data?.cases)
        ? data.cases.map((c) => ({ prompt_id: c.name, pass: c.ok, reason: c.msg || '' }))
        : [];
      if (normalizedCases.length) {
        const latency = Math.round(performance.now() - start);
        recordRun(currentMode, currentDifficulty, normalizedCases, { latency });
      }
      showToast('Tests completed');
    } catch (err) {
      console.error(err);
      if (pyRuntime) {
        try { pyRuntime.globals.delete('USER_CODE'); } catch (_cleanup) {}
      }
      renderHarnessResults({ fatal: err.message || String(err) });
      const outputArea = get('rawOutput');
      if (outputArea) {
        outputArea.style.display = 'block';
        outputArea.textContent = String(err);
      }
      showToast('Python runtime failed', false);
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = 'Run Tests →';
      if (loader) loader.style.display = 'none';
    }
  });
}
