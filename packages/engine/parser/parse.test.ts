/**
 * parse(): spec/redcode.md Definition-of-Done items marked P, plus edge cases.
 * Section names follow the redcode.md checklist.
 */

import { describe, expect, test } from 'bun:test';
import { MessageType, Mode, Modifier, Opcode, Standard, TokenCategory } from '../types.ts';
import { readLoadFormat } from '../loadformat.ts';
import { PRESETS } from '../options.ts';
import { parse } from './index.ts';
import { PARSER_VERSION } from './symbols.ts';
import { asm, commentLines, errorTexts, errors, startOf, warningTexts, warnings } from './testutil.ts';

const OPCODES = ['dat', 'mov', 'add', 'sub', 'mul', 'div', 'mod', 'jmp', 'jmz', 'jmn', 'djn', 'cmp', 'seq', 'sne', 'slt', 'spl', 'nop'];
const TWO_OPERAND_ONLY = ['mov', 'add', 'sub', 'mul', 'div', 'mod', 'jmz', 'jmn', 'djn', 'cmp', 'seq', 'sne', 'slt'];

describe('overview and operands', () => {
    test('mov 0, 1 parses to MOV.I $0, $1', () => {
        expect(asm('mov 0, 1')).toEqual(['MOV.I $0, $1']);
    });

    test('every parsed instruction has all six fields', () => {
        const { instructions } = readLoadFormat(parse('dat 7\njmp 5\nmov 0, 1\nadd #1, @2').tokens);
        for (const ins of instructions) {
            expect(Object.keys(ins).sort()).toEqual(['aMode', 'aNumber', 'bMode', 'bNumber', 'modifier', 'opcode']);
            for (const v of Object.values(ins)) expect(Number.isInteger(v)).toBe(true);
        }
    });

    test('modifiers and modes are optional; defaults are inserted', () => {
        expect(asm('add 1, 2\nadd.x #1, *2')).toEqual(['ADD.F $1, $2', 'ADD.X #1, *2']);
    });

    test('mov.i $1, #2 has A mode $, A number 1, B mode #, B number 2', () => {
        const [ins] = readLoadFormat(parse('mov.i $1, #2').tokens).instructions;
        expect(ins).toEqual({ opcode: Opcode.MOV, modifier: Modifier.I, aMode: Mode.Direct, aNumber: 1, bMode: Mode.Immediate, bNumber: 2 });
    });

    test('an operand with no mode gets $', () => {
        expect(asm('jmz 4, 5')).toEqual(['JMZ.B $4, $5']);
    });

    test.each([
        ['dat 7', 'DAT.F #0, $7'],
        ['jmp 5', 'JMP.B $5, $0'],
        ['spl 3', 'SPL.B $3, $0'],
        ['nop 8', 'NOP.F $8, $0'],
        ['dat #7', 'DAT.F #0, #7'],
        ['jmp @5', 'JMP.B @5, $0'],
    ])('single operand: %s -> %s', (source, expected) => {
        expect(asm(source)).toEqual([expected]);
    });

    test.each(TWO_OPERAND_ONLY)('a single operand on %s is a syntax error', (op) => {
        expect(errorTexts(`${op} 1`)).toEqual([`'${op.toUpperCase()}' needs two operands (only DAT, JMP, SPL and NOP take one)`]);
    });

    test.each(OPCODES)('%s with no operands is an error', (op) => {
        expect(errorTexts(op)).toHaveLength(1);
    });

    test('more than two operands is an error', () => {
        expect(errorTexts('mov 1, 2, 3')).toEqual(['Too many operands: an instruction has at most two']);
    });

    test('an empty operand is an error', () => {
        expect(errorTexts('mov 1,')).toEqual(['Missing B operand']);
        expect(errorTexts('mov ,1')).toEqual(['Missing A operand']);
    });

    test("an ICWS'88-style warrior (no modifiers, $#@< modes, END n) parses", () => {
        const source = `;redcode-88
        dat #0
start   add #4, -1
        mov @-2, <-2
        cmp $0, #3
        slt #1, 0
        djn start, -5
        jmp start
        end 1`;
        const result = parse(source);
        expect(errors(result)).toEqual([]);
        expect(asm(source)).toEqual([
            'DAT.F #0, #0',
            'ADD.AB #4, $-1',
            'MOV.I @-2, <-2',
            'CMP.B $0, #3',
            'SLT.AB #1, $0',
            'DJN.B $-4, $-5',
            'JMP.B $-5, $0',
        ]);
        expect(startOf(source)).toBe(1);
        expect(commentLines(source)[0]).toBe(';redcode-88');
    });
});

describe('opcodes: parsing', () => {
    test('all 17 opcodes are accepted', () => {
        const lines = asm(OPCODES.map((op) => `${op} 1, 2`).join('\n'));
        expect(lines.map((l) => l.split('.')[0])).toEqual(OPCODES.map((op) => op.toUpperCase()));
    });

    test('opcodes are case-insensitive', () => {
        expect(asm('MOV 0, 1\nmov 0, 1\nMoV 0, 1')).toEqual(['MOV.I $0, $1', 'MOV.I $0, $1', 'MOV.I $0, $1']);
    });

    test('an unknown opcode is a parse error', () => {
        expect(errorTexts('mvo 0, 1')).toEqual(["Expected an opcode or directive after 'mvo', found '0'"]);
        expect(errorTexts('xyz.ab 0, 1')).toEqual(["Unknown opcode 'xyz'"]);
    });

    test('CMP is kept as CMP in the output (an alias of SEQ)', () => {
        expect(asm('cmp 1, 2\nseq 1, 2')).toEqual(['CMP.I $1, $2', 'SEQ.I $1, $2']);
    });
});

