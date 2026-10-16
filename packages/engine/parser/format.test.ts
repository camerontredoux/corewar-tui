/** formatRedcode (the canonical layout) and formatRedcodeSafely (the guarded save path). */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Glob } from 'bun';
import { formatRedcode, formatRedcodeSafely, instructionColumn, operandColumn, parse, serialise } from './index.ts';
import { asm } from './testutil.ts';

const fmt = (lines: string[]): string => formatRedcode(lines.join('\n'));
const out = (lines: string[]): string => `${lines.join('\n')}\n`;

describe('formatRedcode layout', () => {
    test('label column, opcode column and operands, as in warriors/dwarf.red', () => {
        const dwarf = ';redcode-94\n;assert 1\n;name Dwarf\nloop\tmov bomb, >bomb\n\t\t\tdjn loop, #4\n\t\t\tjmp 0\nbomb\tdat #0, #1\nend\n';
        expect(formatRedcode(dwarf)).toBe(
            out([';redcode-94', ';assert 1', ';name Dwarf', 'loop    mov     bomb, >bomb', '        djn     loop, #4', '        jmp     0', 'bomb    dat     #0, #1', '        end']),
        );
    });

    test('columns widen to the longest label and opcode plus two', () => {
        expect(fmt(['bootstrap mov.ab #1, 2', 'x jmp bootstrap'])).toBe(out(['bootstrap  mov.ab  #1, 2', 'x          jmp     bootstrap']));
    });

    test('instructionColumn is where the opcodes go: 8, or the longest label plus two', () => {
        expect(instructionColumn('')).toBe(8);
        expect(instructionColumn('loop mov 0, 1\nnext')).toBe(8);
        expect(instructionColumn('bootstrap mov.ab #1, 2\nx jmp bootstrap')).toBe('bootstrap  '.length);
    });

    test('operandColumn is where the operands go: both columns, each 8 or its longest entry plus two', () => {
        expect(operandColumn('')).toBe(16);
        expect(operandColumn('loop mov 0, 1\n end')).toBe(16); // END without an argument does not count
        expect(operandColumn('bootstrap mov.ab #1, 2\nx jmp bootstrap')).toBe('bootstrap  mov.ab  '.length);
    });

    test('opcodes, modifiers and directives go lower case; label case and expressions stay as written', () => {
        expect(fmt(['Loop MOV.I  Bomb ,  >Bomb+ 2*X', 'X EQU 3', 'END Loop'])).toBe(
            out(['Loop    mov.i   Bomb, >Bomb+ 2*X', 'X       equ     3', '        end     Loop']),
        );
    });

    test('never adds a modifier, mode or operand', () => {
        const source = fmt(['dat 7', 'jmp 0', 'mov 0,1', 'spl # 4']);
        expect(source).toBe(out(['        dat     7', '        jmp     0', '        mov     0, 1', '        spl     # 4']));
        expect(asm(source)).toEqual(asm('dat 7\njmp 0\nmov 0,1\nspl # 4'));
    });

    test('comments: full lines verbatim, trailing ones two spaces out and aligned per run', () => {
        expect(fmt(['  ; indented note  ', ';name X', 'a mov 0, 1 ; one', 'jmp a   ;two', '', 'dat 0 ;  three'])).toBe(
            out(['  ; indented note', ';name X', 'a       mov     0, 1  ; one', '        jmp     a     ;two', '', '        dat     0  ;  three']),
        );
    });

    test('blank lines: runs of three or more cut to two, trailing whitespace and extra final lines dropped', () => {
        expect(fmt(['mov 0, 1   ', '', '', '', '', 'jmp -1', '', '', ''])).toBe(out(['        mov     0, 1', '', '', '        jmp     -1']));
        expect(formatRedcode('mov 0, 1')).toBe('        mov     0, 1\n');
        expect(formatRedcode('')).toBe('');
        expect(formatRedcode('mov 0, 1\r\njmp -1\r\n')).toBe(out(['        mov     0, 1', '        jmp     -1']));
    });

    test('labels on their own line stay there; colons are kept', () => {
        expect(fmt(['start:', '  first second', 'loop: mov 0, 1'])).toBe(out(['start:', 'first second', 'loop:   mov     0, 1']));
    });

    test('EQU, FOR, ROF, ORG, PIN and END use the same columns', () => {
        expect(fmt(['step equ 4 ', 'ORG go', 'PIN 7', 'i FOR 2', 'dat i, step', 'ROF', 'go jmp 0', 'END'])).toBe(
            out(['step    equ     4', '        org     go', '        pin     7', 'i       for     2', '        dat     i, step', '        rof', 'go      jmp     0', '        end']),
        );
    });

    test('FOR 0 and computed-count blocks stay verbatim, header to ROF', () => {
        const block = ['n for 0', '   a mov of  prose, here ', '  for whatever', '  rof', 'rof'];
        expect(fmt([...block, 'MOV 0, 1'])).toBe(out(['n for 0', '   a mov of  prose, here', '  for whatever', '  rof', 'rof', '        mov     0, 1']));
        expect(fmt(['k equ 2', 'FOR k', 'DAT 0', 'ROF'])).toBe(out(['k       equ     2', 'FOR k', 'DAT 0', 'ROF']));
    });

    test('lines it does not understand stay verbatim (& concatenation, stray characters)', () => {
        expect(fmt(['i for 2', 'x&i  DAT 0', 'rof', 'mov 0 ? 1'])).toBe(out(['i       for     2', 'x&i  DAT 0', '        rof', 'mov 0 ? 1']));
    });

    test('text after END is kept exactly, trailing spaces included', () => {
        expect(fmt(['mov 0, 1', 'end', 'notes:   MOV  ', '', 'more'])).toBe(out(['        mov     0, 1', '        end', 'notes:   MOV  ', '', 'more']));
    });

    test('is idempotent', () => {
        const once = fmt(['a: b MOV.AB #1 ,2 ; x', 'c equ 3', '', '', '', 'jmp a', 'end a', 'tail']);
        expect(formatRedcode(once)).toBe(once);
    });
});

