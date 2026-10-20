// The deck, drawn as SVG in the page: look A, "Kangas" (the user's pick, 2026-10-20), a screen print
// on cool paper. Each card is flat ink cut from a giant print of its colour's sign; the numerals in
// Unbounded. Every colour carries a sign, Stichle's suits' (red ▲, blue ●, green ■, yellow ◆), in
// both corners, so the colours stay apart without colour vision. The wilds are the four signs on
// black; the back is the lagoon with the four signs in a pattern and the wordmark. Our own art: no
// oval, nothing copied. Sketch: development/plans/yksi/looks.html.
//
// Card ids are the server's (server/rules.mjs): '<colour>-<face>-<copy>', colour r y g b (w for the
// wilds), face 0–9, skip, rev, d2, wild or d4. The copy only tells two equal cards apart.

export type Colour = 'r' | 'y' | 'g' | 'b';
export type Face = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'skip' | 'rev' | 'd2' | 'wild' | 'd4';

export const COLOURS: Colour[] = ['r', 'y', 'g', 'b'];

/** The four print inks, and each one's darker overprint (the giant sign). */
export const INK: Record<Colour, string> = { r: '#df432d', y: '#f2b600', g: '#1f8a5a', b: '#2462c8' };
const SHADE: Record<Colour, string> = { r: '#c4321e', y: '#dc9e00', g: '#167049', b: '#1a4ea8' };
const PAPER = '#fbfaf5';
/** On yellow, the numerals are printed in a dark ink: paper white on yellow is too faint. */
const DARK = '#2b2410';
const WILD = '#1d1f22';
export const LAGOON = '#007183';
const LAGOON_HI = '#0c8597';
export const SUN = '#f2b600';

/** The card's box: 100 × 140, the card kit's 5 : 7. */
const W = 100;
const H = 140;

const CARD = /^([rygbw])-(\d|skip|rev|d2|wild|d4)-(\d)$/;

export function parse(id: string | null | undefined): { c: Colour | null; f: Face } | null {
  const m = id ? CARD.exec(id) : null;
  if (!m) return null;
  return { c: m[1] === 'w' ? null : (m[1] as Colour), f: m[2] as Face };
}

export const isWild = (f: Face) => f === 'wild' || f === 'd4';
export const isNumber = (f: Face) => /^\d$/.test(f);

/** A colour's sign, centred on (x, y); s is half its size. */
export function sign(c: Colour, x: number, y: number, s: number, fill: string, extra = '') {
  if (c === 'r') return `<path d="M${x} ${y - s}L${x + s * 1.05} ${y + s * 0.82}H${x - s * 1.05}Z" fill="${fill}" ${extra}/>`;
  if (c === 'b') return `<circle cx="${x}" cy="${y}" r="${s * 0.92}" fill="${fill}" ${extra}/>`;
  if (c === 'g') return `<rect x="${x - s * 0.8}" y="${y - s * 0.8}" width="${s * 1.6}" height="${s * 1.6}" rx="${s * 0.12}" fill="${fill}" ${extra}/>`;
  return `<path d="M${x} ${y - s * 1.05}L${x + s * 0.9} ${y}L${x} ${y + s * 1.05}L${x - s * 0.9} ${y}Z" fill="${fill}" ${extra}/>`;
}

/** A colour's sign on its own, for chips and buttons. */
export const signSvg = (c: Colour, fill = INK[c]) => `<svg viewBox="-12 -12 24 24" aria-hidden="true">${sign(c, 0, 0, 10, fill)}</svg>`;

/** The action symbols, centred on (x, y) at size s: skip (a barred ring), reverse (two arrows). */
function symbol(f: Face, x: number, y: number, s: number, fill: string) {
  if (f === 'skip') {
    return `<circle cx="${x}" cy="${y}" r="${s * 0.78}" fill="none" stroke="${fill}" stroke-width="${s * 0.26}"/><path d="M${x - s * 0.55} ${y + s * 0.55}L${x + s * 0.55} ${y - s * 0.55}" stroke="${fill}" stroke-width="${s * 0.26}" stroke-linecap="round"/>`;
  }
  if (f === 'rev') {
    const w = s * 0.2;
    return `<g fill="none" stroke="${fill}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"><path d="M${x - s * 0.75} ${y - s * 0.12}V${y - s * 0.3}Q${x - s * 0.75} ${y - s * 0.62} ${x - s * 0.42} ${y - s * 0.62}H${x + s * 0.6}"/><path d="M${x + s * 0.32} ${y - s * 0.9}L${x + s * 0.62} ${y - s * 0.62}L${x + s * 0.32} ${y - s * 0.34}"/><path d="M${x + s * 0.75} ${y + s * 0.12}V${y + s * 0.3}Q${x + s * 0.75} ${y + s * 0.62} ${x + s * 0.42} ${y + s * 0.62}H${x - s * 0.6}"/><path d="M${x - s * 0.32} ${y + s * 0.9}L${x - s * 0.62} ${y + s * 0.62}L${x - s * 0.32} ${y + s * 0.34}"/></g>`;
  }
  if (f === 'wild') return `<circle cx="${x}" cy="${y}" r="${s * 0.62}" fill="none" stroke="${fill}" stroke-width="${s * 0.22}"/><circle cx="${x}" cy="${y}" r="${s * 0.2}" fill="${fill}"/>`;
  return '';
}

