// An avatar is three small numbers: colours, division, charge (the maker's arrows, top to bottom).
// The page draws it with Folio's token emblem, a round seal (src/lib/avatar.ts); the server only
// checks the ranges (the runtime image carries no vendor files).

/** How many choices each part has: the token emblem's (tests/avatar.test.mjs checks they match). */
export const AVATAR_PARTS = Object.freeze([14, 14, 24]);

/** A valid avatar from whatever came in, or a random one. */
export function cleanAvatar(raw, random = Math.random) {
  if (Array.isArray(raw) && raw.length === AVATAR_PARTS.length && raw.every((v, i) => Number.isInteger(v) && v >= 0 && v < AVATAR_PARTS[i])) {
    return [...raw];
  }
  return randomAvatar(random);
}

export function randomAvatar(random = Math.random) {
  return AVATAR_PARTS.map((n) => Math.floor(random() * n));
}
