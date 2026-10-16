/** Which core cell each source line becomes, and the relative gutter's offsets. */

import { describe, expect, test } from 'bun:test';
import { MessageType, parse } from '../engine/index.ts';
import { cellOffsets, guessCells, lineCells } from './overlays/editor.ts';

const cells = (source: string) => lineCells(source, parse(source));

describe('lineCells', () => {
    test('comments, blank lines, ;name lines and labels on their own line take no cell', () => {
        const source = [';redcode-94', ';name Test', '', '; a comment', 'start', 'top:  mov 0, 1', '      add #1, top', 'last', '      jmp top'].join('\n');
        expect(cells(source)).toEqual([[], [], [], [], [], [0], [1], [], [2]]);
    });

    test('EQU, ORG and END take no cell, and nothing after END does', () => {
        const source = ['step  equ 4', '      org go', 'go    add #step, 1', '      dat 0, 0', '      end go', '      mov 0, 1'].join('\n');
        expect(cells(source)).toEqual([[], [], [0], [1], [], []]);
    });

    test('a line inside FOR … ROF has a cell per repetition; later lines count the expansion', () => {
        const source = ['      jmp 2', '      for 3', '      dat 0, 0', '      rof', '      mov 0, 1'].join('\n');
        expect(cells(source)).toEqual([[0], [], [1, 2, 3], [], [4]]);
    });

    test('with a syntax error it falls back to guessing from the opcodes', () => {
        const source = [';name Broken', 'top   mov 0,', '      add #1, top', 'x     equ 2', '      jmp top'].join('\n');
        expect(parse(source).messages.some((m) => m.type === MessageType.Error)).toBe(true);
        expect(cells(source)).toEqual([[], [0], [1], [], [2]]);
    });

    test('the guess expands FOR with a plain count, and gives up after a block it cannot expand', () => {
        expect(guessCells('for 2\nmov 0, 1\nrof\njmp -2')).toEqual([[], [0, 1], [], [2]]);
        expect(guessCells('dat 0\nfor n\nmov 0, 1\nrof\njmp -2')).toEqual([[0], [], [], [], []]);
    });

    test('the guess agrees with the parser on a clean warrior', () => {
        const source = ';name Dwarf\nstep equ 4\nloop add.ab #step, bomb ; on\n mov.i bomb, @bomb\n jmp loop\nbomb dat #0, #0\n end loop';
        expect(guessCells(source)).toEqual(cells(source));
    });
});

describe('cellOffsets', () => {
    const map = [[], [0], [1], [], [2], [3, 4], [5]];

    test('offsets count from the cursor line, signed', () => {
        expect([...cellOffsets(map, 2)]).toEqual([
            [1, -1],
            [2, 0],
            [4, 1],
            [6, 4],
        ]);
    });

    test('on a line without a cell, the next instruction below is 0; past the last, the one above', () => {
        expect(cellOffsets(map, 3).get(4)).toBe(0);
        expect(cellOffsets(map, 0).get(1)).toBe(0);
        expect(cellOffsets([[0], [], []], 2).get(0)).toBe(0);
    });

    test('lines with several cells get no number; a cursor inside counts from the first repetition', () => {
        expect(cellOffsets(map, 1).has(5)).toBe(false);
        expect(cellOffsets(map, 5).get(6)).toBe(2);
        expect(cellOffsets([[], []], 0).size).toBe(0);
    });
});
