// Yksi QA: a game played through the page like a person would (a card that fits tapped twice, a
// wild's colour picked, the stock tapped to draw, "Keep", "yksi!" before the second-to-last card,
// "Caught!" when someone sits at one card without the call, a +4 taken or challenged), alone against
// bots (SOLO=1) or at a table with a code (a host, PEOPLE−1 guests who join through the page, bots for
// the rest). Screenshots at each new phase, overflow and console checks, and the jump check: every
// frame the seats, the middle, your end of the table and your hand are measured, and any move is
// listed under PROBLEMS (learnings/projects/stichle.md: "it cannot jump"). From Stammtisch's and
// Würfle's tools/qa.mjs. Not part of CI: Playwright is borrowed from Folio's checkout next door.
//
//   npm run build && node server/server.mjs --port 6711     (or the yksi-prod preview)
//   node tools/qa.mjs [base] [outdir]        W=390 H=844 LANG_UI=en ROUNDS=2 by default
//   SOLO=1 node tools/qa.mjs …               a game against bots in the page (offline-capable)
//   PEOPLE=2 node tools/qa.mjs …             a guest joins by the link and plays too
//   BOTS=master node tools/qa.mjs …          the bots' rank (apprentice, journeyman, master)
//   RULES=stack,jumpIn,sevenZero,drawToPlay  house rules on
//   FORGET=1 node tools/qa.mjs …             never call "yksi!" (the bots should catch it)
//   AUDIT=1 node tools/qa.mjs …              every shot also checks that text sits in the middle of its box
//   SCHEME=dark node tools/qa.mjs …          the page in dark mode
import { chromium, webkit } from '../../folio/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
import { digitAudit, stackAudit, textAudit } from './text-audit.mjs';

const BASE = process.argv[2] ?? 'http://localhost:6711';
const OUT = process.argv[3] ?? '/tmp/yksi-qa/';
const W = Number(process.env.W ?? 390), H = Number(process.env.H ?? 844);
const LANG = process.env.LANG_UI ?? 'en';
const PEOPLE = Number(process.env.PEOPLE ?? 1);
const SOLO = Boolean(process.env.SOLO);
const ROUNDS = Number(process.env.ROUNDS ?? 2);
const FORGET = Boolean(process.env.FORGET);
const RULES = (process.env.RULES ?? '').split(',').filter(Boolean);
const AUDIT = process.env.AUDIT ? Number(process.env.AUDIT) : 0;
const SCHEME = process.env.SCHEME === 'dark' ? 'dark' : 'light';
const offCentre = new Map();
const oldDigits = new Map();
const offStacks = new Map();
// The table's bar keeps its line in place; the round's line isn't centred on purpose.
const AUDIT_SKIP = ['header.top'];
mkdirSync(OUT, { recursive: true });

const problems = [];
const say = (...a) => console.log(...a);
const browser = await (process.env.BROWSER === 'chromium' ? chromium : webkit).launch();

async function person(name) {
  const touch = W < 768;
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, colorScheme: SCHEME, isMobile: touch, hasTouch: touch });
  await context.addInitScript(([lang]) => {
    try {
      localStorage.setItem('ewo:lang', lang);
      // The guide opens once on a first visit: seen already.
      localStorage.setItem('yksi:guide', '1');
    } catch {}
    const watched = ['.table .seats', '.table .felt', '.table .middle', '.table .dock', '.table .hand', '.table .shout'];
    const last = new Map();
    window.__jumps = [];
    const look = () => {
      for (const sel of watched) {
        const el = document.querySelector(sel);
        if (!el) {
          last.delete(sel);
          continue;
        }
        const r = el.getBoundingClientRect();
        const now = [r.left, r.top, r.width, r.height].map(Math.round).join(',');
        const was = last.get(sel);
        if (was && was !== now) window.__jumps.push(`${sel}: ${was} → ${now} (${document.querySelector('.status')?.textContent ?? (document.querySelector('.panel') ? 'panel' : '-')})`);
        last.set(sel, now);
      }
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  }, [LANG]);
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && problems.push(`${name} console: ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`${name} pageerror: ${e.message}`));
  return { name, context, page };
}

async function api(page, path, body, token) {
  return page.evaluate(
    async ([path, body, token]) => {
      const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'x-yksi-token': token } : {}) }, body: JSON.stringify(body ?? {}) });
      return r.status === 204 ? null : r.json();
    },
    [path, body, token],
  );
}

async function overflow(p, label) {
  const wide = await p.page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    return [...document.querySelectorAll('body *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > w + 1 && !el.closest('.hand, svg, .wrap, .peek, .cards, ewo-guide');
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} → ${Math.round(el.getBoundingClientRect().right)}`);
  });
  if (wide.length) problems.push(`${p.name} overflow at ${label}: ${wide.join(', ')}`);
}

