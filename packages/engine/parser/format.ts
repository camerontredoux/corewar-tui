/**
 * Redcode source formatter. OWNER: parser engineer.
 *
 * `formatRedcode` lays a warrior out in one canonical style:
 *
 *     loop    mov     bomb, >bomb     ; trailing comment
 *             djn     loop, #4
 *     bomb    dat     #0, #1
 *
 * - a label column, an opcode column and the operands, padded with spaces;
 *   each column is as wide as its longest entry plus two, and at least 8;
 * - opcodes, modifiers and directives in lower case; modifiers, modes,
 *   operands and expressions otherwise exactly as written, with `, ` between
 *   the A and B operand (no default is ever added);
 * - EQU, FOR, ROF, ORG, END and PIN in the same columns as instructions;
 * - full-line comments verbatim; trailing comments kept, two spaces after the
 *   code and aligned within runs of consecutive commented lines;
 * - labels on their own line stay there; blank lines kept, runs of three or
 *   more cut to two; trailing whitespace removed; one final newline;
 * - verbatim: anything after END, any FOR block whose count is not a plain
 *   positive number (FOR 0 is the multi-line comment), and any line it does
 *   not fully understand (`&` concatenation, stray characters, errors).
 *
 * The formatter is lexical and never evaluates anything. `formatRedcodeSafely`
 * is the guarded entry point: it only formats source that parses without
 * errors, and keeps the formatting only when both texts assemble to the same
 * warrior.
 */

import { MessageType, TokenCategory, type IParseOptions, type IParseResult } from '../types.ts';
import { lexLine, type ISourceToken } from './lexer.ts';
import { parse, serialise } from './index.ts';

/** Narrowest label and opcode columns. */
export const MIN_COLUMN = 8;
/** Spaces at least between a column's longest entry and the next column. */
const GAP = 2;
/** Longest run of blank lines kept. */
const MAX_BLANK_RUN = 2;

/** A line in canonical form: label column, keyword, arguments, trailing comment. */
interface IFormattedLine {
    kind: 'code';
    /** Labels joined by spaces (colons kept), or ''. */
    label: string;
    /** Lower-case opcode (with modifier) or directive, or '' for a label-only line. */
    keyword: string;
    /** Operands or directive argument, or ''. */
    args: string;
    comment?: string;
}

interface IVerbatimLine {
    kind: 'verbatim';
    text: string;
}

interface IBlankLine {
    kind: 'blank';
}

type Line = IFormattedLine | IVerbatimLine | IBlankLine;

const isColon = (t: ISourceToken | undefined): boolean => t !== undefined && t.category === TokenCategory.Unknown && t.lexeme === ':';
const isWord = (t: ISourceToken | undefined, word: string): boolean =>
    t !== undefined && t.category === TokenCategory.Preprocessor && t.lexeme.toUpperCase() === word;
const isComment = (t: ISourceToken): boolean => t.category === TokenCategory.Comment;

/** The source text of tokens[from..to] (inclusive), internal spacing as written. */
const slice = (text: string, tokens: readonly ISourceToken[]): string =>
    tokens.length === 0 ? '' : text.slice(tokens[0]!.position.char - 1, tokens[tokens.length - 1]!.end - 1);

/** Index of the FOR keyword when the line is `names... FOR ...` (as the preprocessor reads it), else -1. */
function forHeaderIndex(tokens: readonly ISourceToken[]): number {
    for (let j = 0; j < tokens.length; j++) {
        const t = tokens[j]!;
        if (isWord(t, 'FOR')) return j;
        const nameLike = t.category === TokenCategory.Label || (t.category === TokenCategory.Unknown && (t.lexeme === '&' || t.lexeme === ':'));
        if (!nameLike) return -1;
    }
    return -1;
}

/**
 * Index of the line holding the ROF that closes a FOR opened before `from`,
 * counting every FOR header as a nested block, or -1. This finds the
 * preprocessor's ROF or a later one, so a verbatim block never ends too soon.
 */
function closingRof(lines: readonly ISourceToken[][], from: number): number {
    let depth = 0;
    for (let j = from; j < lines.length; j++) {
        const tokens = lines[j]!;
        if (isWord(tokens[0], 'ROF')) {
            if (depth === 0) return j;
            depth--;
        } else if (forHeaderIndex(tokens) >= 0) {
            depth++;
        }
    }
    return -1;
}

