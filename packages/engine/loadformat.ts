/**
 * The load format: the exact token stream in IParseResult.tokens that the
 * parser produces and the simulator consumes. This file IS the contract
 * between the two; see ARCHITECTURE.md "Load format".
 *
 * OWNER: architect. FROZEN after the scaffold phase.
 *
 * Grammar, one logical line per EOL token (Comment tokens are allowed on any
 * line and ignored by the reader; blank lines are allowed):
 *
 *   metadata line:    Comment EOL                   (";name dwarf", ";redcode-94", ...)
 *   start line:       Preprocessor("ORG") Number EOL
 *   PIN line:         Preprocessor("PIN") Number EOL    (optional, at most one)
 *   instruction line: Opcode Modifier Mode Number Comma Mode Number EOL
 *
 * - Opcode lexeme: upper-case mnemonic ("MOV"). The reader is case-insensitive.
 * - Modifier lexeme: "." + upper-case modifier (".AB").
 * - Mode lexeme: one of # $ * @ { < } >.
 * - Number lexeme: signed decimal, relative, NOT folded ("-1", "5334").
 * - ORG number: start offset relative to the first instruction. It may lie
 *   outside the warrior (pMARS); the loader folds it into the core.
 * - PIN number: the warrior's P-space identifier (spec/pspace.md), signed,
 *   not folded. Warriors with the same PIN share P-space; without a PIN line
 *   the P-space is private.
 * - The final EOL may be missing.
 * - Writers emit lines in this order: metadata, ORG, PIN, instructions.
 */

import {
    MessageType,
    TokenCategory,
    type IMessage,
    type IParseResult,
    type IPosition,
    type IToken,
} from './types.ts';
import {
    MODE_SYMBOLS,
    MODIFIER_NAMES,
    OPCODE_NAMES,
    modeFromSymbol,
    modifierFromName,
    opcodeFromName,
    type IInstructionSpec,
} from './instruction.ts';

/** What the loader needs from one warrior. */
export interface IWarriorProgram {
    instructions: IInstructionSpec[];
    /** Offset of the first instruction to execute, relative to the first instruction. May lie outside [0, length). */
    startOffset: number;
    /** P-space identifier (the PIN directive); absent when the warrior has none. */
    pin?: number;
}

export class LoadFormatError extends Error {
    constructor(
        message: string,
        readonly position: IPosition,
    ) {
        super(`${message} (line ${position.line}, char ${position.char})`);
        this.name = 'LoadFormatError';
    }
}

const NUMBER_RE = /^[+-]?\d+$/;

/**
 * Decode a load-format token stream. Throws LoadFormatError on any deviation
 * from the grammar or on an empty program.
 */
export function readLoadFormat(tokens: readonly IToken[]): IWarriorProgram {
    const instructions: IInstructionSpec[] = [];
    let startOffset = 0;
    let pin: number | undefined;
    let line: IToken[] = [];

    const fail = (msg: string, tok: IToken | undefined): never => {
        throw new LoadFormatError(msg, tok?.position ?? { line: 0, char: 0 });
    };
    const num = (tok: IToken | undefined): number => {
        if (!tok || tok.category !== TokenCategory.Number || !NUMBER_RE.test(tok.lexeme)) {
            return fail('expected a signed integer', tok);
        }
        return Number.parseInt(tok.lexeme, 10);
    };
    const expect = (tok: IToken | undefined, category: TokenCategory, what: string): IToken =>
        tok && tok.category === category ? tok : fail(`expected ${what}`, tok);

    const flush = (): void => {
        const t = line;
        line = [];
        if (t.length === 0) return;
        const first = t[0]!;
        if (first.category === TokenCategory.Preprocessor) {
            const word = first.lexeme.toUpperCase();
            if ((word !== 'ORG' && word !== 'PIN') || t.length !== 2) {
                fail('expected "ORG <number>" or "PIN <number>"', first);
            }
            if (word === 'ORG') startOffset = num(t[1]);
            else if (pin !== undefined) fail('more than one PIN line', first);
            else pin = num(t[1]);
            return;
        }
        if (t.length !== 8) fail('malformed instruction line', first);
        const opcode = opcodeFromName(expect(t[0], TokenCategory.Opcode, 'an opcode').lexeme);
        if (opcode === undefined) fail('unknown opcode', t[0]);
        const modifier = modifierFromName(expect(t[1], TokenCategory.Modifier, 'a modifier').lexeme);
        if (modifier === undefined) fail('unknown modifier', t[1]);
        const aMode = modeFromSymbol(expect(t[2], TokenCategory.Mode, 'an A mode').lexeme);
        if (aMode === undefined) fail('unknown mode', t[2]);
        const aNumber = num(t[3]);
        expect(t[4], TokenCategory.Comma, 'a comma');
        const bMode = modeFromSymbol(expect(t[5], TokenCategory.Mode, 'a B mode').lexeme);
        if (bMode === undefined) fail('unknown mode', t[5]);
        const bNumber = num(t[6]);
        expect(t[7], TokenCategory.EOL, 'end of line');
        instructions.push({ opcode: opcode!, modifier: modifier!, aMode: aMode!, aNumber, bMode: bMode!, bNumber });
    };

    for (const tok of tokens) {
        if (tok.category === TokenCategory.Comment) continue;
        if (tok.category === TokenCategory.EOL) {
            if (line.length > 0 && line[0]!.category === TokenCategory.Opcode) line.push(tok);
            flush();
            continue;
        }
        line.push(tok);
    }
    if (line.length > 0 && line[0]!.category === TokenCategory.Opcode) {
        line.push({ position: line[line.length - 1]!.position, lexeme: '\n', category: TokenCategory.EOL });
    }
    flush();

    if (instructions.length === 0) {
        throw new LoadFormatError('warrior has no instructions', { line: 0, char: 0 });
    }
    return pin === undefined ? { instructions, startOffset } : { instructions, startOffset, pin };
}

