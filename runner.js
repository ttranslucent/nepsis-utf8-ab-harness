// ---- config: expected NFC outputs for each case ----
const CASES = [
  { key: 'cmb',    name: 'Combining marks split over chunks', expect: 'é' }, // e + ◌́ → é
  { key: 'idem',   name: 'Idempotent NFC',                     expect: 'é' }, // é → é
  { key: 'hangul', name: 'Hangul Jamo compose',                expect: '가' }, // ᄀ + ᅡ → 가
];

// ---- utilities ----
const firstChar = (s) => (s ?? '').trim().replace(/^```[\s\S]*?```/g,'').trim().at(0) ?? '';
const cp = (ch) => 'U+' + (ch.codePointAt?.(0) ?? 0).toString(16).toUpperCase();

// ---- load prompts so users can copy them ----
// These files already exist in your repo:
async function loadPrompt(path){ const r = await fetch(path); return await r.text(); }
let prompts = { naked: '', nepsis: '' };
(async () => {
  try {
    prompts.naked  = await loadPrompt('/prompts/naked.txt');
    prompts.nepsis = await loadPrompt('/prompts/scaffold.txt');
  } catch { /* non-blocking */ }
})();

// ---- copy buttons ----
const copy = async (text) => navigator.clipboard.writeText(text);
document.getElementById('copy-naked') .onclick = () => copy(prompts.naked);
document.getElementById('copy-nepsis').onclick = () => copy(prompts.nepsis);

// ---- evaluation of *pasted* outputs ----
function evaluateSide(prefix){
  const results = [];
  let score = 0;

  // 3 case checks
  for (const c of CASES){
    const val = document.getElementById(`${prefix}-${c.key}`).value;
    const got = firstChar(val);
    const pass = got === c.expect;
    results.push({
      check: c.name, label: prefix, pass,
      note: pass ? '' : `got ${got ? `${cp(got)} '${got}'` : '∅'} want ${cp(c.expect)} '${c.expect}'`
    });
    if (pass) score += 1;
  }

  // replacement char check
  const allText = CASES.map(c => document.getElementById(`${prefix}-${c.key}`).value).join(' ');
  const bad = /\uFFFD/.test(allText);
  results.push({ check: 'No replacement characters', label: prefix, pass: !bad, note: bad ? 'Found U+FFFD' : '' });
  if (!bad) score += 1;

  return { checks: results, score };
}

function renderScores(nakedEval, nepsisEval){
  const tbody = document.querySelector('#score tbody');
  const totalN = document.getElementById('total-naked');
  const totalS = document.getElementById('total-nepsis');
  tbody.innerHTML = '';

  const byName = new Map();
  for (const c of nakedEval.checks)  byName.set(c.check, { name:c.check, naked:c,  nepsis:null });
  for (const c of nepsisEval.checks) byName.set(c.check, { ...(byName.get(c.check)||{name:c.check}), nepsis:c });

  const rows = [];
  for (const {name, naked, nepsis} of byName.values()){
    rows.push(`<tr>
      <td>${name}</td>
      <td class="${naked?.pass ? 'ok':'bad'}">${naked ? (naked.pass ? '✔︎':'✖︎') : '—'}</td>
      <td class="${nepsis?.pass ? 'ok':'bad'}">${nepsis ? (nepsis.pass ? '✔︎':'✖︎') : '—'}</td>
      <td>${[naked?.note, nepsis?.note].filter(Boolean).join(' / ')}</td>
    </tr>`);
  }
  tbody.innerHTML = rows.join('\n');
  totalN.textContent = nakedEval.score;
  totalS.textContent = nepsisEval.score;

  // stash for CSV
  window._lastScoreRows = [...nakedEval.checks, ...nepsisEval.checks];
}

document.getElementById('evaluate').onclick = () => {
  const eN = evaluateSide('naked');
  const eS = evaluateSide('nepsis');
  renderScores(eN, eS);
};

// ---- CSV download ----
document.getElementById('download-csv').onclick = () => {
  const rows = window._lastScoreRows || [];
  const lines = ['check,label,pass,note', ...rows.map(
    r => `${JSON.stringify(r.check)},${r.label},${r.pass},${JSON.stringify(r.note||'')}`
  )];
  const blob = new Blob([lines.join('\n')], {type:'text/csv'});
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob), download: 'scorecard.csv'
  });
  a.click(); URL.revokeObjectURL(a.href);
};
