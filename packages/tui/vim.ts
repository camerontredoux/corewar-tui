/**
 * Vim keys for the warrior editor (off by default; F2 in the editor). The
 * agreed subset: normal, insert, visual (`v`) and visual-line (`V`) modes; the
 * motions h j k l w b e 0 ^ $ gg G with counts; i a I A o O, x, dd, yy, p P,
 * r{char}, the operators d c y with any of those motions, u, ctrl+r and `.`;
 * and the commands :w :q :wq :x :q!. One unnamed register. No macros, named
 * registers, text objects, search, marks or :s.
 *
 * The engine edits through `VimBuffer` (plain string offsets), so it runs
 * without a renderer in vim.test.ts; overlays/editor.ts adapts its Textarea.
 * Undo is kept here as whole-text snapshots, one per change, as in vim (an
 * insert session is one change).
 */

export type VimMode = 'normal' | 'insert' | 'visual' | 'visual-line' | 'command';

/** The parts of an OpenTUI KeyEvent the engine reads. */
export interface VimKey {
    name: string;
    sequence?: string;
    ctrl?: boolean;
    meta?: boolean;
}

export interface VimBuffer {
    readonly text: string;
    /** Cursor as an offset into `text`. */
    cursor: number;
    /** Replace text[start, end) with `insert`. */
    replace(start: number, end: number, insert: string): void;
    /** Show [start, end) as selected (visual modes), or clear the selection. */
    select(range: { start: number; end: number } | null): void;
}

export interface VimHost {
    readonly dirty: boolean;
    /** Save as the Save button does; false when it failed. */
    save(): boolean;
    /** Close as the Close button does (asks once about unsaved changes); `force` discards them. */
    close(force: boolean): void;
    /** Leading whitespace for a new line that follows text[0, at) (enter in insert mode, o, O). Default none. */
    indent?(text: string, at: number): string;
    /** How many characters backspace in insert mode deletes before `cursor`. Default 1. */
    backspaceWidth?(text: string, cursor: number): number;
    /** What space types at `cursor` in insert mode (blanks up to a column). Default one space. */
    space?(text: string, cursor: number): string;
}

type Operator = 'd' | 'c' | 'y';

interface Motion {
    to: number;
    linewise?: boolean;
    /** The character at `to` is part of the range (e, $). */
    inclusive?: boolean;
}

const MOTIONS = new Set(['h', 'j', 'k', 'l', 'w', 'b', 'e', '0', '^', '$', 'G']);
const ARROWS: Record<string, string> = { left: 'h', down: 'j', up: 'k', right: 'l' };
const ESCAPE: VimKey = { name: 'escape' };

// ---- Text helpers (offsets into the whole text) ------------------------------

const lineStart = (t: string, i: number) => (i <= 0 ? 0 : t.lastIndexOf('\n', i - 1) + 1);
function lineEnd(t: string, i: number): number {
    const n = t.indexOf('\n', i);
    return n < 0 ? t.length : n;
}
function rowOf(t: string, i: number): number {
    let row = 0;
    for (let k = t.indexOf('\n'); k >= 0 && k < i; k = t.indexOf('\n', k + 1)) row++;
    return row;
}
function rowStart(t: string, row: number): number {
    let i = 0;
    for (let r = 0; r < row; r++) {
        const n = t.indexOf('\n', i);
        if (n < 0) return i;
        i = n + 1;
    }
    return i;
}
function firstNonBlank(t: string, i: number): number {
    let k = lineStart(t, i);
    const end = lineEnd(t, k);
    while (k < end && (t[k] === ' ' || t[k] === '\t')) k++;
    return k;
}
/** Normal mode never rests on a line break, except on an empty line. */
function clampNormal(t: string, i: number): number {
    const at = Math.max(0, Math.min(i, t.length));
    const s = lineStart(t, at);
    const e = lineEnd(t, at);
    return e > s ? Math.min(at, e - 1) : s;
}

/** 0 blank, 1 word character, 2 other punctuation: a vim word is a run of 1s or of 2s. */
function kind(ch: string | undefined): number {
    if (ch === undefined || ch === ' ' || ch === '\t' || ch === '\n') return 0;
    return /\w/.test(ch) ? 1 : 2;
}
/**
 * The range [start, end) of the `iw`/`aw` text object (`iW`/`aW` when big) at c,
 * n times, within the line; null on an empty line. `aw` takes the trailing blanks,
 * or the leading ones when there are none after; from a blank it takes the blanks and the next word.
 */
