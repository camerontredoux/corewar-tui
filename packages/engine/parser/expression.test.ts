import { describe, expect, test } from 'bun:test';
import type { IMessage } from '../types.ts';
import { lexLine } from './lexer.ts';
import { evaluate } from './expression.ts';

const symbols: Record<string, number> = { a: 3, b: -4 };
function ev(text: string): { value: number | undefined; messages: IMessage[] } {
    const messages: IMessage[] = [];
    const value = evaluate(lexLine(text, 1), (name) => symbols[name], messages);
    return { value, messages };
}
const value = (text: string) => ev(text).value;
const errorText = (text: string) => ev(text).messages.map((m) => m.text).join(' | ');

describe('expression evaluator', () => {
    test.each([
        ['5+2*3', 11],
        ['(4/2-1)*5', 5],
        ['(1+2)/2', 1],
        ['8-2-1', 5],
        ['8/2/2', 2],
        ['7%3*2', 2],
        ['2*7%3', 2],
        ['1+7%3', 2],
        ['-7/2', -3],
        ['7/-2', -3],
        ['-7/3', -2],
        ['-7%3', -1],
        ['7%-3', 1],
        ['-2', -2],
        ['--2', 2],
        ['+5', 5],
        ['-(1+2)', -3],
        ['a*b', -12],
        ['a+1', 4],
    ])('%s = %d', (text, expected) => {
        expect(value(text)).toBe(expected);
    });

    test.each([
        ['1==1', 1], ['1==2', 0], ['1!=2', 1], ['2!=2', 0],
        ['1<2', 1], ['2<2', 0], ['2<=2', 1], ['3<=2', 0], ['3>2', 1], ['2>2', 0], ['2>=2', 1], ['1>=2', 0],
        ['1&&2', 1], ['1&&0', 0], ['0||0', 0], ['0||3', 1],
        ['!0', 1], ['!5', 0], ['!!5', 1],
        ['1+1==2', 1], ['1<2==1', 1], ['1||0&&0', 1], ['(1||0)&&0', 0], ['2*3>5&&1', 1],
        ['8000==8000', 1],
    ])('%s = %d (C semantics)', (text, expected) => {
        expect(value(text)).toBe(expected);
    });

    test('&& and || short-circuit', () => {
        expect(ev('0&&1/0')).toEqual({ value: 0, messages: [] });
        expect(ev('1||1/0')).toEqual({ value: 1, messages: [] });
    });

    test('never yields negative zero', () => {
        expect(Object.is(value('0*-1'), 0)).toBe(true);
        expect(Object.is(value('-1/3'), 0)).toBe(true);
        expect(Object.is(value('-3%3'), 0)).toBe(true);
    });

    test.each([
        ['1/0', 'Division by zero'],
        ['1%0', 'Modulo by zero'],
        ['5/(a-3)', 'Division by zero'],
        ['(1+2', 'missing'],
        ['1+2)', "unexpected ')'"],
        ['', 'Expected an expression'],
        ['1+', 'ends unexpectedly'],
        ['1 2', 'missing comma'],
        ['zz', "Undefined label or constant 'zz'"],
        ['mov', 'keyword'],
        ['1?', "Unexpected '?'"],
        ['99999999999999999999', 'too large'],
        ['4503599627370496*4', 'overflow'],
    ])('%s is an error (%s)', (text, fragment) => {
        const r = ev(text);
        expect(r.value).toBeUndefined();
        expect(errorText(text)).toContain(fragment);
    });

    test('errors carry the offending token position', () => {
        expect(ev('1 + 2/0').messages[0]!.position).toEqual({ line: 1, char: 6 });
        expect(ev('1 + qq').messages[0]!.position).toEqual({ line: 1, char: 5 });
    });
});
