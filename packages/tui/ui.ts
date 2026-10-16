/**
 * Small UI kit shared by the header, footer and overlays: styled text
 * segments, and a text renderable whose segments can be clickable buttons
 * (OpenTUI has no click event or button widget; this maps mouse-up positions
 * to segments and highlights the hovered one).
 */

import {
    BoxRenderable,
    StyledText,
    TextRenderable,
    bg as bgStyle,
    bold as boldStyle,
    dim as dimStyle,
    fg as fgStyle,
    strikethrough as strikeStyle,
    type MouseEvent,
    type RenderContext,
    type StylableInput,
    type TextChunk,
} from '@opentui/core';
import { HEX } from './theme.ts';

export interface Segment {
    text: string;
    fg?: string;
    bg?: string;
    bold?: boolean;
    dim?: boolean;
    strike?: boolean;
    /** Makes the segment a button. */
    onClick?: () => void;
    /** Hover background for buttons (default HEX.hover). */
    hoverBg?: string;
}

export type Line = Segment[];

export function lineWidth(line: Line): number {
    return line.reduce((n, s) => n + s.text.length, 0);
}

/** Pad a line on the right to `width` columns (or truncate it). */
export function fitLine(line: Line, width: number): Line {
    const out: Line = [];
    let used = 0;
    for (const s of line) {
        if (used >= width) break;
        const text = s.text.slice(0, width - used);
        out.push({ ...s, text });
        used += text.length;
    }
    if (used < width) out.push({ text: ' '.repeat(width - used) });
    return out;
}

/** Left part, gap, right part, filling `width` (the right part wins on overflow). */
export function spread(left: Line, right: Line, width: number): Line {
    const gap = width - lineWidth(left) - lineWidth(right);
    if (gap >= 1) return [...left, { text: ' '.repeat(gap) }, ...right];
    return fitLine([...left, { text: ' ' }, ...right], width);
}

function chunk(s: Segment, hovered: boolean): TextChunk {
    let c: StylableInput = s.text;
    if (s.bold) c = boldStyle(c);
    if (s.dim) c = dimStyle(c);
    if (s.strike) c = strikeStyle(c);
    c = fgStyle(s.fg ?? HEX.text)(c);
    const background = hovered ? (s.hoverBg ?? HEX.hover) : s.bg;
    if (background) c = bgStyle(background)(c);
    return c;
}

/** A multi-line text renderable made of segments; segments with onClick are buttons. */
export class SegmentText extends TextRenderable {
    private lines: Line[] = [];
    private hovered: Segment | null = null;
    /** Local cell under the mouse, so a button keeps its hover when the lines are rebuilt. */
    private mouse: { x: number; y: number } | null = null;

    constructor(ctx: RenderContext, options: ConstructorParameters<typeof TextRenderable>[1] = {}) {
        super(ctx, { selectable: false, wrapMode: 'none', ...options });
        this.onMouseUp = (e: MouseEvent) => {
            if (e.button !== 0) return;
            const s = this.segmentAt(e.x - this.x, e.y - this.y);
            if (s?.onClick) {
                e.stopPropagation();
                s.onClick();
            }
        };
        this.onMouseMove = (e: MouseEvent) => {
            this.mouse = { x: e.x - this.x, y: e.y - this.y };
            this.setHover(this.segmentAt(this.mouse.x, this.mouse.y));
        };
        this.onMouseOut = () => {
            this.mouse = null;
            this.setHover(null);
        };
    }

    setLines(lines: Line[]): void {
        this.lines = lines;
        const s = this.mouse ? this.segmentAt(this.mouse.x, this.mouse.y) : null;
        this.hovered = s?.onClick ? s : null;
        this.redraw();
    }

    /** The segment at a local cell, or null. */
    segmentAt(x: number, y: number): Segment | null {
        const line = this.lines[y];
        if (!line || x < 0) return null;
        let col = 0;
        for (const s of line) {
            if (x < col + s.text.length) return s;
            col += s.text.length;
        }
        return null;
    }

    /** Text of every line (for tests and debugging). */
    plain(): string[] {
        return this.lines.map((l) => l.map((s) => s.text).join(''));
    }

    private setHover(s: Segment | null): void {
        const next = s?.onClick ? s : null;
        if (next === this.hovered) return;
        this.hovered = next;
        this.redraw();
    }

    private redraw(): void {
        const chunks: TextChunk[] = [];
        this.lines.forEach((line, i) => {
            if (i > 0) chunks.push(fgStyle(HEX.text)('\n'));
            for (const s of line) if (s.text) chunks.push(chunk(s, s === this.hovered));
        });
        this.content = new StyledText(chunks);
    }
}

/** A clickable "[ label ]"-style button segment. */
export function button(label: string, onClick: () => void, primary = false): Segment {
    return primary
        ? { text: ` ${label} `, fg: HEX.accentInk, bg: HEX.accent, bold: true, hoverBg: HEX.white, onClick }
        : { text: ` ${label} `, fg: HEX.text, bg: HEX.hover, hoverBg: HEX.selection, onClick };
}

/** A modal panel with a titled border. The overlay manager adds it to the root and centres it. */
export function panel(ctx: RenderContext, id: string, title: string, width: number, height: number): BoxRenderable {
    return new BoxRenderable(ctx, {
        id,
        position: 'absolute',
        width,
        height,
        border: true,
        borderStyle: 'single',
        borderColor: HEX.accent,
        title,
        titleColor: HEX.accent,
        backgroundColor: HEX.panel,
        shouldFill: true,
        paddingLeft: 1,
        paddingRight: 1,
        zIndex: 100,
        flexDirection: 'column',
    });
}