function wordObject(t: string, c: number, around: boolean, big: boolean, n: number): [number, number] | null {
    const cls = (ch: string | undefined): number =>
        ch === undefined || ch === '\n' ? -1 : ch === ' ' || ch === '\t' ? 0 : big ? 1 : kind(ch);
    const k0 = cls(t[c]);
    if (k0 < 0) return null;
    const runEnd = (i: number): number => {
        const k = cls(t[i]);
        while (i < t.length && cls(t[i]) === k) i++;
        return i;
    };
    let start = c;
    while (start > 0 && cls(t[start - 1]) === k0) start--;
    let end = runEnd(c);
    if (!around) {
        for (let k = 1; k < n && cls(t[end]) >= 0; k++) end = runEnd(end);
        return [start, end];
    }
    if (k0 === 0) {
        if (cls(t[end]) > 0) end = runEnd(end);
    } else if (cls(t[end]) === 0) end = runEnd(end);
    else while (start > 0 && cls(t[start - 1]) === 0) start--;
    for (let k = 1; k < n && cls(t[end]) >= 0; k++) {
        end = runEnd(end);
        if (cls(t[end]) === 0) end = runEnd(end);
    }
    return [start, end];
}

function wordForward(t: string, i: number): number {
    const c = kind(t[i]);
    if (c !== 0) while (i < t.length && kind(t[i]) === c) i++;
    while (i < t.length && kind(t[i]) === 0) {
        if (t[i++] === '\n' && t[i] === '\n') return i; // an empty line is a word
    }
    return i;
}
function wordBackward(t: string, i: number): number {
    if (i <= 0) return 0;
    i--;
    while (i > 0 && kind(t[i]) === 0) {
        if (t[i] === '\n' && t[i - 1] === '\n') return i;
        i--;
    }
    const c = kind(t[i]);
    if (c !== 0) while (i > 0 && kind(t[i - 1]) === c) i--;
    return i;
}
function wordEnd(t: string, i: number): number {
    i++;
    while (i < t.length && kind(t[i]) === 0) i++;
    if (i >= t.length) return Math.max(0, t.length - 1);
    const c = kind(t[i]);
    while (i + 1 < t.length && kind(t[i + 1]) === c) i++;
    return i;
}

/** The printable character a key types, if any. */
function charOf(key: VimKey): string | undefined {
    if (key.ctrl || key.meta) return undefined;
    if (key.name === 'space') return ' ';
    const s = key.sequence;
    return s && s.length === 1 && s >= ' ' && s !== '\x7f' ? s : undefined;
}

export class Vim {
    mode: VimMode = 'normal';
    /** A short error or note for the status line; cleared by the next key. */
    message = '';
    private register: { text: string; linewise: boolean } | null = null;
    private undoStack: string[] = [];
    private redoStack: string[] = [];
    /** Text when the change in progress began (null between changes). */
    private before: string | null = null;
    private count = '';
    private opCount = '';
    private op: Operator | null = null;
    private g = false;
    /** After `r`: the next character replaces. */
    private replacing = false;
    /** After `i` or `a` following an operator or in visual mode: a text object (`w`, `W`) comes next. */
    private textObj: 'i' | 'a' | null = null;
    /** Keys of the command in progress, for `.`; null while a change must not be recorded (visual mode). */
    private keys: VimKey[] | null = [];
    private lastChange: VimKey[] = [];
    private anchor = 0;
    /** Column j/k aim for (Infinity after $). */
    private wantCol = 0;
    private lastCursor = -1;
    private command = '';

    constructor(
        private readonly buf: VimBuffer,
        private readonly host: VimHost,
    ) {
        this.moveTo(buf.cursor);
    }

    /** Mode for the status line: NORMAL, -- INSERT --, ..., or the `:` command being typed. */
    get status(): string {
        switch (this.mode) {
            case 'command':
                return `:${this.command}`;
            case 'insert':
                return '-- INSERT --';
            case 'visual':
                return '-- VISUAL --';
            case 'visual-line':
                return '-- VISUAL LINE --';
            default:
                return 'NORMAL';
        }
    }

