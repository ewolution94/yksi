# Yksi

Our own colour-matching card game for the afternoon meeting, against bots or at a table with
friends, at <https://yksi.ewolution.cloud>. Match the top card's colour, number or symbol; play
Skips, Reverses and Draw Twos; name a colour with a wild; and call "yksi!" before your second-to-last
card, or anyone can catch you and you draw two. German first, English beside it. Part of the
ewolution family (Stammtisch, Stichle, Würfle, CDNMS, Kritzle and Vollmond are its siblings).

The name is the app's own: Finnish for "one", what you call with one card left. The game's
trademarked name never appears, and the card art is drawn here (no oval, no copied faces).

## How it works

- **Against bots:** the rules and the bots run in the page (`server/rules.mjs` and `server/bots.mjs`
  are plain ESM the page imports as they are), so a game needs no server and plays offline once the
  service worker has the page. One to five bots at a rank you pick. The game is kept on the device as
  it goes (`yksi:solo`); finished games go into a small record (`yksi:record`) the start page shows.
- **With friends:** a table with a four-letter code (rooms in memory, `server/rooms.mjs`), a lobby
  with the order of play, two to ten at the table and anyone else watching, bots in three ranks to
  fill seats. The host picks how far the match goes (500 points, 200, or one round), the house rules,
  the clock and the bots' rank. One Server-Sent Events stream per page carries the room
  (`server/api.mjs`), and each page gets the rules' view for its own seat only: your hand, nobody
  else's. Moves are JSON posts.
- **The hand** (`src/components/Hand.svelte`, Folio's card kit): a fan along the bottom, two rows
  when it's too many cards for one; run a thumb along it and the cards lift; flick a card up, drag
  it, or tap it twice, and it flies to the pile. A card that doesn't fit shakes and drops back, and
  the line above the hand says why. Hold a card to look at it big (it tilts with the phone).
- **The call:** the round button by the right thumb (`src/components/Table.svelte`). With two cards
  left on your turn it lights up; tapped, the call goes with your next card. Forgotten, you're "open"
  until the next player moves: you may still call late, and everyone else's button turns into
  Caught (Erwischt), which makes you draw two. Bots catch too, after a moment that depends on their
  rank, and a bot whose turn is next waits 1.8 s so a person can catch first.
- **Questions float:** a wild asks for its colour, a 7 under the 7-0 rule whom to swap with, a Wild
  Draw Four played on you whether to challenge it; each panel floats over the table above the hand,
  so the table never changes size while you play (`tools/qa.mjs` measures it every frame).
- **The page holds still while playing:** the document doesn't scroll or bounce, and a touchmove on
  the table is claimed, except in a part that scrolls (iOS otherwise pulls the whole app).
- **Between rounds** the result (who went out, every hand shown, the points so far) waits for
  everyone's "Next round", or 25 s. The clock (off, 60 s or 25 s a turn): when it runs out, a bot
  plays the turn. Someone who closed the page has their turn played after 12 s.

## The rules

As in the maker's printed instructions (the 2009 sheet as the baseline, checked against the sheets
from 2001 to 2025, `development/plans/yksi.md`):

- 108 cards: four colours, each one 0, two each of 1–9, two Skips, two Reverses and two Draw Twos;
  four Wilds and four Wild Draw Fours. Seven cards each, play starts left of the dealer, clockwise.
- The upcard: a Wild Draw Four goes back and another is turned; a Wild lets the first player name
  the colour; a Draw Two makes the first player draw two and miss the turn; a Skip skips them; a
  Reverse turns play round and the dealer starts.
- A card goes on the pile when it matches the colour, the number or the symbol. A wild goes on
  anything and names the colour. You may draw instead of playing; a drawn card that fits may go
  straight on, else you keep it.
