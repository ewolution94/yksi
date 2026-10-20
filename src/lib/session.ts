// What a device remembers: the name and seal you play under, and your seat in each room (so a
// reload, or the phone locking mid-game, puts you back in the same seat with your block). Storage can be blocked; then nothing is remembered and everything still works.

import type { Seat } from './api';
import { isAvatar, randomAvatar, type Avatar } from './avatar';

const NAME = 'yksi:name';
const AVATAR = 'yksi:avatar';
const SEAT = 'yksi:seat:';

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // not kept
  }
}

export const savedName = () => read(NAME) ?? '';
export const saveName = (name: string) => write(NAME, name.trim() || null);

/** Your avatar; a random one (kept from then on) the first time. */
export function savedAvatar(): Avatar {
  try {
    const value = JSON.parse(read(AVATAR) ?? 'null');
    if (isAvatar(value)) {
      saveAvatar(value);
      return value;
    }
  } catch {
    // a new one below
  }
  const fresh = randomAvatar();
  saveAvatar(fresh);
  return fresh;
}
export const saveAvatar = (a: Avatar) => write(AVATAR, JSON.stringify(a));

export function savedSeat(code: string): Seat | null {
  try {
    const seat = JSON.parse(read(SEAT + code) ?? 'null');
    return seat && typeof seat.token === 'string' && typeof seat.player === 'string' ? { ...seat, code } : null;
  } catch {
    return null;
  }
}

export function saveSeat(seat: Seat) {
  write(SEAT + seat.code, JSON.stringify({ player: seat.player, token: seat.token, at: Date.now() }));
  // Old rooms are long gone after a day; keep the storage tidy.
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key?.startsWith(SEAT) || key === SEAT + seat.code) continue;
      const at = JSON.parse(localStorage.getItem(key) ?? '{}')?.at ?? 0;
      if (Date.now() - at > 24 * 60 * 60_000) localStorage.removeItem(key);
    }
  } catch {
    // fine
  }
}

export const forgetSeat = (code: string) => write(SEAT + code, null);