let shot = 0;
async function snap(p, label) {
  await p.page.waitForTimeout(450);
  await p.page.screenshot({ path: `${OUT}${String(++shot).padStart(2, '0')}-${label}.png` });
  await overflow(p, label);
  if (!AUDIT) return;
  for (const [audit, map] of [[textAudit, offCentre], [stackAudit, offStacks]]) {
    for (const row of await p.page.evaluate(audit, { min: AUDIT, skip: AUDIT_SKIP })) {
      const key = `${row.where} | ${row.text.replace(/\d+/g, '#')}`;
      if (!map.has(key)) map.set(key, { ...row, at: label });
    }
  }
  for (const row of await p.page.evaluate(digitAudit)) {
    const key = `${row.where} | ${row.text.replace(/\d+/g, '#')}`;
    if (!oldDigits.has(key)) oldDigits.set(key, { ...row, at: label });
  }
}

/** One move like a person; returns what it did (or 'wait'). */
async function step(p) {
  const { what, tap } = await p.page.evaluate(
    ([forget]) => {
      let tap = null;
      // A tap where a finger lands on a card in the fan: its visible strip, near its left edge.
      const point = (el) => {
        const r = el.getBoundingClientRect();
        return [r.x + Math.min(14, r.width / 3), r.y + r.height * 0.45];
      };
      if (document.querySelector('.final')) return { what: 'final' };
      const next = document.querySelector('.result .btn.primary');
      if (next) {
        next.click();
        return { what: 'scored' };
      }
      if (document.querySelector('.result')) return { what: 'wait' };
      const colour = document.querySelector('.panel .colourbtn');
      if (colour) {
        colour.click();
        return { what: 'colour' };
      }
      const swap = document.querySelector('.panel .swaps .btn');
      if (swap) {
        swap.click();
        return { what: 'swap' };
      }
      const peek = document.querySelector('.panel .peek');
      if (peek) {
        document.querySelector('.panel .btn').click();
        return { what: 'peek' };
      }
      const challenge = document.querySelectorAll('.panel .pair .btn');
      if (challenge.length === 2) {
        // Now and then challenge, else take the four.
        challenge[Math.random() < 0.35 ? 0 : 1].click();
        return { what: 'challenged' };
      }
      const shout = document.querySelector('.shout:not([disabled])');
      if (shout?.classList.contains('catch')) {
        shout.click();
        return { what: 'catch' };
      }
      if (shout && shout.getAttribute('aria-pressed') === 'false' && !forget) {
        shout.click();
        return { what: 'call' };
      }
      if (!document.querySelector('.status.mine')) return { what: 'wait' };
      const lifted = document.querySelector('.hand .slot.lifted:not(.dim):not([aria-disabled="true"])');
      if (lifted) {
        tap = point(lifted);
        return { what: 'play', tap };
      }
      const legal = document.querySelector('.hand .slot:not(.dim):not([aria-disabled="true"])');
      if (legal) {
        tap = point(legal);
        return { what: 'lift', tap };
      }
      const keep = [...document.querySelectorAll('.actions .btn')].find((b) => /Keep|Behalten/.test(b.textContent ?? ''));
      if (keep) {
        keep.click();
        return { what: 'keep' };
      }
      const draw = document.querySelector('.actions .btn');
      if (draw) {
        draw.click();
        return { what: 'draw' };
      }
      return { what: 'stuck' };
    },
    [FORGET],
  );
  if (tap) await p.page.mouse.click(tap[0], tap[1]);
  return what;
}

async function play(people, label) {
  const [host] = people;
  const done = new Set();
  let rounds = 0;
  let quiet = 0;
  let lastStatus = '';
  for (let t = 0; t < 4000; t++) {
    for (const guest of people.slice(1)) {
      const did = await step(guest);
      if (did !== 'wait' && !done.has(`${guest.name}-${did}`)) {
        done.add(`${guest.name}-${did}`);
        await snap(guest, `${label}-guest-${did}`);
      }
    }
    // A round's result: shot before it's tapped away.
    if (!done.has('result') && (await host.page.locator('.result').count())) {
      done.add('result');
      await snap(host, `${label}-result`);
    }
    const what = await step(host);
    if (process.env.TRACE) say(t, what, await host.page.evaluate(() => document.querySelector('.status')?.textContent ?? ''));
    if (what === 'final') break;
    if (!done.has(what) && !['wait', 'lift'].includes(what)) {
      done.add(what);
      await snap(host, `${label}-${what}`);
    }
    if (what === 'scored') {
      rounds++;
      if (rounds >= ROUNDS) break;
    }
    if (what === 'stuck') {
      problems.push(`${label}: stuck at the table`);
      await snap(host, `${label}-stuck`);
      break;
    }
    // Nothing moving for 45 s: say what the page shows.
    const status = await host.page.evaluate(() => document.querySelector('.status, .toast')?.textContent ?? '');
    if (what === 'wait' && status === lastStatus) {
      if (++quiet > 110) {
        problems.push(`${label}: nothing moved for 45 s (${status})`);
        await snap(host, `${label}-frozen`);
        break;
      }
    } else quiet = 0;
    lastStatus = status;
    await host.page.waitForTimeout(what === 'wait' ? 400 : 260);
  }
  for (const p of people) {
    const jumps = await p.page.evaluate(() => window.__jumps);
    if (jumps.length) problems.push(`${p.name}: the table moved ${jumps.length}×:\n  ${[...new Set(jumps)].slice(0, 12).join('\n  ')}`);
  }
  return rounds;
}

