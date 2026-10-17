/**
 * Warrior editor (modal): a Redcode text area with line numbers and syntax
 * highlighting, live parse diagnostics, and one Save button (also ctrl+s).
 *
 * Opened through `App.openEditor({ mode, warrior })` (app.ts). The focused
 * Textarea receives the typing; the overlay is modal, so game keys stay quiet.
 * Escape and the Close button ask once before discarding unsaved changes.
 * Saving goes through `deps.save` (app.ts -> `WarriorLibrary.save`), and is
 * allowed with parse errors: the file is a draft until it parses.
 *
 * Five preferences (prefs.ts), toggled with F2 to F6 or the footer buttons:
 * relative numbers (on by default: the gutter shows each instruction's cell
 * offset from the cursor line, see `drawGutter`), vim keys (off by default:
 * vim.ts drives the Textarea, and Escape no longer closes; `:q` does), format
 * on save (on by default: see `format`; it also turns on auto-indent, see
 * `autoIndent` and `backspaceWidth`) and autocomplete (on by default: while
 * an opcode is typed, a box beside the cursor lists the matching opcodes and
 * directives, see `completionAt` and `drawCompletion`) and preview (off by
 * default: the saved warrior runs beside the text, a step a second, and the
 * source line that runs next is highlighted; see preview.ts and `drawGutter`).
 */

import {
    BoxRenderable,
    LineNumberRenderable,
    SyntaxStyle,
    TextareaRenderable,
    type CliRenderer,
    type KeyEvent,
    type LineColorConfig,
    type LineSign,
} from '@opentui/core';
import { MessageType, OPCODE_NAMES, MODIFIER_NAMES, TokenCategory, type IParseResult, type ISimulatorOptions } from '../../engine/index.ts';
import { formatRedcodeSafely, instructionColumn, operandColumn } from '../../engine/parser/index.ts';
import type { WarriorEntry } from '../library.ts';
import type { EditorPrefs } from '../prefs.ts';
import { HEX } from '../theme.ts';
import { INSTRUCTION_REFS, syntaxOf, type InstructionRef } from '../redcode-ref.ts';
import { SegmentText, button, fitLine, lineWidth, panel, spread, type Line, type Segment } from '../ui.ts';
import { Vim, type VimBuffer, type VimHost } from '../vim.ts';
import type { Overlay } from './manager.ts';
import { NEXT_LINE_BG, PREVIEW_WIDTH, Preview } from './preview.ts';

export interface EditorRequest {
    mode: 'new' | 'edit';
    warrior?: WarriorEntry;
}

export interface EditorDeps {
    /** Source text of the warrior being edited ('' for new: the template is used). */
    source: string;
    /** Parse for diagnostics. May throw. */
    check(source: string): IParseResult;
    /** Save and return the saved entry plus a status note. Throws on I/O errors. */
    save(source: string, entry: WarriorEntry | undefined): { entry: WarriorEntry; note: string };
    onClose(): void;
    prefs: EditorPrefs;
    /** Persist toggled preferences. Throws on I/O errors. */
    savePrefs(prefs: EditorPrefs): void;
    /** The match's simulator settings, which the preview runs with. */
    options: ISimulatorOptions;
}

export const NEW_WARRIOR_TEMPLATE = `;redcode-94
;name Untitled
;author
;strategy A dwarf: bomb every 4th address, forever.

step    equ     4
loop    add.ab  #step, bomb  ; move the bomb target on
        mov.i   bomb, @bomb  ; drop a DAT bomb there
        jmp     loop         ; and again
bomb    dat     #0, #0
        end     loop
`;

/** Debounce for re-parsing while typing. */
export const CHECK_DELAY_MS = 150;

export type TokenKind = 'opcode' | 'modifier' | 'mode' | 'number' | 'label' | 'comment' | 'meta';

export interface Token {
    start: number;
    end: number;
    kind: TokenKind;
}

const OPCODES = new Set([...OPCODE_NAMES, 'ORG', 'END', 'EQU', 'FOR', 'ROF', 'PIN']);
const MODIFIERS = new Set(MODIFIER_NAMES);
const META = /^;\s*(redcode|name|author|strategy|version|date|assert)\b/i;
const MODE_CHARS = '#$*@{<}>';

/** Redcode tokens of one line for highlighting. Never throws; unknown text is left plain. */
export function tokenizeLine(line: string): Token[] {
    const out: Token[] = [];
    const semi = line.indexOf(';');
    const code = semi >= 0 ? line.slice(0, semi) : line;
    const word = /([A-Za-z_][A-Za-z0-9_]*)(\.[A-Za-z]+)?|(\d+)|(\S)/g;
    let operandStart = false; // the next non-space char may be an addressing mode
    for (let m = word.exec(code); m; m = word.exec(code)) {
        const at = m.index;
        if (m[1]) {
            const isOp = OPCODES.has(m[1].toUpperCase());
            out.push({ start: at, end: at + m[1].length, kind: isOp ? 'opcode' : 'label' });
            if (m[2] && isOp && MODIFIERS.has(m[2].slice(1).toUpperCase())) {
                out.push({ start: at + m[1].length, end: at + m[0].length, kind: 'modifier' });
            }
            operandStart = isOp;
        } else if (m[3]) {
            out.push({ start: at, end: at + m[3].length, kind: 'number' });
            operandStart = false;
        } else {
            if (operandStart && MODE_CHARS.includes(m[4]!)) out.push({ start: at, end: at + 1, kind: 'mode' });
            operandStart = m[4] === ',';
        }
    }
    if (semi >= 0) out.push({ start: semi, end: line.length, kind: META.test(line.slice(semi)) ? 'meta' : 'comment' });
    return out;
}

