// ---- config: expected NFC outputs for each case ----
const CASES = [
  { key: 'cmb',    name: 'Combining marks split over chunks', expect: 'é' }, // e + ◌́ → é
  { key: 'idem',   name: 'Idempotent NFC',                     expect: 'é' }, // é → é
  { key: 'hangul', name: 'Hangul Jamo compose',                expect: '가' }, // ᄀ + ᅡ → 가
];

const PROMPT_PATHS = {
  naked: '/prompts/naked.txt',
  nepsis: '/prompts/scaffold.txt',
};

// ---- utilities ----
const firstChar = (s) => (s ?? '').trim().replace(/^```[\s\S]*?```/g, '').trim().at(0) ?? '';
const cp = (ch) => 'U+' + (ch.codePointAt?.(0) ?? 0).toString(16).toUpperCase();

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

function showToast(msg, ok = true) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.style.borderColor = ok ? 'rgba(16,185,129,.4)' : 'rgba(239,68,68,.4)';
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 1400);
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

async function loadPrompt(path) {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`Failed to load ${path}: ${res.status}`);
  }
  return await res.text();
}

const prompts = { naked: null, nepsis: null };
const promptLoads = {};
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
  naked: document.getElementById('copy-naked'),
  nepsis: document.getElementById('copy-nepsis'),
};

for (const [kind, button] of Object.entries(copyButtons)) {
  if (!button) continue;
  button.addEventListener('click', async (event) => {
    try {
      const prompt = await ensurePrompt(kind);
      await copy(prompt, event.currentTarget);
    } catch (err) {
      console.error(err);
      flashCopy(event.currentTarget, false, 'Copy failed');
    }
  });
}

// ---- evaluation of *pasted* outputs ----
function evaluateSide(prefix) {
  const results = [];
  let score = 0;

  for (const c of CASES) {
    const val = document.getElementById(`${prefix}-${c.key}`).value;
    const got = firstChar(val);
    const pass = got === c.expect;
    results.push({
      check: c.name,
      label: prefix,
      pass,
      note: pass ? '' : `got ${got ? `${cp(got)} '${got}'` : '∅'} want ${cp(c.expect)} '${c.expect}'`,
    });
    if (pass) score += 1;
  }

  const allText = CASES.map((c) => document.getElementById(`${prefix}-${c.key}`).value).join(' ');
  const bad = /\uFFFD/.test(allText);
  results.push({ check: 'No replacement characters', label: prefix, pass: !bad, note: bad ? 'Found U+FFFD' : '' });
  if (!bad) score += 1;

  return { checks: results, score };
}

function renderScores(nakedEval, nepsisEval) {
  const tbody = document.querySelector('#score tbody');
  const totalN = document.getElementById('total-naked');
  const totalS = document.getElementById('total-nepsis');
  tbody.innerHTML = '';

  const byName = new Map();
  for (const c of nakedEval.checks) byName.set(c.check, { name: c.check, naked: c, nepsis: null });
  for (const c of nepsisEval.checks) byName.set(c.check, { ...(byName.get(c.check) || { name: c.check }), nepsis: c });

  const rows = [];
  const symbol = (entry) => (entry == null ? '—' : entry.pass ? '✔︎' : '✖︎');
  const stateClass = (entry) => (entry == null ? '' : entry.pass ? 'ok' : 'bad');
  for (const { name, naked, nepsis } of byName.values()) {
    rows.push(`<tr>
      <td>${name}</td>
      <td class="${stateClass(naked)}">${symbol(naked)}</td>
      <td class="${stateClass(nepsis)}">${symbol(nepsis)}</td>
      <td>${[naked?.note, nepsis?.note].filter(Boolean).join(' / ')}</td>
    </tr>`);
  }
  tbody.innerHTML = rows.join('\n');
  totalN.textContent = nakedEval.score;
  totalS.textContent = nepsisEval.score;

  window._lastScoreRows = [...nakedEval.checks, ...nepsisEval.checks];
}

const evaluateBtn = document.getElementById('evaluate');
if (evaluateBtn) {
  evaluateBtn.addEventListener('click', () => {
    const eN = evaluateSide('naked');
    const eS = evaluateSide('nepsis');
    renderScores(eN, eS);
    showToast('Scores updated');
  });
}

const downloadBtn = document.getElementById('download-csv');
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
    pulseButton(downloadBtn);
    showToast('Scorecard downloaded');
  });
}
