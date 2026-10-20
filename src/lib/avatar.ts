// An avatar is three small numbers: colours, division, charge (the maker's arrows, top to bottom).
// Folio's token emblem draws it as a round seal (<ewo-emblem theme="token">, vendor/ewo;
// development/plans/emblems.md), so every screen draws the same one. The server checks the same
// ranges (server/avatar.mjs; tests/avatar.test.mjs keeps them in step).

import { isEmblem, randomEmblem } from '../../vendor/ewo/elements/emblem-core.js';

export type Avatar = number[];

export const isAvatar = (value: unknown): value is Avatar => isEmblem('token', value);

export const randomAvatar = () => randomEmblem('token') as Avatar;