const label = (f: Face) => (f === 'd2' ? '+2' : f === 'd4' ? '+4' : isNumber(f) ? f : '');
const num = (size: number, x: number, y: number, fill: string, text: string) =>
  `<text x="${x}" y="${y}" text-anchor="middle" font-family="Unbounded, 'Familjen Grotesk', system-ui, sans-serif" font-weight="800" font-size="${size}" fill="${fill}">${text}</text>`;

/** The corner indices: the numeral or symbol, the colour's sign under it; the second turned round. */
function index(c: Colour | null, f: Face, on: string) {
  const one = (x: number, y: number, flip: boolean) => {
    const turn = flip ? ` transform="rotate(180 ${x} ${y})"` : '';
    const text = label(f);
    const glyph = text ? num(text.length > 1 ? 17 : 23, x, y + 8, on, text) : symbol(f, x, y, 10, on);
    const s = c ? sign(c, x, y + 20, 5.6, on) : '';
    return `<g${turn}>${glyph}${s}</g>`;
  };
  return one(15, 16, false) + one(W - 15, H - 16, true);
}

/**
 * One card as SVG, or the back (id null). `uid` keeps each card's clip path its own on a page with
 * many cards.
 */
export function card(id: string | null, { uid = 0 }: { uid?: number } = {}) {
  const clipId = `yk${uid}`;
  const clip = `<clipPath id="${clipId}"><rect width="${W}" height="${H}" rx="8"/></clipPath>`;
  const open = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${clip}<g clip-path="url(#${clipId})">`;
  const p = parse(id);

  if (!p) {
    let pattern = '';
    for (let row = 0; row < 7; row++) for (let i = 0; i < 5; i++) pattern += sign(COLOURS[(row + i) % 4], 4 + i * 23 + (row % 2) * 11, 6 + row * 22, 6.4, LAGOON_HI);
    return `${open}<rect width="${W}" height="${H}" fill="${LAGOON}"/>${pattern}<rect x="13" y="52" width="74" height="36" rx="18" fill="${LAGOON}"/>${num(22, 50, 78, PAPER, 'yksi')}</g><rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="7.5" fill="none" stroke="rgb(0 0 0 / 0.14)"/></svg>`;
  }

  if (isWild(p.f)) {
    const big = sign('r', 18, 28, 32, INK.r) + sign('b', 84, 32, 32, INK.b) + sign('g', 16, 112, 30, INK.g) + sign('y', 84, 110, 32, INK.y);
    const mid = p.f === 'd4' ? num(38, 50, 84, PAPER, '+4') : symbol('wild', 50, 70, 26, PAPER);
    return `${open}<rect width="${W}" height="${H}" fill="${WILD}"/>${big}<rect x="16" y="44" width="68" height="52" rx="26" fill="${WILD}"/>${mid}</g>${index(null, p.f, PAPER)}</svg>`;
  }

  const c = p.c as Colour;
  const on = c === 'y' ? DARK : PAPER;
  const big = sign(c, 62, 90, 58, SHADE[c]);
  const text = label(p.f);
  const mid = text ? num(text.length > 1 ? 38 : 60, 50, text.length > 1 ? 84 : 91, on, text) : symbol(p.f, 50, 70, 28, on);
  return `${open}<rect width="${W}" height="${H}" fill="${INK[c]}"/>${big}${mid}</g>${index(c, p.f, on)}</svg>`;
}

const NAMES = {
  de: {
    colour: { r: 'Rot', y: 'Gelb', g: 'Grün', b: 'Blau' } as Record<Colour, string>,
    face: { skip: 'Aussetzen', rev: 'Richtungswechsel', d2: 'Zieh zwei', wild: 'Farbwahl', d4: 'Farbwahl, zieh vier' } as Record<string, string>,
  },
  en: {
    colour: { r: 'Red', y: 'Yellow', g: 'Green', b: 'Blue' } as Record<Colour, string>,
    face: { skip: 'Skip', rev: 'Reverse', d2: 'Draw Two', wild: 'Wild', d4: 'Wild Draw Four' } as Record<string, string>,
  },
};

export const colourName = (c: Colour, lang: 'de' | 'en') => NAMES[lang].colour[c];

/** A card's name, for screen readers and the inspect view: "Rot 7", "Blau Aussetzen", "Farbwahl". */
export function nameOf(id: string | null, lang: 'de' | 'en') {
  const p = parse(id);
  if (!p) return lang === 'de' ? 'Rückseite' : 'Back';
  const face = isNumber(p.f) ? p.f : NAMES[lang].face[p.f];
  return p.c ? `${NAMES[lang].colour[p.c]} ${face}` : face;
}