    /** A count or operator typed so far, as vim's showcmd (`2d`). */
    get pending(): string {
        return `${this.opCount}${this.op ?? ''}${this.count}${this.textObj ?? ''}${this.g ? 'g' : ''}${this.replacing ? 'r' : ''}`;
    }

    /** Returns false only in insert mode, for keys the text area should handle itself (arrows, delete, ...). */
    handleKey(key: VimKey): boolean {
        this.message = '';
        if (this.mode === 'insert') return this.insertKey(key);
        if (this.mode === 'command') this.commandKey(key);
        else this.normalKey(key);
        this.lastCursor = this.buf.cursor;
        return true;
    }

    // ---- Normal and visual mode ---------------------------------------------

    private get visual(): boolean {
        return this.mode === 'visual' || this.mode === 'visual-line';
    }

    private normalKey(key: VimKey): void {
        if (this.buf.cursor !== this.lastCursor) this.wantCol = this.column(this.buf.cursor); // moved by the mouse
        if (key.name === 'escape') {
            if (this.visual) this.exitVisual();
            return this.done(false);
        }
        if (key.ctrl) {
            if (key.name === 'r' && !this.visual && !this.op) this.redo(this.takeCount() ?? 1);
            return this.done(false);
        }
        if (this.replacing) {
            const with_ = charOf(key);
            if (!with_) return this.done(false); // r then esc (or enter, an arrow) cancels
            this.keys?.push(key);
            return this.replaceChars(with_);
        }
        const ch = ARROWS[key.name] ?? charOf(key);
        if (!ch) return this.done(false);
        this.keys?.push(key);
        if (/[0-9]/.test(ch) && (ch !== '0' || this.count)) {
            this.count += ch;
            return;
        }
        if (this.g) {
            this.g = false;
            return ch === 'g' ? this.motionKey('gg') : this.done(false);
        }
        if (this.textObj) {
            const around = this.textObj === 'a';
            this.textObj = null;
            return this.wordObjectKey(ch, around);
        }
        if ((ch === 'i' || ch === 'a') && (this.op || this.visual)) {
            this.textObj = ch;
            return;
        }
        if (ch === 'g') {
            this.g = true;
            return;
        }
        if (MOTIONS.has(ch)) return this.motionKey(ch);
        if (ch === 'r') {
            if (this.op) return this.done(false);
            this.replacing = true;
            return;
        }
        if (this.visual) return this.visualKey(ch);
        if (this.op) {
            if (ch !== this.op) return this.done(false);
            const n = this.takeCount() ?? 1;
            const t = this.buf.text;
            const row = rowOf(t, this.buf.cursor);
            return this.done(this.lineOp(this.op, row, Math.min(row + n - 1, rowOf(t, t.length)), t));
        }
        const t = this.buf.text;
        const c = this.buf.cursor;
        switch (ch) {
            case 'd':
            case 'c':
            case 'y':
                this.op = ch;
                this.opCount = this.count;
                this.count = '';
                return;
            case 'x':
                this.op = 'd';
                return this.motionKey('l');
            case 'i':
                return this.insertAt(c);
            case 'a':
                return this.insertAt(lineEnd(t, c) === c ? c : c + 1);
            case 'I':
                return this.insertAt(firstNonBlank(t, c));
            case 'A':
                return this.insertAt(lineEnd(t, c));
            case 'o':
            case 'O': {
                const at = ch === 'o' ? lineEnd(t, c) : lineStart(t, c);
                const indent = this.host.indent?.(t, at) ?? '';
                this.begin();
                this.buf.replace(at, at, ch === 'o' ? `\n${indent}` : `${indent}\n`);
                return this.insertAt(ch === 'o' ? at + 1 + indent.length : at + indent.length);
            }
            case 'p':
            case 'P':
                return this.done(this.paste(ch === 'P', this.takeCount() ?? 1));
            case 'u':
                this.undo(this.takeCount() ?? 1);
                return this.done(false);
            case '.':
                return this.repeat();
            case 'v':
            case 'V':
                this.mode = ch === 'v' ? 'visual' : 'visual-line';
                this.anchor = c;
                this.showSelection();
                return this.done(false);
            case ':':
                this.mode = 'command';
                this.command = '';
                return this.done(false);
        }
        this.done(false);
    }