describe('modifiers', () => {
    test.each(['a', 'b', 'ab', 'ba', 'f', 'x', 'i'])('.%s is accepted in any case', (m) => {
        expect(asm(`mov.${m} 1, 2\nmov.${m.toUpperCase()} 1, 2`)).toEqual([`MOV.${m.toUpperCase()} $1, $2`, `MOV.${m.toUpperCase()} $1, $2`]);
    });

    test.each(['.z', '.abx', '.fi'])('unknown modifier %s is an error', (m) => {
        expect(errorTexts(`mov${m} 1, 2`)).toEqual([`Unknown modifier '${m}'`]);
    });

    test('an explicit modifier is never replaced by the default', () => {
        expect(asm('mov.a #1, 2\nadd.i 1, 2\ndat.x 1, 2\njmp.f 1\nslt.i #1, 2')).toEqual([
            'MOV.A #1, $2', 'ADD.I $1, $2', 'DAT.X $1, $2', 'JMP.F $1, $0', 'SLT.I #1, $2',
        ]);
    });

    test('the modifier must follow the opcode with no space', () => {
        expect(errorTexts('mov .i 1, 2')).toEqual(["The modifier '.i' must follow the opcode with no space"]);
        expect(errorTexts('mov . i 1, 2')).toHaveLength(1);
    });

    test('a directive does not take a modifier', () => {
        expect(errorTexts('org.a 0\ndat 0')).toEqual(["'org' does not take a modifier"]);
    });
});

describe('default modifiers (redcode.md 7.4)', () => {
    const modeChars = ['#', '$', '*', '@', '{', '<', '}', '>'];
    const expectFor = (op: string, a: string, b: string): string => {
        const aImm = a === '#';
        const bImm = b === '#';
        switch (op) {
            case 'dat': case 'nop': return 'F';
            case 'mov': case 'cmp': case 'seq': case 'sne': return aImm ? 'AB' : bImm ? 'B' : 'I';
            case 'add': case 'sub': case 'mul': case 'div': case 'mod': return aImm ? 'AB' : bImm ? 'B' : 'F';
            case 'slt': return aImm ? 'AB' : 'B';
            default: return 'B';
        }
    };
    const cases = OPCODES.flatMap((op) => modeChars.flatMap((a) => modeChars.map((b) => [op, a, b] as const)));

    test(`all ${cases.length} opcode/mode combinations follow the table`, () => {
        const source = cases.map(([op, a, b]) => `${op} ${a}1, ${b}2`).join('\n');
        const got = asm(source, { instructionLimit: cases.length });
        cases.forEach(([op, a, b], k) => {
            expect(`${op} ${a} ${b} ${got[k]!.split(' ')[0]}`).toBe(`${op} ${a} ${b} ${op.toUpperCase()}.${expectFor(op, a, b)}`);
        });
    });

    test('documented examples', () => {
        expect(asm('mov 0, 1')).toEqual(['MOV.I $0, $1']);
        expect(asm('add.ab 1, 2')).toEqual(['ADD.AB $1, $2']);
        expect(asm('dat 7')).toEqual(['DAT.F #0, $7']);
        expect(asm('top dat 0\njmp top')).toEqual(['DAT.F #0, $0', 'JMP.B $-1, $0']);
        // redcode.md AMBIGUITY 7.4: the table wins over the (comments)/(preprocessor) examples.
        expect(asm('add 3, 4')).toEqual(['ADD.F $3, $4']);
        expect(asm('add (4/2-1)*5, 1')).toEqual(['ADD.F $5, $1']);
        expect(asm('bmb dat 0\nmov bmb, @bmb')).toEqual(['DAT.F #0, $0', 'MOV.I $-1, @-1']);
    });

    test('the modifier is computed from the modes after defaulting (single-operand forms)', () => {
        // DAT's inserted A operand is $0; MOV-like rows never see a single operand.
        expect(asm('dat #1')).toEqual(['DAT.F #0, #1']);
        expect(asm('jmp #1')).toEqual(['JMP.B #1, $0']);
        expect(asm('nop #1')).toEqual(['NOP.F #1, $0']);
    });
});

describe('addressing modes', () => {
    test('all eight modes parse', () => {
        expect(asm('mov #1, $2\nmov *1, @2\nmov {1, <2\nmov }1, >2')).toEqual([
            'MOV.AB #1, $2', 'MOV.I *1, @2', 'MOV.I {1, <2', 'MOV.I }1, >2',
        ]);
    });

    test('a mode character is recognised only at the start of an operand', () => {
        expect(asm('mov $1*2, *1')).toEqual(['MOV.I $2, *1']);
        expect(asm('mov <2>1, >1<2')).toEqual(['MOV.I <1, >1']);
        expect(asm('mov (2*3), 1*2')).toEqual(['MOV.I $6, $2']);
        expect(asm('mov $-1, #-2')).toEqual(['MOV.B $-1, #-2']);
    });

    test('a mode with no number is an error', () => {
        expect(errorTexts('mov $, 1')).toEqual(['Operand is missing a number']);
        expect(errorTexts('mov 1, #')).toEqual(['Operand is missing a number']);
    });

    test('a mode character inside an expression is an error', () => {
        expect(errorTexts('mov 1#2, 3')).toEqual(["Unexpected '#' (missing comma?)"]);
        expect(errorTexts('mov 1, 2 @3')).toEqual(["Unexpected '@' (missing comma?)"]);
    });

    test('operands without a comma are an error (redcode.md 9.1 AMBIGUITY)', () => {
        expect(errorTexts('dat #1 #2')).toEqual(["Unexpected '#' (missing comma?)"]);
    });
});

describe('parser defaults and output', () => {
    test('whitespace and comments are removed', () => {
        const result = parse('   mov\t0 ,   1   ; copy\n; whole line\n\n');
        expect(asm('   mov\t0 ,   1   ; copy\n; whole line\n\n')).toEqual(['MOV.I $0, $1']);
        expect(result.tokens.filter((t) => t.category === TokenCategory.Comment).map((t) => t.lexeme)).toEqual([
            ';redcode-94', ';name Nameless', ';author Blameless',
        ]);
    });

    test('the default mode is $ for every opcode including DAT; a single DAT operand is B and A is #0', () => {
        expect(asm('bmb dat 5, 5\ndat 0, 0')).toEqual(['DAT.F $5, $5', 'DAT.F $0, $0']);
    });

    test('output is OPCODE.MOD <m><n>, <m><n>, upper case, signed relative numbers', () => {
        expect(asm('x dat 0\nmov.ab x, @x\njmp -10, >-3')).toEqual(['DAT.F #0, $0', 'MOV.AB $-1, @-1', 'JMP.B $-10, >-3']);
    });

    test('numbers are not folded by the parser', () => {
        expect(asm('dat 9000, -9000')).toEqual(['DAT.F $9000, $-9000']);
    });

    test('diagnostics carry severity, line, char and text; warnings do not block success', () => {
        const result = parse('dat 0\ndat 0\nORG 5');
        expect(errors(result)).toEqual([]);
        expect(warnings(result)).toEqual([
            { type: MessageType.Warning, position: { line: 3, char: 5 }, text: 'Start address 5 is outside the warrior (length 2); execution starts outside its code' },
        ]);
        expect(readLoadFormat(result.tokens).startOffset).toBe(5);

        const bad = parse('dat 0\n  mov 0');
        expect(bad.messages).toEqual([
            { type: MessageType.Error, position: { line: 2, char: 8 }, text: "'MOV' needs two operands (only DAT, JMP, SPL and NOP take one)" },
        ]);
    });

    test('a warrior with no instructions is an error', () => {
        expect(errorTexts('')).toEqual(['Warrior has no instructions']);
        expect(errorTexts('; just a comment\nx EQU 4\nlabel')).toEqual(['Warrior has no instructions']);
    });

    test('unexpected characters are errors', () => {
        expect(errorTexts('mov 0, 1 ?')).toEqual(["Unexpected '?'"]);
        expect(errorTexts('? mov 0, 1')).toEqual(["Expected a label, opcode or directive, found '?'"]);
        expect(errorTexts('mov 0, x&y')).toEqual(["Unexpected '&'"]);
        expect(errorTexts('a&b dat 0')).toEqual(["'&' is only allowed inside a FOR block, followed by the loop counter name"]);
    });
});