- With two players a Reverse works as a Skip.
- A Wild Draw Four is legal only without a card of the colour in play (other colours' cards and
  wilds don't count), but nothing stops a bluff: the next player may challenge. Guilty: the player
  who played it draws four, and the challenger plays on. Innocent: the challenger draws six and
  misses the turn.
- The call and the catch as above; a catch costs two cards.
- The stock runs out: the pile under its top card is shuffled into a new one.
- Whoever plays their last card wins the round (a last Draw Two or Four still makes the next player
  draw) and scores the cards left in the others' hands: numbers at face value, action cards 20,
  wilds 50. First to the target wins the match.
- **House rules,** each a switch, all off by default: stacking (a Draw Two on a Draw Two, a Four on a
  Four), jump-in (an identical card out of turn), 7-0 (a 7 swaps hands with someone, a 0 passes every
  hand on) and drawing until a card fits.

The bots, in three ranks (`server/bots.mjs`): the **apprentice** plays any card that fits every other
turn, picks colours half at random, forgets the call one time in four and never challenges. The
**journeyman** keeps its wilds for when nothing else fits, sheds the colour it holds most, hits a
player close to going out with a Draw Two or a Skip, plays a Wild Draw Four only when it may, always
calls, catches whoever forgets, and challenges a Four when its player's record says they bluff. The
**master** also remembers which colours each player drew on, bluffs a Four now and then, challenges by
the odds, and deals out the cards it can't see many times over to play its best few choices to the end
of the round, with a hard stop at 80 ms a move. No bot reads a hand but its own. On duplicate deals at
four (the same cards, the ranks swapping seats; `node tools/ladder.mjs`, 60 deal pairs, a 10,000-play
master), each rank wins more points a round and seat than the one below: the apprentice +62 over a
random player, the journeyman +19 over the apprentice, the master +6.5 ± 4.4 over the journeyman. The
master decides in about 9 ms (20 ms at most).

## Commands

```bash
npm install
npm run dev          # the whole app on one port (6710): the table server runs inside Vite
npm test             # the unit tests: the rules, the bots and the rooms on fixed deals (CI runs these)
npm run test:sim     # the simulated games: whole matches by bots and random players, the bots' timing (local only)
npm run check        # svelte-check
npm run build && npm start -- --port 6711    # the production server with the built page
node tools/qa.mjs http://localhost:6711      # a host and bots play through the page in WebKit, 390 px
SOLO=1 node tools/qa.mjs http://localhost:6711          # a game against bots in the page
PEOPLE=2 FORGET=1 node tools/qa.mjs …                   # a guest too, and nobody calls (the catch)
node tools/ladder.mjs                        # the bots' ranks against each other
```

The QA script borrows Playwright from Folio's checkout next door (`../folio/node_modules`).

## Deploy (NAS)

This mirrors Würfle and Stammtisch:

- `ci.yml` runs the typecheck, the unit tests and the build, then smoke-tests the production server: the
  page and its headers, a table with a guest and a bot, the deal on the guest's stream with only
  their own hand in it, a move refused.
- `docker-publish.yml` gates on `ci.yml`, then pushes `ghcr.io/ewolution94/yksi:latest` for amd64
  and arm64.
- The shared Watchtower picks the image up. A push to `release` is the whole deploy, and it ends any
  table in progress (games against bots carry on in their pages).
- The NAS runs `deploy/portainer-stack.yml`, on the port the workspace's registry holds for it, with
  the health check in Yksi's slot (every 768 s, `plans/nas-load.md`).
- The stack joins the external Docker network `ewolution`, where Census listens as `census:4901`.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `--port` | `8080` | Listen port |
| `HOST` | `0.0.0.0` | Listen address |
| `YKSI_CENSUS` | off | Census's ingest origin, `http://census:4901` on the NAS |
| `YKSI_MASTER_MS` | `100` | The master bot's time per decision |

## Project layout

```
server/
  server.mjs     the production server: /healthz, the API, the built page, the Census forwarder
  api.mjs        the rooms over HTTP and SSE
  rooms.mjs      tables with a code, seats, the host, bots and their reflexes, the clock, the rounds
  rules.mjs      the game as a pure state machine (also run by the page for games against bots)
  bots.mjs       the three ranks
  census.mjs     forwards /_e and /_e.js to Census
src/
  App.svelte     the routes: the start, /solo, /KXPT
  components/    Home, Join, Lobby, Game (a room), SoloGame, Table, Hand, RoundEnd, ScoreSheet, Final,
                 Settings, Guide …
  lib/deck.ts    the deck, drawn as SVG: look "Kangas", a Finnish screen print
  lib/match.ts   what the table shows (a MatchView) and asks (a Driver), for a room or a game alone
  lib/solo.svelte.ts   a game against bots in the page; lib/remote.ts the room's driver
tests/           rules, bots, rooms
tools/           qa.mjs, ladder.mjs, text-audit.mjs
vendor/ewo/      Folio's tokens and elements (`npm run vendor -- yksi` in folio); don't edit here
```