    private motionKey(name: string): void {
        let count = this.takeCount();
        const op = this.op;
        this.op = null;
        const t = this.buf.text;
        const c = this.buf.cursor;
        // cw on a word changes to the end of that word, like ce, except that the first
        // word counted is the one under the cursor, even a one-character word (vim's special case).
        let m: Motion | null;
        if (op === 'c' && name === 'w' && kind(t[c]) !== 0) {
            let to = wordEnd(t, c - 1);
            for (let k = 1; k < (count ?? 1); k++) to = wordEnd(t, to);
            m = { to, inclusive: true };
        } else m = this.motion(name, t, c, count, op !== null);
        if (!m) return this.done(false);
        if (!op) {
            this.moveTo(m.to, name === 'j' || name === 'k');
            if (name === '$') this.wantCol = Infinity;
            this.showSelection();
            return this.done(false);
        }
        if (m.linewise) return this.done(this.lineOp(op, Math.min(rowOf(t, c), rowOf(t, m.to)), Math.max(rowOf(t, c), rowOf(t, m.to)), t));
        const start = Math.min(c, m.to);
        let end = Math.max(c, m.to);
        if (m.inclusive && end < t.length && t[end] !== '\n') end++;
        this.done(this.charOp(op, start, end, t));
    }

    /** `iw`, `aw`, `iW`, `aW`: apply the pending operator to the word object, or select it in visual mode. */
    private wordObjectKey(ch: string, around: boolean): void {
        const t = this.buf.text;
        const count = this.takeCount() ?? 1;
        const r = ch === 'w' || ch === 'W' ? wordObject(t, this.buf.cursor, around, ch === 'W', count) : null;
        if (!r) return this.done(false);
        if (this.visual) {
            this.mode = 'visual';
            this.anchor = r[0];
            this.moveTo(r[1] - 1);
            this.showSelection();
            return this.done(false);
        }
        const op = this.op!;
        this.op = null;
        this.done(this.charOp(op, r[0], r[1], t));
    }

    private motion(name: string, t: string, c: number, count: number | undefined, forOp: boolean): Motion | null {
        const n = count ?? 1;
        const s = lineStart(t, c);
        const e = lineEnd(t, c);
        const lastRow = rowOf(t, t.length);
        let to = c;
        switch (name) {
            case 'h':
                return c > s ? { to: Math.max(s, c - n) } : null;
            case 'l': {
                // An operator may reach the line end: dl and x on the last character delete it.
                const max = forOp ? e : Math.max(s, e - 1);
                return c < max ? { to: Math.min(c + n, max) } : null;
            }
            case 'j':
            case 'k': {
                const row = rowOf(t, c);
                const target = name === 'j' ? Math.min(row + n, lastRow) : Math.max(row - n, 0);
                if (target === row) return null;
                const ts = rowStart(t, target);
                return { to: Math.min(ts + this.wantCol, Math.max(ts, lineEnd(t, ts) - 1)), linewise: true };
            }
            case 'w':
                for (let k = 0; k < n; k++) to = wordForward(t, to);
                if (forOp) {
                    // When the last word moved over ends its line, the operator stops at that
                    // word's end instead of reaching into the next line (vim's dw special case).
                    let end = to;
                    while (end > c && kind(t[end - 1]) === 0) end--;
                    if (t.slice(end, to).includes('\n')) to = end;
                }
                return to === c ? null : { to };
            case 'b':
                for (let k = 0; k < n; k++) to = wordBackward(t, to);
                return to === c ? null : { to };
            case 'e':
                for (let k = 0; k < n; k++) to = wordEnd(t, to);
                // At the end of the text e cannot move, but an operator still takes the character under the cursor.
                if (to === c) return forOp && c < t.length && t[c] !== '\n' ? { to, inclusive: true } : null;
                return { to, inclusive: true };
            case '0':
                return { to: s };
            case '^':
                return { to: firstNonBlank(t, c) };
            case '$': {
                const rs = rowStart(t, Math.min(rowOf(t, c) + n - 1, lastRow));
                return { to: Math.max(rs, lineEnd(t, rs) - 1), inclusive: true };
            }
            case 'G':
            case 'gg': {
                const row = count !== undefined ? Math.min(Math.max(count - 1, 0), lastRow) : name === 'G' ? lastRow : 0;
                return { to: firstNonBlank(t, rowStart(t, row)), linewise: true };
            }
        }
        return null;
    }

