// Shared by the room tests: a fake clock, rooms set up the way pages use them.

import { createRooms } from '../server/rooms.mjs';
import { seeded } from './helpers.mjs';

/** A clock that only moves when the test says so. */
export function fakeClock(start = 1_000_000) {
  let t = start;
  let timers = [];
  return {
    now: () => t,
    setTimeout(fn, ms) {
      const handle = { at: t + ms, fn };
      timers.push(handle);
      return handle;
    },
    clearTimeout(handle) {
      timers = timers.filter((h) => h !== handle);
    },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = timers.filter((h) => h.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter((h) => h !== due);
        t = due.at;
        due.fn();
      }
      t = end;
    },
  };
}

export function setup(seed = 7) {
  const clock = fakeClock();
  const rooms = createRooms({ clock, randomInt: seeded(seed) });
  return { clock, rooms };
}

/** A page on the room's stream, keeping the latest view. */
export function watch(rooms, code, playerId = null) {
  const page = { view: null };
  page.close = rooms.subscribe(code, playerId, (event, data) => {
    if (event === 'view') page.view = JSON.parse(data);
  });
  return page;
}

const NAMES = ['Ben', 'Lea', 'Mia', 'Jonas', 'Emre', 'Sofia'];

/** A host and `others` more players, all on the stream and at the table, in that order. */
export function table(rooms, others = 2) {
  const host = rooms.create({ name: 'Anna', avatar: [1, 0, 0] });
  const seats = [host];
  for (let i = 0; i < others; i++) seats.push(rooms.join(host.code, { name: NAMES[i] }));
  const pages = seats.map((s) => watch(rooms, host.code, s.player));
  const act = (seat, action, body = {}) => rooms.act(host.code, seat.token, action, body);
  return { code: host.code, seats, pages, host, act };
}