describe('labels', () => {
    test.each(['lbl', '_Label', 'a123:', 'my_label:', 'b_13_'])('%s declares a label', (decl) => {
        const name = decl.replace(':', '');
        expect(asm(`${decl} dat 1\njmp ${name}`)).toEqual(['DAT.F #0, $1', 'JMP.B $-1, $0']);
    });

    test('a label may sit alone on its line, with or without colon', () => {
        expect(asm('lbl:\n  dat 1\njmp lbl')).toEqual(['DAT.F #0, $1', 'JMP.B $-1, $0']);
    });

    test('a label starting with a digit is not accepted', () => {
        expect(errorTexts('1abc dat 0')).toEqual(["Invalid label '1abc': a label must start with a letter or '_'"]);
        expect(errorTexts('dat 0\njmp 1abc')).toEqual(["Unexpected '1abc'"]);
    });

    test('the colon is not part of the name', () => {
        expect(asm('start: dat 0\njmp start')).toEqual(['DAT.F #0, $0', 'JMP.B $-1, $0']);
        expect(errorTexts('start: dat 0\njmp start:')).toHaveLength(1);
    });

    test('the bmb/top example', () => {
        const source = `bmb: dat     #4, #0
top: add.ab bmb, bmb
     mov.i  bmb, @bmb
     jmp top`;
        expect(asm(source)).toEqual(['DAT.F #4, #0', 'ADD.AB $-1, $-1', 'MOV.I $-2, @-2', 'JMP.B $-2, $0']);
    });

    test('forward references resolve', () => {
        expect(asm('jmp end1\ndat 0\nend1 dat 1')).toEqual(['JMP.B $2, $0', 'DAT.F #0, $0', 'DAT.F #0, $1']);
    });

    test('several labels can name one address, on separate lines or one line', () => {
        expect(asm('label:\nanother:\nmov 0, 1\njmp label\njmp another')).toEqual(['MOV.I $0, $1', 'JMP.B $-1, $0', 'JMP.B $-2, $0']);
        expect(asm('a b: c: mov 0, 1\njmp a, b\njmp c')).toEqual(['MOV.I $0, $1', 'JMP.B $-1, $-1', 'JMP.B $-2, $0']);
    });

    test('labels are case-sensitive', () => {
        expect(asm('Top dat 1\ntop dat 2\njmp Top, top')).toEqual(['DAT.F #0, $1', 'DAT.F #0, $2', 'JMP.B $-2, $-1']);
        expect(errorTexts('Top dat 1\njmp TOP')).toEqual(["Undefined label or constant 'TOP'"]);
    });

    test('undefined and duplicate labels are errors', () => {
        expect(errorTexts('jmp nowhere')).toEqual(["Undefined label or constant 'nowhere'"]);
        const dup = parse('x dat 0\nx dat 1');
        expect(errors(dup)).toEqual([
            { type: MessageType.Error, position: { line: 2, char: 1 }, text: "'x' is already defined as a label on line 1" },
        ]);
    });

    test('opcode, directive and predefined names cannot be labels', () => {
        expect(errorTexts('jmp: dat 0')).toHaveLength(1);
        expect(errorTexts('CORESIZE dat 0')).toEqual(["'CORESIZE' is a predefined constant and cannot be used as a label name"]);
        expect(asm('coresize dat 0\njmp coresize')).toEqual(['DAT.F #0, $0', 'JMP.B $-1, $0']);
    });

    test('inserting an instruction between a labelled dat and the mov keeps the reference', () => {
        expect(asm('d dat #1, #2\nmov d, 10')).toEqual(['DAT.F #1, #2', 'MOV.I $-1, $10']);
        expect(asm('d dat #1, #2\nspl 5\nmov d, 10')).toEqual(['DAT.F #1, #2', 'SPL.B $5, $0', 'MOV.I $-2, $10']);
    });

    test('trailing labels resolve to the warrior length', () => {
        expect(asm('jmp last\ndat 0\nlast')).toEqual(['JMP.B $2, $0', 'DAT.F #0, $0']);
    });

    test('labels before ORG/END bind to the next instruction', () => {
        expect(asm('dat 0\nhere ORG here\nmov 0, 1\njmp here')).toEqual(['DAT.F #0, $0', 'MOV.I $0, $1', 'JMP.B $-1, $0']);
        expect(startOf('dat 0\nhere ORG here\nmov 0, 1')).toBe(1);
        expect(asm('a\nORG 1\ndat a, 0\ndat a, 0')).toEqual(['DAT.F $0, $0', 'DAT.F $-1, $0']);
    });

    test('a label-only line before EQU names the constant too (pMARS)', () => {
        expect(asm('a\nb EQU 5\ndat a, b')).toEqual(['DAT.F $5, $5']);
        expect(asm('x\n\n; comment\na EQU 5\ny dat a, x\njmp y')).toEqual(['DAT.F $5, $5', 'JMP.B $-1, $0']);
    });

    test('long label names are allowed', () => {
        const name = 'l'.repeat(500);
        expect(asm(`${name} dat 0\njmp ${name}`)).toEqual(['DAT.F #0, $0', 'JMP.B $-1, $0']);
    });
});