const host = await person('host');
await host.page.goto(BASE, { waitUntil: 'load' });
await host.page.locator('input[autocomplete="nickname"]').fill('Anna');
await snap(host, 'home');

if (SOLO) {
  if (RULES.length) {
    await host.page.locator('details.more summary').click();
    for (const k of RULES) await host.page.locator(`ewo-switch[aria-label]`).nth(['stack', 'jumpIn', 'sevenZero', 'drawToPlay'].indexOf(k)).click();
  }
  await host.page.getByRole('button', { name: /^(Play against bots|Gegen Bots spielen|New game|Neues Spiel)$/ }).click();
  await host.page.waitForSelector('.table');
  await snap(host, 'solo-table');
  const rounds = await play([host], 'solo');
  say('solo rounds', rounds);
  await host.page.locator('.scores').click();
  await snap(host, 'solo-scores');
  await host.page.keyboard.press('Escape');
} else {
  const seat = await api(host.page, '/api/rooms', { name: 'Anna', avatar: [1, 2, 3] });
  await host.page.evaluate(([code, s]) => localStorage.setItem(`yksi:seat:${code}`, JSON.stringify({ ...s, at: Date.now() })), [seat.code, seat]);
  await host.page.goto(`${BASE}/${seat.code}`, { waitUntil: 'load' });
  await host.page.waitForSelector('.lobby');
  const people = [host];
  for (let i = 1; i < PEOPLE; i++) {
    const guest = await person(`guest${i}`);
    await guest.page.goto(`${BASE}/${seat.code}`, { waitUntil: 'load' });
    await guest.page.locator('.join input.input').fill(`Gast ${i}`);
    await guest.page.getByRole('button', { name: /^(Play|Mitspielen|Join the table|Mit an den Tisch)$/ }).click();
    await guest.page.waitForSelector('.lobby');
    people.push(guest);
  }
  if (process.env.BOTS) await api(host.page, `/api/rooms/${seat.code}/settings`, { bots: process.env.BOTS }, seat.token);
  if (RULES.length) await api(host.page, `/api/rooms/${seat.code}/settings`, { rules: Object.fromEntries(RULES.map((k) => [k, true])) }, seat.token);
  for (let i = people.length; i < 4; i++) await api(host.page, `/api/rooms/${seat.code}/bot`, { add: true }, seat.token);
  await snap(host, 'lobby');
  await host.page.getByRole('button', { name: /^(Start the match|Partie starten)$/ }).click();
  for (const p of people) await p.page.waitForSelector('.table');
  say('dealt', seat.code);
  const rounds = await play(people, 'room');
  say('room rounds', rounds);
  await host.page.locator('.scores').click();
  await snap(host, 'room-scores');
  await host.page.keyboard.press('Escape');
  await api(host.page, `/api/rooms/${seat.code}/stop`, {}, seat.token);
  await host.page.waitForSelector('.final', { timeout: 5000 }).catch(() => problems.push('no final screen'));
  await snap(host, 'room-final');
  for (const guest of people.slice(1)) {
    await guest.page.waitForSelector('.final', { timeout: 5000 }).catch(() => problems.push('the guest saw no final screen'));
    await snap(guest, 'guest-final');
    await guest.context.close();
  }
}
await host.context.close();
await browser.close();

if (offCentre.size)
  problems.push(
    `text off the middle of its box in ${offCentre.size} places (px, + low, − high; bias: the font's own share):\n  ${[...offCentre.values()]
      .sort((a, b) => Math.abs(b.off) - Math.abs(a.off))
      .map((r) => `${r.off > 0 ? '+' : ''}${r.off} (bias ${r.bias}) ${r.where} "${r.text}" ${r.font} h${r.height} @${r.at}`)
      .join('\n  ')}`,
  );
if (offStacks.size)
  problems.push(`stacked lines off the middle of their box in ${offStacks.size} places:\n  ${[...offStacks.values()].map((r) => `${r.off > 0 ? '+' : ''}${r.off} ${r.where} "${r.text}" ${r.lines} lines h${r.height} @${r.at}`).join('\n  ')}`);
if (oldDigits.size) problems.push(`old-style digits in ${oldDigits.size} places:\n  ${[...oldDigits.values()].map((r) => `${r.where} "${r.text}" ${r.font} [${r.numeric}] @${r.at}`).join('\n  ')}`);
say(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'no problems');
