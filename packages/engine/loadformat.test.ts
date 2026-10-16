import { describe, expect, test } from 'bun:test';
import {
    LoadFormatError,
    emitCommentLine,
    emitInstructionTokens,
    emitOrgTokens,
    emitPinTokens,
    programToParseResult,
    readLoadFormat,
    type IWarriorProgram,
} from './loadformat.ts';
import { Mode, Modifier, Opcode, TokenCategory, type IToken } from './types.ts';

const at = { line: 1, char: 1 };
const dwarf: IWarriorProgram = {
    startOffset: 1,
    instructions: [
        { opcode: Opcode.DAT, modifier: Modifier.F, aMode: Mode.Immediate, aNumber: 0, bMode: Mode.Immediate, bNumber: 0 },
        { opcode: Opcode.ADD, modifier: Modifier.AB, aMode: Mode.Immediate, aNumber: 4, bMode: Mode.Direct, bNumber: -1 },
        { opcode: Opcode.MOV, modifier: Modifier.I, aMode: Mode.Direct, aNumber: -2, bMode: Mode.BIndirect, bNumber: -2 },
        { opcode: Opcode.JMP, modifier: Modifier.B, aMode: Mode.Direct, aNumber: -2, bMode: Mode.Direct, bNumber: 0 },
    ],
};

describe('load format contract', () => {
    test('what the writers emit, the reader decodes unchanged (metadata comments ignored)', () => {
        const tokens: IToken[] = [...emitCommentLine(';name dwarf', at), ...emitOrgTokens(1, at)];
        for (const ins of dwarf.instructions) tokens.push(...emitInstructionTokens(ins, at));
        expect(readLoadFormat(tokens)).toEqual(dwarf);
        expect(readLoadFormat(programToParseResult(dwarf).tokens)).toEqual(dwarf);
    });

    test('lexemes are upper case with a dotted modifier and signed numbers', () => {
        const lexemes = emitInstructionTokens(dwarf.instructions[2]!, at).map((t) => t.lexeme);
        expect(lexemes).toEqual(['MOV', '.I', '$', '-2', ',', '@', '-2', '\n']);
    });

    test('rejects streams that break the grammar', () => {
        const valid = emitInstructionTokens(dwarf.instructions[0]!, at);
        const withoutComma = valid.filter((t) => t.category !== TokenCategory.Comma);
        expect(() => readLoadFormat(withoutComma)).toThrow(LoadFormatError);
        expect(() => readLoadFormat([])).toThrow('no instructions');
    });

    test('an ORG outside the warrior is kept as written (pMARS starts execution there)', () => {
        const valid = emitInstructionTokens(dwarf.instructions[0]!, at);
        expect(readLoadFormat([...emitOrgTokens(-1, at), ...valid]).startOffset).toBe(-1);
    });

    test('a PIN line round-trips; without one the program has no pin', () => {
        const withPin: IWarriorProgram = { ...dwarf, pin: -7 };
        expect(readLoadFormat(programToParseResult(withPin).tokens)).toEqual(withPin);
        expect('pin' in readLoadFormat(programToParseResult(dwarf).tokens)).toBe(false);
        const lexemes = emitPinTokens(42, at).map((t) => t.lexeme);
        expect(lexemes).toEqual(['PIN', '42', '\n']);
    });

    test('rejects a second PIN line and other directives', () => {
        const valid = emitInstructionTokens(dwarf.instructions[0]!, at);
        expect(() => readLoadFormat([...emitPinTokens(1, at), ...emitPinTokens(2, at), ...valid])).toThrow('more than one PIN');
        const equ = [{ position: at, lexeme: 'EQU', category: TokenCategory.Preprocessor }, { position: at, lexeme: '1', category: TokenCategory.Number }];
        expect(() => readLoadFormat([...equ, ...valid])).toThrow('PIN <number>');
    });
});
