/**
 * Preprocessor: metadata comments, ;assert, EQU, FOR/ROF expansion,
 * text after END, label addresses.
 * OWNER: parser engineer. Internal; signatures may change.
 *
 * One pass over the source lines in order, expanding FOR blocks as they are
 * met. Every label is bound to the number of instructions emitted before it,
 * which is the address of the next instruction (redcode.md 8.4). Operands,
 * ORG/END addresses and asserts are only collected here; the assembler
 * evaluates them once every label is known (forward references).
 */

import { MessageType, TokenCategory, type IMessage, type IMetaData, type IPosition } from '../types.ts';
import type { IResolvedParseOptions } from '../options.ts';
import { identifierCategory, lexLine, type ISourceToken } from './lexer.ts';
import { error } from './expression.ts';
import { content, isKeyword, parseLine, type IParsedLine } from './line.ts';
import { SymbolTable } from './symbols.ts';

/** Upper bound on source lines processed during FOR expansion (guards against runaway counts). */
export const MAX_EXPANDED_LINES = 100_000;

export interface IInstructionLine {
    /** 0-based offset from the warrior's first instruction. */
    address: number;
    /** A parsed line whose keyword is an opcode. */
    line: IParsedLine;
}

export interface IDirective {
    kind: 'ORG' | 'END' | 'PIN';
    token: ISourceToken;
    /** Address (ORG, END) or identifier (PIN) expression tokens; empty for a bare END. */
    args: ISourceToken[];
    /** Instructions emitted before the directive (CURLINE). */
    address: number;
}

export interface IAssertion {
    comment: ISourceToken;
    condition: ISourceToken[];
    /** Instructions emitted before the assert (CURLINE). */
    address: number;
}

export interface IMetaLine {
    text: string;
    position: IPosition;
}

export interface IPreprocessed {
    metaData: IMetaData;
    /** ;redcode-NN line to emit (";redcode-94" when absent). */
    redcodeLine: IMetaLine;
    /** Source ;name / ;author comment positions, when present. */
    namePosition?: IPosition;
    authorPosition?: IPosition;
    /** One entry per source ;strategy line, values trimmed. */
    strategyLines: IMetaLine[];
    instructions: IInstructionLine[];
    directives: IDirective[];
    asserts: IAssertion[];
    symbols: SymbolTable;
}

const REDCODE_RE = /^;redcode(?:-(\S*))?/i;
const META_RE = /^;(name|author|strategy|assert)(?=\s|$)/i;
const STANDARD_COMMENTS: Readonly<Record<string, string>> = { '94': ';redcode-94', '88': ';redcode-88', '86': ';redcode-86' };

/** Zero-padded FOR counter for `&` concatenation: at least two digits (redcode.md 9.5). */
export const padCounter = (n: number): string => String(n).padStart(2, '0');

