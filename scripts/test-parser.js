/**
 * Parser + queue sanity check. Run with: npm run test:parser
 * Pure parser exercise — no JFE, no DB.
 */
import { parseAN, parseLL, sortQueueByPriority, selectLegFlights } from '../src/amadeus/parser.js';
import { buildAN, buildLL } from '../src/amadeus/commandBuilder.js';
import { sampleResponseFor } from '../src/amadeus/samples.js';

console.log('=== command builder ===');
const cmdCases = [
  { args: ['2026-07-15', 'LHR', 'SEA'], expect: 'ANBA15JULLHRSEA' },
  { args: ['2026-07-29', 'SEA', 'LHR'], expect: 'ANBA29JULSEALHR' },
  { args: ['2026-01-01', 'LHR', 'JFK'], expect: 'ANBA01JANLHRJFK' },
  { args: ['2026-12-31', 'LHR', 'SYD'], expect: 'ANBA31DECLHRSYD' },
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

console.log('\n=== selectLegFlights ===');
const check = (ok, label) => {
  console.log((ok ? '✅' : '❌'), label);
  if (!ok) process.exitCode = 1;
};
const legNos = (text, o, d) => {
  const r = selectLegFlights(parseAN(text).flights, o, d);
  return { nos: r.selected.map(f => `${f.flightNo}:${f.origin}-${f.destination}`).join(' '), coTerminal: r.coTerminal };
};

// Exact airport pair served by BA → only that pair, codeshares dropped.
const exactLeg = legNos(sampleResponseFor('AN11JULLHRDFW'), 'LHR', 'DFW');
check(exactLeg.nos === 'BA0193:LHR-DFW' && !exactLeg.coTerminal, `exact leg: ${exactLeg.nos}`);

// ORY→LHR: Amadeus answers PAR→LON. The only ORY flight is a Vueling
// codeshare, so the BA-operated CDG→LHR flights are picked up instead.
const AN_ORY_LHR = `ANBA04OCTORYLHR
** BRITISH AIRWAYS - AN ** LON LONDON.GB                       1 SU 04OCT 0000
 1   BA 315  J2 CL Y2 BL HL KL ML /CDG2C LHR 5  0750    0815  E0/320       1:25
             GL XL
 2   BA 301  J1 CL Y1 BL HL KL ML /CDG2C LHR 5  1035    1100  E0/320  EQT  1:25
             GL
 3VY:BA8136  Y9                   /ORY 1 LHR 4  1345    1415  E0/320       1:30
             OPERATED BY VUELING AIRLINES
 4   BA 305  JL CL Y3 BL HL KL ML /CDG2C LHR 5  1420    1445  E0/32Q       1:25
             GL XL
 5   BA 307  J1 C1 Y3 B3 HL KL ML /CDG2C LHR 5  1710    1725  E0/319       1:15
             GL XL
 6   BA 309  J1 C1 Y9 B9 H7 KL ML /CDG2C LHR 5  1930    1945  E0/320  EQT  1:15
             GL
 7   BA 313  J1 CL Y1 BL HL KL ML /CDG2C LHR 5  2140    2155  E0/319       1:15
             GL XL
NO MORE LATER FLTS   04OCT PAR LON
>`;
const ory = legNos(AN_ORY_LHR, 'ORY', 'LHR');
check(
  ory.coTerminal && ory.nos ===
    'BA0315:CDG-LHR BA0301:CDG-LHR BA0305:CDG-LHR BA0307:CDG-LHR BA0309:CDG-LHR BA0313:CDG-LHR',
  `co-terminal fallback (ORY→LHR): ${ory.nos}`
);

// No direct BA flight at all: the BA first legs of connections must NOT be
// picked up by the co-terminal fallback.
const AN_CONNECTIONS_ONLY = `ANBA04OCTORYJFK
** BRITISH AIRWAYS - AN ** NYC NEW YORK.USNY                   1 SU 04OCT 0000
 1   BA 315  J2 CL Y2 BL HL KL ML /CDG2C LHR 5  0750    0815  E0/320
             GL XL
     BA 117  J9 C9 D9 R9 I9 W9 E9 /LHR 5 JFK 8  1125    1420  E0/777      12:30
             T9 Y9 B9 H9
 2   BA 301  J1 CL Y1 BL HL KL ML /CDG2C LHR 5  1035    1100  E0/320
             GL
  AA:BA1511  J7 C7 D7 Y7 B7 H7 K7 /LHR 3 JFK 8  1340    1640  E0/77W      12:05
             OPERATED BY AMERICAN AIRLINES
>`;
const conn = legNos(AN_CONNECTIONS_ONLY, 'ORY', 'JFK');
check(conn.nos === '' && !conn.coTerminal, `connections only → nothing selected: "${conn.nos}"`);

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

console.log('\n=== parseLL (torn capture — mid-render screen tear) ===');
// Regression test for a real bug: Ctrl+C fired while JFE was still drawing
// the screen, so the first copy was torn right after passenger 002's header
// line, before their own PTC/OSI rows rendered. The automation's retry then
// captured a complete render, concatenated after the torn one. The queue
// parser used to read straight through the tear and attach passenger 001's
// leftover PTC/OSI rows (further down, in the retried copy) to passenger
// 002 — i.e. the wrong person's staff-travel code.
const TORN_LL = `**PASSENGER LOADING LIST**
LL/BA0001/01JAN/LHR
-CAB---LEG--EQP--CAP---ADJ---UNS----BC----NC--
   M   LHRJFK 388  0150  000   003    0148  0000
-------------------------------------------------
LHRJFK
001   ALLEN/TOM           AB12CD   M
         PTC BKB
         OSI BA STF 08/J12 DOJ01SEP11
002   BAKER/SUE           EF34GH   M
)>
**PASSENGER LOADING LIST**
         PTC BKB
         OSI BA STF 08/J12 DOJ01SEP11
002   BAKER/SUE           EF34GH   M
         PTC SBY
         OSI BA STF 54A/M48 DOJ16AUG23
END OF DISPLAY
)>`;
const torn = parseLL(TORN_LL).queue;
const allen = torn.find(q => q.lineNo === '001');
const baker = torn.find(q => q.lineNo === '002');
check(allen?.stfCode === '08/J12', `torn capture: ALLEN keeps their own code: ${allen?.stfCode}`);
check(
  baker?.stfCode === '54A/M48' && baker?.ptc === 'SBY' && baker?.doj === '16AUG23',
  `torn capture: BAKER keeps their own code, not ALLEN's leftover: ${JSON.stringify(baker)}`
);

const expectedCabins = ['F', 'J', 'W', 'M'];
const cabinsOK = expectedCabins.every(c => ll.cabins.find(x => x.cabin === c));
console.log(cabinsOK ? '\n✅ All four cabins parsed' : '\n❌ Missing cabins');
console.log(ll.queue.length >= 6 ? '✅ Queue from both pages captured' : '❌ Queue incomplete');
console.log(ll.complete ? '✅ END OF DISPLAY detected' : '❌ END OF DISPLAY not detected');
