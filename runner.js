// ---- expected characters for each case ----
const CASES = [
  { key: 'cmb',    name: 'Combining marks split over chunks', expect: 'é' },
  { key: 'idem',   name: 'Idempotent NFC',                     expect: 'é' },
  { key: 'hangul', name: 'Hangul Jamo compose',                expect: '가' },
];

const PROMPT_PATHS = {
  naked: '/prompts/naked.txt',
  nepsis: '/prompts/scaffold.txt',
};

// ---- helpers ----
const get = (id) => document.getElementById(id);
const cp = (ch) => 'U+' + (ch.codePointAt(0).toString(16).toUpperCase());

function firstCharFrom(text) {
  if (!text) return '';
  const stripped = text.replace(/```[\s\S]*?```/g, '').trim();
  for (const ch of stripped) {
    if (!/\s|["'`]/.test(ch)) return ch;
  }
  return '';
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

// ---- scoring ----
function scoreBlob(text, label) {
  const rows = [];
  let score = 0;

  for (const c of CASES) {
    const found = (text ?? '').includes(c.expect);
    rows.push({
      check: c.name,
      label,
      pass: found,
      note: found ? '' : `did not find ${c.expect} (${cp(c.expect)})`,
    });
    if (found) score += 1;
  }

  const hasReplacement = /\uFFFD/.test(text ?? '');
  rows.push({
    check: 'No replacement characters',
    label,
    pass: !hasReplacement,
    note: hasReplacement ? 'Found U+FFFD (�) in output' : '',
  });
  if (!hasReplacement) score += 1;

  return { checks: rows, score };
}

function renderScores(nakedEval, nepsisEval) {
  const tbody = document.querySelector('#score tbody');
  const totalN = get('total-naked');
  const totalS = get('total-nepsis');
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

const evaluateBtn = get('evaluate');
if (evaluateBtn) {
  evaluateBtn.addEventListener('click', () => {
    const nakedText = get('naked-all').value;
    const nepsisText = get('nepsis-all').value;

    const eN = scoreBlob(nakedText, 'naked');
    const eS = scoreBlob(nepsisText, 'nepsis');

    renderScores(eN, eS);
    showToast('Scores updated');
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
