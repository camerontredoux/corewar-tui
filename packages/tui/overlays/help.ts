/**
 * Help (modal), two pages: key bindings, editor keys and the board legend,
 * then a Redcode reference. ←/→ switch pages; ↑/↓ and PgUp/PgDn scroll when
 * the terminal is too short.
 */

import type { BoxRenderable, CliRenderer, KeyEvent } from '@opentui/core';
import { BINDINGS } from '../keys.ts';
import { instructionRef, syntaxOf } from '../redcode-ref.ts';
import { HEX, shadeHex, warriorHex } from '../theme.ts';
import { SegmentText, panel, type Line } from '../ui.ts';
import type { Overlay } from './manager.ts';

const PAGES = ['Keys', 'Redcode'] as const;

const heading = (text: string): Line => [{ text, bold: true }];
const para = (text: string): Line => [{ text: `  ${text}` }];
const note = (text: string): Line => [{ text: `  ${text}`, fg: HEX.muted }];
/** A highlighted term and its meaning; `width` aligns the meanings of one section. */
const entry = (term: string, meaning: string, width: number): Line => [{ text: `  ${term.padEnd(width)}`, fg: HEX.accent }, { text: meaning }];
const op = (name: string): Line => {
    const r = instructionRef(name);
    return entry(syntaxOf(r), r.meaning, 11);
};

// Accurate to this engine (spec/redcode.md, spec/pspace.md). Every line fits the 60-column body.
const REDCODE: Line[] = [
    heading('Basics'),
    para('Addresses are relative: 0 is this cell, 1 the next one,'),
    para('-1 the one before. After each instruction the process'),
    para('moves to the next cell, unless it jumped or skipped one.'),
    para('Running a DAT kills that process. A warrior with no'),
    para('processes left is dead. A and B are the two operands.'),
    [],
    heading('Data and moves'),
    op('DAT'),
    op('MOV'),
    op('NOP'),
    heading('Arithmetic'),
    op('ADD'),
    op('SUB'),
    op('MUL'),
    op('DIV'),
    op('MOD'),
    note('DIV or MOD by zero kills the process.'),
    heading('Jumps and tests'),
    op('JMP'),
    op('JMZ'),
    op('JMN'),
    op('DJN'),
    op('SEQ'),
    op('CMP'),
    op('SNE'),
    op('SLT'),
    heading('Processes'),
    op('SPL'),
    note('Processes take turns. At the process limit SPL adds none.'),
    heading('P-space (kept between rounds)'),
    op('LDP'),
    op('STP'),
    note("Cell 0 is last round's result: 0 = died, else the number"),
    note('of survivors (1 = won). It is -1 before the first round.'),
    [],
    heading('Addressing modes'),
    entry('#5', 'immediate: the number 5 itself', 5),
    entry('$5', 'direct (same as no prefix): the cell 5 away', 5),
    entry('@5', "B-indirect: where cell 5's B-field points", 5),
    entry('<5', 'like @, but first decrement that B-field', 5),
    entry('>5', 'like @, then increment that B-field', 5),
    entry('*5', "A-indirect: where cell 5's A-field points", 5),
    entry('{5', 'like *, but first decrement that A-field', 5),
    entry('}5', 'like *, then increment that A-field', 5),
    note('A jump to a # operand stays put: jmp #5 loops in place.'),
    [],
    heading('Modifiers'),
    note('.A .B: A or B field only. .AB: A into B. .BA: B into A.'),
    note('.F: both fields. .X: both, crossed. .I: the whole cell.'),
    note('Left out, they are filled in from the opcode and modes,'),
    note('which is why the inspector shows e.g. MOV.I.'),
    [],
    heading('Directives'),
    entry(';name ;author', "the warrior's name and author", 15),
    entry('loop  djn ...', 'a label names a cell; use it as an operand', 15),
    entry('step  EQU 4', 'a named constant', 15),
    entry('ORG start', 'begin at the label start (or END start)', 15),
    entry('END', 'stop here; later lines are ignored', 15),
    entry('FOR 3 … ROF', 'repeat the lines between 3 times', 15),
];

export class HelpOverlay implements Overlay {
    readonly id = 'help';
    readonly modal = true;
    readonly root: BoxRenderable;
    private readonly body: SegmentText;
    private page = 0;
    private scroll = 0;
    private total = 0;

