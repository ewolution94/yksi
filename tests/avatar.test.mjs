import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AVATAR_PARTS, cleanAvatar } from '../server/avatar.mjs';
import { cleanEmblem, emblemRanges, isEmblem } from '../vendor/ewo/elements/emblem-core.js';

// The page draws seals with Folio's token emblem (vendor/ewo); the server checks avatars on its own
// (the runtime image carries no vendor files). These keep the two in step after a vendor update.

test("the server's ranges are the token emblem's", () => {
  assert.deepEqual([...AVATAR_PARTS], emblemRanges('token'));
});

test('the server keeps what the emblem keeps, and replaces what it replaces', () => {
  const cases = [[0, 0, 0], [7, 7, 15], [8, 0, 0], [0, 8, 0], [0, 0, 16], [13, 13, 23], [14, 0, 0], [0, 14, 0], [0, 0, 24], [1, 2], [1.5, 0, 0], '1,2,3', null];
  for (const raw of cases) {
    const ours = cleanAvatar(raw);
    assert.ok(isEmblem('token', ours), `${JSON.stringify(raw)} → ${ours}`);
    if (isEmblem('token', raw)) assert.deepEqual(ours, cleanEmblem('token', raw));
    else assert.notEqual(ours, raw);
  }
});
