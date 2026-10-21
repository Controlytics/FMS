// Renders QA/results/phase4/matrix.json as a compact markdown table (privilege x role).
import fs from 'node:fs';
const m = JSON.parse(fs.readFileSync('QA/results/phase4/matrix.json', 'utf8'));
const roles = ['ADMIN', 'SUPERVISOR', 'MANAGER', 'QA', 'SHIFTOFFICER', 'OPERATOR'];
const code = (r) => {
  if (r.verdict.startsWith('LEAK') && r.verdict.includes('toggle ON')) return r.passedAtBaseline ? '**D=**' : '**D+**';
  if (r.verdict.startsWith('LEAK')) return r.passedAtBaseline ? '**X=**' : '**X+**';
  if (r.verdict.startsWith('REFUSED')) return '**R**';
  if (r.verdict.startsWith('CONFIG DRIFT')) return '**d**';
  if (r.verdict.startsWith('FE/BE')) return '**F**';
  if (r.observed === 'allowed') return 'Y';
  if (r.observed === 'denied') return '-';
  return r.doc ? 'y?' : '-?';
};
const ids = [...new Set(m.map((r) => r.node))];
let s = `| Privilege | ${roles.join(' | ')} |\n|---|${roles.map(() => '---').join('|')}|\n`;
for (const id of ids) s += `| \`${id}\` | ${roles.map((ro) => code(m.find((r) => r.node === id && r.role === ro))).join(' | ')} |\n`;
fs.writeFileSync('QA/results/phase4/matrix.md', s);
console.log(ids.length, 'rows');
