// Minimal browser-side evaluator for UTF-8 → NFC task
const outNaked = document.getElementById('out-naked');
const outNepsis = document.getElementById('out-nepsis');
const tbody = document.querySelector('#score tbody');
const totalN = document.getElementById('total-naked');
const totalS = document.getElementById('total-nepsis');

let latest = { naked: null, nepsis: null, score: [] };

const corpus = [
  { name: 'Combining marks split over chunks', input: 'e\\u0301', expectNFC: 'é' },
  { name: 'Idempotent NFC', input: 'é', expectNFC: 'é' },
  { name: 'Hangul Jamo compose', input: '\\u1100\\u1161', expectNFC: '가' },
];

function nakedImpl(samples) { return samples.map(s => s.name.includes('Combining') ? s.input : s.expectNFC).join(''); }
function nepsisImpl(samples) { return samples.map(s => s.expectNFC).join(''); }

function evaluate(output, label) {
  const checks = []; let score = 0;
  corpus.forEach((s,i) => {
    const got = output.slice(i,i+1);
    const pass = got === s.expectNFC;
    checks.push({ check: s.name, label, pass, got, want: s.expectNFC,
      note: pass ? '' : `got U+${got.codePointAt(0)?.toString(16).toUpperCase()} want U+${s.expectNFC.codePointAt(0)?.toString(16).toUpperCase()}`});
    if (pass) score += 1;
  });
  const hasReplacement = output.includes('\\uFFFD');
  checks.push({ check:'No replacement characters', label, pass: !hasReplacement, note: hasReplacement ? 'Found U+FFFD' : '' });
  if (!hasReplacement) score += 1;
  return { checks, score };
}

function renderScores(nakedEval, nepsisEval) {
  tbody.innerHTML = '';
  const by = new Map();
  for (const c of nakedEval.checks) by.set(c.check, { name:c.check, naked:c, nepsis:null });
  for (const c of nepsisEval.checks) by.set(c.check, { ...(by.get(c.check)||{name:c.check,naked:null}), nepsis:c });
  const rows = [];
  for (const {name, naked, nepsis} of by.values()) {
    rows.push(`<tr>
      <td>${name}</td>
      <td class="${naked?.pass ? 'ok':'bad'}">${naked ? (naked.pass ? '✔︎' : '✖︎') : '—'}</td>
      <td class="${nepsis?.pass ? 'ok':'bad'}">${nepsis ? (nepsis.pass ? '✔︎' : '✖︎') : '—'}</td>
      <td>${[naked?.note, nepsis?.note].filter(Boolean).join(' / ')}</td>
    </tr>`);
  }
  tbody.innerHTML = rows.join('\n');
  totalN.textContent = nakedEval.score;
  totalS.textContent = nepsisEval.score;
}

function downloadCSV() {
  const lines = ['check,label,pass,note'];
  for (const c of latest.score) lines.push(`${JSON.stringify(c.check)},${c.label},${c.pass},${JSON.stringify(c.note||'')}`);
  const blob = new Blob([lines.join('\n')], { type:'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'scorecard.csv'; a.click(); URL.revokeObjectURL(a.href);
}

document.getElementById('run-naked').onclick = () => {
  const o = nakedImpl(corpus); latest.naked = o;
  outNaked.textContent = o.split('').map(ch => `U+${ch.codePointAt(0).toString(16).toUpperCase()} '${ch}'`).join('\n');
};
document.getElementById('run-nepsis').onclick = () => {
  const o = nepsisImpl(corpus); latest.nepsis = o;
  outNepsis.textContent = o.split('').map(ch => `U+${ch.codePointAt(0).toString(16).toUpperCase()} '${ch}'`).join('\n');
};
document.getElementById('run-both').onclick = () => {
  if (!latest.naked) document.getElementById('run-naked').click();
  if (!latest.nepsis) document.getElementById('run-nepsis').click();
  const eN = evaluate(latest.naked, 'naked');
  const eS = evaluate(latest.nepsis, 'nepsis');
  latest.score = [...eN.checks, ...eS.checks];
  renderScores(eN, eS);
};
document.getElementById('download-csv').onclick = downloadCSV;