/** One line in canonical form, or undefined when it holds anything unexpected. */
function formatLine(text: string, tokens: readonly ISourceToken[]): IFormattedLine | undefined {
    const comment = tokens.find(isComment);
    const body = tokens.filter((t) => !isComment(t));
    if (body.some((t) => t.category === TokenCategory.Unknown && t.lexeme !== ':')) return undefined;

    const labels: string[] = [];
    let i = 0;
    while (i < body.length && body[i]!.category === TokenCategory.Label) {
        const name = body[i]!.lexeme;
        i++;
        if (isColon(body[i])) {
            labels.push(`${name}:`);
            i++;
        } else {
            labels.push(name);
        }
    }
    const line: IFormattedLine = { kind: 'code', label: labels.join(' '), keyword: '', args: '' };
    if (comment) line.comment = comment.lexeme.trimEnd();
    const keyword = body[i];
    if (!keyword) return labels.length > 0 ? line : undefined;
    const rest = body.slice(i + 1);
    if (rest.some((t) => isColon(t))) return undefined;

    if (keyword.category === TokenCategory.Preprocessor) {
        if (rest[0]?.category === TokenCategory.Modifier) return undefined;
        line.keyword = keyword.lexeme.toLowerCase();
        line.args = slice(text, rest);
        return line;
    }
    if (keyword.category !== TokenCategory.Opcode) return undefined;

    let operands = rest;
    line.keyword = keyword.lexeme.toLowerCase();
    const modifier = rest[0];
    if (modifier?.category === TokenCategory.Modifier) {
        if (modifier.position.char !== keyword.end) return undefined;
        line.keyword += modifier.lexeme.toLowerCase();
        operands = rest.slice(1);
    }
    if (operands.some((t) => isWord(t, 'EQU') || isWord(t, 'FOR'))) return undefined;
    const groups: ISourceToken[][] = [[]];
    for (const t of operands) {
        if (t.category === TokenCategory.Comma) groups.push([]);
        else groups[groups.length - 1]!.push(t);
    }
    if (operands.length > 0 && (groups.length > 2 || groups.some((g) => g.length === 0))) return undefined;
    line.args = groups.map((g) => slice(text, g)).join(', ');
    return line;
}

/** Read the source into canonical, verbatim and blank lines. */
function readLines(source: string): Line[] {
    const texts = source.split(/\r\n|\r|\n/);
    const lexed = texts.map((text, k) => lexLine(text, k + 1));
    const out: Line[] = [];
    const verbatim = (k: number): void => {
        out.push(texts[k]!.trim() === '' ? { kind: 'blank' } : { kind: 'verbatim', text: texts[k]!.trimEnd() });
    };
    for (let k = 0; k < texts.length; k++) {
        const text = texts[k]!;
        const tokens = lexed[k]!;
        if (tokens.length === 0) {
            out.push({ kind: 'blank' });
            continue;
        }
        if (isComment(tokens[0]!)) {
            verbatim(k);
            continue;
        }
        const forAt = forHeaderIndex(tokens);
        if (forAt >= 0) {
            const count = slice(text, tokens.slice(forAt + 1).filter((t) => !isComment(t)));
            if (!/^\d+$/.test(count) || Number(count) === 0) {
                // FOR 0 (a multi-line comment) or a computed count: keep the whole block as written.
                const rof = closingRof(lexed, k + 1);
                const last = rof < 0 ? texts.length - 1 : rof;
                for (let j = k; j <= last; j++) verbatim(j);
                k = last;
                continue;
            }
        }
        const line = formatLine(text, tokens);
        if (!line) {
            verbatim(k);
            continue;
        }
        out.push(line);
        if (line.keyword === 'end') {
            // Text after END is not Redcode: keep it exactly.
            for (let j = k + 1; j < texts.length; j++) {
                out.push(texts[j]!.trim() === '' ? { kind: 'blank' } : { kind: 'verbatim', text: texts[j]! });
            }
            break;
        }
    }
    return out;
}

const codeLines = (lines: Line[]): IFormattedLine[] => lines.filter((l): l is IFormattedLine => l.kind === 'code' && l.keyword !== '');
const labelColumn = (code: IFormattedLine[]): number => Math.max(MIN_COLUMN, ...code.map((l) => l.label.length + GAP));
const opcodeColumn = (code: IFormattedLine[]): number => Math.max(MIN_COLUMN, ...code.filter((l) => l.args !== '').map((l) => l.keyword.length + GAP));
const codeOf = (source: string): IFormattedLine[] => codeLines(readLines(typeof source === 'string' ? source : String(source ?? '')));

