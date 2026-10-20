// The ranks against each other: each rank against the next (and the apprentice against a random
// player, for scale), on duplicate deals: every deal is played twice, the two ranks swapping every
// seat, with the same cards and the same reshuffles, so the cards' luck cancels out and what's left
// is how they play. Half the seats each (with an odd count the extra seat changes hands with the
// deal); one round a deal; every seat's out-of-turn reflexes asked after each move (the mover's last,
// so the others catch before a late call). What it prints for each rank: points won a round and a
// seat, rounds won, and the edge of the better rank in points a round and a seat (its points won,
// less its points conceded shared among the others), with its standard error; and how long the
// master thinks.
//
//   node tools/ladder.mjs [deals] [players] [pairs]   200 deal pairs a table; 2,3,4,5,6 players;
//                                                     random-apprentice,apprentice-journeyman,journeyman-master
//   YKSI_MASTER_PLAYS=10000 node tools/ladder.mjs     a cheaper master, for a quicker ladder
//   RULES='{"stack":true,"jumpIn":true}' node tools/ladder.mjs 100   with house rules
import { act, createGame, handPoints } from '../server/rules.mjs';
import { MASTER_MS, PLAYS, botMove, botReflex, randomMove } from '../server/bots.mjs';

const DEALS = Number(process.argv[2] ?? 200);
const COUNTS = (process.argv[3] ?? '2,3,4,5,6').split(',').map(Number);
const PAIRS = (process.argv[4] ?? 'random-apprentice,apprentice-journeyman,journeyman-master').split(',').map((p) => p.split('-'));
const RULES = JSON.parse(process.env.RULES ?? '{}');

/** mulberry32: a repeatable random integer below n. @param {number} seed */
function seeded(seed) {
  let a = seed >>> 0;
  return (/** @type {number} */ n) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

/** @type {number[]} */
const times = [];
const started = Date.now();
console.log(`Yksi, ${DEALS} duplicate deal pairs a table${Object.keys(RULES).length ? `, rules ${JSON.stringify(RULES)}` : ''} (master: ${PLAYS} plays, ${MASTER_MS} ms stop):`);
for (const [low, high] of PAIRS) {
  console.log(`\n${low} against ${high}`);
  console.log('  players  rank          won/round  rounds won   edge of the better');
  for (const n of COUNTS) {
    const sum = { [low]: { won: 0, wins: 0, seats: 0 }, [high]: { won: 0, wins: 0, seats: 0 } };
    /** @type {number[]} */
    const edges = [];
    for (let d = 0; d < DEALS; d++) {
      let edge = 0;
      for (const flip of [0, 1]) {
        const level = (/** @type {number} */ seat) => ((seat + flip) % 2 ? high : low);
        const randomInt = seeded(20261020 + d * 7919 + n);
        const s = createGame({ players: n, dealer: d % n, rules: { ...RULES, target: 0 }, randomInt });
        for (let steps = 0; s.phase === 'play'; steps++) {
          if (steps > 5000) throw new Error(`deal ${d} doesn't end`);
          const seat = s.turn;
          const lv = level(seat);
          const t0 = performance.now();
          const move = lv === 'random' ? randomMove(s, seat, randomInt) : botMove(s, seat, { level: lv });
          if (lv === 'master') times.push(performance.now() - t0);
          act(s, seat, /** @type {any} */ (move), { randomInt });
          for (let k = 1; k <= n && s.phase === 'play'; k++) {
            const other = (seat + k) % n;
            if (level(other) === 'random') continue;
            const reflex = botReflex(s, other, { level: level(other) });
            if (reflex) act(s, other, reflex, { randomInt });
          }
        }
        const result = /** @type {NonNullable<typeof s.result>} */ (s.result);
        for (let seat = 0; seat < n; seat++) {
          const lv = level(seat);
          sum[lv].seats += 1;
          sum[lv].won += result.points[seat];
          if (s.winner === seat) sum[lv].wins += 1;
          const net = result.points[seat] - (s.winner === seat ? 0 : handPoints(s.hands[seat]) / (n - 1));
          edge += lv === high ? net : -net;
        }
      }
      edges.push(edge / n);
    }
    const mean = edges.reduce((a, b) => a + b, 0) / edges.length;
    const se = Math.sqrt(edges.reduce((a, b) => a + (b - mean) ** 2, 0) / edges.length / edges.length);
    for (const lv of [low, high]) {
      const st = sum[lv];
      const tail = lv === high ? `   ${high} ${mean >= 0 ? '+' : ''}${mean.toFixed(1)} ± ${se.toFixed(1)}` : '';
      console.log(`  ${String(n).padStart(7)}  ${lv.padEnd(12)}  ${(st.won / st.seats).toFixed(1).padStart(9)}  ${((100 * st.wins) / st.seats).toFixed(1).padStart(8)} %${tail}`);
    }
  }
}
times.sort((a, b) => a - b);
const at = (/** @type {number} */ q) => times[Math.min(times.length - 1, Math.floor(times.length * q))].toFixed(1);
console.log(`\n  (${((Date.now() - started) / 1000).toFixed(0)} s)`);
if (times.length) console.log(`  master: ${times.length} moves, median ${at(0.5)} ms, 90 % ${at(0.9)} ms, slowest ${at(1)} ms`);
