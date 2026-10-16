/**
 * Line structure: `[label [:]]... [opcode[.modifier] operands | directive args] [; comment]`.
 * OWNER: parser engineer. Internal.
 *
 * Reading left to right, every identifier that is not an opcode or directive
 * keyword is a label declaration, until an opcode or directive is found
 * (redcode.md 8.4). A colon directly after a label is not part of its name.
 */

import { TokenCategory, type IMessage } from '../types.ts';
import { describe, error } from './expression.ts';
import type { ISourceToken } from './lexer.ts';

export interface IParsedLine {
    /** Declared names, colons removed. */
    labels: ISourceToken[];
    /** The opcode or directive; undefined for a label-only or empty line. */
    keyword?: ISourceToken;
    /** Modifier token directly after an opcode (".ab"). */
    modifier?: ISourceToken;
    /** Tokens after the keyword (and modifier), without comment and EOL. */
    rest: ISourceToken[];
    /** The line's comment, if any. */
    comment?: ISourceToken;
    eol: ISourceToken;
    /**
     * Set when the line has an error (already reported). 'instruction': the
     * line looks like an instruction with an unknown opcode, which is not in
     * `labels`; it still takes an address so later addresses stay stable.
     */
    invalid?: 'instruction' | 'line';
}

export const isKeyword = (t: ISourceToken | undefined, word: string): boolean =>
    t !== undefined && t.category === TokenCategory.Preprocessor && t.lexeme.toUpperCase() === word;

const isColon = (t: ISourceToken | undefined): boolean => t !== undefined && t.category === TokenCategory.Unknown && t.lexeme === ':';

/** Content tokens of a line: everything except a trailing comment and the EOL. */
export function content(tokens: readonly ISourceToken[]): ISourceToken[] {
    return tokens.filter((t) => t.category !== TokenCategory.Comment && t.category !== TokenCategory.EOL);
}

/** Split a line into labels, keyword and the rest. Sets `invalid` after reporting an Error. */
export function parseLine(tokens: readonly ISourceToken[], messages: IMessage[]): IParsedLine {
    const eol = tokens[tokens.length - 1]!;
    const comment = tokens.find((t) => t.category === TokenCategory.Comment);
    const body = content(tokens);
    const labels: ISourceToken[] = [];
    let i = 0;
    while (i < body.length && body[i]!.category === TokenCategory.Label) {
        labels.push(body[i]!);
        i++;
        if (isColon(body[i])) i++;
    }
    const result: IParsedLine = { labels, rest: [], eol };
    if (comment) result.comment = comment;
    const next = body[i];
    if (!next) return result;

    if (next.category === TokenCategory.Opcode || next.category === TokenCategory.Preprocessor) {
        result.keyword = next;
        i++;
        const after = body[i];
        if (next.category === TokenCategory.Opcode && (isKeyword(after, 'EQU') || isKeyword(after, 'FOR'))) {
            error(messages, next.position, `'${next.lexeme}' is an opcode and cannot be used as an ${after!.lexeme.toUpperCase()} name`);
            return { ...result, keyword: after!, invalid: 'line' };
        }
        const mod = body[i];
        if (mod && mod.category === TokenCategory.Modifier) {
            if (next.category !== TokenCategory.Opcode) {
                error(messages, mod.position, `'${next.lexeme}' does not take a modifier`);
                return { ...result, invalid: 'line' };
            }
            if (mod.position.char !== next.end || mod.position.line !== next.position.line) {
                error(messages, mod.position, `The modifier '${mod.lexeme}' must follow the opcode with no space`);
                return { ...result, invalid: 'instruction' };
            }
            result.modifier = mod;
            i++;
        }
        result.rest = body.slice(i);
        return result;
    }

    const last = labels[labels.length - 1];
    if (last && next.category === TokenCategory.Modifier) {
        error(messages, last.position, `Unknown opcode '${last.lexeme}'`);
        return { ...result, labels: labels.slice(0, -1), invalid: 'instruction' };
    }
    if (next.category === TokenCategory.Unknown && next.lexeme === '&') {
        error(messages, next.position, "'&' is only allowed inside a FOR block, followed by the loop counter name");
    } else if (next.category === TokenCategory.Unknown && /^\d/.test(next.lexeme)) {
        error(messages, next.position, `Invalid label '${next.lexeme}': a label must start with a letter or '_'`);
    } else if (last) {
        error(messages, next.position, `Expected an opcode or directive after '${last.lexeme}', found ${describe(next)}`);
    } else {
        error(messages, next.position, `Expected a label, opcode or directive, found ${describe(next)}`);
    }
    return { ...result, invalid: 'line' };
}