export function preprocess(lines: ISourceToken[][], options: IResolvedParseOptions, messages: IMessage[]): IPreprocessed {
    const symbols = new SymbolTable(options);
    const result: IPreprocessed = {
        metaData: { name: '', author: '', strategy: '' },
        redcodeLine: { text: ';redcode-94', position: { line: 1, char: 1 } },
        strategyLines: [],
        instructions: [],
        directives: [],
        asserts: [],
        symbols,
    };
    let redcodeSeen = false;
    let address = 0;
    let stopped = false;
    let budget = MAX_EXPANDED_LINES;
    const commentLinesSeen = new Set<number>();

    // ---- metadata and ;assert ---------------------------------------------

    const handleComment = (tokens: readonly ISourceToken[]): void => {
        const comment = tokens[0];
        if (!comment || comment.category !== TokenCategory.Comment) return;
        if (commentLinesSeen.has(comment.position.line)) return;
        commentLinesSeen.add(comment.position.line);
        const text = comment.lexeme;

        const redcode = REDCODE_RE.exec(text);
        if (redcode) {
            if (redcodeSeen) return;
            redcodeSeen = true;
            const suffix = redcode[1] ?? '';
            const std = /^(\d+)/.exec(suffix)?.[1];
            let line = ';redcode-94';
            if (std !== undefined) {
                const known = STANDARD_COMMENTS[std];
                if (known) line = known;
                else warn(comment.position, `Unknown redcode standard '${std}'; assuming ICWS'94`);
            }
            result.redcodeLine = { text: line, position: comment.position };
            return;
        }
        const meta = META_RE.exec(text);
        if (!meta) return;
        const keyword = meta[1]!.toLowerCase();
        const value = text.slice(meta[0].length).trim();
        switch (keyword) {
            case 'name':
                result.metaData.name = value;
                result.namePosition = comment.position;
                break;
            case 'author':
                result.metaData.author = value;
                result.authorPosition = comment.position;
                break;
            case 'strategy':
                result.strategyLines.push({ text: value, position: comment.position });
                break;
            case 'assert': {
                const column = comment.position.char + meta[0].length;
                const condition = lexLine(text.slice(meta[0].length), comment.position.line, column);
                if (condition.length === 0) {
                    error(messages, comment.position, ';assert needs a condition');
                } else {
                    result.asserts.push({ comment, condition, address });
                }
                break;
            }
        }
    };

    const warn = (position: IPosition, text: string): void => {
        messages.push({ type: MessageType.Warning, position: { ...position }, text });
    };

    // ---- FOR counter substitution and & concatenation ----------------------

    /**
     * Apply FOR counters. `&name` appends the zero-padded counter to the
     * token directly before it (or stands alone as a number). With `plain`,
     * a bare counter name becomes its value.
     */
    const substitute = (tokens: readonly ISourceToken[], env: ReadonlyMap<string, number>, plain: boolean): ISourceToken[] => {
        if (env.size === 0) return [...tokens];
        const out: ISourceToken[] = [];
        for (let j = 0; j < tokens.length; j++) {
            const t = tokens[j]!;
            const next = tokens[j + 1];
            if (
                t.category === TokenCategory.Unknown && t.lexeme === '&' &&
                next && next.category === TokenCategory.Label && env.has(next.lexeme) && next.position.char === t.end
            ) {
                const digits = padCounter(env.get(next.lexeme)!);
                const prev = out[out.length - 1];
                if (prev && prev.end === t.position.char && (prev.category === TokenCategory.Label || prev.category === TokenCategory.Number || prev.category === TokenCategory.Opcode || prev.category === TokenCategory.Preprocessor)) {
                    const lexeme = prev.lexeme + digits;
                    const category = /^\d+$/.test(lexeme) ? TokenCategory.Number : /^[A-Za-z_]/.test(lexeme) ? identifierCategory(lexeme) : TokenCategory.Unknown;
                    out[out.length - 1] = { position: prev.position, lexeme, category, end: next.end };
                } else {
                    out.push({ position: t.position, lexeme: digits, category: TokenCategory.Number, end: next.end });
                }
                j++;
                continue;
            }
            if (plain && t.category === TokenCategory.Label && env.has(t.lexeme)) {
                out.push({ ...t, lexeme: String(env.get(t.lexeme)!), category: TokenCategory.Number });
                continue;
            }
            out.push(t);
        }
        return out;
    };

    // ---- FOR / ROF ----------------------------------------------------------

    /** Index of the FOR keyword if the line is `names... FOR ...`, else -1. */
    const forHeaderIndex = (tokens: readonly ISourceToken[]): number => {
        for (let j = 0; j < tokens.length; j++) {
            const t = tokens[j]!;
            if (isKeyword(t, 'FOR')) return j;
            const nameLike = t.category === TokenCategory.Label || (t.category === TokenCategory.Unknown && (t.lexeme === '&' || t.lexeme === ':'));
            if (!nameLike) return -1;
        }
        return -1;
    };

    /**
     * Index of the ROF that closes the block starting at `from`, or -1.
     * Inside a FOR 0 block (`strict`), only lines that start with FOR count as
     * nested blocks, so prose such as "wait for it" cannot open one.
     */
    const findRof = (block: readonly ISourceToken[][], from: number, strict: boolean): number => {
        let depth = 0;
        for (let j = from; j < block.length; j++) {
            const tokens = block[j]!;
            if (isKeyword(tokens[0], 'ROF')) {
                if (depth === 0) return j;
                depth--;
            } else if (strict ? isKeyword(tokens[0], 'FOR') : forHeaderIndex(tokens) >= 0) {
                depth++;
            }
        }
        return -1;
    };

    const forCount = (forToken: ISourceToken, tokens: ISourceToken[]): number => {
        if (tokens.length === 0) {
            error(messages, forToken.position, 'FOR needs a repeat count');
            return 0;
        }
        const context = { address, relative: false, undefinedText: (n: string) => `FOR count uses '${n}', which is not defined before the FOR` };
        const value = symbols.evaluate(tokens, context, messages);
        return value === undefined ? 0 : Math.max(0, value);
    };

    // ---- one ordinary line ---------------------------------------------------

    const declareLabels = (labels: readonly ISourceToken[]): void => {
        for (const label of labels) symbols.declareLabel(label, address, messages);
    };

    /**
     * Names from label-only lines, waiting for the next statement. They join
     * its labels (redcode.md 8.4), so before EQU they name the constant too.
     */
    let pending: ISourceToken[] = [];
    const flushPending = (): void => {
        declareLabels(pending);
        pending = [];
    };

    const handleLine = (tokens: ISourceToken[]): void => {
        const parsed = parseLine(tokens, messages);
        const keyword = parsed.keyword;
        if (!parsed.invalid && !keyword) {
            pending.push(...parsed.labels);
            return;
        }
        const line = pending.length === 0 ? parsed : { ...parsed, labels: [...pending, ...parsed.labels] };
        pending = [];
        if (line.invalid) {
            declareLabels(line.labels);
            if (line.invalid === 'instruction') address++;
            return;
        }
        if (!keyword) return;
        if (keyword.category === TokenCategory.Opcode) {
            declareLabels(line.labels);
            result.instructions.push({ address, line });
            address++;
            return;
        }
        const word = keyword.lexeme.toUpperCase();
        switch (word) {
            case 'EQU': {
                if (line.labels.length === 0) {
                    error(messages, keyword.position, 'EQU needs a name before it');
                    return;
                }
                if (line.rest.length === 0) {
                    error(messages, keyword.position, 'EQU needs a value');
                    return;
                }
                for (const name of line.labels) symbols.declareConstant(name, line.rest, messages);
                return;
            }
            case 'ORG':
            case 'END': {
                declareLabels(line.labels);
                if (word === 'ORG' && line.rest.length === 0) {
                    error(messages, keyword.position, 'ORG needs a start address');
                } else {
                    result.directives.push({ kind: word, token: keyword, args: line.rest, address });
                }
                if (word === 'END') stopped = true;
                return;
            }
            case 'PIN': {
                declareLabels(line.labels);
                result.directives.push({ kind: 'PIN', token: keyword, args: line.rest, address });
                return;
            }
            case 'ROF':
                error(messages, keyword.position, 'ROF without a matching FOR');
                return;
            default:
                // FOR lines are handled by processBlock; this is a FOR after something that is not a name.
                error(messages, keyword.position, `Unexpected '${keyword.lexeme}'`);
        }
    };

    // ---- the pass ------------------------------------------------------------

    const processBlock = (block: readonly ISourceToken[][], env: ReadonlyMap<string, number>): void => {
        for (let i = 0; i < block.length && !stopped; i++) {
            if (--budget < 0) {
                const at = block[i]![0]!.position;
                error(messages, at, `FOR expansion is too large (more than ${MAX_EXPANDED_LINES} lines)`);
                stopped = true;
                return;
            }
            const raw = block[i]!;
            handleComment(raw);

            const forAt = forHeaderIndex(raw);
            if (forAt >= 0) {
                const forToken = raw[forAt]!;
                flushPending();
                const names = substitute(raw.slice(0, forAt), env, false).filter((t) => !(t.category === TokenCategory.Unknown && t.lexeme === ':'));
                const count = forCount(forToken, substitute(content(raw.slice(forAt + 1)), env, true));
                const rof = findRof(block, i + 1, count === 0);
                if (rof < 0) {
                    error(messages, forToken.position, 'FOR without a matching ROF');
                    return;
                }
                const bad = names.find((t) => t.category !== TokenCategory.Label);
                if (bad) {
                    error(messages, bad.position, `Invalid name '${bad.lexeme}' before FOR`);
                } else {
                    const counter = names[names.length - 1];
                    declareLabels(names.slice(0, -1));
                    const valid = counter === undefined || symbols.checkName(counter, messages, 'FOR counter');
                    if (valid) {
                        const body = block.slice(i + 1, rof);
                        for (let k = 1; k <= count && !stopped; k++) {
                            const inner = new Map(env);
                            if (counter) inner.set(counter.lexeme, k);
                            processBlock(body, inner);
                        }
                    }
                }
                i = rof;
                continue;
            }
            handleLine(substitute(raw, env, true));
        }
    };

    processBlock(lines, new Map());
    flushPending();
    symbols.checkCycles(messages);
    if (result.strategyLines.length > 0) result.metaData.strategy = result.strategyLines.map((s) => s.text).join('\n');
    return result;
}
