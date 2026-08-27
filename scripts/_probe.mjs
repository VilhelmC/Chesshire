import { writeFileSync, mkdtempSync } from 'node:fs';
import { build } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'pr-'));
const e = join(dir, 'e.ts');
writeFileSync(e, `export { ledger } from ${JSON.stringify(join(process.cwd(),'src/domain/ledger.ts'))};
export { verdict, claims } from ${JSON.stringify(join(process.cwd(),'src/domain/cover.ts'))};
export { positionFromFen, makeSquare } from ${JSON.stringify(join(process.cwd(),'src/domain/chess.ts'))};`);
const o = join(dir,'b.mjs');
await build({entryPoints:[e],bundle:true,format:'esm',outfile:o,platform:'node',logLevel:'silent'});
const M = await import(o);
const sq = M.makeSquare;
const uci = (m)=>`${sq(m.from)}${sq(m.to)}${m.promotion?m.promotion[0]:''}`;
const V=(n)=>n===Infinity?'INF':n;
for (const [label,fen] of [
  ['rook en prise', '4k3/8/8/8/8/4r3/4R3/4K3 b - - 0 1'],
  ['knight forks K+R', 'r3k3/2N5/8/8/8/8/8/4K3 b - - 0 1'],
  ['quiet start', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'],
  ['fork available', '4k3/8/8/8/8/8/r7/2N1K3 w - - 0 1'],
]) {
  const p = M.positionFromFen(fen);
  const L = M.ledger(p, p.turn);
  const v = M.verdict(p);
  console.log(`\n## ${label}  [${p.turn} to move]`);
  console.log('  owes:', L.map(o=>`${o.role}@${sq(o.square)}=${V(o.weight)}`).join(' ') || '(nothing)');
  console.log(`  mode=${v.mode} concession=${V(v.concession)} best=${v.best?uci(v.best.move):'-'} survives=${v.survives?sq(v.survives.square)+'='+V(v.survives.weight):'-'}`);
  const c = M.claims(p).slice(0,3);
  console.log('  top claims:', c.map(x=>`${uci(x.move)}:${V(x.deficiency)}`).join(' '));
}
