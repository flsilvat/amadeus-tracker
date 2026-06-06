/**
 * Canned responses for DRY_RUN mode.
 *
 * We simulate a 2-page LL response so the pagination + queue parser get a
 * proper workout. Page 1 ends without END OF DISPLAY; page 2 finishes it.
 */

const SAMPLE_AN = `AN11JULLHRDFW
** BRITISH AIRWAYS - AN ** DFW DALLAS.USTX                47 SA 11JUL 0000
1AA:BA1504  F4 A4 J7 C7 D7 R7 I7 /LHR 3 DFW D  0855   1300   E0/77W   10:05
            W6 E6 T2 Y7 B7 H7 K7 M7 L7 V7 N7 S7 O7 Q7
            OPERATED BY AMERICAN AIRLINES
2AA:BA1590  J7 C7 D7 R7 I6 W3 E3 /LHR 3 DFW D  1005   1420   E0/789   10:15
            TL Y7 B7 H7 K7 M7 L7 V7 N2 S6
            OPERATED BY AMERICAN AIRLINES
3   BA 193  F2 A1 J9 C9 D9 R9 I9 /LHR 5 DFW D  1255   1705   E0/388   10:10
            W9 E9 T9 Y9 B9 H9 K7 M3 GL
4AA:BA1520  F6 A6 J7 C7 D7 R1 IL /LHR 3 DFW D  1425   1845   E0/77W   10:20
            WL EL TL Y7 B7 H7 K7 M7 L7 V4 S1
            OPERATED BY AMERICAN AIRLINES
5AA:BA1530  F6 AL J5 C5 D5 RL IL /LHR 3 DFW D  1625   2039   E0/77W   10:14
            WL EL TL Y7 B7 H7 K7 M7 L7 V3
            OPERATED BY AMERICAN AIRLINES
)>`;

const SAMPLE_LL_PAGE_1 = `**PASSENGER LOADING LIST**
LL/BA0193/11JUL/LHR
-CAB---LEG--EQP--CAP---ADJ---UNS----BC----NC--
   F   LHRDFW 388  0014  000   002    0012  0000
-------------------------------------------------
   J   LHRDFW 388  0097  000   029    0068  0000
-------------------------------------------------
   W   LHRDFW 388  0055  000   020    0035  0000
-------------------------------------------------
   M   LHRDFW 388  0303  000   049    0254  0000
-------------------------------------------------
LHRDFW
001   SMITH/JOHN          BW69Z6   J
         PTC SBY
         OSI BA STF 21A/J19 DOJ12MAR15
002   JONES/SARAH         BMSI3D   J
         PTC SBY
         OSI BA STF 21B/J20 DOJ15JUN18
003   PATEL/RAJ           C9R49J   Y
         PTC SBY
         OSI BA STF 53B/M52 DOJ08JAN20
)>`;

const SAMPLE_LL_PAGE_2 = `LHRDFW
004   DAVIS/ELOISE        C9UET4   Y
         PTC SBY
         OSI BA STF 53C/M53 DOJ20SEP21
005   KIM/HANNA           D7K12P   C
         PTC BKB
         OSI BA STF 21A/J18 DOJ03FEB14
006   GARCIA/MIGUEL       E8L34Q   Y
         PTC SBY
         OSI BA STF 54/M01 DOJ11NOV22
END OF DISPLAY
)>`;

// MD command output when nothing more to page — same as last page.
const SAMPLE_LL_PAGE_2_REPEAT = SAMPLE_LL_PAGE_2;

let mdCallCount = 0;

export function sampleResponseFor(command) {
  if (command.startsWith('AN')) {
    mdCallCount = 0;
    return SAMPLE_AN;
  }
  if (command.startsWith('LL')) {
    mdCallCount = 0;
    return SAMPLE_LL_PAGE_1;
  }
  if (command === 'MD') {
    mdCallCount++;
    if (mdCallCount === 1) return SAMPLE_LL_PAGE_2;
    return SAMPLE_LL_PAGE_2_REPEAT; // identical → pagination loop will stop
  }
  return '';
}
