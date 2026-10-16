import { describe, expect, test } from 'bun:test';
import corewar, {
    AccessType,
    MessageTopic,
    MessageType,
    Mode,
    Modifier,
    Opcode,
    Standard,
    TokenCategory,
    initialiseSimulator,
    parse,
    serialise,
} from './index.ts';

// developer.md section 5 values, which must never be renumbered.
describe('public enums', () => {
    const entries = (e: object) => Object.entries(e).filter(([k]) => Number.isNaN(Number(k)));

    test.each([
        ['TokenCategory', TokenCategory, { Label: 0, Opcode: 1, Preprocessor: 2, Modifier: 3, Mode: 4, Number: 5, Comma: 6, Maths: 7, EOL: 8, Comment: 9, Unknown: 10 }],
        ['MessageType', MessageType, { Error: 0, Warning: 1, Info: 2 }],
        ['Standard', Standard, { ICWS86: 0, ICWS88: 1, ICWS94draft: 2 }],
        ['Opcode', Opcode, { DAT: 0, MOV: 1, ADD: 2, SUB: 3, MUL: 4, DIV: 5, MOD: 6, JMP: 7, JMZ: 8, JMN: 9, DJN: 10, CMP: 11, SEQ: 12, SNE: 13, SLT: 14, SPL: 15, NOP: 16, LDP: 17, STP: 18 }],
        ['Modifier', Modifier, { A: 0, B: 1, AB: 2, BA: 3, F: 4, X: 5, I: 6 }],
        ['Mode', Mode, { Immediate: 0, Direct: 1, AIndirect: 2, BIndirect: 3, APreDecrement: 4, BPreDecrement: 5, APostIncrement: 6, BPostIncrement: 7 }],
        ['AccessType', AccessType, { read: 0, write: 1, execute: 2 }],
    ] as const)('%s has the documented members and values', (_name, actual, expected) => {
        expect(Object.fromEntries(entries(actual))).toEqual(expected);
    });

    test('MessageTopic values are the documented topic strings', () => {
        for (const [k, v] of Object.entries(MessageTopic)) expect(String(v)).toBe(k);
        expect(Object.keys(MessageTopic).sort()).toEqual(
            ['CORE_ACCESS', 'CORE_INITIALISE', 'MATCH_END', 'NEXT_EXECUTION', 'ROUND_END', 'RUN_PROGRESS', 'TASK_COUNT'],
        );
    });
});

test('default export exposes the API functions as methods', () => {
    expect(corewar.parse).toBe(parse);
    expect(corewar.serialise).toBe(serialise);
    expect(corewar.initialiseSimulator).toBe(initialiseSimulator);
    for (const name of ['step', 'run', 'getWithInfoAt', 'republish', 'runMatch'] as const) {
        expect(typeof corewar[name]).toBe('function');
    }
});

test('the engine never imports the UI library', async () => {
    const offenders: string[] = [];
    for await (const file of new Bun.Glob('**/*.ts').scan({ cwd: import.meta.dir })) {
        const text = await Bun.file(`${import.meta.dir}/${file}`).text();
        if (/from\s+['"]@opentui\//.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
});
