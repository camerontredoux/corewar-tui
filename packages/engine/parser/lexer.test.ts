import { describe, expect, test } from 'bun:test';
import { TokenCategory } from '../types.ts';
import { lex, lexLine } from './lexer.ts';

const C = TokenCategory;
const summary = (text: string) => lexLine(text, 1).map((t) => [t.lexeme, t.category]);

describe('lexer', () => {
    test('every line ends with an EOL token and positions are 1-based', () => {
        const lines = lex('mov 0, 1\n  dat #4');
        expect(lines).toHaveLength(2);
        expect(lines[0]!.at(-1)).toMatchObject({ category: C.EOL, position: { line: 1, char: 9 } });
        expect(lines[1]![0]).toMatchObject({ lexeme: 'dat', category: C.Opcode, position: { line: 2, char: 3 }, end: 6 });
        expect(lines[1]![1]).toMatchObject({ lexeme: '#', category: C.Mode, position: { line: 2, char: 7 } });
    });

    test('CRLF, CR and LF all end lines', () => {
        expect(lex('a\r\nb\rc\nd')).toHaveLength(4);
    });

    test('classifies opcodes and directives case-insensitively, other names as labels', () => {
        expect(summary('MOV mov Mov org END equ For rof ldp STP pin loop _x a1')).toEqual([
            ['MOV', C.Opcode], ['mov', C.Opcode], ['Mov', C.Opcode], ['org', C.Preprocessor], ['END', C.Preprocessor],
            ['equ', C.Preprocessor], ['For', C.Preprocessor], ['rof', C.Preprocessor], ['ldp', C.Opcode], ['STP', C.Opcode], ['pin', C.Preprocessor],
            ['loop', C.Label],
            ['_x', C.Label], ['a1', C.Label],
        ]);
    });

    test('modifier is a dot followed by letters', () => {
        expect(summary('mov.ab')).toEqual([['mov', C.Opcode], ['.ab', C.Modifier]]);
        expect(summary('mov . i')).toEqual([['mov', C.Opcode], ['.', C.Unknown], ['i', C.Label]]);
    });

    test('mode characters and operators', () => {
        expect(summary('# $ @ { } * < >')).toEqual([
            ['#', C.Mode], ['$', C.Mode], ['@', C.Mode], ['{', C.Mode], ['}', C.Mode], ['*', C.Maths], ['<', C.Maths], ['>', C.Maths],
        ]);
        expect(summary('a==b!=c<=d>=e&&f||!g%(h)').filter(([, c]) => c === C.Maths).map(([l]) => l)).toEqual([
            '==', '!=', '<=', '>=', '&&', '||', '!', '%', '(', ')',
        ]);
    });

    test('numbers, invalid digit-led names, comments and stray characters', () => {
        expect(summary('12 3abc , ; rest of line')).toEqual([
            ['12', C.Number], ['3abc', C.Unknown], [',', C.Comma], ['; rest of line', C.Comment],
        ]);
        expect(summary('a: x&i ? =')).toEqual([
            ['a', C.Label], [':', C.Unknown], ['x', C.Label], ['&', C.Unknown], ['i', C.Label], ['?', C.Unknown], ['=', C.Unknown],
        ]);
    });

    test('lexLine honours a starting column', () => {
        expect(lexLine(' CORESIZE', 4, 8)[0]).toMatchObject({ position: { line: 4, char: 9 }, end: 17 });
    });
});
