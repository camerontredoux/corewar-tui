/**
 * The core board: one custom renderable that paints every core address each
 * frame from the simulator's live access arrays (ICoreView), plus the pure
 * layout maths it uses (exported for tests).
 *
 * Layout modes, picked from the core size and the space available:
 * - 'wide'  : one address = two terminal columns: a one-column cell and a gap, small cores.
 * - 'glyph' : one address = one terminal cell, with the docs' glyphs.
 * - 'half'  : two addresses per terminal cell, stacked with '▀' (top = fg,
 *             bottom = bg). Colour only, so access kinds become brightness
 *             levels. Scrolls (wheel, ↑/↓ or PgUp/PgDn) if even this does not fit.
 * The `z` key toggles the view (ModeOverride): 'fit' picks as above; 'detail'
 * never packs two addresses per cell, so a core that 'half' would fit shows
 * in 'glyph' and scrolls the same way.
 * Addresses run row-major, left to right, top to bottom (guide.md 8.1).
 */

import { Renderable, type MouseEvent, type OptimizedBuffer, type RenderContext, type RenderableOptions, RGBA } from '@opentui/core';
import type { ICoreView, IWarriorProcessView } from '../engine/index.ts';
import { GLYPH, HEX, SHADE_COUNT, boardPalette } from './theme.ts';

export type BoardMode = 'wide' | 'glyph' | 'half';
export type ModeOverride = 'fit' | 'detail';

export interface BoardLayout {
    mode: BoardMode;
    size: number;
    /** Addresses per address row. */
    cols: number;
    /** Terminal columns per address (2 in 'wide'). */
    cellW: number;
    /** Address rows per terminal line (2 in 'half'). */
    rowsPerLine: number;
    /** Terminal lines the whole core needs. */
    lines: number;
    /** Terminal lines shown (lines, or the area height when scrolling). */
    visibleLines: number;
    /** Offset of the grid inside the area (centred). */
    offsetX: number;
    offsetY: number;
}

function idealCols(size: number, width: number, height: number, pixelW: number, pixelH: number): number {
    // A terminal cell is about twice as tall as wide. Match the grid's shape to the area's.
    return Math.sqrt((size * pixelH * width) / (2 * height * pixelW));
}

export function computeLayout(size: number, width: number, height: number, override: ModeOverride = 'fit'): BoardLayout {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    let mode: BoardMode;
    let cellW = 1;
    let rowsPerLine = 1;
    let ideal: number;
    if (Math.floor(w / 2) * h >= size) {
        mode = 'wide';
        cellW = 2;
        ideal = idealCols(size, w, h, 2, 2);
    } else if (override === 'detail' || w * h >= size) {
        mode = 'glyph';
        ideal = w * h >= size ? idealCols(size, w, h, 1, 2) : w;
    } else {
        mode = 'half';
        rowsPerLine = 2;
        ideal = w * h * 2 >= size ? idealCols(size, w, h, 1, 1) : w;
    }
    const maxCols = Math.max(1, Math.floor(w / cellW));
    const minCols = Math.ceil(size / (h * rowsPerLine));
    let cols = Math.ceil(ideal);
    if (cols >= 20) cols = Math.ceil(cols / 10) * 10; // round numbers make addresses easier to read off
    cols = Math.min(maxCols, Math.max(cols, minCols, 1));
    const addressRows = Math.ceil(size / cols);
    const lines = Math.ceil(addressRows / rowsPerLine);
    const visibleLines = Math.min(lines, h);
    return {
        mode,
        size,
        cols,
        cellW,
        rowsPerLine,
        lines,
        visibleLines,
        offsetX: Math.max(0, Math.floor((w - cols * cellW) / 2)),
        offsetY: Math.max(0, Math.floor((h - visibleLines) / 2)),
    };
}

export function maxScroll(layout: BoardLayout): number {
    return layout.lines - layout.visibleLines;
}

/** Address under a board-local cell, or null. In 'half' mode the top address of the pair. */
export function addressAt(layout: BoardLayout, scroll: number, localX: number, localY: number): number | null {
    const col = Math.floor((localX - layout.offsetX) / layout.cellW);
    const line = localY - layout.offsetY;
    if (localX < layout.offsetX || col >= layout.cols || line < 0 || line >= layout.visibleLines) return null;
    const address = (line + scroll) * layout.rowsPerLine * layout.cols + col;
    return address < layout.size ? address : null;
}

/** Board-local cell of an address (and which half), or null when scrolled out of view. */
export function cellOf(layout: BoardLayout, scroll: number, address: number): { x: number; y: number; half: 0 | 1 } | null {
    const row = Math.floor(address / layout.cols);
    const line = Math.floor(row / layout.rowsPerLine) - scroll;
    if (line < 0 || line >= layout.visibleLines) return null;
    return {
        x: layout.offsetX + (address % layout.cols) * layout.cellW,
        y: layout.offsetY + line,
        half: (row % layout.rowsPerLine) as 0 | 1,
    };
}