describe('EQU', () => {
    const dwarf = `step EQU 3044
ORG  top
bmb: dat    #step, #step
top: add.ab bmb, bmb
     mov    bmb, @bmb
     jmp    top`;

    test('the step EQU 3044 dwarf parses to the documented output', () => {
        expect(asm(dwarf)).toEqual(['DAT.F #3044, #3044', 'ADD.AB $-1, $-1', 'MOV.I $-2, @-2', 'JMP.B $-2, $0']);
        expect(startOf(dwarf)).toBe(1);
    });

    test('mybmb EQU bmb resolves like bmb at each use site', () => {
        const source = `step EQU 3044
mybmb EQU bmb
ORG  top
bmb: dat    #step, #step
top: add.ab mybmb, mybmb
     mov    mybmb, @mybmb
     jmp    top`;
        expect(asm(source)).toEqual(asm(dwarf));
    });

    test('the label-constant example without step is an undefined-symbol error', () => {
        expect(errorTexts('mybmb EQU bmb\nbmb: dat #step, #step\njmp mybmb')).toEqual([
            "Undefined label or constant 'step'",
            "Undefined label or constant 'step'",
        ]);
    });

    test('values may be numbers, labels, special constants or expressions', () => {
        expect(asm('a EQU 7\nb EQU here\nc EQU CORESIZE\nd EQU (a+1)*2\nhere dat a, b\ndat c, d')).toEqual([
            'DAT.F $7, $0', 'DAT.F $8000, $16',
        ]);
    });

    test('myconst EQU (1+2)/2 gives 1', () => {
        expect(asm('myconst EQU (1+2)/2\ndat myconst')).toEqual(['DAT.F #0, $1']);
    });

    test('EQU is plain text substitution, no parentheses (ICWS\'94, pMARS): x EQU 1+2 then x*2 is 5', () => {
        expect(asm('x EQU 1+2\ndat x*2')).toEqual(['DAT.F #0, $5']);
        expect(asm('x EQU 1+2\ny EQU x*x\ndat -y')).toEqual(['DAT.F #0, $3']);
    });

    test('a value that is not an expression is substituted as raw text', () => {
        expect(asm('bomb EQU <2667\ndat bomb, #1')).toEqual(['DAT.F <2667, #1']);
        expect(asm('pair EQU 1, 2\nmov pair')).toEqual(['MOV.I $1, $2']);
    });

    test('labels inside a value resolve relative to each use site', () => {
        expect(asm('p EQU tgt+1\ndat p\ndat p\ntgt dat 0')).toEqual(['DAT.F #0, $3', 'DAT.F #0, $2', 'DAT.F #0, $0']);
    });

    test('a constant may be used before it is defined', () => {
        expect(asm('dat k\nk EQU 5')).toEqual(['DAT.F #0, $5']);
    });

    test('redefinition, label clashes and cycles are errors', () => {
        expect(errorTexts('x EQU 1\nx EQU 2\ndat 0')).toEqual(["'x' is already defined as a constant on line 1"]);
        expect(errorTexts('x dat 0\nx EQU 2')).toEqual(["'x' is already defined as a label on line 1"]);
        expect(errorTexts('a EQU b+1\nb EQU a\ndat a')).toEqual(["Cyclic EQU definition of 'a'", "Cyclic EQU definition of 'b'"]);
        expect(errorTexts('s EQU s\ndat 0')).toEqual(["Cyclic EQU definition of 's'"]);
    });

    test('EQU needs a name and a value', () => {
        expect(errorTexts('EQU 5\ndat 0')).toEqual(['EQU needs a name before it']);
        expect(errorTexts('x EQU\ndat 0')).toEqual(['EQU needs a value']);
        expect(errorTexts('MOV EQU 1\ndat 0')).toEqual(["'MOV' is an opcode and cannot be used as an EQU name"]);
    });

    test('EQU is case-insensitive and produces no instruction', () => {
        expect(asm('a equ 1\nb Equ 2\ndat a, b')).toEqual(['DAT.F $1, $2']);
    });

    test('errors inside a value point at the EQU line, once', () => {
        const result = parse('x EQU 1/0\ndat x\ndat x');
        expect(errors(result)).toEqual([
            { type: MessageType.Error, position: { line: 1, char: 8 }, text: 'Division by zero in expression' },
        ]);
    });
});

describe('expressions in operands', () => {
    test('+ - * / % in operands and EQU values', () => {
        expect(asm('dat 7+3, 7-3\ndat 7*3, 7/3\nk EQU 7%3\ndat k, -7/2')).toEqual([
            'DAT.F $10, $4', 'DAT.F $21, $2', 'DAT.F $1, $-3',
        ]);
    });

    test('5+2*3 is 11 and parentheses control order', () => {
        expect(asm('dat 5+2*3, (5+2)*3')).toEqual(['DAT.F $11, $21']);
        expect(asm('add (4/2-1)*5, 1')).toEqual(['ADD.F $5, $1']);
    });

    test('labels in expressions: mov bmb, bmb+1', () => {
        expect(asm('bmb dat 5, 5\n    dat 0, 0\n    mov bmb, bmb+1')).toEqual(['DAT.F $5, $5', 'DAT.F $0, $0', 'MOV.I $-2, $-1']);
    });

    test('unary minus', () => {
        expect(asm('jmp -2\ndat $-1')).toEqual(['JMP.B $-2, $0', 'DAT.F #0, $-1']);
    });

    test('left-associativity and % precedence', () => {
        expect(asm('dat 8-2-1, 8/2/2\ndat 1+7%3, 2*7%3')).toEqual(['DAT.F $5, $2', 'DAT.F $2, $2']);
    });

    test('division or modulo by zero is a parse error', () => {
        expect(errorTexts('dat 1/0')).toEqual(['Division by zero in expression']);
        expect(errorTexts('dat 1%(2-2)')).toEqual(['Modulo by zero in expression']);
    });

    test('comparison and logical operators work in operands', () => {
        expect(asm('dat 3>2, (1==1)+(2!=2)\ndat !0, 1&&0||1')).toEqual(['DAT.F $1, $1', 'DAT.F $1, $1']);
    });

    test('unbalanced parentheses are errors', () => {
        expect(errorTexts('dat (1+2')).toEqual(["Unbalanced parentheses: missing ')'"]);
        expect(errorTexts('dat 1+2)')).toEqual(["Unbalanced parentheses: unexpected ')'"]);
    });
});