export interface Completion {
    /** The typed part of the opcode word: line[start, end). */
    start: number;
    end: number;
    /** Opcodes and directives starting with it, in INSTRUCTION_REFS order. */
    matches: InstructionRef[];
    /** Complete in upper case (the typed part has letters, all upper case). */
    upper: boolean;
}

/**
 * The completion for the cursor at string offset `col` of `line`, or null. The
 * cursor must end a word that sits where an opcode goes, as in `tokenizeLine`:
 * the first word, or the second after a first word that is not an opcode (a
 * label). Nothing in a comment, an operand or a modifier, in the middle of a
 * word, or when the word is already the only match.
 */
export function completionAt(line: string, col: number): Completion | null {
    const before = line.slice(0, col);
    if (before.includes(';') || /^[\w.]/.test(line.slice(col))) return null;
    const word = /(^|\s)([A-Za-z_]\w*)$/.exec(before);
    if (!word) return null;
    const start = col - word[2]!.length;
    const lead = /^\s*(?:([A-Za-z_]\w*)\s+)?$/.exec(before.slice(0, start));
    if (!lead || (lead[1] && OPCODES.has(lead[1].toUpperCase()))) return null;
    const typed = word[2]!.toUpperCase();
    const matches = INSTRUCTION_REFS.filter((r) => r.name.startsWith(typed));
    if (!matches.length || (matches.length === 1 && matches[0]!.name === typed)) return null;
    return { start, end: col, matches, upper: word[2] === typed && /[A-Z]/.test(typed) };
}

/**
 * Auto-indent: the spaces a new line that follows text[0, at) starts with.
 * The nearest code line above (blank and comment-only lines skipped; the last
 * one may be the part before the cursor) sets it: its opcode's display column
 * (`width` measures, a tab is wider), or, without an opcode or a code line, the
 * column format on save puts opcodes in (`instructionColumn`).
 */
export function autoIndent(text: string, at: number, width: (s: string) => number = (s) => s.length): string {
    const line = text
        .slice(0, at)
        .split('\n')
        .findLast((l) => l.split(';', 1)[0]!.trim() !== '');
    const op = line === undefined ? undefined : tokenizeLine(line).find((t) => t.kind === 'opcode');
    return ' '.repeat(op ? width(line!.slice(0, op.start)) : instructionColumn(text));
}

/** With an indent, the blanks after `at` that a new line would otherwise push in after it. */
export function leadingBlanks(text: string, at: number, indent: string): number {
    return indent ? /^[ \t]*/.exec(text.slice(at))![0].length : 0;
}

/** Backspace at `cursor` deletes a whole line of blanks it ends (an auto-indent), else one character. */
export function backspaceWidth(text: string, cursor: number): number {
    const start = text.lastIndexOf('\n', cursor - 1) + 1;
    const end = text.indexOf('\n', cursor);
    const blanks = /^[ \t]+$/.test(text.slice(start, cursor)) && (end < 0 ? text.length : end) === cursor;
    return blanks ? cursor - start : 1;
}

/**
 * Space snaps to the next column: the number of spaces it types at `cursor`
 * (1 for a plain space). Nothing but blanks may follow the cursor on its line.
 * - After a label that starts the line (a first word at column 0 that is not
 *   an opcode or directive): up to the opcode column, `autoIndent`'s, and at
 *   least two spaces past the label, as the formatter widens its label column.
 * - After the opcode word (with any `.modifier`) where an opcode goes: up to
 *   the formatter's operand column, counted from where this opcode starts
 *   (`operandColumn` − `instructionColumn`, at least the word plus two).
 * Columns are display columns (`width`; a tab is wider).
 */
export function snapWidth(text: string, cursor: number, width: (s: string) => number = (s) => s.length): number {
    const start = text.lastIndexOf('\n', cursor - 1) + 1;
    const end = text.indexOf('\n', cursor);
    const before = text.slice(start, cursor);
    if (!/^[ \t]*$/.test(text.slice(cursor, end < 0 ? text.length : end))) return 1;
    if (/^[A-Za-z_]\w*$/.test(before) && !OPCODES.has(before.toUpperCase())) {
        return Math.max(autoIndent(text, start, width).length, width(before) + 2) - width(before);
    }
    const m = /^(\s*(?:([A-Za-z_]\w*)\s+)?)([A-Za-z_]\w*)(\.[A-Za-z]+)?$/.exec(before);
    if (!m || !OPCODES.has(m[3]!.toUpperCase()) || (m[2] && OPCODES.has(m[2].toUpperCase()))) return 1;
    if (m[4] && !MODIFIERS.has(m[4].slice(1).toUpperCase())) return 1;
    const word = m[3]!.length + (m[4]?.length ?? 0);
    const column = width(m[1]!) + Math.max(operandColumn(text) - instructionColumn(text), word + 2);
    return column - width(before);
}

export interface Diagnostics {
    errors: number;
    warnings: number;
    instructions: number;
    /** One status line: the first error (or warning), or the instruction count. */
    line: Line;
    /** 1-based source lines with errors. */
    errorLines: number[];
}

