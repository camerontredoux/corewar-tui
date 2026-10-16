import { expect, test } from 'bun:test';
import { aModeOf, bModeOf, fold, formatInstruction, modifierOf, opModKey, opcodeOf, packOp, OPMOD_KEY_COUNT } from './instruction.ts';
import { Mode, Modifier, Opcode } from './types.ts';

test('packed op word round-trips every field and gives a dense dispatch key', () => {
    const op = packOp(Opcode.NOP, Modifier.I, Mode.APostIncrement, Mode.BPostIncrement);
    expect([opcodeOf(op), modifierOf(op), aModeOf(op), bModeOf(op)]).toEqual([Opcode.NOP, Modifier.I, Mode.APostIncrement, Mode.BPostIncrement]);
    expect(op).toBeLessThan(0x10000);
    expect(opModKey(op)).toBe((Opcode.NOP << 3) | Modifier.I);
    expect(opModKey(op)).toBeLessThan(OPMOD_KEY_COUNT);
});

test('fold is a true modulo (guide.md 3.3: 40 + 41 = 1 in an 80 core; -1 is coresize - 1)', () => {
    expect(fold(40 + 41, 80)).toBe(1);
    expect(fold(-1, 8000)).toBe(7999);
});

test('formatInstruction prints load-file style, optionally signed', () => {
    const spec = { opcode: Opcode.MOV, modifier: Modifier.I, aMode: Mode.Direct, aNumber: 0, bMode: Mode.BIndirect, bNumber: 7999 };
    expect(formatInstruction(spec)).toBe('MOV.I $0, @7999');
    expect(formatInstruction(spec, { signedFor: 8000, lowerCase: true })).toBe('mov.i $0, @-1');
});
