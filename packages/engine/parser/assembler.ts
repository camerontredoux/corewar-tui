/**
 * Assembler: operand evaluation, default modes/modifiers, start offset,
 * asserts, length check, then load-format token emission via loadformat.ts.
 * OWNER: parser engineer. Internal; signatures may change.
 */

import { MessageType, Mode, Modifier, Opcode, Standard, TokenCategory, type IMessage, type IPosition, type IToken } from '../types.ts';
import type { IResolvedParseOptions } from '../options.ts';
import { OPCODE_NAMES, modeFromSymbol, modifierFromName, opcodeFromName, type IInstructionSpec } from '../instruction.ts';
import {
    emitCommentLine,
    emitInstructionTokens,
    emitOrgTokens,
    emitPinTokens,
    type IInstructionPositions,
    type IWarriorProgram,
} from '../loadformat.ts';
import { error, evaluate } from './expression.ts';
import type { ISourceToken } from './lexer.ts';
import type { IInstructionLine, IPreprocessed } from './preprocessor.ts';

export interface IAssembled {
    program: IWarriorProgram;
    /** Load-format tokens: metadata comment lines, ORG line, instruction lines. */
    tokens: IToken[];
}

/**
 * Default addressing mode for a written operand without one: `$` for every
 * opcode, DAT included (redcode.md 7.2, as ICWS'94 and pMARS do).
 */
export const DEFAULT_MODE: Mode = Mode.Direct;
/** The A operand inserted for a single-operand DAT: `dat 7` is `DAT.F #0, $7` (redcode.md 3, ICWS'94). */
export const DAT_INSERTED_A_MODE: Mode = Mode.Immediate;

/** Opcodes that may be written with a single operand (redcode.md 7.3). */
const SINGLE_OPERAND = new Set<Opcode>([Opcode.DAT, Opcode.JMP, Opcode.SPL, Opcode.NOP]);

/** Opcodes and modes of the pre-'94 standards (no modifiers at all). '86 and '88 share the set. */
export const LEGACY_OPCODES = new Set<Opcode>([
    Opcode.DAT, Opcode.MOV, Opcode.ADD, Opcode.SUB, Opcode.JMP, Opcode.JMZ,
    Opcode.JMN, Opcode.DJN, Opcode.CMP, Opcode.SLT, Opcode.SPL,
]);
export const LEGACY_MODES = new Set<Mode>([Mode.Immediate, Mode.Direct, Mode.BIndirect, Mode.BPreDecrement]);
const STANDARD_NAMES: Readonly<Record<number, string>> = { [Standard.ICWS86]: "ICWS'86", [Standard.ICWS88]: "ICWS'88" };

/**
 * redcode.md 7.4, with seq/sne like cmp and `*`/`}` counted as non-`#`.
 * LDP and STP default like SLT (spec/pspace.md, pMARS).
 */
export function defaultModifier(opcode: Opcode, aMode: Mode, bMode: Mode): Modifier {
    const aImm = aMode === Mode.Immediate;
    const bImm = bMode === Mode.Immediate;
    switch (opcode) {
        case Opcode.DAT:
        case Opcode.NOP:
            return Modifier.F;
        case Opcode.MOV:
        case Opcode.CMP:
        case Opcode.SEQ:
        case Opcode.SNE:
            return aImm ? Modifier.AB : bImm ? Modifier.B : Modifier.I;
        case Opcode.ADD:
        case Opcode.SUB:
        case Opcode.MUL:
        case Opcode.DIV:
        case Opcode.MOD:
            return aImm ? Modifier.AB : bImm ? Modifier.B : Modifier.F;
        case Opcode.SLT:
        case Opcode.LDP:
        case Opcode.STP:
            return aImm ? Modifier.AB : Modifier.B;
        default:
            return Modifier.B;
    }
}

interface IOperand {
    mode: Mode;
    number: number;
    modePosition?: IPosition;
    numberPosition?: IPosition;
}

const isModeToken = (t: ISourceToken): boolean =>
    t.category === TokenCategory.Mode ||
    (t.category === TokenCategory.Maths && (t.lexeme === '*' || t.lexeme === '<' || t.lexeme === '>'));