describe('special constants and assert', () => {
    test('each predefined constant resolves from the parser settings', () => {
        const options = { coresize: 800, maximumCycles: 8000, maxTasks: 64, warriors: 3, instructionLimit: 20, minSeparation: 25, rounds: 7 };
        const source = 'dat CORESIZE, MAXCYCLES\ndat MAXPROCESSES, WARRIORS\ndat MAXLENGTH, MINDISTANCE\ndat VERSION, PSPACESIZE\ndat ROUNDS, CURLINE';
        expect(asm(source, options)).toEqual([
            'DAT.F $800, $8000', 'DAT.F $64, $3', 'DAT.F $20, $25', `DAT.F $${PARSER_VERSION}, $50`, 'DAT.F $7, $4',
        ]);
    });

    test('defaults come from options.ts', () => {
        expect(asm('dat CORESIZE, MAXCYCLES\ndat MAXPROCESSES, WARRIORS\ndat MAXLENGTH, MINDISTANCE\ndat PSPACESIZE, ROUNDS')).toEqual([
            'DAT.F $8000, $80000', 'DAT.F $8000, $2', 'DAT.F $100, $100', 'DAT.F $500, $1',
        ]);
    });

    test('CURLINE is the 0-based instruction offset, after FOR expansion', () => {
        expect(asm('dat CURLINE\nFOR 2\ndat CURLINE\nROF\nk EQU CURLINE*10\ndat k')).toEqual([
            'DAT.F #0, $0', 'DAT.F #0, $1', 'DAT.F #0, $2', 'DAT.F #0, $30',
        ]);
    });

    test('predefined constants are case-sensitive', () => {
        expect(errorTexts('dat coresize')).toEqual(["Undefined label or constant 'coresize'"]);
    });

    test(';assert CORESIZE==8000 passes at 8000 and fails at any other size', () => {
        const source = ';assert CORESIZE==8000\nmov 0, 1';
        expect(errors(parse(source))).toEqual([]);
        expect(errors(parse(source, { coresize: 8192 }))).toEqual([
            { type: MessageType.Error, position: { line: 1, char: 1 }, text: 'Assertion failed: CORESIZE==8000' },
        ]);
    });

    test('assert supports the full C operator set', () => {
        const ok = [
            '1+1==2', '3-1==2', '2*3==6', '7/2==3', '7%2==1', '1!=2', '1<2', '2<=2', '3>2', '2>=2',
            'CORESIZE>=8000 && MAXLENGTH<=100', '0 || 1', '!(CORESIZE==55440)',
        ];
        for (const cond of ok) expect(errorTexts(`;assert ${cond}\ndat 0`)).toEqual([]);
        for (const cond of ['1>2', '0 && 1', '!1', 'CORESIZE<8000']) {
            expect(errorTexts(`;assert ${cond}\ndat 0`)).toEqual([`Assertion failed: ${cond}`]);
        }
    });

    test('assert sees EQU constants, even ones defined later, and labels as offsets', () => {
        expect(errorTexts(';assert len==3 && last==2\nlen EQU 3\ndat 0\ndat 0\nlast dat 0')).toEqual([]);
    });

    test('assert keyword rules', () => {
        expect(errorTexts(';ASSERT 0\ndat 0')).toEqual(['Assertion failed: 0']);
        expect(errorTexts(';assert\ndat 0')).toEqual([';assert needs a condition']);
        expect(errorTexts(';assertion 0\ndat 0')).toEqual([]);
        expect(errorTexts('; assert 0\ndat 0')).toEqual([]);
        expect(errorTexts('dat 0 ;assert 0')).toEqual([]);
        expect(errorTexts(';assert 1 +\ndat 0')).toEqual(['Expression ends unexpectedly']);
    });

    test('assert errors point inside the comment', () => {
        expect(errors(parse(';assert   nope\ndat 0'))[0]!.position).toEqual({ line: 1, char: 11 });
    });

    test('every assert must pass', () => {
        expect(errorTexts(';assert 1\n;assert 0\n;assert 1\ndat 0')).toEqual(['Assertion failed: 0']);
    });
});