/** True when a parse result has no Error messages (the "succeeded" rule). */
export function parseSucceeded(result: Pick<IParseResult, 'messages'>): boolean {
    return !result.messages.some((m: IMessage) => m.type === MessageType.Error);
}

// ---- Writers (the parser MUST build its output with these) -----------------

const tok = (lexeme: string, category: TokenCategory, position: IPosition): IToken => ({
    position: { line: position.line, char: position.char },
    lexeme,
    category,
});

/**
 * Source positions for the parts of one instruction. Parts the source did not
 * spell out (a default modifier or mode, an inserted operand) use `line`.
 */
export interface IInstructionPositions {
    line: IPosition;
    opcode?: IPosition;
    modifier?: IPosition;
    aMode?: IPosition;
    aNumber?: IPosition;
    bMode?: IPosition;
    bNumber?: IPosition;
}

/** One instruction line (8 tokens). Pass an IPosition to place every token there. */
export function emitInstructionTokens(spec: IInstructionSpec, at: IPosition | IInstructionPositions): IToken[] {
    const p: IInstructionPositions = typeof at.line === 'object' ? (at as IInstructionPositions) : { line: at as IPosition };
    const l = p.line;
    return [
        tok(OPCODE_NAMES[spec.opcode]!, TokenCategory.Opcode, p.opcode ?? l),
        tok(`.${MODIFIER_NAMES[spec.modifier]}`, TokenCategory.Modifier, p.modifier ?? l),
        tok(MODE_SYMBOLS[spec.aMode]!, TokenCategory.Mode, p.aMode ?? l),
        tok(String(spec.aNumber), TokenCategory.Number, p.aNumber ?? l),
        tok(',', TokenCategory.Comma, p.aNumber ?? l),
        tok(MODE_SYMBOLS[spec.bMode]!, TokenCategory.Mode, p.bMode ?? l),
        tok(String(spec.bNumber), TokenCategory.Number, p.bNumber ?? l),
        tok('\n', TokenCategory.EOL, p.bNumber ?? l),
    ];
}

export function emitOrgTokens(startOffset: number, position: IPosition): IToken[] {
    return [
        tok('ORG', TokenCategory.Preprocessor, position),
        tok(String(startOffset), TokenCategory.Number, position),
        tok('\n', TokenCategory.EOL, position),
    ];
}

/** The P-space identifier line: `PIN <number>`. */
export function emitPinTokens(pin: number, position: IPosition): IToken[] {
    return [
        tok('PIN', TokenCategory.Preprocessor, position),
        tok(String(pin), TokenCategory.Number, position),
        tok('\n', TokenCategory.EOL, position),
    ];
}

/** A metadata comment line; `text` includes the leading ';' (";name dwarf"). */
export function emitCommentLine(text: string, position: IPosition): IToken[] {
    return [tok(text, TokenCategory.Comment, position), tok('\n', TokenCategory.EOL, position)];
}

/**
 * Build a valid IParseResult from a program without running the parser.
 * Intended for simulator and match tests; production code uses parse().
 */
export function programToParseResult(
    program: IWarriorProgram,
    metaData: Partial<IParseResult['metaData']> = {},
    data?: unknown,
): IParseResult {
    const at = (line: number): IPosition => ({ line, char: 1 });
    const tokens: IToken[] = [...emitOrgTokens(program.startOffset, at(1))];
    if (program.pin !== undefined) tokens.push(...emitPinTokens(program.pin, at(1)));
    program.instructions.forEach((ins, i) => tokens.push(...emitInstructionTokens(ins, at(i + 2))));
    const result: IParseResult = {
        metaData: { name: metaData.name ?? '', author: metaData.author ?? '', strategy: metaData.strategy ?? '' },
        tokens,
        messages: [],
    };
    if (data !== undefined) result.data = data;
    return result;
}
