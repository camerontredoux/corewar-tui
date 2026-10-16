/**
 * Core memory as struct-of-arrays plus the per-cell access arrays that back
 * the visualiser hook. OWNER: simulator engineer. Internal; may change, but
 * the encoding must stay as documented in instruction.ts / ARCHITECTURE.md.
 */

import { Opcode, type IInstruction } from '../types.ts';
import {
    aModeOf,
    bModeOf,
    fold,
    modifierOf,
    opcodeOf,
    packOp,
    toPublicInstruction,
    type IInstructionSpec,
} from '../instruction.ts';

export class Core {
    /** Packed opcode/modifier/modes, see instruction.ts packOp. */
    readonly op: Uint16Array;
    /** A-numbers, always in [0, size). */
    readonly a: Int32Array;
    /** B-numbers, always in [0, size). */
    readonly b: Int32Array;
    /** 0 = untouched, else AccessType + 1. */
    readonly accessKind: Uint8Array;
    readonly accessWarrior: Uint8Array;
    readonly accessStamp: Uint32Array;

    constructor(
        readonly size: number,
        initial: IInstructionSpec,
    ) {
        this.op = new Uint16Array(size);
        this.a = new Int32Array(size);
        this.b = new Int32Array(size);
        this.accessKind = new Uint8Array(size);
        this.accessWarrior = new Uint8Array(size);
        this.accessStamp = new Uint32Array(size);
        this.write(0, initial);
        this.op.fill(this.op[0]!);
        this.a.fill(this.a[0]!);
        this.b.fill(this.b[0]!);
    }

    /** Write a spec (numbers folded into [0, size)) at a folded address. CMP is stored as SEQ. */
    write(address: number, spec: IInstructionSpec): void {
        const at = fold(address, this.size);
        const opcode = spec.opcode === Opcode.CMP ? Opcode.SEQ : spec.opcode;
        this.op[at] = packOp(opcode, spec.modifier, spec.aMode, spec.bMode);
        this.a[at] = fold(spec.aNumber, this.size);
        this.b[at] = fold(spec.bNumber, this.size);
    }

    /** Decode the cell at a folded address. */
    read(address: number): IInstructionSpec {
        const at = fold(address, this.size);
        const op = this.op[at]!;
        return {
            opcode: opcodeOf(op),
            modifier: modifierOf(op),
            aMode: aModeOf(op),
            aNumber: this.a[at]!,
            bMode: bModeOf(op),
            bNumber: this.b[at]!,
        };
    }

    /** Public copy of the cell at a folded address. */
    toPublic(address: number): IInstruction {
        const at = fold(address, this.size);
        return toPublicInstruction(this.read(at), at);
    }
}