describe('FOR / ROF', () => {
    test('FOR 10 emits ten identical instructions', () => {
        expect(asm('FOR 10\ndat.f $1, $2\nROF')).toEqual(Array(10).fill('DAT.F $1, $2'));
    });

    test('nested FOR 2 / FOR 3 emits six instructions', () => {
        expect(asm('FOR 2\nFOR 3\ndat.f $1, $2\nROF\nROF')).toEqual(Array(6).fill('DAT.F $1, $2'));
    });

    test('i FOR 3 / loop&i declares loop01, loop02, loop03', () => {
        const source = 'i FOR 3\nloop&i dat.f $1, $1\nROF\njmp loop01\njmp loop02\njmp loop03';
        expect(asm(source)).toEqual([
            'DAT.F $1, $1', 'DAT.F $1, $1', 'DAT.F $1, $1', 'JMP.B $-3, $0', 'JMP.B $-3, $0', 'JMP.B $-3, $0',
        ]);
    });

    test('the counter is usable in expressions inside the block', () => {
        expect(asm('i FOR 3\ndat i, 0\nROF')).toEqual(['DAT.F $1, $0', 'DAT.F $2, $0', 'DAT.F $3, $0']);
        expect(asm('n FOR 3\ndat n*n, -n\nROF')).toEqual(['DAT.F $1, $-1', 'DAT.F $4, $-2', 'DAT.F $9, $-3']);
    });

    test('a label on its own line before FOR 4 gives the documented values', () => {
        expect(asm('label\nFOR 4\ndat.f $1+label, $1-label\nROF')).toEqual([
            'DAT.F $1, $1', 'DAT.F $0, $2', 'DAT.F $-1, $3', 'DAT.F $-2, $4',
        ]);
    });

    test('the last name before FOR is the counter; earlier names are labels', () => {
        expect(asm('start i FOR 2\ndat i, start\nROF')).toEqual(['DAT.F $1, $0', 'DAT.F $2, $-1']);
        expect(errorTexts('i FOR 2\ndat 0\nROF\njmp i')).toEqual(["Undefined label or constant 'i'"]);
    });

    test('FOR 0 ... ROF removes its contents without validating them', () => {
        const source = `FOR 0
This is a multi-line comment, with $ymbols & stuff: mov 0
It is a good place to wait for the scan to finish
or explain a subtle nuance of the warrior's code
ROF
mov 0, 1`;
        expect(asm(source)).toEqual(['MOV.I $0, $1']);
    });

    test('a FOR 0 block may contain nested FOR lines', () => {
        expect(asm('FOR 0\nFOR 3\nnot code\nROF\nstill not code\nROF\ndat 1')).toEqual(['DAT.F #0, $1']);
    });

    test('ROF without FOR and FOR without ROF are errors', () => {
        expect(errorTexts('dat 0\nROF')).toEqual(['ROF without a matching FOR']);
        expect(errorTexts('dat 0\nFOR 2\ndat 1')).toEqual(['FOR without a matching ROF']);
        expect(errorTexts('dat 0\nFOR 2\nFOR 2\ndat 1\nROF')).toEqual(['FOR without a matching ROF']);
    });

    test('FOR and ROF lines produce no output; keywords are case-insensitive', () => {
        expect(asm('for 2\ndat 0\nrof\nFor 1\ndat 1\nRof')).toEqual(['DAT.F #0, $0', 'DAT.F #0, $0', 'DAT.F #0, $1']);
    });

    test('the count may use EQU, predefined constants and earlier labels', () => {
        expect(asm('n EQU 2\nFOR n+1\ndat 0\nROF')).toHaveLength(3);
        expect(asm('FOR MAXLENGTH/50\ndat 0\nROF')).toHaveLength(2);
        expect(asm('a dat 0\nb dat 0\nFOR b-a+CURLINE\ndat 1\nROF')).toHaveLength(5);
    });

    test('a count that refers to a forward label is an error', () => {
        expect(errorTexts('FOR later\ndat 0\nROF\nlater dat 1')).toEqual(["FOR count uses 'later', which is not defined before the FOR"]);
    });

    test('a negative count is treated as zero; a missing count is an error', () => {
        expect(asm('FOR -3\ndat 0\nROF\ndat 1')).toEqual(['DAT.F #0, $1']);
        expect(errorTexts('FOR\nROF\ndat 0')).toEqual(['FOR needs a repeat count']);
    });

    test('nested counters, & on both levels, and shadowing', () => {
        const source = `i FOR 2
j FOR 2
c&i&j dat i, j
ROF
ROF
jmp c0102`;
        expect(asm(source)).toEqual(['DAT.F $1, $1', 'DAT.F $1, $2', 'DAT.F $2, $1', 'DAT.F $2, $2', 'JMP.B $-3, $0']);
        expect(asm('i FOR 2\ndat i\ni FOR 3\ndat i\nROF\nROF')).toEqual([
            'DAT.F #0, $1', 'DAT.F #0, $1', 'DAT.F #0, $2', 'DAT.F #0, $3',
            'DAT.F #0, $2', 'DAT.F #0, $1', 'DAT.F #0, $2', 'DAT.F #0, $3',
        ]);
        expect(asm('i FOR 2\nj FOR i\ndat i, j\nROF\nROF')).toEqual(['DAT.F $1, $1', 'DAT.F $2, $1', 'DAT.F $2, $2']);
    });

    test('the & counter pads to at least two digits', () => {
        const result = parse('i FOR 100\nx&i dat 0\nROF\njmp x01\njmp x09\njmp x10\njmp x100', { instructionLimit: 200 });
        expect(errors(result)).toEqual([]);
        expect(asm('i FOR 3\ndat x&i\nROF\nx01 dat 0\nx02 dat 0\nx03 dat 0')).toEqual([
            'DAT.F #0, $3', 'DAT.F #0, $3', 'DAT.F #0, $3', 'DAT.F #0, $0', 'DAT.F #0, $0', 'DAT.F #0, $0',
        ]);
    });

    test('labels declared inside a FOR block without & are duplicates', () => {
        expect(errorTexts('FOR 2\nx dat 0\nROF')).toEqual(["'x' is already defined as a label on line 2"]);
    });

    test('EQU inside a FOR block with & defines one constant per pass', () => {
        expect(asm('i FOR 2\nk&i EQU i*10\nROF\ndat k01, k02')).toEqual(['DAT.F $10, $20']);
    });

    test('a runaway FOR is stopped with an error', () => {
        const texts = errorTexts('FOR 1000000\nFOR 1000000\ndat 0\nROF\nROF');
        expect(texts.some((t) => t.startsWith('FOR expansion is too large'))).toBe(true);
    });

    test('metadata comments inside a FOR block count once; FOR 0 hides them', () => {
        const result = parse('FOR 3\n;strategy once\ndat 0\nROF\nFOR 0\n;name hidden\nROF');
        expect(result.metaData.strategy).toBe('once');
        expect(result.metaData.name).toBe('');
    });
});

describe('ORG / END', () => {
    const body = 'dat #4, #0\nadd.ab -1, -1';

    test('with no ORG/END the start offset is 0 and ORG 0 is emitted', () => {
        expect(startOf(body)).toBe(0);
        expect(parse(body).tokens.some((t) => t.category === TokenCategory.Preprocessor && t.lexeme === 'ORG')).toBe(true);
    });

    test('ORG 1 before the code starts at the add', () => {
        expect(startOf(`ORG 1\n${body}`)).toBe(1);
        expect(warningTexts(`ORG 1\n${body}`)).toEqual([]);
    });

    test('END 1 after the code also starts at the add', () => {
        expect(startOf(`${body}\nEND 1`)).toBe(1);
    });

    test('ORG top resolves the label as an absolute offset', () => {
        expect(startOf('ORG top\ndat 0\ndat 0\ntop dat 0\njmp top')).toBe(2);
        expect(startOf('dat 0\ndat 0\nORG top+CURLINE-2\ntop dat 0\njmp top')).toBe(2);
    });

    test('ORG and END both present: ORG wins with a warning', () => {
        const source = `ORG 1\n${body}\nEND 0`;
        expect(startOf(source)).toBe(1);
        expect(warningTexts(source)).toEqual(['Both ORG and END give a start address; ORG takes precedence']);
    });

    test('several ORGs: the last wins with a warning', () => {
        const source = `ORG 1\n${body}\nORG 0`;
        expect(startOf(source)).toBe(0);
        expect(warningTexts(source)).toEqual(['Several ORG directives give a start address; the last one is used']);
    });

    test('a bare END sets no start and does not count toward the warning', () => {
        expect(startOf(`ORG 1\n${body}\nEND`)).toBe(1);
        expect(warningTexts(`ORG 1\n${body}\nEND`)).toEqual([]);
    });

    test('lines after END are ignored, even invalid ones', () => {
        const source = `${body}\nEND\nthis is not redcode !!!\nORG 1\n;assert 0\n;name late`;
        expect(asm(source)).toEqual(['DAT.F #4, #0', 'ADD.AB $-1, $-1']);
        expect(startOf(source)).toBe(0);
        expect(parse(source).messages).toEqual([]);
        expect(parse(source).metaData.name).toBe('');
    });

    test('an out-of-range start is warned about and kept, so execution starts outside the code (pMARS)', () => {
        expect(startOf(`ORG 5\n${body}`)).toBe(5);
        expect(startOf(`ORG -1\n${body}`)).toBe(-1);
        expect(warningTexts(`END -1\n${body}`)).toEqual([]);
        expect(warningTexts(`${body}\nEND -1`)).toEqual(['Start address -1 is outside the warrior (length 2); execution starts outside its code']);
    });

    test('ORG needs an address; bad addresses are errors', () => {
        expect(errorTexts(`ORG\n${body}`)).toEqual(['ORG needs a start address']);
        expect(errorTexts(`ORG nowhere\n${body}`)).toEqual(["Undefined label or constant 'nowhere'"]);
    });

    test('directives are case-insensitive', () => {
        expect(startOf(`org 1\n${body}`)).toBe(1);
        expect(startOf(`${body}\nend 1`)).toBe(1);
    });

    test('the ORG token points at the directive', () => {
        const org = parse(`dat 0\n  ORG 0`).tokens.find((t) => t.lexeme === 'ORG')!;
        expect(org.position).toEqual({ line: 2, char: 3 });
    });
});