describe('formatRedcodeSafely', () => {
    test('formats source that parses', () => {
        expect(formatRedcodeSafely('MOV 0,1\n')).toEqual({ text: '        mov     0, 1\n', changed: true });
    });

    test('keeps source with parse errors as typed', () => {
        expect(formatRedcodeSafely('mvo 0,1\n')).toEqual({ text: 'mvo 0,1\n', changed: false, skipped: 'errors' });
    });

    test('reports already formatted source as unchanged', () => {
        expect(formatRedcodeSafely('        mov     0, 1\n')).toEqual({ text: '        mov     0, 1\n', changed: false, skipped: 'unchanged' });
    });

    test('falls back to the source when the formatted text assembles differently', () => {
        const source = ';name A\nmov 0, 1\n';
        const changes = [
            (s: string) => s.replace('mov 0, 1', 'mov 0, 2'), // instruction
            (s: string) => `${s}org 0\nend 1\n`, // warning count
            (s: string) => s.replace(';name A', ';name B'), // metadata
            (s: string) => `${s}pin 3\n`, // P-space
            (s: string) => s.replace('mov', 'mvo'), // errors
            () => {
                throw new Error('boom');
            },
        ];
        for (const change of changes) expect(formatRedcodeSafely(source, undefined, change)).toEqual({ text: source, changed: false, skipped: 'semantics' });
    });
});

describe('the warrior corpus', () => {
    const root = join(import.meta.dir, '..', '..', '..');
    const files = ['warriors/*.red', 'examples/*.red', 'packages/engine/parser/fixtures/**/*.red'].flatMap((p) => [...new Glob(p).scanSync({ cwd: root })]);

    test('is found', () => {
        expect(files.length).toBeGreaterThan(0);
    });

    test.each(files)('%s assembles the same after formatting, and formatting is idempotent', (file) => {
        const source = readFileSync(join(root, file), 'utf8');
        const once = formatRedcode(source);
        expect(formatRedcode(once)).toBe(once);
        const before = parse(source);
        const after = parse(once);
        expect(serialise(after.tokens)).toBe(serialise(before.tokens));
        expect(after.metaData).toEqual(before.metaData);
        expect(after.messages.map((m) => [m.type, m.text])).toEqual(before.messages.map((m) => [m.type, m.text]));
        expect(formatRedcodeSafely(source).skipped).not.toBe('semantics');
    });
});
