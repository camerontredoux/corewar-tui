/**
 * Parser API contract (spec/developer.md 2, checklist items marked [parser]),
 * serialise format, round-trip stability, and the sample/user warriors as
 * fixtures (guide.md 650, 651). The user warriors are copies in `fixtures/`, so
 * editing the live `warriors/` and `examples/` folders doesn't change the tests.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MessageType, TokenCategory, type IParseResult, type IToken } from '../types.ts';
import { parse as barrelParse, serialise as barrelSerialise } from '../index.ts';
import { readLoadFormat } from '../loadformat.ts';
import { PRESETS } from '../options.ts';
import { DWARF, DWARF_UNLABELED, SAMPLES } from '../samples.ts';
import { parse, serialise } from './index.ts';
import { errors } from './testutil.ts';

const FIXTURES = join(import.meta.dir, 'fixtures');
const tok = (lexeme: string, category: TokenCategory, line = 1, char = 1): IToken => ({ lexeme, category, position: { line, char } });

describe('IParseResult shape', () => {
    test('parse is exported from the engine barrel and returns metaData, tokens and messages', () => {
        expect(barrelParse).toBe(parse);
        expect(barrelSerialise).toBe(serialise);
        const result = parse(';name imp\n;author A. K. Dewdney\n;strategy go\nmov 0, 1');
        expect(result.metaData).toEqual({ name: 'imp', author: 'A. K. Dewdney', strategy: 'go' });
        expect(result.messages).toEqual([]);
        for (const t of result.tokens) {
            expect(Number.isInteger(t.position.line) && t.position.line >= 1).toBe(true);
            expect(Number.isInteger(t.position.char) && t.position.char >= 1).toBe(true);
            expect(typeof t.lexeme).toBe('string');
            expect(Object.values(TokenCategory)).toContain(t.category);
        }
    });

    test('messages have a MessageType, a 1-based position and text', () => {
        const result = parse('dat 0\ndat 0\nORG 9\njmp nowhere');
        expect(result.messages.length).toBeGreaterThan(1);
        for (const m of result.messages) {
            expect([MessageType.Error, MessageType.Warning, MessageType.Info]).toContain(m.type);
            expect(m.position.line).toBeGreaterThanOrEqual(1);
            expect(m.position.char).toBeGreaterThanOrEqual(1);
            expect(typeof m.text).toBe('string');
        }
    });

    test('missing metadata fields are ""', () => {
        expect(parse('mov 0, 1').metaData).toEqual({ name: '', author: '', strategy: '' });
    });

    test('a parse result accepts a data property that the parser leaves alone', () => {
        const result: IParseResult = { ...parse('mov 0, 1'), data: { id: 7 } };
        expect(readLoadFormat(result.tokens).instructions).toHaveLength(1);
        expect(result.data).toEqual({ id: 7 });
    });

    test('a failed parse still returns the full shape with Error messages', () => {
        const result = parse('mov 0');
        expect(result.metaData).toEqual({ name: '', author: '', strategy: '' });
        expect(Array.isArray(result.tokens)).toBe(true);
        expect(errors(result)).toHaveLength(1);
    });
});

describe('serialise', () => {
    test('[] gives ""', () => {
        expect(serialise([])).toBe('');
    });

    test('spacing: none before a comma or modifier, none after a mode, one space otherwise', () => {
        const tokens = [
            tok('MOV', TokenCategory.Opcode), tok('.I', TokenCategory.Modifier), tok('$', TokenCategory.Mode), tok('0', TokenCategory.Number),
            tok(',', TokenCategory.Comma), tok('$', TokenCategory.Mode), tok('1', TokenCategory.Number), tok('\n', TokenCategory.EOL),
            tok('ORG', TokenCategory.Preprocessor), tok('top', TokenCategory.Label), tok('+', TokenCategory.Maths), tok('1', TokenCategory.Number),
        ];
        expect(serialise(tokens)).toBe('MOV.I $0, $1\nORG top + 1');
    });

    test('does not validate categories', () => {
        expect(serialise([tok('a', 99 as TokenCategory), tok('b', -1 as TokenCategory)])).toBe('a b');
    });

    test('snapshot: the dwarf load file', () => {
        expect(serialise(parse(DWARF).tokens)).toBe(
            ';redcode-94\n;name dwarf\n;author Blameless\nORG 0\nADD.AB #4, $3\nMOV.I $2, @2\nJMP.B $-2, $0\nDAT.F #0, #0\n',
        );
    });

    test('snapshot: metadata, ORG and every mode', () => {
        const source = `;redcode-94
;name All Modes
;author someone
;strategy line one
;strategy line two
ORG go
x   dat #1, $2
go  mov *x, @x
    mov {x, }x
    mov <x, >x
end`;
        expect(serialise(parse(source).tokens)).toBe(
            [
                ';redcode-94', ';name All Modes', ';author someone', ';strategy line one', ';strategy line two', 'ORG 1',
                'DAT.F #1, $2', 'MOV.I *-1, @-1', 'MOV.I {-2, }-2', 'MOV.I <-3, >-3', '',
            ].join('\n'),
        );
    });

    test('round-trip: parse(serialise(parse(x).tokens)) is stable', () => {
        const sources = [...Object.values(SAMPLES), DWARF_UNLABELED, ';redcode-88\nstart add #4, -1\nend start', 'x EQU 3\ni FOR 3\na&i dat i*x, CURLINE\nROF'];
        for (const source of sources) {
            const first = parse(source);
            const text = serialise(first.tokens);
            const second = parse(text);
            expect(errors(second)).toEqual([]);
            expect(second.metaData).toEqual({
                name: first.metaData.name || 'Nameless',
                author: first.metaData.author || 'Blameless',
                strategy: first.metaData.strategy,
            });
            expect(readLoadFormat(second.tokens)).toEqual(readLoadFormat(first.tokens));
            expect(serialise(second.tokens)).toBe(text);
        }
    });
});

describe('sample warriors (guide.md 650, 651)', () => {
    test.each(Object.entries(SAMPLES))('%s parses without errors or warnings under the standard preset', (_, source) => {
        expect(parse(source, PRESETS.standard).messages).toEqual([]);
    });

    test('the unlabeled warriors-page Dwarf assembles to the same code as dwarf', () => {
        expect(readLoadFormat(parse(DWARF_UNLABELED).tokens)).toEqual(readLoadFormat(parse(DWARF).tokens));
    });
});

describe('user warriors (copies in fixtures/)', () => {
    const files = ['examples', 'warriors'].flatMap((dir) =>
        readdirSync(join(FIXTURES, dir))
            .filter((f) => f.endsWith('.red'))
            .map((f) => `${dir}/${f}`),
    );
    test.each(files)('%s parses without errors', (file) => {
        const result = parse(readFileSync(join(FIXTURES, file), 'utf8'));
        expect(errors(result)).toEqual([]);
        expect(readLoadFormat(result.tokens).instructions.length).toBeGreaterThan(0);
    });

    test('load files are stable', () => {
        const out = Object.fromEntries(files.map((f) => [f, serialise(parse(readFileSync(join(FIXTURES, f), 'utf8')).tokens)]));
        expect(out).toMatchSnapshot();
    });
});
