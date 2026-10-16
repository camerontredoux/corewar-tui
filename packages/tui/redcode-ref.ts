/**
 * One-line descriptions of the Redcode opcodes and directives, shared by the
 * Help page's reference (overlays/help.ts) and the editor's instruction
 * autocomplete (overlays/editor.ts). Accurate to this engine (spec/redcode.md,
 * spec/pspace.md).
 */

import { OPCODE_NAMES } from '../engine/index.ts';

export interface InstructionRef {
    /** Upper case, as in OPCODE_NAMES. */
    name: string;
    /** Operand placeholders after the name ('' for none). */
    operands: string;
    meaning: string;
}

const OPCODES: Readonly<Record<string, [operands: string, meaning: string]>> = {
    DAT: ['A, B', 'data; the process that runs it dies'],
    MOV: ['A, B', 'copy A to B'],
    ADD: ['A, B', 'B = B + A'],
    SUB: ['A, B', 'B = B − A'],
    MUL: ['A, B', 'B = B × A'],
    DIV: ['A, B', 'B = B ÷ A, dropping any remainder'],
    MOD: ['A, B', 'B = the remainder of B ÷ A'],
    JMP: ['A', 'jump to A'],
    JMZ: ['A, B', 'jump to A if B is zero'],
    JMN: ['A, B', 'jump to A if B is not zero'],
    DJN: ['A, B', 'B = B − 1, then jump to A if B is not zero'],
    CMP: ['A, B', 'same as SEQ'],
    SEQ: ['A, B', 'skip the next cell if A equals B'],
    SNE: ['A, B', 'skip the next cell if A differs from B'],
    SLT: ['A, B', 'skip the next cell if A is less than B'],
    SPL: ['A', 'start a new process at A; this one carries on'],
    NOP: ['', 'do nothing'],
    LDP: ['A, B', 'B = P-space cell A'],
    STP: ['A, B', 'P-space cell B = A'],
};

const DIRECTIVES: Readonly<Record<string, [operands: string, meaning: string]>> = {
    ORG: ['start', 'begin running at start'],
    END: ['', 'stop here; later lines are ignored'],
    EQU: ['value', 'name a constant: label EQU value'],
    FOR: ['n', 'repeat the lines up to ROF n times'],
    ROF: ['', 'end a FOR block'],
    PIN: ['n', 'share P-space with warriors of the same PIN'],
};

const ref = (table: typeof OPCODES, name: string): InstructionRef => {
    const [operands, meaning] = table[name]!;
    return { name, operands, meaning };
};

/** Every opcode (in OPCODE_NAMES order), then the directives. */
export const INSTRUCTION_REFS: readonly InstructionRef[] = [
    ...OPCODE_NAMES.map((name) => ref(OPCODES, name)),
    ...Object.keys(DIRECTIVES).map((name) => ref(DIRECTIVES, name)),
];

/** The reference for one opcode or directive (upper case). */
export function instructionRef(name: string): InstructionRef {
    const found = INSTRUCTION_REFS.find((r) => r.name === name);
    if (!found) throw new Error(`no reference for ${name}`);
    return found;
}

/** `JMZ A, B`: the name and its operands. */
export const syntaxOf = (r: InstructionRef): string => (r.operands ? `${r.name} ${r.operands}` : r.name);