/** Accesses older than these multiples of the fade window drop one brightness level. */
const FADE_STEPS = [1, 4, 16] as const;

export class CoreBoard extends Renderable {
    /** Core size; drawn as untouched cells while there is no view. */
    size = 8000;
    view: ICoreView | null = null;
    processes: IWarriorProcessView[] = [];
    warriorCount = 2;
    /** Dim old accesses (off by default: the docs have no fading). */
    fade = false;
    /** Address highlighted by the inspector. */
    selected: number | null = null;
    /** Centred text drawn when there is no view (errors, "no match"). */
    message = '';
    scroll = 0;
    /** 'fit' picks the mode by size; 'detail' never uses 'half'. */
    modeOverride: ModeOverride = 'fit';
    onCellClick?: (address: number) => void;
    /** Called after the board's size changed (the layout may have changed). */
    onResized?: () => void;
    /** Called after the scroll offset changed. */
    onScrolled?: () => void;

    private cachedLayout: BoardLayout | null = null;
    private ipOwner = new Int16Array(0);
    /** Address the next execution runs, or -1. */
    private nextRun = -1;
    private ipMarked: number[] = [];
    private footprint = new Int16Array(0);
    private footprintKey = '';

    constructor(ctx: RenderContext, options: RenderableOptions<CoreBoard> = {}) {
        super(ctx, { flexGrow: 1, ...options });
        this.onMouseDown = (e: MouseEvent) => {
            if (e.button !== 0) return;
            const address = addressAt(this.layout, this.scroll, e.x - this.x, e.y - this.y);
            if (address !== null) this.onCellClick?.(address);
        };
        this.onMouseScroll = (e: MouseEvent) => {
            const dir = e.scroll?.direction;
            if (dir === 'up') this.scrollBy(-3);
            else if (dir === 'down') this.scrollBy(3);
        };
    }

    get layout(): BoardLayout {
        const l = this.cachedLayout;
        if (l && l.size === this.size && this.layoutW === this.width && this.layoutH === this.height && this.layoutMode === this.modeOverride) return l;
        this.layoutW = this.width;
        this.layoutH = this.height;
        this.layoutMode = this.modeOverride;
        this.cachedLayout = computeLayout(this.size, this.width, this.height, this.modeOverride);
        this.scroll = Math.min(this.scroll, maxScroll(this.cachedLayout));
        return this.cachedLayout;
    }
    private layoutW = -1;
    private layoutH = -1;
    private layoutMode: ModeOverride = 'fit';

    scrollBy(lines: number): void {
        const next = Math.max(0, Math.min(maxScroll(this.layout), this.scroll + lines));
        if (next !== this.scroll) {
            this.scroll = next;
            this.requestRender();
            this.onScrolled?.();
        }
    }

    /** Scroll just enough to show an address. */
    reveal(address: number): void {
        const l = this.layout;
        const line = Math.floor(Math.floor(address / l.cols) / l.rowsPerLine);
        if (line < this.scroll) this.scrollBy(line - this.scroll);
        else if (line >= this.scroll + l.visibleLines) this.scrollBy(line - this.scroll - l.visibleLines + 1);
    }

    protected override onResize(width: number, height: number): void {
        super.onResize(width, height);
        this.onResized?.();
    }

    private prepareMarkers(): void {
        const size = this.size;
        if (this.ipOwner.length !== size) {
            this.ipOwner = new Int16Array(size).fill(-1);
            this.footprint = new Int16Array(size).fill(-1);
            this.ipMarked = [];
            this.footprintKey = '';
        }
        for (const a of this.ipMarked) this.ipOwner[a] = -1;
        this.ipMarked.length = 0;
        const view = this.view && this.view.size === size ? this.view : null;
        const nextProcess = view ? this.processes.find((p) => p.warriorId === view.nextWarrior) : undefined;
        const nextIp = nextProcess?.alive ? nextProcess.instructionPointers[0] : undefined;
        this.nextRun = nextIp !== undefined && nextIp < size ? nextIp : -1;
        let key = '';
        for (const p of this.processes) {
            key += `${p.warriorId}:${p.loadAddress}:${p.length};`;
            const ip = p.instructionPointers[0];
            if (p.alive && ip !== undefined && ip < size) {
                this.ipOwner[ip] = p.warriorId;
                this.ipMarked.push(ip);
            }
        }
        if (key !== this.footprintKey) {
            this.footprintKey = key;
            this.footprint.fill(-1);
            for (const p of this.processes) {
                for (let i = 0; i < p.length; i++) this.footprint[(p.loadAddress + i) % size] = p.warriorId;
            }
        }
    }

