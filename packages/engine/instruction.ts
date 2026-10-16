/**
 * Internal instruction representation, mnemonic tables and disassembly.
 *
 * OWNER: architect. FROZEN after the scaffold phase (shared by parser,
 * simulator and TUI). See ARCHITECTURE.md "Internal representation".
 */

import { Mode, Modifier, Opcode, type IInstruction } from './types.ts';

/**
 * A decoded instruction without an address: the unit the parser produces
 * (inside the load format) and the loader writes to core. Numbers are signed
 * and relative in a parser-produced program; inside core they are always
 * folded into [0, coresize).
 */
export interface IInstructionSpec {
    opcode: Opcode;
    modifier: Modifier;
    aMode: Mode;
    aNumber: number;
    bMode: Mode;
    bNumber: number;
}

// ---- Packed op word --------------------------------------------------------
//
// Core stores each cell as three parallel typed-array entries:
//   op[addr]: Uint16  = opcode << 9 | modifier << 6 | aMode << 3 | bMode
//   a[addr]:  Int32   = A-number in [0, coresize)
//   b[addr]:  Int32   = B-number in [0, coresize)
// `op >>> 6` is (opcode << 3 | modifier), a dispatch key below OPMOD_KEY_COUNT (152).

export const OPCODE_SHIFT = 9;
export const MODIFIER_SHIFT = 6;
export const AMODE_SHIFT = 3;
export const BMODE_SHIFT = 0;
export const MODE_MASK = 0b111;
export const MODIFIER_MASK = 0b111;
export const OPCODE_MASK = 0b11111;
/** Number of distinct (opcode, modifier) dispatch keys. */
export const OPMOD_KEY_COUNT = (Opcode.STP + 1) << 3;

export function packOp(opcode: Opcode, modifier: Modifier, aMode: Mode, bMode: Mode): number {
    return (opcode << OPCODE_SHIFT) | (modifier << MODIFIER_SHIFT) | (aMode << AMODE_SHIFT) | bMode;
}

export function opcodeOf(op: number): Opcode {
    return (op >>> OPCODE_SHIFT) & OPCODE_MASK;
}

export function modifierOf(op: number): Modifier {
    return (op >>> MODIFIER_SHIFT) & MODIFIER_MASK;
}

export function aModeOf(op: number): Mode {
    return (op >>> AMODE_SHIFT) & MODE_MASK;
}

export function bModeOf(op: number): Mode {
    return op & MODE_MASK;
}

/** (opcode << 3 | modifier): index into a dispatch table of OPMOD_KEY_COUNT entries. */
export function opModKey(op: number): number {
    return op >>> MODIFIER_SHIFT;
}

// ---- Mnemonics -------------------------------------------------------------

export const OPCODE_NAMES: readonly string[] = [
    'DAT', 'MOV', 'ADD', 'SUB', 'MUL', 'DIV', 'MOD', 'JMP', 'JMZ',
    'JMN', 'DJN', 'CMP', 'SEQ', 'SNE', 'SLT', 'SPL', 'NOP',
    'LDP', 'STP',
];

export const MODIFIER_NAMES: readonly string[] = ['A', 'B', 'AB', 'BA', 'F', 'X', 'I'];

/** Index = Mode value. */
export const MODE_SYMBOLS: readonly string[] = ['#', '$', '*', '@', '{', '<', '}', '>'];

const OPCODE_BY_NAME = new Map(OPCODE_NAMES.map((n, i) => [n, i as Opcode]));
const MODIFIER_BY_NAME = new Map(MODIFIER_NAMES.map((n, i) => [n, i as Modifier]));
const MODE_BY_SYMBOL = new Map(MODE_SYMBOLS.map((s, i) => [s, i as Mode]));

/** Case-insensitive opcode lookup. Unknown names give undefined. */
export function opcodeFromName(name: string): Opcode | undefined {
    return OPCODE_BY_NAME.get(name.toUpperCase());
}

/** Case-insensitive modifier lookup; accepts a leading '.' (".ab" or "AB"). */
export function modifierFromName(name: string): Modifier | undefined {
    const n = name.startsWith('.') ? name.slice(1) : name;
    return MODIFIER_BY_NAME.get(n.toUpperCase());
}

export function modeFromSymbol(symbol: string): Mode | undefined {
    return MODE_BY_SYMBOL.get(symbol);
}

// ---- Conversions -----------------------------------------------------------

/** True modulo: result in [0, size) for any integer x, including negatives. */
export function fold(x: number, size: number): number {
    const r = x % size;
    return r < 0 ? r + size : r;
}

export function toPublicInstruction(spec: IInstructionSpec, address: number): IInstruction {
    return {
        address,
        opcode: spec.opcode,
        modifier: spec.modifier,
        aOperand: { mode: spec.aMode, address: spec.aNumber },
        bOperand: { mode: spec.bMode, address: spec.bNumber },
    };
}

export function fromPublicInstruction(ins: IInstruction): IInstructionSpec {
    return {
        opcode: ins.opcode,
        modifier: ins.modifier,
        aMode: ins.aOperand.mode,
        aNumber: ins.aOperand.address,
        bMode: ins.bOperand.mode,
        bNumber: ins.bOperand.address,
    };
}

export interface IFormatOptions {
    /**
     * When set, numbers in [0, coresize) above coresize / 2 are shown as
     * negatives (pMARS display convention), e.g. 7999 -> -1 for coresize 8000.
     */
    signedFor?: number;
    /** Lower-case mnemonics. Default false (upper case, the load-file style). */
    lowerCase?: boolean;
}

/** Disassemble to load-file style: `MOV.I $0, $1`. */
export function formatInstruction(ins: IInstructionSpec | IInstruction, options: IFormatOptions = {}): string {
    const spec = 'aOperand' in ins ? fromPublicInstruction(ins) : ins;
    const size = options.signedFor;
    const num = (n: number): string => String(size !== undefined && n > size / 2 ? n - size : n);
    const text =
        `${OPCODE_NAMES[spec.opcode]}.${MODIFIER_NAMES[spec.modifier]} ` +
        `${MODE_SYMBOLS[spec.aMode]}${num(spec.aNumber)}, ${MODE_SYMBOLS[spec.bMode]}${num(spec.bNumber)}`;
    return options.lowerCase ? text.toLowerCase() : text;
}
