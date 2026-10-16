/**
 * Constant-expression parser and evaluator (redcode.md 9.2 and ;assert, 9.4).
 * OWNER: parser engineer. Internal; signatures may change.
 *
 * One grammar for every context (operands, EQU, ORG/END, FOR counts, assert).
 * Precedence, highest first:
 *   1. unary - + !
 *   2. * / %
 *   3. + -
 *   4. < <= > >=
 *   5. == !=
 *   6. &&
 *   7. ||
 * Binary operators are left-associative. Integer semantics: `/` truncates
 * toward zero, `%` takes the sign of the dividend, comparisons and logical
 * operators yield 1 or 0, `&&` and `||` short-circuit. Division or modulo by
 * zero and results outside the safe-integer range are errors.
 */

import { MessageType, TokenCategory, type IMessage, type IPosition } from '../types.ts';
import type { ISourceToken } from './lexer.ts';

export type Expr =
    | { kind: 'number'; value: number; token: ISourceToken }
    | { kind: 'symbol'; name: string; token: ISourceToken }
    | { kind: 'unary'; op: string; operand: Expr; token: ISourceToken }
    | { kind: 'binary'; op: string; left: Expr; right: Expr; token: ISourceToken };

/**
 * Resolves a symbol. Return a number, `undefined` when the name is unknown
 * (the evaluator reports it), or `null` when the lookup already reported an
 * error (for example a cyclic EQU).
 */
export type SymbolLookup = (name: string, token: ISourceToken) => number | undefined | null;

export function error(messages: IMessage[], position: IPosition, text: string): void {
    messages.push({ type: MessageType.Error, position: { line: position.line, char: position.char }, text });
}

const BINARY_LEVELS: readonly (readonly string[])[] = [
    ['||'],
    ['&&'],
    ['==', '!='],
    ['<', '<=', '>', '>='],
    ['+', '-'],
    ['*', '/', '%'],
];

const UNARY = new Set(['-', '+', '!']);

class ParseFailure extends Error {}

/** Describe a token for a message. */
export function describe(token: ISourceToken): string {
    return token.category === TokenCategory.EOL ? 'end of line' : `'${token.lexeme}'`;
}

/**
 * Parse an expression that must use every token. `at` positions the error for
 * an empty token list. Returns undefined (with an Error message) on failure.
 */
export function parseExpression(tokens: readonly ISourceToken[], at: IPosition, messages: IMessage[]): Expr | undefined {
    if (tokens.length === 0) {
        error(messages, at, 'Expected an expression');
        return undefined;
    }
    let i = 0;
    const fail = (token: ISourceToken | undefined, text: string): never => {
        error(messages, token ? token.position : endOf(tokens), text);
        throw new ParseFailure(text);
    };

    const primary = (): Expr => {
        const t = tokens[i];
        if (!t) return fail(undefined, 'Expression ends unexpectedly');
        if (t.category === TokenCategory.Maths && UNARY.has(t.lexeme)) {
            i++;
            return { kind: 'unary', op: t.lexeme, operand: primary(), token: t };
        }
        if (t.category === TokenCategory.Maths && t.lexeme === '(') {
            i++;
            const inner = binary(0);
            const close = tokens[i];
            if (!close || close.category !== TokenCategory.Maths || close.lexeme !== ')') {
                return fail(t, "Unbalanced parentheses: missing ')'");
            }
            i++;
            return inner;
        }
        if (t.category === TokenCategory.Number) {
            i++;
            const value = Number(t.lexeme);
            if (!Number.isSafeInteger(value)) return fail(t, `Number ${t.lexeme} is too large`);
            return { kind: 'number', value, token: t };
        }
        if (t.category === TokenCategory.Label) {
            i++;
            return { kind: 'symbol', name: t.lexeme, token: t };
        }
        if (t.category === TokenCategory.Maths && t.lexeme === ')') return fail(t, "Unbalanced parentheses: unexpected ')'");
        if (t.category === TokenCategory.Opcode || t.category === TokenCategory.Preprocessor) {
            return fail(t, `Unexpected keyword '${t.lexeme}' in an expression`);
        }
        if (t.category === TokenCategory.Unknown) return fail(t, `Unexpected ${describe(t)}`);
        return fail(t, `Unexpected ${describe(t)} in an expression`);
    };

    const binary = (level: number): Expr => {
        if (level >= BINARY_LEVELS.length) return primary();
        const ops = BINARY_LEVELS[level]!;
        let left = binary(level + 1);
        for (;;) {
            const t = tokens[i];
            if (!t || t.category !== TokenCategory.Maths || !ops.includes(t.lexeme)) return left;
            i++;
            const right = binary(level + 1);
            left = { kind: 'binary', op: t.lexeme, left, right, token: t };
        }
    };

    try {
        const expr = binary(0);
        const extra = tokens[i];
        if (extra) {
            if (extra.category === TokenCategory.Maths && extra.lexeme === ')') {
                fail(extra, "Unbalanced parentheses: unexpected ')'");
            }
            const hint = extra.category === TokenCategory.Mode || extra.category === TokenCategory.Number || extra.category === TokenCategory.Label
                ? ' (missing comma?)'
                : '';
            fail(extra, `Unexpected ${describe(extra)}${hint}`);
        }
        return expr;
    } catch (e) {
        if (e instanceof ParseFailure) return undefined;
        throw e;
    }
}