/** The column `formatRedcode` puts opcodes and directives in for this source (the label column's width). Pure; never throws. */
export function instructionColumn(source: string): number {
    return labelColumn(codeOf(source));
}

/** The column `formatRedcode` puts operands in for this source (the label and opcode columns' widths). Pure; never throws. */
export function operandColumn(source: string): number {
    const code = codeOf(source);
    return labelColumn(code) + opcodeColumn(code);
}

/** Format Redcode source in the canonical layout (see the file comment). Pure; never throws. */
export function formatRedcode(source: string): string {
    const lines = readLines(typeof source === 'string' ? source : String(source ?? ''));
    const code = codeLines(lines);
    const labelWidth = labelColumn(code);
    const opWidth = opcodeColumn(code);

    const codeText = (l: IFormattedLine): string => {
        if (l.keyword === '') return l.label;
        const head = l.label.padEnd(labelWidth);
        return l.args === '' ? head + l.keyword : head + l.keyword.padEnd(opWidth) + l.args;
    };

    const rendered = lines.map((l) => (l.kind === 'code' ? codeText(l) : l.kind === 'verbatim' ? l.text : ''));

    // Align trailing comments within each run of consecutive commented code lines.
    for (let k = 0; k < lines.length; ) {
        const isCommented = (j: number) => lines[j]?.kind === 'code' && (lines[j] as IFormattedLine).comment !== undefined;
        if (!isCommented(k)) {
            k++;
            continue;
        }
        let end = k;
        while (isCommented(end)) end++;
        const column = Math.max(...rendered.slice(k, end).map((t) => t.length)) + GAP;
        for (let j = k; j < end; j++) rendered[j] = rendered[j]!.padEnd(column) + (lines[j] as IFormattedLine).comment!;
        k = end;
    }

    const out: string[] = [];
    let blanks = 0;
    for (let k = 0; k < rendered.length; k++) {
        const text = rendered[k]!;
        if (lines[k]!.kind === 'blank') {
            if (++blanks > MAX_BLANK_RUN) continue;
        } else {
            blanks = 0;
        }
        out.push(lines[k]!.kind === 'verbatim' ? text : text.trimEnd());
    }
    while (out.length > 0 && out[out.length - 1]!.trim() === '') out.pop();
    return out.length === 0 ? '' : `${out.join('\n')}\n`;
}

/** Why `formatRedcodeSafely` kept the source as it was. */
export type FormatSkipReason = 'errors' | 'unchanged' | 'semantics';

export interface IFormatOutcome {
    /** The text to save: the formatted source, or the original one. */
    text: string;
    /** True when `text` differs from the source. */
    changed: boolean;
    /** Set when the source was kept. */
    skipped?: FormatSkipReason;
}

/** Everything a parse yields that matters to a match, positions left out. */
function fingerprint(result: IParseResult): string {
    return JSON.stringify({
        load: serialise(result.tokens),
        metaData: result.metaData,
        errors: result.messages.filter((m) => m.type === MessageType.Error).length,
        warnings: result.messages.filter((m) => m.type === MessageType.Warning).length,
    });
}

/**
 * Format `source`, but only when it is safe: the source must parse without
 * errors, and the formatted text must assemble (same options) to the same
 * warrior: identical load file (metadata comments, start offset, PIN,
 * instructions), metadata and message counts. Otherwise the source comes back
 * unchanged. `format` is replaceable for tests.
 */
export function formatRedcodeSafely(source: string, options?: IParseOptions, format: (source: string) => string = formatRedcode): IFormatOutcome {
    const before = parse(source, options);
    if (before.messages.some((m) => m.type === MessageType.Error)) return { text: source, changed: false, skipped: 'errors' };
    let text: string;
    try {
        text = format(source);
    } catch {
        return { text: source, changed: false, skipped: 'semantics' };
    }
    if (text === source) return { text: source, changed: false, skipped: 'unchanged' };
    if (fingerprint(parse(text, options)) !== fingerprint(before)) return { text: source, changed: false, skipped: 'semantics' };
    return { text, changed: true };
}