    /** d/c/y on text[start, end). Returns true when the text changed. */
    private charOp(op: Operator, start: number, end: number, t: string): boolean {
        this.register = { text: t.slice(start, end), linewise: false };
        if (op === 'y') {
            this.moveTo(start);
            return false;
        }
        this.begin();
        this.buf.replace(start, end, '');
        if (op === 'c') this.insertAt(start);
        else this.moveTo(start);
        return true;
    }

    /** d/c/y on whole rows r1..r2. */
    private lineOp(op: Operator, r1: number, r2: number, t: string): boolean {
        const s = rowStart(t, r1);
        const e = lineEnd(t, rowStart(t, r2));
        this.register = { text: `${t.slice(s, e)}\n`, linewise: true };
        if (op === 'y') {
            const c = this.buf.cursor;
            if (rowOf(t, c) > r1) this.moveTo(Math.min(s + this.column(c), lineEnd(t, s)));
            return false;
        }
        this.begin();
        if (op === 'c') {
            this.buf.replace(s, e, '');
            this.insertAt(s);
            return true;
        }
        if (e < t.length) this.buf.replace(s, e + 1, '');
        else if (s > 0) this.buf.replace(s - 1, e, ''); // the last rows: take the line break before them
        else this.buf.replace(s, e, '');
        const u = this.buf.text;
        this.moveTo(firstNonBlank(u, Math.min(s, u.length)));
        return true;
    }

    /** p / P: whole lines below / above the cursor line, or text after / at the cursor. */
    private paste(before: boolean, count: number): boolean {
        const reg = this.register;
        if (!reg) return false;
        const t = this.buf.text;
        const c = this.buf.cursor;
        this.begin();
        if (reg.linewise) {
            const block = reg.text.repeat(count);
            if (before) {
                const s = lineStart(t, c);
                this.buf.replace(s, s, block);
                this.moveTo(firstNonBlank(this.buf.text, s));
                return true;
            }
            const e = lineEnd(t, c);
            if (e < t.length) this.buf.replace(e + 1, e + 1, block);
            else this.buf.replace(e, e, `\n${block.slice(0, -1)}`);
            this.moveTo(firstNonBlank(this.buf.text, e + 1));
            return true;
        }
        const text = reg.text.repeat(count);
        const at = before || lineEnd(t, c) === c ? c : c + 1;
        this.buf.replace(at, at, text);
        this.moveTo(text.includes('\n') ? at : at + text.length - 1);
        return true;
    }

    /**
     * r{char}: in normal mode replace `count` characters from the cursor (none
     * if the line has fewer left, as in vim) and end on the last; in visual
     * modes replace every selected character except line breaks.
     */
    private replaceChars(ch: string): void {
        const t = this.buf.text;
        const c = this.buf.cursor;
        if (this.visual) {
            const lines = this.mode === 'visual-line';
            const start = lines ? lineStart(t, Math.min(this.anchor, c)) : Math.min(this.anchor, c);
            const end = lines ? lineEnd(t, Math.max(this.anchor, c)) : Math.min(Math.max(this.anchor, c) + 1, t.length);
            this.keys = null; // like the other visual changes, not repeated by `.`
            this.exitVisual();
            this.begin();
            this.buf.replace(start, end, t.slice(start, end).replace(/[^\n]/g, ch));
            this.moveTo(start);
            return this.done(true);
        }
        const n = this.takeCount() ?? 1;
        if (c + n > lineEnd(t, c)) return this.done(false);
        this.begin();
        this.buf.replace(c, c + n, ch.repeat(n));
        this.moveTo(c + n - 1);
        this.done(true);
    }