export function diagnose(check: (source: string) => IParseResult, source: string): Diagnostics {
    let result: IParseResult;
    try {
        result = check(source);
    } catch (e) {
        const text = `✗ parser failed: ${e instanceof Error ? e.message : String(e)}`;
        return { errors: 1, warnings: 0, instructions: 0, line: [{ text, fg: HEX.bad }], errorLines: [] };
    }
    const errors = result.messages.filter((m) => m.type === MessageType.Error);
    const warnings = result.messages.filter((m) => m.type === MessageType.Warning);
    const instructions = result.tokens.filter((t) => t.category === TokenCategory.Opcode).length;
    const where = (m: (typeof errors)[number]) => `line ${m.position.line}:${m.position.char} ${m.text}`;
    const more = (n: number, what: string) => (n > 1 ? ` (+${n - 1} more ${what}${n > 2 ? 's' : ''})` : '');
    const line: Line = [];
    if (errors.length) {
        line.push({ text: `✗ ${where(errors[0]!)}`, fg: HEX.bad }, { text: more(errors.length, 'error'), fg: HEX.muted });
    } else {
        line.push({ text: `✓ ${instructions} instruction${instructions === 1 ? '' : 's'}`, fg: HEX.good });
        if (warnings.length) line.push({ text: `  ⚠ ${where(warnings[0]!)}${more(warnings.length, 'warning')}`, fg: HEX.warn });
    }
    return { errors: errors.length, warnings: warnings.length, instructions, line, errorLines: errors.map((m) => m.position.line) };
}

const INSTRUCTIONS = new Set(OPCODE_NAMES);

/**
 * The core cells (load order, 0 = the first instruction) each source line
 * assembles to, by 0-based line: [] for comments, blank lines, labels on their
 * own, `;name`-style lines, EQU, ORG, END and anything after END. A line inside
 * FOR … ROF has one cell per repetition (none for FOR 0). Taken from the
 * parser's opcode positions when the source parses; with errors, guessed.
 */
export function lineCells(source: string, result: IParseResult | undefined): number[][] {
    if (!result || result.messages.some((m) => m.type === MessageType.Error)) return guessCells(source);
    const cells = source.split('\n').map((): number[] => []);
    let cell = 0;
    for (const t of result.tokens) if (t.category === TokenCategory.Opcode) cells[t.position.line - 1]?.push(cell++);
    return cells;
}

/**
 * The lexical fallback: a line whose first opcode word (after any labels) is
 * an instruction makes one cell. FOR with a plain number repeats its block;
 * a block it cannot expand (a count expression, nesting) leaves that block and
 * every later line without cells, since their cells are unknown.
 */
export function guessCells(source: string): number[][] {
    const lines = source.split('\n');
    const cells = lines.map((): number[] => []);
    let cell = 0;
    let block: { count: number; lines: number[] } | null = null;
    for (let i = 0; i < lines.length; i++) {
        const code = lines[i]!.split(';', 1)[0]!;
        const op = code.match(/[A-Za-z_]\w*/g)?.map((w) => w.toUpperCase()).find((w) => OPCODES.has(w));
        if (op === 'END') break;
        if (block) {
            if (op === 'FOR') break;
            if (op === 'ROF') {
                for (let k = 0; k < block.count; k++) for (const line of block.lines) cells[line]!.push(cell++);
                block = null;
            } else if (op && INSTRUCTIONS.has(op)) block.lines.push(i);
        } else if (op === 'FOR') {
            const count = /\bfor\s+(\d+)\s*$/i.exec(code);
            if (!count) break;
            block = { count: Number(count[1]), lines: [] };
        } else if (op && INSTRUCTIONS.has(op)) cells[i]!.push(cell++);
    }
    return cells;
}

/**
 * Each line's offset from the cell under the cursor: the operand to type on
 * the cursor line to reach that line. On a line without a cell, offsets count
 * from the next instruction below it (else the last one above). Lines with no
 * cell, or several (inside FOR … ROF), get none; a cursor inside a block
 * counts from the block's first repetition.
 */
export function cellOffsets(cells: number[][], row: number): Map<number, number> {
    const offsets = new Map<number, number>();
    const ref = (cells.slice(row).find((c) => c.length) ?? cells.slice(0, row).findLast((c) => c.length))?.[0];
    if (ref === undefined) return offsets;
    cells.forEach((c, line) => {
        if (c.length === 1) offsets.set(line, c[0]! - ref);
    });
    return offsets;
}

const STYLES = {
    opcode: { fg: '#7dd3fc', bold: true },
    modifier: { fg: '#93c5fd' },
    mode: { fg: '#f9a8d4', bold: true },
    number: { fg: '#bef264' },
    label: { fg: '#fcd34d' },
    comment: { fg: HEX.muted, italic: true },
    meta: { fg: '#c4b5fd', italic: true },
} as const;

const ERROR_BG = '#4c1d1d';
/** Function keys that flip a preference. */
const PREF_KEYS: Readonly<Record<string, keyof EditorPrefs>> = { f2: 'vimKeys', f3: 'relativeNumbers', f4: 'formatOnSave', f5: 'autocomplete', f6: 'preview' };
/** Footer toggles: key, preference, then labels from longest to shortest (see `toggles`). */
const TOGGLES: readonly [string, keyof EditorPrefs, string, string][] = [
    ['F2', 'vimKeys', 'vim keys', 'vim'],
    ['F3', 'relativeNumbers', 'relative numbers', 'rel'],
    ['F4', 'formatOnSave', 'format on save', 'fmt'],
    ['F5', 'autocomplete', 'autocomplete', 'auto'],
    ['F6', 'preview', 'preview', 'run'],
];
/** The most completion rows shown at once. */
const COMPLETION_ROWS = 8;
/** Characters that each take one column, so a string's offset is its display column. */
const NARROW = /^[\x20-\x7e\n]*$/;