    protected override renderSelf(buf: OptimizedBuffer): void {
        const pal = boardPalette(this.warriorCount);
        const L = this.layout;
        buf.fillRect(this.x, this.y, this.width, this.height, pal.bg);
        this.prepareMarkers();

        const view = this.view && this.view.size === this.size ? this.view : null;
        const kinds = view?.accessKind;
        const owners = view?.accessWarrior;
        const stamps = view?.accessStamp;
        const executions = view?.executions ?? 0;
        const current = view?.lastExecuted ?? -1;
        const fadeWindow = Math.max(50, Math.floor(this.size / 8));
        const fade = this.fade;
        const maxShade = SHADE_COUNT - 1;
        const shades = pal.shades;
        const nW = shades.length;
        const ipOwner = this.ipOwner;
        const nextRun = this.nextRun;
        const footprint = this.footprint;
        const selected = this.selected ?? -1;
        const x0 = this.x + L.offsetX;
        const y0 = this.y + L.offsetY;

        const fadeLevel = (a: number): number => {
            if (!fade) return 0;
            const age = executions - stamps![a]!;
            let level = 0;
            for (const step of FADE_STEPS) if (age >= step * fadeWindow) level++;
            return level;
        };

        if (L.mode === 'half') {
            const colourOf = (a: number): RGBA => {
                if (a >= this.size) return pal.bg;
                if (a === selected) return pal.selection;
                if (a === current) return pal.white;
                // Only the instruction that runs next is pale; other warriors' next instructions show their colour.
                const ipw = ipOwner[a]!;
                if (ipw >= 0) return a === nextRun ? pal.tints[ipw % nW]! : shades[ipw % nW]![0]!;
                const kind = kinds ? kinds[a]! : 0;
                if (kind !== 0) {
                    const level = Math.min(maxShade, fadeLevel(a) + (3 - kind));
                    return shades[owners![a]! % nW]![level]!;
                }
                const f = footprint[a]!;
                return f >= 0 ? shades[f % nW]![3]! : pal.halfEmpty;
            };
            for (let line = 0; line < L.visibleLines; line++) {
                const base = (line + this.scroll) * 2 * L.cols;
                for (let col = 0; col < L.cols; col++) {
                    const top = base + col;
                    if (top >= this.size) break;
                    buf.drawChar(GLYPH.upperHalf, x0 + col, y0 + line, colourOf(top), colourOf(top + L.cols));
                }
            }
        } else {
            const wide = L.cellW === 2;
            for (let line = 0; line < L.visibleLines; line++) {
                const base = (line + this.scroll) * L.cols;
                const y = y0 + line;
                for (let col = 0; col < L.cols; col++) {
                    const a = base + col;
                    if (a >= this.size) break;
                    let glyph: number = GLYPH.untouched;
                    let fg: RGBA = pal.untouched;
                    let bg: RGBA = pal.bg;
                    const ipw = ipOwner[a]!;
                    const kind = kinds ? kinds[a]! : 0;
                    if (a === current) {
                        glyph = GLYPH.execute;
                        fg = pal.white;
                    } else if (ipw >= 0) {
                        // The instruction that runs next is a large square on full colour;
                        // the other warriors' next instructions are small squares on a dim tint.
                        glyph = a === nextRun ? GLYPH.runsNext : GLYPH.nextIp;
                        fg = pal.white;
                        bg = shades[ipw % nW]![a === nextRun ? 0 : 2]!;
                    } else if (kind !== 0) {
                        const s = shades[owners![a]! % nW]!;
                        const level = fadeLevel(a);
                        if (kind === 3) {
                            glyph = GLYPH.execute;
                            fg = s[level]!;
                        } else if (kind === 2) {
                            glyph = GLYPH.write;
                            fg = s[level]!;
                        } else {
                            glyph = GLYPH.read;
                            fg = s[Math.min(maxShade, level + 1)]!;
                        }
                    } else {
                        const f = footprint[a]!;
                        if (f >= 0) {
                            glyph = GLYPH.loaded;
                            fg = shades[f % nW]![2]!;
                        }
                    }
                    if (a === selected) {
                        bg = pal.selection;
                        if (glyph === GLYPH.execute) glyph = 0x25a0; // ■ lets the selection show around it
                    }
                    const x = x0 + col * L.cellW;
                    buf.drawChar(glyph, x, y, fg, bg);
                    // The second column of a wide cell is a gap, so every cell is a one-column rectangle.
                    if (wide) buf.drawChar(GLYPH.space, x + 1, y, pal.bg, pal.bg);
                }
            }
        }

        if (!view && this.message) {
            const lines = this.message.split('\n');
            const fg = RGBA.fromHex(HEX.text);
            const top = this.y + Math.max(0, Math.floor((this.height - lines.length) / 2));
            lines.forEach((text, i) => {
                const t = text.slice(0, this.width);
                buf.drawText(t, this.x + Math.max(0, Math.floor((this.width - t.length) / 2)), top + i, fg, pal.bg);
            });
        }
    }
}