    private visualKey(ch: string): void {
        const t = this.buf.text;
        const c = this.buf.cursor;
        const lines = this.mode === 'visual-line';
        const start = lines ? lineStart(t, Math.min(this.anchor, c)) : Math.min(this.anchor, c);
        const end = lines ? lineEnd(t, Math.max(this.anchor, c)) : Math.min(Math.max(this.anchor, c) + 1, t.length);
        switch (ch) {
            case 'v':
            case 'V': {
                const mode = ch === 'v' ? 'visual' : 'visual-line';
                if (this.mode === mode) this.exitVisual();
                else this.mode = mode;
                this.showSelection();
                return this.done(false);
            }
            case 'd':
            case 'x':
            case 'c':
            case 'y': {
                // Visual changes are not repeated by `.` (vim would repeat them on a same-sized region).
                this.keys = null;
                this.exitVisual();
                const op: Operator = ch === 'x' ? 'd' : ch;
                return this.done(lines ? this.lineOp(op, rowOf(t, start), rowOf(t, end), t) : this.charOp(op, start, end, t));
            }
            case 'p': {
                this.keys = null;
                this.exitVisual();
                const reg = this.register;
                if (!reg) return this.done(false);
                let insert = reg.text;
                if (lines && reg.linewise) insert = reg.text.slice(0, -1);
                else if (!lines && reg.linewise) insert = `\n${reg.text}`;
                this.register = { text: lines ? `${t.slice(start, end)}\n` : t.slice(start, end), linewise: lines };
                this.begin();
                this.buf.replace(start, end, insert);
                this.moveTo(lines ? firstNonBlank(this.buf.text, start) : insert.includes('\n') ? start : start + insert.length - 1);
                return this.done(true);
            }
            case ':':
                this.exitVisual();
                this.mode = 'command';
                this.command = '';
                return this.done(false);
        }
        this.done(false);
    }

    private showSelection(): void {
        if (!this.visual) return;
        const t = this.buf.text;
        const c = this.buf.cursor;
        if (this.mode === 'visual-line') {
            this.buf.select({ start: lineStart(t, Math.min(this.anchor, c)), end: lineEnd(t, Math.max(this.anchor, c)) });
        } else {
            this.buf.select({ start: Math.min(this.anchor, c), end: Math.min(Math.max(this.anchor, c) + 1, t.length) });
        }
    }

    private exitVisual(): void {
        this.mode = 'normal';
        this.buf.select(null);
    }

    // ---- Insert mode --------------------------------------------------------

    private insertAt(at: number): void {
        this.begin();
        this.buf.cursor = at;
        this.mode = 'insert';
        this.done(true);
    }

    private insertKey(key: VimKey): boolean {
        if (key.name === 'escape') {
            this.mode = 'normal';
            const c = this.buf.cursor;
            this.moveTo(c > lineStart(this.buf.text, c) ? c - 1 : c);
            if (this.keys) this.lastChange = [...this.keys, ESCAPE];
            this.keys = [];
            this.commit();
            this.lastCursor = this.buf.cursor;
            return true;
        }
        const c = this.buf.cursor;
        if (key.name === 'backspace') {
            const n = Math.min(c, this.host.backspaceWidth?.(this.buf.text, c) ?? 1);
            if (n > 0) this.buf.replace(c - n, c, '');
            this.buf.cursor = c - n;
            this.keys?.push(key);
            return true;
        }
        const newline = key.name === 'return' || key.name === 'enter';
        const indent = newline ? (this.host.indent?.(this.buf.text, c) ?? '') : '';
        const text = newline ? `\n${indent}` : key.name === 'tab' ? '\t' : key.name === 'space' ? (this.host.space?.(this.buf.text, c) ?? ' ') : charOf(key);
        if (text === undefined) return false;
        this.keys?.push(key);
        // An indented new line drops the blanks the moved text started with, so it is not indented twice.
        const blanks = indent ? /^[ \t]*/.exec(this.buf.text.slice(c))![0].length : 0;
        this.buf.replace(c, c + blanks, text);
        this.buf.cursor = c + text.length;
        return true;
    }

    // ---- Command line -------------------------------------------------------

    private commandKey(key: VimKey): void {
        if (key.name === 'escape') {
            this.mode = 'normal';
        } else if (key.name === 'return' || key.name === 'enter') {
            this.mode = 'normal';
            this.run(this.command.trim());
        } else if (key.name === 'backspace') {
            if (this.command) this.command = this.command.slice(0, -1);
            else this.mode = 'normal';
        } else {
            const ch = charOf(key);
            if (ch) this.command += ch;
        }
    }