function endOf(tokens: readonly ISourceToken[]): IPosition {
    const last = tokens[tokens.length - 1];
    return last ? { line: last.position.line, char: last.end } : { line: 1, char: 1 };
}

class EvalFailure extends Error {}

/** Evaluate a parsed expression. Returns undefined (with an Error message) on failure. */
export function evaluateExpr(expr: Expr, lookup: SymbolLookup, messages: IMessage[]): number | undefined {
    const fail = (token: ISourceToken, text?: string): never => {
        if (text !== undefined) error(messages, token.position, text);
        throw new EvalFailure();
    };
    const safe = (value: number, token: ISourceToken): number =>
        Number.isSafeInteger(value) ? value : fail(token, 'Arithmetic overflow in expression');

    const ev = (e: Expr): number => {
        switch (e.kind) {
            case 'number':
                return e.value;
            case 'symbol': {
                const v = lookup(e.name, e.token);
                if (v === null) return fail(e.token);
                if (v === undefined) return fail(e.token, `Undefined label or constant '${e.name}'`);
                return v;
            }
            case 'unary': {
                const v = ev(e.operand);
                if (e.op === '-') return safe(0 - v, e.token);
                if (e.op === '+') return v;
                return v === 0 ? 1 : 0;
            }
            case 'binary': {
                if (e.op === '&&') return ev(e.left) !== 0 && ev(e.right) !== 0 ? 1 : 0;
                if (e.op === '||') return ev(e.left) !== 0 || ev(e.right) !== 0 ? 1 : 0;
                const a = ev(e.left);
                const b = ev(e.right);
                switch (e.op) {
                    case '+': return safe(a + b, e.token);
                    case '-': return safe(a - b, e.token);
                    case '*': return safe(a * b, e.token) + 0;
                    case '/':
                        if (b === 0) return fail(e.token, 'Division by zero in expression');
                        return Math.trunc(a / b) + 0;
                    case '%':
                        if (b === 0) return fail(e.token, 'Modulo by zero in expression');
                        return (a % b) + 0;
                    case '==': return a === b ? 1 : 0;
                    case '!=': return a !== b ? 1 : 0;
                    case '<': return a < b ? 1 : 0;
                    case '<=': return a <= b ? 1 : 0;
                    case '>': return a > b ? 1 : 0;
                    case '>=': return a >= b ? 1 : 0;
                }
                return fail(e.token, `Unknown operator '${e.op}'`);
            }
        }
    };

    try {
        return ev(expr);
    } catch (e) {
        if (e instanceof EvalFailure) return undefined;
        throw e;
    }
}

/** Parse and evaluate in one step. */
export function evaluate(
    tokens: readonly ISourceToken[],
    lookup: SymbolLookup,
    messages: IMessage[],
    at: IPosition = tokens[0]?.position ?? { line: 1, char: 1 },
): number | undefined {
    const expr = parseExpression(tokens, at, messages);
    return expr === undefined ? undefined : evaluateExpr(expr, lookup, messages);
}
