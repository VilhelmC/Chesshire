// The gap AMEND-6.1 §8 names: two rows on one square, both collected.
//
// `held()` asks each defender in isolation. Where a square depends on two pieces
// and BOTH are drawn away, the two rows are collected separately and their
// weights add — but the piece falls once. This measures how often that happens
// and how much material it over-states.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const d = mkdtempSync(join(tmpdir(), 'ho-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { complex } from './src/domain/complex';
export { traverse } from './src/domain/traverse';
export { see } from './src/domain/exchange';
export { positionFromFen } from './src/domain/chess';
export { makeFen } from 'chessops/fen';
export { makeSquare } from 'chessops/util';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const sq = (s) => M.makeSquare(s);
const P = JSON.parse(readFileSync('src/data/labPuzzles.json','utf8')).slice(0,N);
const play=(p,u)=>{const n=p.clone();const pr=u[4]?{q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]]:undefined;
 const mv={from:'abcdefgh'.indexOf(u[0])+8*(+u[1]-1),to:'abcdefgh'.indexOf(u[2])+8*(+u[3]-1)};if(pr)mv.promotion=pr;n.play(mv);return n;};
let n=0, hit=0, worstOver=0; const cases=[];
for(const p of P){let pos;try{pos=M.positionFromFen(p.fen)}catch{continue}
 for(let i=0;i<p.moves.length;i++){ n++;
  const c=M.complex(pos); const t=M.traverse(c);
  const bySquare=new Map();
  for(const o2 of t.collected){ if(o2.kind!=='held')continue;
   bySquare.set(o2.square,(bySquare.get(o2.square)??[]).concat(o2)); }
  for(const [s,rows] of bySquare){
   if(rows.length<2)continue;
   hit++;
   // What the square is ACTUALLY worth with every collected holder gone.
   const b=pos.board.clone(); for(const r of rows) b.take(r.holder);
   const truth=M.see(b,s,rows[0].claimant).value;
   const charged=rows.reduce((a,r)=>a+r.weight,0);
   worstOver=Math.max(worstOver,charged-truth);
   if(cases.length<12)cases.push(`${p.id} ply ${i}  ${sq(s)}: charged ${charged}, actually ${truth}  (holders ${rows.map(r=>sq(r.holder)).join('+')})\n      ${M.makeFen(pos.toSetup())}`);
  }
  try{pos=play(pos,p.moves[i])}catch{break}
 }}
console.log(`\n${n} positions`);
console.log(`  a square lost two holds at once : ${hit} (${(100*hit/n).toFixed(2)}%)`);
console.log(`  worst over-charge               : ${worstOver}\n`);
for(const x of cases) console.log(`  ${x}\n`);
