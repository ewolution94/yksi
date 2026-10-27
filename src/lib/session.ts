// What a device remembers: the name and seal you play under, and your seat in each room (so a
// reload, or the phone locking mid-game, puts you back in the same seat with your block). The name and the seal also go
// to Folio's shared cookie, so they follow you to the other ewolution games (development/plans/emblems.md).
// Storage can be blocked; then nothing is remembered and everything still works.

import type { Seat } from './api';
import type { Avatar } from './avatar';
import { playerEmblem, shareEmblem, sharedName, shareName } from '../../vendor/ewo/elements/emblem-shared.js';

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

/** The name field's maxlength: a name from another game may be longer. */
const NAME_MAX = 16;

/** The name you last joined with, here or in another ewolution game. */
export const savedName = () => (sharedName() || read(NAME) || '').slice(0, NAME_MAX);
export function saveName(name: string) {
  write(NAME, name.trim() || null);
  shareName(name);
}

/** Your seal: the one you picked in any coin game, else this game's own, else a random one (kept from then on). */
export function savedAvatar(): Avatar {
  let own: unknown = null;
  try {
    own = JSON.parse(read(AVATAR) ?? 'null');
  } catch {
    // a new one
  }
  const avatar = playerEmblem('token', own) as Avatar;
  write(AVATAR, JSON.stringify(avatar));
  return avatar;
}

/** A seal picked in the maker: kept here and shared with the other games. */
export function saveAvatar(a: Avatar) {
  write(AVATAR, JSON.stringify(a));
  shareEmblem('token', a);
}

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