    private run(command: string): void {
        switch (command) {
            case '':
                return;
            case 'w':
                this.host.save();
                return;
            case 'q':
                return this.host.close(false);
            case 'q!':
                return this.host.close(true);
            case 'wq':
                if (this.host.save()) this.host.close(false);
                return;
            case 'x':
                if (!this.host.dirty || this.host.save()) this.host.close(false);
                return;
        }
        this.message = `not an editor command: ${command}`;
    }

    // ---- Changes, undo and repeat -------------------------------------------

    /** End a command: clear what was pending, and record a change for undo and `.`. */
    private done(change: boolean): void {
        this.count = '';
        this.opCount = '';
        this.op = null;
        this.g = false;
        this.replacing = false;
        this.textObj = null;
        if (this.mode === 'insert') return; // recording goes on until Escape
        if (change && this.keys) this.lastChange = this.keys;
        this.keys = [];
        this.commit();
    }

    private begin(): void {
        this.before ??= this.buf.text;
    }

    private commit(): void {
        if (this.before !== null && this.before !== this.buf.text) {
            this.undoStack.push(this.before);
            this.redoStack = [];
        }
        this.before = null;
    }

    private undo(n: number): void {
        for (let k = 0; k < n; k++) {
            const text = this.undoStack.pop();
            if (text === undefined) {
                this.message = 'already at oldest change';
                return;
            }
            this.redoStack.push(this.buf.text);
            this.restore(text);
        }
    }

    private redo(n: number): void {
        for (let k = 0; k < n; k++) {
            const text = this.redoStack.pop();
            if (text === undefined) {
                this.message = 'already at newest change';
                return;
            }
            this.undoStack.push(this.buf.text);
            this.restore(text);
        }
    }

    /**
     * Replace the whole text from outside the engine (format on save) as one
     * change that `u` undoes, and put the cursor at `cursor`. An insert session
     * in progress ends before it and goes on as a new change after it.
     */
    replaceText(text: string, cursor: number): void {
        if (text === this.buf.text) return;
        this.commit();
        this.undoStack.push(this.buf.text);
        this.redoStack = [];
        this.restore(text);
        if (this.mode === 'insert') {
            this.buf.cursor = Math.max(0, Math.min(cursor, text.length));
            this.before = text;
        } else {
            this.moveTo(cursor);
        }
        this.lastCursor = this.buf.cursor;
    }

    /** Replace only the part that differs, and put the cursor where it starts. */
    private restore(text: string): void {
        const cur = this.buf.text;
        let p = 0;
        while (p < cur.length && p < text.length && cur[p] === text[p]) p++;
        let s = 0;
        while (s < cur.length - p && s < text.length - p && cur[cur.length - 1 - s] === text[text.length - 1 - s]) s++;
        this.buf.replace(p, cur.length - s, text.slice(p, text.length - s));
        this.moveTo(p);
    }

    /** `.`: replay the last change's keys; a count replaces the one it was typed with. */
    private repeat(): void {
        const count = this.count;
        this.count = '';
        this.keys = [];
        if (!this.lastChange.length) return;
        let replay = this.lastChange;
        if (count) {
            let k = 0;
            while (k < replay.length && /^[0-9]$/.test(replay[k]!.sequence ?? '')) k++;
            replay = [...[...count].map((d) => ({ name: d, sequence: d })), ...replay.slice(k)];
        }
        for (const key of replay) this.handleKey(key);
    }

    // ---- Cursor ---------------------------------------------------------------

    private takeCount(): number | undefined {
        const a = this.opCount;
        const b = this.count;
        this.opCount = '';
        this.count = '';
        return a || b ? Number(a || 1) * Number(b || 1) : undefined;
    }

    private column(i: number): number {
        return i - lineStart(this.buf.text, i);
    }

    /** Move in normal or visual mode; j/k keep aiming for the remembered column. */
    private moveTo(i: number, vertical = false): void {
        const at = clampNormal(this.buf.text, i);
        this.buf.cursor = at;
        if (!vertical) this.wantCol = this.column(at);
    }
}
