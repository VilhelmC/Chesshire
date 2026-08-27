// Does the ledger, at tau = 1, pick the puzzle's move? And when it doesn't, why?
//
// The number that matters is not "% solved". It is the breakdown by CAUSE:
// DEFICIENCY.md's claim is that a miss names the ledger row it is missing. If
// the causes come out as mush, that claim is wrong and this is where it shows.
//
// Ground truth is the puzzle's own solver plies. The old search is not consulted.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { build } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 200);
const d = mkdtempSync(join(tmpdir(),'lm-'));
const e = join(d,'e.ts');
writeFileSync(e, `export { ledger } from ${JSON.stringify(join(process.cwd(),'src/domain/ledger.ts'))};
export { verdict, claims } from ${JSON.stringify(join(process.cwd(),'src/domain/cover.ts'))};
export { positionFromFen, makeSquare, parseSquare } from ${JSON.stringify(join(process.cwd(),'src/domain/chess.ts'))};`);
const o = join(d,'b.mjs');
await build({entryPoints:[e],bundle:true,format:'esm',outfile:o,platform:'node',logLevel:'silent'});
const M = await import(o);
const sq = M.makeSquare;
const uci = (m)=>`${sq(m.from)}${sq(m.to)}${m.promotion?(m.promotion[0]==='k'?'n':m.promotion[0]):''}`;
const play=(p,u)=>{const n=p.clone();const pr=u[4]?{q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]]:undefined;
  const mv={from:M.parseSquare(u.slice(0,2)),to:M.parseSquare(u.slice(2,4))}; if(pr) mv.promotion=pr; n.play(mv); return n;};

const ALL = JSON.parse(readFileSync('src/data/labPuzzles.json','utf8')).slice(0, N);
const tally = {}; let CUR=null;
const byTheme={}; const allTheme={};
const bump=(k)=>{tally[k]=(tally[k]??0)+1; (byTheme[k] ??= {}); for(const t of CUR) byTheme[k][t]=(byTheme[k][t]??0)+1;};
const examples = {};
let plies=0, hit=0, sharp=0;
const sizes0=[], sizesN=[];
const hist=(a)=>{const h={};for(const n of a)h[n>=10?'10+':n]=(h[n>=10?'10+':n]??0)+1;return Object.entries(h).sort((x,y)=>(x[0]==='10+'?99:+x[0])-(y[0]==='10+'?99:+y[0])).map(([k,v])=>`${k}:${v}`).join(' ');};
const t0=Date.now();
for (const p of ALL) {
  let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
  for (let i=0;i<p.moves.length;i++){
    const want=p.moves[i];
    if (i>0 && i%2===1) {
      CUR=p.themes; for(const t of p.themes) allTheme[t]=(allTheme[t]??0)+1;
      plies++;
      let C; try { C = M.claims(pos); } catch { bump('threw'); C=null; }
      if (C && C.length) {
        const top=C[0].value;
        const mine=C.find(c=>uci(c.move)===want);
        const ties=C.filter(c=>c.value===top).length;
        if (mine && mine.value===top) {
          hit++;
          if (ties<=1) { sharp++; bump('found — sole top'); }
          else if (top===0) { bump('tied at ZERO — the ledger saw nothing'); sizes0.push(ties);
            (examples['tied at ZERO — the ledger saw nothing'] ??= []).length<6 &&
              examples['tied at ZERO — the ledger saw nothing'].push(`${p.id} ply${i} want ${want} (${ties} ties) [${p.themes.slice(0,3).join(',')}]`); }
          else { bump('tied above zero — no resolution'); sizesN.push(ties);
            (examples['tied above zero — no resolution'] ??= []).length<6 &&
              examples['tied above zero — no resolution'].push(`${p.id} ply${i} want ${want} val=${top} (${ties} ties, e.g. ${C.filter(c=>c.value===top).slice(0,3).map(c=>uci(c.move)).join('/')}) [${p.themes.slice(0,3).join(',')}]`); }
        } else if (!mine) {
          bump('move never generated');
        } else if (top===0) {
          bump('nothing visible at tau=1');
        } else if (mine.value===0) {
          bump('puzzle move scores zero — needs a deadline');
        } else {
          bump('wrong preference');
          const k='wrong preference';
          (examples[k] ??= []).length<6 && examples[k].push(`${p.id} ply${i} want ${want}(${mine.value}) got ${uci(C[0].move)}(${top}) [${p.themes.slice(0,3).join(',')}]`);
        }
        if (!mine || mine.value!==top) {
          const k2 = top===0 ? 'nothing visible at tau=1' : null;
          if (k2) (examples[k2] ??= []).length<6 && examples[k2].push(`${p.id} ply${i} want ${want} [${p.themes.slice(0,3).join(',')}]`);
        }
      } else if (C) bump('no legal moves');
    }
    try { pos=play(pos,want); } catch { break; }
  }
}
const ms=Date.now()-t0;
console.log(`\n${ALL.length} puzzles, ${plies} solver plies, ${(ms/plies).toFixed(0)}ms/ply\n`);
console.log(`hit (move is top-valued): ${hit}/${plies}  = ${(100*hit/plies).toFixed(1)}%`);
console.log(`sharp (top, and discriminating): ${sharp}/${plies} = ${(100*sharp/plies).toFixed(1)}%\n`);
console.log('by cause:');
for (const [k,v] of Object.entries(tally).sort((a,b)=>b[1]-a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
console.log(`\ntie-set sizes at zero: ${hist(sizes0)}`);
console.log(`tie-set sizes above zero: ${hist(sizesN)}`);
console.log('\nTHEME LIFT (share in bucket / share overall), themes with >=8 in bucket:');
for (const [k,n] of Object.entries(tally).sort((a,b)=>b[1]-a[1])) {
  const tt=byTheme[k]??{}; const rows=Object.entries(tt)
    .filter(([t,c])=>c>=8)
    .map(([t,c])=>[t,c,(c/n)/((allTheme[t]??1)/plies)])
    .sort((a,b)=>b[2]-a[2]).slice(0,6);
  if(rows.length) console.log(`  ${k}:\n` + rows.map(([t,c,l])=>`      x${l.toFixed(1)}  ${t} (${c})`).join('\n'));
}
for (const [k,v] of Object.entries(examples)) { console.log(`\n-- ${k}`); v.forEach(x=>console.log('   '+x)); }