export class EditorOverlay implements Overlay, VimHost {
    readonly id = 'editor';
    readonly modal = true;
    readonly root: BoxRenderable;
    readonly textarea: TextareaRenderable;
    private readonly gutter: LineNumberRenderable;
    private readonly status: SegmentText;
    private readonly style: SyntaxStyle;
    private readonly styleIds: Record<TokenKind, number>;
    /** The file being edited (set after the first save of a new warrior). */
    private entry: WarriorEntry | undefined;
    private savedText: string;
    /** Text at the last content change (change events also come without an edit). */
    private lastText: string;
    private diagnostics: Diagnostics;
    private checkedText: string;
    private notice: Line = [];
    /** Set by a first Escape/Close/ctrl+c with unsaved changes; the next one goes through. */
    private discardArmed = false;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private focused = false;
    private prefs: EditorPrefs;
    /** Set while vim keys are on. */
    private vim: Vim | undefined;
    /** `lineCells` of the text, for the relative gutter. */
    private cells: number[][] = [];
    /** Bumped when the cells or the error lines change; the gutter redraws when this or the cursor row does. */
    private gutterVersion = 0;
    private gutterDrawn = '';
    /** The open completion box: its matches, the highlighted one, and the cursor it was made for. */
    private completion: (Completion & { index: number; row: number; col: number }) | null = null;
    /** Set by a content change; the completion is worked out on the next frame or key. */
    private completionStale = false;
    /** The last snapped space: the text it made, the cursor after it, and its width (for backspace). */
    private snap: { text: string; end: number; width: number } | null = null;
    private readonly popup: BoxRenderable;
    private readonly popupText: SegmentText;
    readonly preview: Preview;
    /** The terminal size the editor was last placed in, to place it again when the preview is toggled. */
    private screen = { width: 80, height: 24 };

    constructor(
        private readonly renderer: CliRenderer,
        readonly request: EditorRequest,
        private readonly deps: EditorDeps,
    ) {
        this.entry = request.warrior;
        this.prefs = { ...deps.prefs };
        this.root = panel(renderer, 'editor', this.title(), 80, 24);
        this.style = SyntaxStyle.fromStyles(STYLES, renderer.nativeScene);
        this.styleIds = Object.fromEntries(Object.keys(STYLES).map((k) => [k, this.style.getStyleId(k)!])) as Record<TokenKind, number>;
        const source = deps.source || (request.mode === 'new' ? NEW_WARRIOR_TEMPLATE : '');
        this.savedText = source;
        this.lastText = source;
        this.textarea = new TextareaRenderable(renderer, {
            id: 'editor-text',
            flexGrow: 1,
            initialValue: source,
            wrapMode: 'none',
            syntaxStyle: this.style,
            // Transparent so the gutter's per-line backgrounds (cursor line, errors) show across the text.
            backgroundColor: 'transparent',
            focusedBackgroundColor: 'transparent',
            textColor: HEX.text,
            focusedTextColor: HEX.text,
            cursorColor: HEX.accent,
            selectionBg: HEX.selection,
            keyBindings: [
                { name: 'z', ctrl: true, action: 'undo' },
                { name: 'y', ctrl: true, action: 'redo' },
                { name: 'z', ctrl: true, shift: true, action: 'redo' },
            ],
            onContentChange: () => this.changed(),
        });
        this.gutter = new LineNumberRenderable(renderer, {
            id: 'editor-gutter',
            target: this.textarea,
            flexGrow: 1,
            fg: HEX.muted,
            bg: HEX.panel,
            minWidth: 3,
        });
        this.status = new SegmentText(renderer, { id: 'editor-status', height: 3, flexShrink: 0 });
        this.preview = new Preview(renderer, deps.options, () => {
            this.gutterVersion++;
            this.renderer.requestRender();
        });
        this.preview.root.visible = this.prefs.preview;
        const body = new BoxRenderable(renderer, { id: 'editor-body', flexDirection: 'row', flexGrow: 1 });
        body.add(this.gutter);
        body.add(this.preview.root);
        this.root.add(body);
        this.root.add(this.status);
        this.popup = new BoxRenderable(renderer, {
            id: 'editor-completion',
            position: 'absolute',
            visible: false,
            zIndex: 10,
            backgroundColor: HEX.popup,
            shouldFill: true,
        });
        this.popupText = new SegmentText(renderer, { id: 'editor-completion-text', flexGrow: 1 });
        this.popup.add(this.popupText);
        this.root.add(this.popup);
        // Runs before each frame's layout, so the gutter and the completion box follow cursor moves (keys, clicks) in the same frame.
        this.root.onLifecyclePass = () => {
            if (this.prefs.preview) this.preview.fit();
            this.drawGutter();
            this.drawCompletion();
        };
        this.checkedText = source;
        this.diagnostics = diagnose(deps.check, source);
        this.updateCells();
        this.highlight();
        if (this.prefs.vimKeys) this.vim = new Vim(this.vimBuffer(), this);
        if (this.prefs.preview) this.runPreview(source);
    }

    get text(): string {
        return this.textarea.plainText;
    }

    get dirty(): boolean {
        return this.text !== this.savedText;
    }

    /** With the preview on, wider by the preview's width (as far as the terminal allows). */
    size(width: number, height: number) {
        const text = Math.max(Math.min(60, width - 2), Math.floor(width * 0.75));
        return {
            width: this.prefs.preview ? Math.max(text, Math.min(width - 2, text + PREVIEW_WIDTH)) : text,
            height: Math.max(Math.min(16, height - 2), Math.floor(height * 0.8)),
        };
    }

    /** `size()` centred, as the overlay manager places overlays. */
    place(width: number, height: number): void {
        this.screen = { width, height };
        const s = this.size(width, height);
        const w = Math.max(10, Math.min(s.width, width));
        const h = Math.max(5, Math.min(s.height, height));
        this.root.width = w;
        this.root.height = h;
        this.root.left = Math.max(0, Math.floor((width - w) / 2));
        this.root.top = Math.max(0, Math.floor((height - h) / 2));
    }