describe('comments', () => {
    test('everything from ; to end of line is removed', () => {
        expect(asm('mov 0, 1 ; mov 2, 3')).toEqual(['MOV.I $0, $1']);
    });

    test('the documented comment example produces two instructions', () => {
        const source = `mov 0, 1
; this is a comment
add 3, 4   ; this is also a comment
;jmp -1 this line of code has been commented out and will not be included in the parsed output`;
        expect(asm(source)).toEqual(['MOV.I $0, $1', 'ADD.F $3, $4']);
    });

    test('a FOR 0 multi-line comment is removed entirely', () => {
        const source = `FOR 0
This is a multi-line comment
It is a good place to explain a complex strategy
or subtle nuance of the warrior's code
ROF
dat 0`;
        expect(asm(source)).toEqual(['DAT.F #0, $0']);
    });
});

describe('metadata', () => {
    test.each([
        [';redcode-94', ';redcode-94'],
        [';redcode-88', ';redcode-88'],
        [';redcode-86', ';redcode-86'],
        [';redcode', ';redcode-94'],
        [';REDCODE-88', ';redcode-88'],
        [';redcode-94nop quiet', ';redcode-94'],
        [';redcode-94 verbose', ';redcode-94'],
        ['', ';redcode-94'],
    ])('%s gives %s', (line, expected) => {
        expect(commentLines(`${line}\ndat 0`)[0]).toBe(expected);
    });

    test('an unknown redcode standard is a warning and gives 94', () => {
        expect(warningTexts(';redcode-89\ndat 0')).toEqual(["Unknown redcode standard '89'; assuming ICWS'94"]);
        expect(commentLines(';redcode-89\ndat 0')[0]).toBe(';redcode-94');
    });

    test('the first ;redcode wins', () => {
        expect(commentLines(';redcode-88\n;redcode-94\ndat 0')[0]).toBe(';redcode-88');
    });

    test(';name sets the name; defaults are Nameless in the output and "" in metaData', () => {
        expect(parse(';name imp\nmov 0, 1').metaData.name).toBe('imp');
        expect(commentLines(';name imp\nmov 0, 1')).toContain(';name imp');
        expect(parse('mov 0, 1').metaData).toEqual({ name: '', author: '', strategy: '' });
        expect(commentLines('mov 0, 1')).toEqual([';redcode-94', ';name Nameless', ';author Blameless']);
    });

    test(';author sets the author', () => {
        const result = parse(';author A. K. Dewdney  \nmov 0, 1');
        expect(result.metaData.author).toBe('A. K. Dewdney');
        expect(commentLines(';author A. K. Dewdney\nmov 0, 1')).toContain(';author A. K. Dewdney');
    });

    test('the last ;name and ;author win', () => {
        expect(parse(';name a\n;name b\n;author x\n;author y\ndat 0').metaData).toEqual({ name: 'b', author: 'y', strategy: '' });
    });

    test('several ;strategy lines form a multi-line strategy in source order', () => {
        const source = ';strategy This is a longer strategy which is \n;strategy broken down into three successive\n;strategy lines\ndat 0';
        const result = parse(source);
        expect(result.metaData.strategy).toBe('This is a longer strategy which is\nbroken down into three successive\nlines');
        expect(commentLines(source).slice(3)).toEqual([
            ';strategy This is a longer strategy which is', ';strategy broken down into three successive', ';strategy lines',
        ]);
    });

    test('output order: redcode, name, author, strategy, ORG, instructions', () => {
        const result = parse(';strategy s\n;author a\nORG 0\n;name n\n;redcode-88\ndat 0');
        expect(result.tokens.map((t) => t.lexeme).filter((l) => l !== '\n').slice(0, 6)).toEqual([
            ';redcode-88', ';name n', ';author a', ';strategy s', 'ORG', '0',
        ]);
    });

    test('metadata is in the output but not loaded into core', () => {
        const result = parse(';name imp\n;author me\n;strategy s\nmov 0, 1');
        expect(readLoadFormat(result.tokens).instructions).toHaveLength(1);
    });

    test('; name x (space after ;) is an ordinary comment', () => {
        expect(parse('; name x\ndat 0').metaData.name).toBe('');
        expect(parse(';namex\ndat 0').metaData.name).toBe('');
        expect(parse(';NAME x\ndat 0').metaData.name).toBe('x');
        expect(parse('  ;name x\ndat 0').metaData.name).toBe('x');
    });

    test('a trailing comment is not metadata', () => {
        expect(parse('dat 0 ;name x').metaData.name).toBe('');
    });

    test('an empty ;name gives "" and the Nameless line', () => {
        expect(parse(';name\ndat 0').metaData.name).toBe('');
        expect(commentLines(';name\ndat 0')).toContain(';name Nameless');
    });

    test('metadata comment tokens point at their source comment', () => {
        const name = parse('dat 0\n  ;name imp').tokens.find((t) => t.lexeme === ';name imp')!;
        expect(name.position).toEqual({ line: 2, char: 3 });
    });
});

