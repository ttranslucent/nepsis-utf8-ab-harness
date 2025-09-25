const PROMPT_PATHS = {
  naked: '/prompts/naked.txt',
  nepsis: '/prompts/scaffold.txt',
};

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

const NDA_PROMPT_MSG = 'Nepsis-Scaffold prompt is proprietary. To evaluate under NDA, email ttranslucent@gmail.com. (You can still paste your class below and run the tests.)';

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

// ---- prompt loading ----
const prompts = { naked: null, nepsis: null };
const promptLoads = {};

async function loadPrompt(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return await res.text();
}

async function ensurePrompt(kind) {
  if (prompts[kind] != null) return prompts[kind];
  promptLoads[kind] ??= (async () => {
    const path = PROMPT_PATHS[kind];
    if (!path) throw new Error(`Unknown prompt kind: ${kind}`);
    const text = await loadPrompt(path);
    prompts[kind] = text;
    return text;
  })();
  return promptLoads[kind];
}

(async () => {
  try {
    await Promise.all(Object.keys(PROMPT_PATHS).map((kind) => ensurePrompt(kind)));
  } catch (err) {
    console.warn('Prompt prefetch failed', err);
  }
})();

const copyButtons = {
  naked: get('copy-naked'),
  nepsis: get('copy-nepsis'),
};

for (const [kind, button] of Object.entries(copyButtons)) {
  if (!button) continue;
  button.addEventListener('click', async (event) => {
    try {
      button.classList.add('is-armed');
      const prompt = await ensurePrompt(kind);
      await copy(prompt, event.currentTarget);
    } catch (err) {
      console.error(err);
      flashCopy(event.currentTarget, false, 'Copy failed');
    } finally {
      setTimeout(() => button.classList.remove('is-armed'), 1200);
    }
  });
}

const copyPromptBtn = get('copyPrompt');
if (copyPromptBtn) {
  copyPromptBtn.addEventListener('click', async (event) => {
    const modeSel = get('modeSel');
    const llmSel = get('llmSel');
    const target = (modeSel?.value === 'scaffold') ? 'nepsis' : 'naked';
    try {
      const promptText = target === 'nepsis'
        ? NDA_PROMPT_MSG
        : buildNakedPrompt(llmSel?.value || '');
      await navigator.clipboard.writeText(promptText);
      const toast = get('promptToast');
      if (toast) {
        const modeLabel = target === 'nepsis' ? 'Nepsis-scaffold' : 'Naked';
        const llmLabel = llmSel?.value ? ` for ${llmSel.value}` : '';
        toast.textContent = `Copied ${modeLabel} prompt${llmLabel}`;
        toast.style.display = 'inline';
        setTimeout(() => { toast.style.display = 'none'; }, 1600);
      }
    } catch (err) {
      console.error(err);
      showToast('Prompt copy failed', false);
    }
  });
}

const codePane = get('codePane');
const outputPane = get('outputPane');
const tabCode = get('tabCode');
const tabOutput = get('tabOutput');

function activatePane(which) {
  const showCode = which === 'code';
  if (codePane) codePane.style.display = showCode ? 'block' : 'none';
  if (outputPane) outputPane.style.display = showCode ? 'none' : 'block';
  if (tabCode) {
    tabCode.classList.toggle('btn-primary', showCode);
    tabCode.classList.toggle('btn-ghost', !showCode);
  }
  if (tabOutput) {
    tabOutput.classList.toggle('btn-primary', !showCode);
    tabOutput.classList.toggle('btn-ghost', showCode);
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

function looksLikeCode(txt = '') {
  return /class\s+\w+|def\s+\w+\(|import\s+\w+|^\s*#/.test(txt);
}

const evaluateBtn = get('evaluate');
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
    showToast('Outputs evaluated');
  });
}

const downloadBtn = get('download-csv');
if (downloadBtn) {
  downloadBtn.addEventListener('click', () => {
    const rows = window._lastScoreRows || [];
    if (!rows.length) {
      showToast('Run Evaluate first', false);
      return;
    }
    const lines = ['check,label,pass,note', ...rows.map(
      (r) => `${JSON.stringify(r.check)},${r.label},${r.pass},${JSON.stringify(r.note || '')}`,
    )];
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
      showToast('Tests completed');
    } catch (err) {
      console.error(err);
      if (pyRuntime) {
        try { pyRuntime.globals.delete('USER_CODE'); } catch (_cleanup) {}
      }
      renderHarnessResults({ fatal: err.message || String(err) });
      if (rawOutput) {
        rawOutput.style.display = 'block';
        rawOutput.textContent = String(err);
      }
      showToast('Python runtime failed', false);
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = 'Run Tests →';
      if (loader) loader.style.display = 'none';
    }
  });
}
