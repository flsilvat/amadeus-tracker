/**
 * Parser + queue sanity check. Run with: npm run test:parser
 * Pure parser exercise — no JFE, no DB.
 */
import { parseAN, parseLL, sortQueueByPriority } from '../src/amadeus/parser.js';
import { buildAN, buildLL } from '../src/amadeus/commandBuilder.js';
import { sampleResponseFor } from '../src/amadeus/samples.js';

console.log('=== command builder ===');
const cmdCases = [
  { args: ['2026-07-15', 'LHR', 'SEA'], expect: 'AN15JULLHRSEA' },
  { args: ['2026-07-29', 'SEA', 'LHR'], expect: 'AN29JULSEALHR' },
  { args: ['2026-01-01', 'LHR', 'JFK'], expect: 'AN01JANLHRJFK' },
  { args: ['2026-12-31', 'LHR', 'SYD'], expect: 'AN31DECLHRSYD' },
];
let cmdOk = true;
for (const c of cmdCases) {
  const got = buildAN(...c.args);
  const pass = got === c.expect;
  if (!pass) cmdOk = false;
  console.log((pass ? '✅' : '❌'), got, pass ? '' : `(expected ${c.expect})`);
}
const llCmd = buildLL('193', '2026-07-11', 'LHR');
const llPass = llCmd === 'LL/BA0193/11JUL/LHR';
console.log((llPass ? '✅' : '❌'), llCmd);
if (!cmdOk || !llPass) { console.error('\n❌ command builder regression — aborting'); process.exit(1); }

console.log('=== parseAN ===');
const an = parseAN(sampleResponseFor('AN11JULLHRDFW'), { isoDate: '2026-07-11' });
console.log(`Total flights: ${an.flights.length}`);
console.log(`BA-operated:   ${an.flights.filter(f => f.isBAOperated).length}`);
console.log('BA flights:');
for (const f of an.flights.filter(f => f.isBAOperated)) {
  console.log(`  ${f.flightNo}  ${f.origin}→${f.destination}  ${f.depTime}-${f.arrTime}  ${f.equipment}`);
}

console.log('\n=== parseLL (single page) ===');
const llP1 = parseLL(sampleResponseFor('LL/BA0193/11JUL/LHR'));
console.log(`Cabins: ${llP1.cabins.length}, queue: ${llP1.queue.length}, complete: ${llP1.complete}`);

console.log('\n=== parseLL (concatenated 2 pages, simulating pagination) ===');
const combined = sampleResponseFor('LL/BA0193/11JUL/LHR') + '\n' + sampleResponseFor('MD');
const ll = parseLL(combined);
console.log(`Cabins: ${ll.cabins.length}, queue: ${ll.queue.length}, complete: ${ll.complete}`);
console.log('Queue (before sort):');
for (const q of ll.queue) {
  console.log(`  ${q.lineNo} ${q.name.padEnd(20)} STF=${q.stfCode.padEnd(10)} DOJ=${q.doj} PTC=${q.ptc}`);
}

console.log('\n=== queue after BA priority sort ===');
sortQueueByPriority(ll.queue);
for (const q of ll.queue) {
  console.log(`  #${q.position} ${q.name.padEnd(20)} STF=${q.stfCode.padEnd(10)} DOJ=${q.doj}`);
}

const expectedCabins = ['F', 'J', 'W', 'M'];
const cabinsOK = expectedCabins.every(c => ll.cabins.find(x => x.cabin === c));
console.log(cabinsOK ? '\n✅ All four cabins parsed' : '\n❌ Missing cabins');
console.log(ll.queue.length >= 6 ? '✅ Queue from both pages captured' : '❌ Queue incomplete');
console.log(ll.complete ? '✅ END OF DISPLAY detected' : '❌ END OF DISPLAY not detected');