    handleKey(key: KeyEvent): boolean {
        if (key.ctrl && key.name === 's') {
            key.preventDefault();
            this.save();
            return true;
        }
        const pref = PREF_KEYS[key.name];
        if (pref) {
            this.toggle(pref);
            return true;
        }
        if (this.prefs.preview && (key.name === 'f7' || key.name === 'f8' || key.name === 'f9')) {
            if (key.name === 'f7') this.preview.toggle();
            else if (key.name === 'f8') this.preview.stepOnce();
            else this.preview.restart();
            this.gutterVersion++;
            this.renderer.requestRender();
            return true;
        }
        const c = this.currentCompletion();
        if (c && (key.name === 'up' || key.name === 'down')) {
            c.index = (c.index + (key.name === 'up' ? -1 : 1) + c.matches.length) % c.matches.length;
            this.renderer.requestRender();
            return true;
        }
        if (c && key.name === 'tab' && !key.ctrl && !key.meta && !key.shift) {
            this.accept(c);
            return true;
        }
        if (!this.vim && this.prefs.formatOnSave && !key.ctrl && !key.meta && !key.shift && !this.textarea.hasSelection()) {
            const buffer = this.vimBuffer();
            const at = buffer.cursor;
            if (key.name === 'return' || key.name === 'enter') {
                const t = this.text;
                const indent = this.indent(t, at);
                const blanks = leadingBlanks(t, at, indent);
                if (blanks) {
                    // The new indent replaces the moved text's own leading blanks; one replace keeps it one undo step.
                    this.textarea.replaceText(`${t.slice(0, at)}\n${indent}${t.slice(at + blanks)}`);
                    buffer.cursor = at + 1 + indent.length;
                } else this.textarea.insertText(`\n${indent}`);
                return true;
            }
            if (key.name === 'space') {
                const blanks = this.space(this.text, at);
                if (blanks.length > 1) {
                    this.textarea.insertText(blanks);
                    return true;
                }
            }
            const n = key.name === 'backspace' ? this.backspaceWidth(this.text, at) : 1;
            if (n > 1) {
                buffer.replace(at - n, at, '');
                return true;
            }
        }
        if (!this.vim?.handleKey(key)) return false;
        this.showMode();
        return true;
    }

    /** With format on save on, Enter (and vim's o, O) indents the new line: see `autoIndent`. */
    indent(text: string, at: number): string {
        if (!this.prefs.formatOnSave) return '';
        const ta = this.textarea;
        return autoIndent(text, at, (s) => (NARROW.test(s) ? s.length : ta.editBuffer.measureText(s)));
    }

    /**
     * With format on save on, backspace removes a line's indent in one press
     * (see `backspaceWidth`), and the gap a space just snapped (see `space`)
     * when nothing was edited since.
     */
    backspaceWidth(text: string, cursor: number): number {
        if (!this.prefs.formatOnSave) return 1;
        const snap = this.snap;
        this.snap = null;
        if (snap && snap.text === text && snap.end === cursor) return snap.width;
        return backspaceWidth(text, cursor);
    }

    /** With format on save on, space snaps to the next column (`snapWidth`), also when it closes the completion box. */
    space(text: string, cursor: number): string {
        this.snap = null;
        if (!this.prefs.formatOnSave) return ' ';
        const ta = this.textarea;
        const n = snapWidth(text, cursor, (s) => (NARROW.test(s) ? s.length : ta.editBuffer.measureText(s)));
        const blanks = ' '.repeat(n);
        if (n > 1) this.snap = { text: text.slice(0, cursor) + blanks + text.slice(cursor), end: cursor + n, width: n };
        return blanks;
    }

    /**
     * Escape closes the editor. With vim keys it first leaves insert, visual or
     * command mode and cancels a pending count or operator; in plain normal mode it closes.
     */
    canClose(): boolean {
        if (this.currentCompletion()) {
            this.completion = null;
            this.renderer.requestRender();
            if (!this.vim) return false;
        }
        if (!this.vim || (this.vim.mode === 'normal' && this.vim.pending === '')) return this.confirmDiscard('esc');
        this.vim.handleKey({ name: 'escape' });
        this.showMode();
        this.refresh();
        return false;
    }

    /** True when the editor may close now (clean, or asked once already). */
    confirmDiscard(again = 'esc'): boolean {
        if (!this.dirty || this.discardArmed) return true;
        this.discardArmed = true;
        this.notice = [{ text: `unsaved changes · ${again} again to discard · ${this.vim ? ':w' : 'ctrl+s'} to save`, fg: HEX.warn }];
        this.refresh();
        return false;
    }

    /** Format (when on, see `format`), then write. Returns false when the file could not be written. */
    save(): boolean {
        this.flushCheck();
        if (this.prefs.formatOnSave) this.format();
        const source = this.text;
        let saved = false;
        try {
            const { entry, note } = this.deps.save(source, this.entry);
            this.entry = entry;
            this.savedText = source;
            this.lastText = source;
            this.root.title = this.title();
            const errors = this.diagnostics.errors;
            const draft = errors ? ` with ${errors} error${errors === 1 ? '' : 's'}` : '';
            this.notice = [{ text: `✓ saved ${entry.id}${draft}`, fg: errors ? HEX.warn : HEX.good }, ...(note ? [{ text: ` · ${note}`, fg: HEX.muted }] : [])];
            saved = true;
            if (this.prefs.preview) this.runPreview(source);
        } catch (e) {
            this.notice = [{ text: `✗ not saved: ${e instanceof Error ? e.message : String(e)}`, fg: HEX.bad }];
        }
        this.discardArmed = false;
        this.refresh();
        return saved;
    }

