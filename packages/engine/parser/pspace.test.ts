/**
 * parse(): the P-space extension (spec/pspace.md) - LDP, STP, PIN and
 * PSPACESIZE. Expected values were confirmed against pMARS 0.9.5.
 */

import { describe, expect, test } from 'bun:test';
import { Standard } from '../types.ts';
import { readLoadFormat } from '../loadformat.ts';
import { PRESETS, defaultPSpaceSize } from '../options.ts';
import { parse, serialise } from './index.ts';
import { asm, errorTexts, errors, warningTexts } from './testutil.ts';

const MODES = ['#', '$', '@', '<', '>', '*', '{', '}'];
const pinOf = (source: string): number | undefined => readLoadFormat(parse(source).tokens).pin;

describe('LDP and STP', () => {
    test.each(['ldp', 'stp'])('%s: every explicit modifier is kept', (op) => {
        for (const m of ['a', 'b', 'ab', 'ba', 'f', 'x', 'i']) {
            expect(asm(`${op}.${m} 1, 2`)).toEqual([`${op.toUpperCase()}.${m.toUpperCase()} $1, $2`]);
        }
    });

    test.each(['ldp', 'stp'])('%s default modifier: .AB with an immediate A operand, otherwise .B', (op) => {
        for (const a of MODES) {
            for (const b of MODES) {
                const modifier = a === '#' ? 'AB' : 'B';
                expect(asm(`${op} ${a}1, ${b}2`)).toEqual([`${op.toUpperCase()}.${modifier} ${a}1, ${b}2`]);
            }
        }
    });

    test('opcodes are case-insensitive and take labels and expressions', () => {
        expect(asm('x LDP #1, y\nStP.ab x+1, }y*2\ny dat 0')).toEqual(['LDP.AB #1, $2', 'STP.AB $0, }2', 'DAT.F #0, $0']);
    });

    test('they need two operands', () => {
        expect(errorTexts('ldp 3')).toEqual(["'LDP' needs two operands (only DAT, JMP, SPL and NOP take one)"]);
        expect(errorTexts('stp #4')).toEqual(["'STP' needs two operands (only DAT, JMP, SPL and NOP take one)"]);
    });

    test("they are not part of ICWS'88 or '86", () => {
        expect(errorTexts('ldp #1, 2', { standard: Standard.ICWS88 })).toEqual(["Opcode 'LDP' is not part of ICWS'88"]);
        expect(errorTexts('stp 1, 2', { standard: Standard.ICWS86 })).toEqual(["Opcode 'STP' is not part of ICWS'86"]);
    });

    test('the load file round-trips', () => {
        const result = parse('PIN 9\nldp.x #-1, <2\nstp.i }3, @4');
        expect(serialise(result.tokens)).toBe(
            ';redcode-94\n;name Nameless\n;author Blameless\nORG 0\nPIN 9\nLDP.X #-1, <2\nSTP.I }3, @4\n',
        );
        expect(serialise(parse(serialise(result.tokens)).tokens)).toBe(serialise(result.tokens));
    });
});

describe('PIN', () => {
    test('takes an expression, in any case, anywhere before END', () => {
        expect(pinOf('PIN 5+2\ndat 0')).toBe(7);
        expect(pinOf('dat 0\npin -3')).toBe(-3);
        expect(pinOf('PIN CORESIZE*2\ndat 0')).toBe(16000);
        expect(pinOf('PIN PSPACESIZE\ndat 0')).toBe(500);
    });

    test('is not folded into the core', () => {
        expect(pinOf('dat 0\nPIN 4000000000')).toBe(4000000000);
        expect(pinOf('dat 0\nPIN 8005')).toBe(8005);
    });

    test('a label in PIN is its absolute offset, not relative', () => {
        expect(pinOf('dat 0\ndat 0\nx dat 0\nPIN x')).toBe(2);
        expect(pinOf('dat 0\nPIN x\nx dat 0')).toBe(1);
    });

    test('a label on the PIN line names the next instruction', () => {
        expect(asm('lab PIN 7\ndat lab')).toEqual(['DAT.F #0, $0']);
        expect(pinOf('lab PIN 7\ndat lab')).toBe(7);
    });

    test('a bare PIN is PIN 0, with a warning', () => {
        expect(pinOf('dat 0\nPIN')).toBe(0);
        expect(warningTexts(';assert 1\ndat 0\nPIN')).toEqual(['PIN without a value is PIN 0']);
    });

    test('the last of several PINs wins, with a warning', () => {
        expect(pinOf('PIN 3\nPIN 4\ndat 0')).toBe(4);
        expect(warningTexts(';assert 1\nPIN 3\nPIN 4\ndat 0')).toEqual(['Several PIN directives; the last one is used']);
    });

    test('a PIN after END is ignored', () => {
        expect(pinOf('PIN 3\ndat 0\nend\nPIN 4')).toBe(3);
    });

    test('no PIN gives no PIN line', () => {
        expect(pinOf('dat 0')).toBeUndefined();
        expect(serialise(parse('dat 0').tokens)).not.toContain('PIN');
    });

    test('bad operands are errors', () => {
        expect(errorTexts('PIN foo\ndat 0')).toEqual(["Undefined label or constant 'foo'"]);
        expect(errorTexts('PIN 7/0\ndat 0')).toEqual(['Division by zero in expression']);
        expect(errorTexts('PIN 1,2\ndat 0').length).toBe(1);
        expect(errorTexts('PIN #3\ndat 0').length).toBe(1);
    });

    test("is not part of ICWS'88", () => {
        expect(errorTexts('PIN 3\ndat #0', { standard: Standard.ICWS88 })).toEqual(["The PIN directive is not part of ICWS'88"]);
    });
});

describe('PSPACESIZE', () => {
    test('follows the pSpaceSize option and the presets', () => {
        expect(asm('dat PSPACESIZE')).toEqual(['DAT.F #0, $500']);
        expect(asm('dat PSPACESIZE', { pSpaceSize: 13 })).toEqual(['DAT.F #0, $13']);
        expect(asm('dat PSPACESIZE', PRESETS.nano)).toEqual(['DAT.F #0, $5']);
        expect(asm('dat PSPACESIZE', PRESETS.large)).toEqual(['DAT.F #0, $3465']);
    });

    test('defaults from the core size as pMARS does', () => {
        for (const [coresize, size] of [[8000, 500], [8001, 889], [8008, 572], [100, 10], [96, 6], [50, 5], [33, 3], [16, 1], [7, 1]]) {
            expect(defaultPSpaceSize(coresize!)).toBe(size!);
            expect(asm('dat PSPACESIZE', { coresize })).toEqual([`DAT.F #0, $${size}`]);
        }
    });

    test('sunset.red-style P-space code parses cleanly', () => {
        const source = ';assert 1\nres ldp.ab #0, #0\nstp.ab #1, #1\njmn 0, res\ndat 0';
        expect(errors(parse(source))).toEqual([]);
    });
});
