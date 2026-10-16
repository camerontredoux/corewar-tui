/**
 * Colours and glyphs for the TUI. Buffer drawing needs RGBA objects, so every
 * colour the board uses is allocated once here, never per cell.
 */

import { RGBA } from '@opentui/core';

export const HEX = {
    bg: '#0b0d12',
    panel: '#11141b',
    border: '#2a303c',
    text: '#c8ccd4',
    muted: '#6b7280',
    faint: '#3b4250',
    accent: '#7dd3fc',
    accentInk: '#0b0d12',
    hover: '#1f2530',
    good: '#86efac',
    bad: '#f87171',
    warn: '#fbbf24',
    white: '#ffffff',
    untouched: '#323845',
    halfEmpty: '#1c2029',
    selection: '#4b5568',
    /** Floating lists (the editor's completion box): lighter than the panel and the cursor line (hover). */
    popup: '#2a3140',
} as const;

/**
 * Warrior colours: the Okabe-Ito colour-blind-safe set, brightened where the
 * original is too dark on a near-black background. White and grey are reserved
 * for "current instruction" and "untouched" (guide.md 8.3).
 */
export const WARRIOR_HEX: readonly string[] = [
    '#e69f00', // orange
    '#56b4e9', // sky blue
    '#f0e442', // yellow
    '#cc79a7', // reddish purple
    '#2bc39a', // bluish green
    '#e8641f', // vermillion
    '#4f9de8', // blue
    '#a0a0ff', // periwinkle (beyond Okabe-Ito; used for an 8th warrior)
];

export function warriorHex(id: number): string {
    return WARRIOR_HEX[id % WARRIOR_HEX.length]!;
}

export const GLYPH = {
    untouched: 0x00b7, // ·
    read: 0x2022, // •
    write: 0x00d7, // ×
    execute: 0x2588, // █
    loaded: 0x2591, // ░
    nextIp: 0x25aa, // ▪
    runsNext: 0x25a0, // ■
    upperHalf: 0x2580, // ▀
    space: 0x20,
} as const;

/**
 * Brightness levels for one warrior colour, from full (0) to faintest (4).
 * Reads use one level dimmer than writes and executes; fading (optional)
 * moves old accesses down the ladder.
 */
export const SHADE_FACTORS = [1, 0.72, 0.52, 0.36, 0.24] as const;
export const SHADE_COUNT = SHADE_FACTORS.length;

function mix(fgHex: string, bgHex: string, t: number): RGBA {
    const f = RGBA.fromHex(fgHex).toInts();
    const b = RGBA.fromHex(bgHex).toInts();
    const c = (i: number) => Math.round(b[i]! + (f[i]! - b[i]!) * t);
    return RGBA.fromInts(c(0), c(1), c(2));
}

/** A board shade of a warrior colour as hex, for text swatches. */
export function shadeHex(hex: string, level: number): string {
    const [r, g, b] = mix(hex, HEX.bg, SHADE_FACTORS[level]!).toInts();
    return '#' + [r, g, b].map((v) => v!.toString(16).padStart(2, '0')).join('');
}

export interface BoardPalette {
    bg: RGBA;
    untouched: RGBA;
    halfEmpty: RGBA;
    white: RGBA;
    selection: RGBA;
    /** shades[warrior][level] */
    shades: RGBA[][];
    /** Warrior colour mixed toward white, for the half-block runs-next marker. */
    tints: RGBA[];
}

const paletteCache = new Map<number, BoardPalette>();

/** Palette for `count` warriors (cached; RGBA objects are shared). */
export function boardPalette(count: number): BoardPalette {
    const n = Math.max(1, count);
    let p = paletteCache.get(n);
    if (!p) {
        const shades: RGBA[][] = [];
        const tints: RGBA[] = [];
        for (let w = 0; w < n; w++) {
            const hex = warriorHex(w);
            shades.push(SHADE_FACTORS.map((f) => mix(hex, HEX.bg, f)));
            tints.push(mix(HEX.white, hex, 0.55));
        }
        p = {
            bg: RGBA.fromHex(HEX.bg),
            untouched: RGBA.fromHex(HEX.untouched),
            halfEmpty: RGBA.fromHex(HEX.halfEmpty),
            white: RGBA.fromHex(HEX.white),
            selection: RGBA.fromHex(HEX.selection),
            shades,
            tints,
        };
        paletteCache.set(n, p);
    }
    return p;
}