    /**
     * Format on save: replace the buffer with the canonical layout
     * (parser/format.ts) as one undoable change (`u` with vim keys, ctrl+z
     * without), keeping the cursor on its line with the column clamped. Only
     * text without parse errors is formatted, and only when the formatted text
     * assembles to the same warrior (`formatRedcodeSafely`); otherwise, or
     * when nothing would change, the buffer is left alone.
     */
    private format(): void {
        if (this.diagnostics.errors > 0) return;
        const before = this.text;
        let text: string;
        try {
            const outcome = formatRedcodeSafely(before);
            if (!outcome.changed) return;
            text = outcome.text;
        } catch {
            return;
        }
        const buffer = this.vimBuffer();
        const offset = buffer.cursor;
        const row = before.slice(0, offset).split('\n').length - 1;
        const col = offset - (before.lastIndexOf('\n', offset - 1) + 1);
        const lines = text.split('\n');
        const line = Math.min(row, lines.length - 1);
        const cursor = lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0) + Math.min(col, lines[line]!.length);
        if (this.vim) {
            this.vim.replaceText(text, cursor);
        } else {
            this.textarea.replaceText(text);
            buffer.cursor = cursor;
        }
        this.changed();
        this.flushCheck();
    }

    /** `:q` (asks once about unsaved changes, like Close) and `:q!` (discards them). */
    close(force: boolean): void {
        if (force || this.confirmDiscard(':q')) this.deps.onClose();
    }

    /** Parse now instead of waiting for the debounce. */
    flushCheck(): void {
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = undefined;
        if (this.text !== this.checkedText) this.check();
    }

    refresh(): void {
        if (this.textarea.isDestroyed) return;
        if (this.prefs.preview) {
            this.preview.stale = this.preview.source !== null && this.text !== this.preview.source;
            this.preview.draw();
        }
        if (!this.focused) {
            this.focused = true;
            this.textarea.focus();
        }
        const keys = this.vim ? '  :w save · esc/:q close · u/ctrl+r undo/redo' : '  ctrl+s save · esc close · ctrl+z/y undo/redo';
        const buttons: Line = [
            button('Save', () => this.save(), true),
            { text: ' ' },
            button('Close', () => this.confirmDiscard('close') && this.deps.onClose()),
            { text: keys, fg: HEX.faint },
        ];
        const mode: Line = this.vim
            ? [
                  { text: this.vim.status, fg: HEX.accent, bold: true },
                  { text: this.vim.pending ? ` ${this.vim.pending}` : '', fg: HEX.muted },
                  { text: this.vim.message ? ` ${this.vim.message}` : '', fg: HEX.bad },
              ]
            : [];
        const width = typeof this.root.width === 'number' ? this.root.width - 4 : 60; // inside border and padding
        const toggles = this.toggles(width - (mode.length ? lineWidth(mode) + 1 : 0));
        this.status.setLines([
            this.diagnostics.line,
            this.notice.length ? [...buttons.slice(0, 3), { text: '  ' }, ...this.notice] : buttons,
            mode.length || lineWidth(toggles) < width ? spread(mode, toggles, width) : toggles,
        ]);
    }

    /**
     * The footer toggles in at most `room` columns: full labels when they fit,
     * else shortened one at a time from the right (`vim`, `rel`, ...), then
     * key and state only (`F2 on`). `spread` clips whatever still does not fit.
     */
    private toggles(room: number): Line {
        const level = TOGGLES.map(() => 0);
        const build = (): Line =>
            TOGGLES.flatMap(([key, pref, ...labels], i) => {
                const label = labels[level[i]!];
                const state = this.prefs[pref] ? 'on' : 'off';
                const toggle: Segment = { text: label ? `${key} ${label}: ${state}` : `${key} ${state}`, fg: HEX.muted, onClick: () => this.toggle(pref) };
                return i ? [{ text: '  ' }, toggle] : [toggle];
            });
        for (let step = 0; step < 2; step++) {
            for (let i = TOGGLES.length - 1; i >= 0 && lineWidth(build()) > room; i--) level[i] = step + 1;
        }
        return build();
    }

    onClose(): void {
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = undefined;
        this.preview.pause();
        this.textarea.blur();
        this.root.destroyRecursively();
        this.style.destroy();
    }

    private title(): string {
        const e = this.entry;
        if (!e) return 'NEW WARRIOR';
        return e.origin === 'builtin' ? `EDIT built-in ${e.name}.red · saves a copy to warriors/` : `EDIT ${e.id}`;
    }

    /** Flip a preference, apply it here and save it (deps.savePrefs). */
    private toggle(pref: keyof EditorPrefs): void {
        this.prefs = { ...this.prefs, [pref]: !this.prefs[pref] };
        this.completion = null;
        if (pref === 'vimKeys') {
            this.textarea.clearSelection();
            this.vim = this.prefs.vimKeys ? new Vim(this.vimBuffer(), this) : undefined;
            this.showMode();
        }
        if (pref === 'preview') {
            this.preview.root.visible = this.prefs.preview;
            if (this.prefs.preview) this.runPreview(this.savedText);
            else this.preview.pause();
            this.gutterVersion++;
            this.place(this.screen.width, this.screen.height);
        }
        try {
            this.deps.savePrefs(this.prefs);
        } catch (e) {
            this.notice = [{ text: `✗ preference not saved: ${e instanceof Error ? e.message : String(e)}`, fg: HEX.bad }];
        }
        this.refresh();
    }

    /** A bar cursor in vim's insert mode, a block otherwise. */
    private showMode(): void {
        if (this.textarea.isDestroyed) return; // :q closed the editor
        this.textarea.cursorStyle = { style: this.vim?.mode === 'insert' ? 'line' : 'block', blinking: true };
    }

    /** The Textarea as a VimBuffer: string offsets, converted to its rows and display columns (a tab is wider). */
    private vimBuffer(): VimBuffer {
        const ta = this.textarea;
        const width = (s: string) => (NARROW.test(s) ? s.length : ta.editBuffer.measureText(s));
        const where = (offset: number) => {
            const before = ta.plainText.slice(0, offset);
            const start = before.lastIndexOf('\n') + 1;
            return { row: before.length - before.replaceAll('\n', '').length, col: width(before.slice(start)) };
        };
        return {
            get text() {
                return ta.isDestroyed ? '' : ta.plainText;
            },
            get cursor() {
                if (ta.isDestroyed) return 0; // :q closed the editor during the key
                const { row, col } = ta.logicalCursor;
                const lines = ta.plainText.split('\n');
                const line = lines[row] ?? '';
                let i = NARROW.test(line) ? Math.min(col, line.length) : 0;
                if (!NARROW.test(line)) while (i < line.length && width(line.slice(0, i + 1)) <= col) i++;
                return lines.slice(0, row).reduce((n, l) => n + l.length + 1, 0) + i;
            },
            set cursor(offset: number) {
                const p = where(offset);
                ta.setCursor(p.row, p.col);
            },
            replace(start, end, insert) {
                const a = where(start);
                if (end > start) {
                    const b = where(end);
                    ta.deleteRange(a.row, a.col, b.row, b.col);
                }
                if (insert) {
                    ta.setCursor(a.row, a.col);
                    ta.insertText(insert);
                }
            },
            select(range) {
                if (!range) ta.clearSelection();
                else ta.setSelection(width(ta.plainText.slice(0, range.start)), width(ta.plainText.slice(0, range.end)));
            },
        };
    }

    private changed(): void {
        if (this.text === this.lastText) return;
        this.lastText = this.text;
        this.completionStale = true;
        this.discardArmed = false;
        this.notice = [];
        this.updateCells();
        this.highlight();
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = undefined;
            if (this.textarea.isDestroyed) return;
            this.check();
            this.renderer.requestRender();
        }, CHECK_DELAY_MS);
        this.refresh();
    }

    /** Restart the preview on `source` (the saved text). */
    private runPreview(source: string): void {
        try {
            this.preview.load(source, this.deps.check(source));
        } catch (e) {
            this.preview.fail(source, `✗ parser failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        this.gutterVersion++;
    }

    private check(): void {
        this.checkedText = this.text;
        this.diagnostics = diagnose(this.deps.check, this.checkedText);
        this.gutterVersion++;
        this.refresh();
    }

    /** Parsing is well under a millisecond for a 200-line warrior, so the gutter does not wait for the debounce. */
    private updateCells(): void {
        let result: IParseResult | undefined;
        try {
            result = this.deps.check(this.text);
        } catch {
            result = undefined;
        }
        this.cells = lineCells(this.text, result);
        this.gutterVersion++;
    }

    /** Highlights are placed in display columns, so token offsets are measured: a tab is wider than one column. */
    private highlight(): void {
        const ta = this.textarea;
        ta.clearAllHighlights();
        this.text.split('\n').forEach((line, i) => {
            const col = (at: number) => (NARROW.test(line) ? at : ta.editBuffer.measureText(line.slice(0, at)));
            for (const t of tokenizeLine(line)) ta.addHighlight(i, { start: col(t.start), end: col(t.end), styleId: this.styleIds[t.kind] });
        });
    }

    /**
     * The open completion, or null. A content change works it out afresh at
     * the cursor (`completionAt`, when autocomplete is on and keys type: always
     * without vim keys, in insert mode with them); a cursor that moved without
     * an edit, or leaving insert mode, closes it.
     */
    private currentCompletion(): EditorOverlay['completion'] {
        if (this.textarea.isDestroyed) return null;
        const { row, col } = this.textarea.logicalCursor;
        if (this.completionStale) {
            this.completionStale = false;
            this.completion = null;
            if (this.prefs.autocomplete && (!this.vim || this.vim.mode === 'insert')) {
                const buffer = this.vimBuffer();
                const offset = buffer.cursor;
                const text = buffer.text;
                const start = text.lastIndexOf('\n', offset - 1) + 1;
                const end = text.indexOf('\n', offset);
                const found = completionAt(text.slice(start, end < 0 ? text.length : end), offset - start);
                if (found) this.completion = { ...found, index: 0, row, col };
            }
        }
        const c = this.completion;
        if (c && (c.row !== row || c.col !== col || (this.vim && this.vim.mode !== 'insert'))) this.completion = null;
        return this.completion;
    }

    /**
     * Tab: replace the typed part with the highlighted match, in the typed
     * case, and add the gap a space would (it snaps to the operand column with
     * format on save on) unless a blank already follows. One undo step
     * without vim keys; with them it is typed as keys, so it is part of the
     * insert that `u` undoes and `.` repeats.
     */
    private accept(c: Completion & { index: number }): void {
        const name = c.upper ? c.matches[c.index]!.name : c.matches[c.index]!.name.toLowerCase();
        const { row } = this.textarea.logicalCursor;
        const line = this.text.split('\n')[row] ?? '';
        const typed = line.slice(c.start, c.end);
        let keep = 0;
        while (keep < typed.length && typed[keep] === name[keep]) keep++;
        const add = name.slice(keep);
        const spaced = !/^[ \t]/.test(line.slice(c.end));
        this.completion = null;
        if (this.vim) {
            // Typed as keys: the space goes through the space hook, so it snaps like a typed space.
            for (let k = keep; k < typed.length; k++) this.vim.handleKey({ name: 'backspace' });
            for (const ch of add) this.vim.handleKey({ name: ch, sequence: ch });
            if (spaced) this.vim.handleKey({ name: 'space', sequence: ' ' });
        } else {
            const buffer = this.vimBuffer();
            const at = buffer.cursor;
            const from = at - (typed.length - keep);
            const end = from + add.length;
            const completed = this.text.slice(0, from) + add + this.text.slice(at);
            const gap = spaced ? this.space(completed, end) : '';
            if (keep === typed.length) this.textarea.insertText(add + gap);
            else {
                // Changing the typed case: replacing the whole text keeps it one undo step (deleting first would make two).
                this.textarea.replaceText(completed.slice(0, end) + gap + completed.slice(end));
                buffer.cursor = end + gap.length;
            }
        }
        this.renderer.requestRender();
    }

    /**
     * The completion box: one row per match (`jmz A, B   jump to A if B is
     * zero`) with a space at each end, on the popup colour without a border,
     * the highlighted one in the selection colour, at most COMPLETION_ROWS.
     * Placed just right of the cursor with its first row on the cursor row (moved up to stay within the text area); left of the typed
     * word when that would run past the panel's right edge; below (or above)
     * the cursor row when neither side fits. It floats over the text, so
     * nothing else moves.
     */
    private drawCompletion(): void {
        const c = this.currentCompletion();
        this.popup.visible = c !== null;
        if (!c) return;
        const first = Math.max(0, Math.min(c.index - COMPLETION_ROWS + 1, c.matches.length - COMPLETION_ROWS));
        const shown = c.matches.slice(first, first + COMPLETION_ROWS);
        const syntax = (r: InstructionRef) => {
            const s = syntaxOf(r);
            return c.upper ? s : r.name.toLowerCase() + s.slice(r.name.length);
        };
        const pad = Math.max(...shown.map((r) => syntax(r).length));
        const rows: Line[] = shown.map((r, i) => {
            const bg = first + i === c.index ? HEX.selection : HEX.popup;
            return [
                { text: ` ${syntax(r).padEnd(pad)}   `, fg: HEX.accent, bg, bold: true },
                { text: `${r.meaning} `, fg: HEX.text, bg },
            ];
        });
        // In the coordinates of `left` and `top`: from the panel's top-left inside its border.
        // Within the text area's rows when the box fits there, else over the status lines too.
        const ta = this.textarea;
        const minX = 0;
        const maxX = (typeof this.root.width === 'number' ? this.root.width : 80) - 2;
        const w = Math.min(Math.max(...rows.map(lineWidth)), maxX - minX);
        const h = rows.length;
        const minY = h <= ta.height ? ta.y - this.root.y - 1 : 0;
        const maxY = h <= ta.height ? minY + ta.height : (typeof this.root.height === 'number' ? this.root.height : 24) - 2;
        const cursor = ta.visualCursor; // in the visible part of the text
        const cx = ta.x - this.root.x - 1 + cursor.visualCol;
        const cy = ta.y - this.root.y - 1 + cursor.visualRow;
        const wordX = cx - (c.end - c.start);
        let x: number;
        let y = Math.max(minY, Math.min(cy, maxY - h));
        if (cx + 1 + w <= maxX) x = cx + 1;
        else if (wordX - w >= minX) x = wordX - w;
        else {
            x = Math.max(minX, Math.min(cx, maxX - w));
            y = cy + 1 + h <= maxY ? cy + 1 : Math.max(minY, cy - h);
        }
        this.popup.left = x;
        this.popup.top = y;
        this.popup.width = w;
        this.popup.height = h;
        this.popupText.setLines(rows.map((r) => fitLine(r, w)));
    }

    /**
     * Error lines get a red background, gutter and text alike. With the
     * preview on and the text as it runs there, the line of the instruction
     * that runs next gets the warrior's colour, dimmed. With relative numbers, each line that makes
     * one cell shows its signed offset from the cursor (cellOffsets), lines
     * without a cell are blank, and the cursor line shows ▸ and its own line
     * number, so diagnostics' line numbers stay easy to find.
     */
    private drawGutter(): void {
        if (this.textarea.isDestroyed) return;
        const row = this.textarea.logicalCursor.row;
        const cell = this.prefs.preview && this.text === this.preview.source ? this.preview.nextCell() : null;
        const next = cell === null ? -1 : this.cells.findIndex((c) => c.includes(cell));
        const state = `${this.prefs.relativeNumbers} ${row} ${this.gutterVersion} ${next}`;
        if (state === this.gutterDrawn) return;
        this.gutterDrawn = state;
        const colors = new Map<number, LineColorConfig>(this.diagnostics.errorLines.map((line) => [line - 1, { gutter: ERROR_BG, content: ERROR_BG }]));
        if (next >= 0 && !colors.has(next)) colors.set(next, { gutter: NEXT_LINE_BG, content: NEXT_LINE_BG });
        const numbers = new Map<number, number>();
        const signs = new Map<number, LineSign>();
        const hidden = new Set<number>();
        if (this.prefs.relativeNumbers) {
            if (!colors.has(row)) colors.set(row, { gutter: HEX.hover, content: HEX.hover });
            const offsets = cellOffsets(this.cells, row);
            for (let line = 0; line < this.cells.length; line++) {
                const d = offsets.get(line);
                if (line === row) signs.set(line, { before: '▸', beforeColor: HEX.accent });
                else if (d === undefined) hidden.add(line);
                else {
                    numbers.set(line, Math.abs(d));
                    signs.set(line, { before: d < 0 ? '-' : d > 0 ? '+' : ' ', beforeColor: HEX.text });
                }
            }
        }
        this.gutter.setLineColors(colors);
        this.gutter.setLineNumbers(numbers);
        this.gutter.setLineSigns(signs);
        this.gutter.setHideLineNumbers(hidden);
    }
}