export function assemble(pre: IPreprocessed, options: IResolvedParseOptions, messages: IMessage[]): IAssembled {
    const legacy = options.standard !== Standard.ICWS94draft ? STANDARD_NAMES[options.standard] ?? `standard ${options.standard}` : undefined;
    const { symbols } = pre;

    // ---- one instruction --------------------------------------------------

    const operand = (tokens: ISourceToken[], address: number): IOperand => {
        const first = tokens[0]!;
        let mode = DEFAULT_MODE;
        let modePosition: IPosition | undefined;
        let expr = tokens;
        if (isModeToken(first)) {
            mode = modeFromSymbol(first.lexeme)!;
            modePosition = first.origin ?? first.position;
            expr = tokens.slice(1);
            if (legacy && !LEGACY_MODES.has(mode)) {
                error(messages, first.position, `Addressing mode '${first.lexeme}' is not part of ${legacy}`);
            }
        }
        if (expr.length === 0) {
            error(messages, first.position, 'Operand is missing a number');
            return { mode, number: 0, modePosition };
        }
        const value = evaluate(expr, symbols.lookup({ address, relative: true }, messages), messages);
        return { mode, number: value ?? 0, modePosition, numberPosition: expr[0]!.origin ?? expr[0]!.position };
    };

    const instruction = (ins: IInstructionLine): { spec: IInstructionSpec; positions: IInstructionPositions } => {
        const { line, address } = ins;
        const opToken = line.keyword!;
        const opcode = opcodeFromName(opToken.lexeme)!;
        const positions: IInstructionPositions = { line: opToken.position, opcode: opToken.position };
        const name = OPCODE_NAMES[opcode]!;
        if (legacy && !LEGACY_OPCODES.has(opcode)) {
            error(messages, opToken.position, `Opcode '${name}' is not part of ${legacy}`);
        }

        let modifier: Modifier | undefined;
        if (line.modifier) {
            positions.modifier = line.modifier.position;
            modifier = modifierFromName(line.modifier.lexeme);
            if (modifier === undefined) {
                error(messages, line.modifier.position, `Unknown modifier '${line.modifier.lexeme}'`);
            } else if (legacy) {
                error(messages, line.modifier.position, `Modifiers such as '${line.modifier.lexeme}' are not part of ${legacy}`);
            }
        }

        // Substitute EQU constants (their text may hold modes or commas), then split on commas.
        const rest = symbols.expand(line.rest, messages);
        const groups: ISourceToken[][] = [[]];
        const commas: ISourceToken[] = [];
        for (const t of rest ?? []) {
            if (t.category === TokenCategory.Comma) {
                commas.push(t);
                groups.push([]);
            } else {
                groups[groups.length - 1]!.push(t);
            }
        }
        const end = { line: line.eol.position.line, char: line.eol.position.char };
        let operands: IOperand[] = [];
        if (rest === undefined) {
            // already reported
        } else if (rest.length === 0) {
            error(messages, opToken.position, `'${name}' needs ${SINGLE_OPERAND.has(opcode) ? 'an operand' : 'two operands'}`);
        } else if (groups.length > 2) {
            error(messages, commas[1]!.position, `Too many operands: an instruction has at most two`);
        } else {
            groups.forEach((g, k) => {
                if (g.length === 0) {
                    error(messages, k === 0 ? commas[0]!.position : end, `Missing ${k === 0 ? 'A' : 'B'} operand`);
                }
            });
            if (groups.every((g) => g.length > 0)) {
                operands = groups.map((g) => operand(g, address));
                if (operands.length === 1 && !SINGLE_OPERAND.has(opcode)) {
                    error(messages, end, `'${name}' needs two operands (only DAT, JMP, SPL and NOP take one)`);
                }
            }
        }

        const zero: IOperand = { mode: opcode === Opcode.DAT ? DAT_INSERTED_A_MODE : DEFAULT_MODE, number: 0 };
        let a: IOperand;
        let b: IOperand;
        if (operands.length === 2) [a, b] = operands as [IOperand, IOperand];
        else if (operands.length === 1 && opcode === Opcode.DAT) [a, b] = [zero, operands[0]!];
        else if (operands.length === 1) [a, b] = [operands[0]!, zero];
        else [a, b] = [zero, zero];

        if (a.modePosition) positions.aMode = a.modePosition;
        if (a.numberPosition) positions.aNumber = a.numberPosition;
        if (b.modePosition) positions.bMode = b.modePosition;
        if (b.numberPosition) positions.bNumber = b.numberPosition;
        const spec: IInstructionSpec = {
            opcode,
            modifier: modifier ?? defaultModifier(opcode, a.mode, b.mode),
            aMode: a.mode,
            aNumber: a.number,
            bMode: b.mode,
            bNumber: b.number,
        };
        return { spec, positions };
    };

    const assembled = pre.instructions.map(instruction);
    const length = assembled.length;

    // ---- length -------------------------------------------------------------

    if (length === 0) {
        // An empty warrior is only worth reporting when nothing else explains it.
        if (!messages.some((m) => m.type === MessageType.Error)) error(messages, { line: 1, char: 1 }, 'Warrior has no instructions');
    } else if (length > options.instructionLimit) {
        const first = pre.instructions[options.instructionLimit]!.line.keyword!;
        error(messages, first.position, `Warrior has ${length} instructions; the maximum length is ${options.instructionLimit}`);
    }

    // ---- start offset (redcode.md 10) -----------------------------------------

    const values = pre.directives.map((d) => {
        if (d.args.length === 0) return undefined;
        return symbols.evaluate(d.args, { address: d.address, relative: false }, messages);
    });
    const orgs = pre.directives.map((d, k) => ({ d, k })).filter(({ d }) => d.kind === 'ORG');
    const ends = pre.directives.map((d, k) => ({ d, k })).filter(({ d }) => d.kind === 'END' && d.args.length > 0);
    const chosen = orgs[orgs.length - 1] ?? ends[ends.length - 1];
    let start = 0;
    let orgPosition: IPosition = { line: 1, char: 1 };
    if (chosen) {
        orgPosition = chosen.d.token.position;
        start = values[chosen.k] ?? 0;
        if (orgs.length > 0 && ends.length > 0) {
            warn(chosen.d.token.position, 'Both ORG and END give a start address; ORG takes precedence');
        } else if (orgs.length + ends.length > 1) {
            warn(chosen.d.token.position, 'Several ORG directives give a start address; the last one is used');
        }
        if (length > 0 && (start < 0 || start >= length)) {
            warn(chosen.d.args[0]?.position ?? orgPosition, `Start address ${start} is outside the warrior (length ${length}); execution starts outside its code`);
        }
        if (length === 0) start = 0;
    }

    // ---- PIN (spec/pspace.md) ---------------------------------------------------

    const pins = pre.directives.map((d, k) => ({ d, k })).filter(({ d }) => d.kind === 'PIN');
    const pinned = pins[pins.length - 1];
    let pin: number | undefined;
    if (pinned) {
        // A bare PIN is PIN 0, as in pMARS.
        pin = pinned.d.args.length === 0 ? 0 : values[pinned.k];
        if (pinned.d.args.length === 0) warn(pinned.d.token.position, 'PIN without a value is PIN 0');
        if (pins.length > 1) warn(pinned.d.token.position, 'Several PIN directives; the last one is used');
    }
    if (legacy) for (const { d } of pins) error(messages, d.token.position, `The PIN directive is not part of ${legacy}`);

    // ---- asserts (redcode.md 9.4) ----------------------------------------------

    for (const a of pre.asserts) {
        const value = symbols.evaluate(a.condition, { address: a.address, relative: false }, messages);
        if (value === 0) {
            error(messages, a.comment.position, `Assertion failed: ${a.comment.lexeme.slice(1).trim().replace(/^assert\s+/i, '')}`);
        }
    }

    // ---- emission -------------------------------------------------------------

    const tokens: IToken[] = [];
    const origin = { line: 1, char: 1 };
    tokens.push(...emitCommentLine(pre.redcodeLine.text, pre.redcodeLine.position));
    tokens.push(...emitCommentLine(`;name ${pre.metaData.name || 'Nameless'}`, pre.namePosition ?? origin));
    tokens.push(...emitCommentLine(`;author ${pre.metaData.author || 'Blameless'}`, pre.authorPosition ?? origin));
    for (const s of pre.strategyLines) tokens.push(...emitCommentLine(s.text ? `;strategy ${s.text}` : ';strategy', s.position));
    tokens.push(...emitOrgTokens(start, orgPosition));
    if (pin !== undefined) tokens.push(...emitPinTokens(pin, pinned!.d.token.position));
    for (const { spec, positions } of assembled) tokens.push(...emitInstructionTokens(spec, positions));

    const program: IWarriorProgram = { instructions: assembled.map((x) => x.spec), startOffset: start };
    if (pin !== undefined) program.pin = pin;
    return { program, tokens };

    function warn(position: IPosition, text: string): void {
        messages.push({ type: MessageType.Warning, position: { line: position.line, char: position.char }, text });
    }
}