    constructor(
        renderer: CliRenderer,
        private readonly close: () => void,
    ) {
        this.root = panel(renderer, 'help', 'HELP', 64, 30);
        this.body = new SegmentText(renderer, { flexGrow: 1 });
        this.root.add(this.body);
    }

    size(width: number, height: number) {
        return { width: Math.min(64, width - 2), height: Math.min(BINDINGS.length + 26, height - 2) };
    }

    handleKey(key: KeyEvent): boolean {
        if (key.name === '?' || key.sequence === '?' || key.name === 'q') {
            this.close();
            return true;
        }
        const turn = { left: 0, h: 0, right: 1, l: 1 }[key.name as string];
        if (turn !== undefined) {
            if (turn !== this.page) this.scroll = 0;
            this.page = turn;
            this.refresh();
            return true;
        }
        const page = Math.max(1, this.rows() - 1);
        const by = { up: -1, k: -1, down: 1, j: 1, pageup: -page, pagedown: page }[key.name as string];
        if (by === undefined) return false;
        this.scroll += by;
        this.refresh();
        return true;
    }

    /** Body rows inside the border. */
    private rows(): number {
        return Math.max(1, (typeof this.root.height === 'number' ? this.root.height : 30) - 2);
    }

    private keys(): Line[] {
        // Each row shows the first two warriors' colours side by side.
        const legend: [string, (w: string) => string, string, ((w: string) => string)?][] = [
            ['·', () => HEX.untouched, 'untouched'],
            ['░', (w) => w, "warrior's loaded code"],
            ['█', (w) => w, 'executed'],
            ['×', (w) => w, 'written'],
            ['•', (w) => w, 'read'],
            ['█', () => HEX.white, 'instruction executed last'],
            ['■', () => HEX.white, 'runs on the next step (▶ in the header)', (w) => w],
            ['▪', () => HEX.white, "other warrior's next instruction", (w) => shadeHex(w, 2)],
        ];
        const lines: Line[] = [heading('Keys')];
        for (const b of BINDINGS) lines.push(entry(b.hint, b.label, 8));
        lines.push(entry('esc', 'close the top panel', 8));
        lines.push(entry('click', 'inspect a core cell; arrows move it', 8));
        lines.push(entry('d', 'picker: delete warrior (y/n, moves to .trash/)', 8));
        lines.push(entry('←/→', 'help: switch page', 8));
        lines.push([]);
        lines.push(heading('Editor (n, e)'));
        lines.push(entry('ctrl+s', 'save · esc close (asks first if unsaved)', 8));
        lines.push(entry('F2', 'vim keys on/off (saved; or click the footer)', 8));
        lines.push(entry('F3', 'relative numbers on/off: offsets from cursor', 8));
        lines.push(entry('F4', 'format on save, auto-indent, snap on/off', 8));
        lines.push(entry('F5', 'autocomplete on/off: ↑/↓ pick, tab accepts', 8));
        lines.push(entry('F6', 'preview on/off: the saved warrior, 1 step/s', 8));
        lines.push(entry('F7-F9', 'preview: play/pause · one step · reset', 8));
        lines.push([]);
        lines.push(heading('Board'));
        const warriors = [warriorHex(0), warriorHex(1)];
        for (const [glyph, fg, label, bg] of legend) {
            const swatches = warriors.flatMap((w) => [{ text: ' ' }, { text: glyph, fg: fg(w), bg: bg?.(w) }]);
            lines.push([{ text: ' ' }, ...swatches, { text: `  ${label}` }]);
        }
        lines.push(note('Dense cores pack 2 addresses per character;'));
        lines.push(note('brighter = executed > written > read;'));
        lines.push(note('the pale cell runs on the next step.'));
        return lines;
    }

    refresh(): void {
        this.root.title = `HELP · ${this.page + 1}/${PAGES.length} ${PAGES[this.page]} · ←/→ page`;
        const lines = this.page ? REDCODE : this.keys();
        this.total = lines.length;
        const rows = this.rows();
        if (lines.length <= rows) {
            this.scroll = 0;
            this.body.setLines(lines);
            return;
        }
        // Too tall: show a window and keep the last row for the scroll hint.
        const visible = rows - 1;
        this.scroll = Math.max(0, Math.min(this.scroll, lines.length - visible));
        const shown = lines.slice(this.scroll, this.scroll + visible);
        const end = this.scroll + visible;
        shown.push(note(`↑/↓ scroll · ${this.scroll + 1}-${end} of ${this.total}`));
        this.body.setLines(shown);
    }
}