describe('length limit and standard (guide.md 624, 626)', () => {
    test('a warrior over instructionLimit is an error', () => {
        expect(errorTexts('FOR 100\ndat 0\nROF')).toEqual([]);
        expect(errorTexts('FOR 101\ndat 0\nROF')).toEqual(['Warrior has 101 instructions; the maximum length is 100']);
        expect(errorTexts('FOR 6\ndat 0\nROF', PRESETS.nano)).toEqual(['Warrior has 6 instructions; the maximum length is 5']);
        expect(errorTexts('FOR 1000\ndat 0\nROF', { instructionLimit: 1000 })).toEqual([]);
    });

    test('the length error points at the first instruction past the limit', () => {
        const err = errors(parse('dat 0\ndat 1\ndat 2', { instructionLimit: 2 }))[0]!;
        expect(err.position).toEqual({ line: 3, char: 1 });
    });

    test("ICWS'88 rejects '94-only opcodes, modifiers and modes", () => {
        const icws88 = { standard: Standard.ICWS88 };
        expect(errorTexts('mov 0, 1\ndat #0, <1\nslt @1, 2\nend', icws88)).toEqual([]);
        expect(errorTexts('seq 0, 1', icws88)).toEqual(["Opcode 'SEQ' is not part of ICWS'88"]);
        expect(errorTexts('nop 0', icws88)).toEqual(["Opcode 'NOP' is not part of ICWS'88"]);
        expect(errorTexts('mov.i 0, 1', icws88)).toEqual(["Modifiers such as '.i' are not part of ICWS'88"]);
        expect(errorTexts('mov *0, }1', icws88)).toEqual([
            "Addressing mode '*' is not part of ICWS'88", "Addressing mode '}' is not part of ICWS'88",
        ]);
        expect(errorTexts('mul 1, 2', { standard: Standard.ICWS86 })).toEqual(["Opcode 'MUL' is not part of ICWS'86"]);
        expect(errorTexts('seq.i *0, }1', { standard: Standard.ICWS94draft })).toEqual([]);
    });

    test('the ;redcode line does not restrict the grammar', () => {
        expect(errorTexts(';redcode-88\nseq.i *0, }1')).toEqual([]);
    });
});

describe('token positions (1-based)', () => {
    test('instruction tokens point at the source text that produced them', () => {
        const tokens = parse('  mov.ab  #4 ,  @x\nx dat 0').tokens.filter((t) => t.position.line === 1 && t.category !== TokenCategory.Comment);
        const by = (lexeme: string) => tokens.find((t) => t.lexeme === lexeme)!.position;
        expect(by('MOV')).toEqual({ line: 1, char: 3 });
        expect(by('.AB')).toEqual({ line: 1, char: 6 });
        expect(by('#')).toEqual({ line: 1, char: 11 });
        expect(by('4')).toEqual({ line: 1, char: 12 });
        expect(by('@')).toEqual({ line: 1, char: 17 });
        expect(by('1')).toEqual({ line: 1, char: 18 });
    });

    test('defaulted parts point at the opcode', () => {
        const tokens = parse('\n\tjmp 3').tokens.filter((t) => t.category !== TokenCategory.Comment && t.lexeme !== 'ORG');
        const [op, mod, aMode, aNum, , bMode, bNum] = tokens.slice(-8);
        expect(op!.position).toEqual({ line: 2, char: 2 });
        expect(mod!.position).toEqual({ line: 2, char: 2 });
        expect(aMode!.position).toEqual({ line: 2, char: 2 });
        expect(aNum!.position).toEqual({ line: 2, char: 6 });
        expect(bMode!.position).toEqual({ line: 2, char: 2 });
        expect(bNum!.position).toEqual({ line: 2, char: 2 });
    });

    test('FOR-expanded and EQU-substituted tokens point at their use site', () => {
        const tokens = parse('k EQU <5\nFOR 2\n dat k\nROF').tokens.filter((t) => t.category === TokenCategory.Mode && t.lexeme === '<');
        expect(tokens.map((t) => t.position)).toEqual([{ line: 3, char: 6 }, { line: 3, char: 6 }]);
    });

    test('message positions are 1-based', () => {
        expect(parse('jmp nowhere').messages[0]!.position).toEqual({ line: 1, char: 5 });
        expect(parse('\n\n   bogus 1').messages[0]!.position).toEqual({ line: 3, char: 10 });
    });
});

describe('robustness', () => {
    test('parse never throws, for any input', () => {
        const inputs: unknown[] = [
            '', '\n\n\n', ';', ',,,', '((((((', ')))', '#$@*{}<>', 'mov', 'mov.', 'ORG', 'END', 'EQU', 'FOR', 'ROF',
            'FOR FOR FOR', 'x EQU x', '&', ':', 'a::b', '\0\u0001￿', 'dat 1'.repeat(1000), 'mov 0, 1\r\n'.repeat(50),
            undefined, null, 42,
        ];
        let seed = 12345;
        const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
        const alphabet = 'mov dat add jmp ORG END EQU FOR ROF x y 1 2 # $ @ * < > { } , ; : & ( ) + - / % ! = \n\t';
        for (let i = 0; i < 300; i++) {
            let s = '';
            for (let k = 0; k < 40; k++) s += alphabet[Math.floor(rand() * alphabet.length)];
            inputs.push(s);
        }
        for (const input of inputs) {
            const result = parse(input as string);
            expect(Array.isArray(result.tokens)).toBe(true);
            expect(Array.isArray(result.messages)).toBe(true);
            expect(typeof result.metaData.name).toBe('string');
            expect('data' in result).toBe(false);
            // A successful parse always yields a readable load format.
            if (errors(result).length === 0) expect(() => readLoadFormat(result.tokens)).not.toThrow();
        }
    });

    test('a long program assembles', () => {
        const source = Array.from({ length: 5000 }, (_, i) => `l${i} dat l${i}, ${i}`).join('\n');
        const result = parse(source, { instructionLimit: 5000 });
        expect(errors(result)).toEqual([]);
        expect(readLoadFormat(result.tokens).instructions).toHaveLength(5000);
    });
});
