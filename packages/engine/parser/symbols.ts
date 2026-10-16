/**
 * Symbol table: address labels, EQU constants and the predefined constants
 * (redcode.md 8, 9.1 and 9.3). OWNER: parser engineer. Internal.
 *
 * EQU is text substitution (redcode.md 9.1): a constant's value is kept as
 * tokens and substituted wherever the name appears in an operand, ORG/END
 * address, FOR count, another EQU's value or an assert, recursively. The
 * value is substituted as plain text, with no parentheses added (ICWS'94 and
 * pMARS), so `x EQU 1+2` makes `x*2` equal 5, and a value such as `<2667`
 * can carry an addressing mode. Labels inside a value resolve relative to
 * each use site.
 */
import { TokenCategory, type IMessage, type IPosition } from '../types.ts';
import type { IResolvedParseOptions } from '../options.ts';
import { opcodeFromName } from '../instruction.ts';
import { DIRECTIVES, type ISourceToken } from './lexer.ts';
import { error, evaluate, type SymbolLookup } from './expression.ts';

/**
 * VERSION predefined constant: major * 100 + minor * 10 + patch (pMARS style,
 * redcode.md 9.3) for this implementation's version 0.1.0.
 */
export const PARSER_VERSION = 10;

/** Names that are reserved, upper case and case-sensitive (redcode.md 9.3). */
export const PREDEFINED_CONSTANTS: readonly string[] = [
    'CORESIZE',
    'MAXCYCLES',
    'MAXPROCESSES',
    'WARRIORS',
    'MAXLENGTH',
    'CURLINE',
    'MINDISTANCE',
    'VERSION',
    'PSPACESIZE',
    'ROUNDS',
];
const PREDEFINED = new Set(PREDEFINED_CONSTANTS);

/** Upper bound on tokens produced by expanding one token list (guards against exponential EQU chains). */
export const MAX_EXPANDED_TOKENS = 100_000;

export interface ILabel {
    address: number;
    token: ISourceToken;
}

export interface IConstant {
    token: ISourceToken;
    value: ISourceToken[];
    /** Set when the definition is part of a cycle (already reported). */
    cyclic?: boolean;
}

/** How a symbol lookup resolves labels and CURLINE. */
export interface ILookupContext {
    /** Address of the instruction or directive being evaluated (CURLINE). */
    address: number;
    /** true: labels give `labelAddress - address` (operands); false: absolute offsets. */
    relative: boolean;
    /** Message for a name that is not defined; default "Undefined label or constant". */
    undefinedText?: (name: string) => string;
}

class ExpandFailure extends Error {}

export class SymbolTable {
    readonly labels = new Map<string, ILabel>();
    readonly constants = new Map<string, IConstant>();

    constructor(private readonly options: IResolvedParseOptions) {}

    /** Value of a predefined constant, or undefined for other names. */
    predefined(name: string, curline: number): number | undefined {
        const o = this.options;
        switch (name) {
            case 'CORESIZE': return o.coresize;
            case 'MAXCYCLES': return o.maximumCycles;
            case 'MAXPROCESSES': return o.maxTasks;
            case 'WARRIORS': return o.warriors;
            case 'MAXLENGTH': return o.instructionLimit;
            case 'CURLINE': return curline;
            case 'MINDISTANCE': return o.minSeparation;
            case 'VERSION': return PARSER_VERSION;
            case 'PSPACESIZE': return o.pSpaceSize;
            case 'ROUNDS': return o.rounds;
        }
        return undefined;
    }

