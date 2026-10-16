/**
 * Lexer: source text -> raw source tokens with 1-based positions.
 * OWNER: parser engineer. Internal; signatures may change.
 *
 * The lexer never reports problems. Characters it cannot classify become
 * `Unknown` tokens, and the stage that consumes a line reports them. That way
 * lines inside a `FOR 0` block (multi-line comments) never cause errors.
 *
 * Classification:
 * - identifiers `[A-Za-z_][A-Za-z0-9_]*`: `Opcode` for the 19 opcodes (LDP and
 *   STP included), `Preprocessor` for ORG END EQU FOR ROF PIN (both
 *   case-insensitive), else `Label`;
 * - `.` directly followed by letters: `Modifier` (lexeme ".ab");
 * - `# $ @ { }`: `Mode`. `* < >` are `Maths`; the assembler reads them as a
 *   mode when they start an operand (redcode.md 9.2);
 * - `+ - * / % ( ) ! < > == != <= >= && ||`: `Maths`;
 * - decimal digits: `Number`; digits followed by letters: `Unknown`;
 * - `,`: `Comma`; `;` to end of line: `Comment`;
 * - `:` after a label and `&` (FOR concatenation): `Unknown` with that lexeme.
 */

import { TokenCategory, type IPosition } from '../types.ts';
import { opcodeFromName } from '../instruction.ts';

/** A token as it appears in the source, before preprocessing. */
export interface ISourceToken {
    position: IPosition;
    lexeme: string;
    category: TokenCategory;
    /** 1-based column just after the token's source text (for adjacency checks). */
    end: number;
    /** For a token substituted from an EQU value: the position of the use site. */
    origin?: IPosition;
}

export const DIRECTIVES: ReadonlySet<string> = new Set(['ORG', 'END', 'EQU', 'FOR', 'ROF', 'PIN']);

const MODE_CHARS = new Set(['#', '$', '@', '{', '}']);
const TWO_CHAR_OPS = new Set(['==', '!=', '<=', '>=', '&&', '||']);
const ONE_CHAR_OPS = new Set(['+', '-', '*', '/', '%', '(', ')', '!', '<', '>']);

const isIdentStart = (c: string): boolean => /[A-Za-z_]/.test(c);
const isIdentChar = (c: string): boolean => /[A-Za-z0-9_]/.test(c);
const isDigit = (c: string): boolean => c >= '0' && c <= '9';

export function identifierCategory(name: string): TokenCategory {
    if (opcodeFromName(name) !== undefined) return TokenCategory.Opcode;
    if (DIRECTIVES.has(name.toUpperCase())) return TokenCategory.Preprocessor;
    return TokenCategory.Label;
}

/**
 * Tokenise one line of text. `line` is the 1-based line number and `column`
 * the 1-based column of `text[0]` (used to lex the condition of `;assert`).
 * No EOL token is added.
 */
export function lexLine(text: string, line: number, column = 1): ISourceToken[] {
    const tokens: ISourceToken[] = [];
    const push = (start: number, stop: number, category: TokenCategory, lexeme = text.slice(start, stop)): void => {
        tokens.push({ position: { line, char: column + start }, lexeme, category, end: column + stop });
    };
    let i = 0;
    while (i < text.length) {
        const c = text[i]!;
        if (/\s/.test(c)) {
            i++;
            continue;
        }
        const start = i;
        if (c === ';') {
            push(start, text.length, TokenCategory.Comment);
            break;
        }
        if (isIdentStart(c)) {
            while (i < text.length && isIdentChar(text[i]!)) i++;
            const name = text.slice(start, i);
            push(start, i, identifierCategory(name));
            continue;
        }
        if (isDigit(c)) {
            while (i < text.length && isDigit(text[i]!)) i++;
            if (i < text.length && isIdentChar(text[i]!)) {
                while (i < text.length && isIdentChar(text[i]!)) i++;
                push(start, i, TokenCategory.Unknown);
            } else {
                push(start, i, TokenCategory.Number);
            }
            continue;
        }
        if (c === '.' && i + 1 < text.length && /[A-Za-z]/.test(text[i + 1]!)) {
            i++;
            while (i < text.length && /[A-Za-z]/.test(text[i]!)) i++;
            push(start, i, TokenCategory.Modifier);
            continue;
        }
        if (c === ',') {
            push(start, ++i, TokenCategory.Comma);
            continue;
        }
        if (MODE_CHARS.has(c)) {
            push(start, ++i, TokenCategory.Mode);
            continue;
        }
        const pair = text.slice(i, i + 2);
        if (TWO_CHAR_OPS.has(pair)) {
            i += 2;
            push(start, i, TokenCategory.Maths);
            continue;
        }
        if (ONE_CHAR_OPS.has(c)) {
            push(start, ++i, TokenCategory.Maths);
            continue;
        }
        push(start, ++i, TokenCategory.Unknown);
    }
    return tokens;
}

/** Split source into lines of source tokens. Every line ends with an EOL token. */
export function lex(source: string): ISourceToken[][] {
    const lines = source.split(/\r\n|\r|\n/);
    return lines.map((text, index) => {
        const tokens = lexLine(text, index + 1);
        const char = text.length + 1;
        tokens.push({ position: { line: index + 1, char }, lexeme: '\n', category: TokenCategory.EOL, end: char });
        return tokens;
    });
}