    /** Report and return false if `token` cannot name a label, constant or counter. */
    checkName(token: ISourceToken, messages: IMessage[], what: string): boolean {
        const name = token.lexeme;
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
            error(messages, token.position, `Invalid ${what} name '${name}'`);
            return false;
        }
        if (opcodeFromName(name) !== undefined || DIRECTIVES.has(name.toUpperCase())) {
            error(messages, token.position, `'${name}' is a reserved word and cannot be used as a ${what} name`);
            return false;
        }
        if (PREDEFINED.has(name)) {
            error(messages, token.position, `'${name}' is a predefined constant and cannot be used as a ${what} name`);
            return false;
        }
        return true;
    }

    private checkUnique(token: ISourceToken, messages: IMessage[]): boolean {
        const name = token.lexeme;
        const prior = this.labels.get(name)?.token ?? this.constants.get(name)?.token;
        if (prior === undefined) return true;
        const kind = this.labels.has(name) ? 'label' : 'constant';
        error(messages, token.position, `'${name}' is already defined as a ${kind} on line ${prior.position.line}`);
        return false;
    }

    declareLabel(token: ISourceToken, address: number, messages: IMessage[]): void {
        if (!this.checkName(token, messages, 'label') || !this.checkUnique(token, messages)) return;
        this.labels.set(token.lexeme, { address, token });
    }

    declareConstant(token: ISourceToken, value: readonly ISourceToken[], messages: IMessage[]): void {
        if (!this.checkName(token, messages, 'constant') || !this.checkUnique(token, messages)) return;
        this.constants.set(token.lexeme, { token, value: [...value] });
    }

    /**
     * Report every EQU that refers to itself, directly or through other
     * constants, even if it is never used. Uses of such a constant report
     * nothing further.
     */
    checkCycles(messages: IMessage[]): void {
        const graph = new Map<string, string[]>();
        for (const [name, c] of this.constants) {
            graph.set(name, c.value.filter((t) => t.category === TokenCategory.Label && this.constants.has(t.lexeme)).map((t) => t.lexeme));
        }
        for (const [start, c] of this.constants) {
            const seen = new Set<string>();
            const stack = [...graph.get(start)!];
            while (stack.length > 0) {
                const n = stack.pop()!;
                if (n === start) {
                    c.cyclic = true;
                    error(messages, c.token.position, `Cyclic EQU definition of '${start}'`);
                    break;
                }
                if (seen.has(n)) continue;
                seen.add(n);
                stack.push(...(graph.get(n) ?? []));
            }
        }
    }

    /**
     * Substitute EQU constants into a token list, recursively. Substituted
     * tokens keep their definition positions (so errors inside a value point
     * at the EQU line) and record the use site in `origin`. Returns undefined
     * after reporting an Error.
     */
    expand(tokens: readonly ISourceToken[], messages: IMessage[]): ISourceToken[] | undefined {
        const out: ISourceToken[] = [];
        const active: string[] = [];
        const walk = (list: readonly ISourceToken[], origin: IPosition | undefined): void => {
            for (const t of list) {
                const c = t.category === TokenCategory.Label ? this.constants.get(t.lexeme) : undefined;
                if (!c) {
                    out.push(origin ? { ...t, origin } : t);
                    continue;
                }
                if (c.cyclic) throw new ExpandFailure();
                if (active.includes(t.lexeme)) {
                    error(messages, t.position, `Cyclic EQU definition of '${t.lexeme}'`);
                    throw new ExpandFailure();
                }
                active.push(t.lexeme);
                walk(c.value, origin ?? t.position);
                active.pop();
                if (out.length > MAX_EXPANDED_TOKENS) {
                    error(messages, t.position, 'EQU substitution is too large');
                    throw new ExpandFailure();
                }
            }
        };
        try {
            walk(tokens, undefined);
            return out;
        } catch (e) {
            if (e instanceof ExpandFailure) return undefined;
            throw e;
        }
    }

    /** Labels and predefined constants for the expression evaluator (constants are expanded first). */
    lookup(context: ILookupContext, messages: IMessage[]): SymbolLookup {
        return (name, token) => {
            const label = this.labels.get(name);
            if (label) return context.relative ? label.address - context.address : label.address;
            const value = this.predefined(name, context.address);
            if (value !== undefined) return value;
            if (context.undefinedText) {
                error(messages, token.position, context.undefinedText(name));
                return null;
            }
            return undefined;
        };
    }

    /** Expand EQU constants, then parse and evaluate. Undefined after reporting an Error. */
    evaluate(tokens: readonly ISourceToken[], context: ILookupContext, messages: IMessage[], at?: IPosition): number | undefined {
        const expanded = this.expand(tokens, messages);
        if (!expanded) return undefined;
        return evaluate(expanded, this.lookup(context, messages), messages, at);
    }
}
