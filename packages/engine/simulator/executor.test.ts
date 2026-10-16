import { describe, expect, test } from 'bun:test';
import { MODIFIER_NAMES, toPublicInstruction } from '../instruction.ts';
import type { ISimulatorOptions } from '../types.ts';
import { Simulator } from './simulator.ts';
import { cell, ins, warrior } from './testing.ts';

const MODIFIERS = MODIFIER_NAMES as readonly string[];

/** Load one warrior at address 0, execute `steps` instructions, and expose the result. */
function exec(lines: string[], opts: { start?: number; steps?: number; options?: ISimulatorOptions } = {}) {
    const sim = new Simulator();
    sim.initialise({ seed: 1, ...opts.options }, [warrior(lines, { start: opts.start ?? 0 })]);
    const running = sim.step(opts.steps ?? 1);
    const view = sim.getProcessView()[0]!;
    return { sim, running, cell: (a: number) => cell(sim, a), ips: view.instructionPointers, alive: view.alive };
}

describe('DAT', () => {
    test.each(MODIFIERS)('DAT.%s kills the process', (m) => {
        const r = exec([`DAT.${m} $0, $0`]);
        expect(r.alive).toBe(false);
        expect(r.running).toBe(false);
        expect(r.sim.result).toEqual({ winnerId: null, outcome: 'NONE' });
    });

    test('evaluates its operands before dying: DAT.F 1, <1 decrements the next B number', () => {
        const r = exec(['DAT.F $1, <1', 'DAT.F $1, $1']);
        expect(r.cell(1)).toBe('DAT.F $1, $0');
    });
});

describe('MOV', () => {
    test.each([
        ['A', 'DAT.F $11, $22'],
        ['B', 'DAT.F $21, $12'],
        ['AB', 'DAT.F $21, $11'],
        ['BA', 'DAT.F $12, $22'],
        ['F', 'DAT.F $11, $12'],
        ['X', 'DAT.F $12, $11'],
        ['I', 'DAT.F #11, #12'],
    ])('MOV.%s writes %s', (m, expected) => {
        const r = exec([`MOV.${m} $1, $2`, 'DAT.F #11, #12', 'DAT.F $21, $22']);
        expect(r.cell(2)).toBe(expected);
        expect(r.cell(1)).toBe('DAT.F #11, #12');
        expect(r.ips).toEqual([1]);
    });
});

describe('ADD, SUB, MUL', () => {
    // Source DAT.F #3, #5; destination DAT.F $7, $11.
    test.each([
        ['ADD', 'A', '$10, $11'], ['ADD', 'B', '$7, $16'], ['ADD', 'AB', '$7, $14'], ['ADD', 'BA', '$12, $11'],
        ['ADD', 'F', '$10, $16'], ['ADD', 'X', '$12, $14'], ['ADD', 'I', '$10, $16'],
        ['SUB', 'A', '$4, $11'], ['SUB', 'B', '$7, $6'], ['SUB', 'AB', '$7, $8'], ['SUB', 'BA', '$2, $11'],
        ['SUB', 'F', '$4, $6'], ['SUB', 'X', '$2, $8'], ['SUB', 'I', '$4, $6'],
        ['MUL', 'A', '$21, $11'], ['MUL', 'B', '$7, $55'], ['MUL', 'AB', '$7, $33'], ['MUL', 'BA', '$35, $11'],
        ['MUL', 'F', '$21, $55'], ['MUL', 'X', '$35, $33'], ['MUL', 'I', '$21, $55'],
    ])('%s.%s gives DAT.F %s', (op, m, expected) => {
        const r = exec([`${op}.${m} $1, $2`, 'DAT.F #3, #5', 'DAT.F $7, $11']);
        expect(r.cell(2)).toBe(`DAT.F ${expected}`);
        expect(r.ips).toEqual([1]);
    });

    test.each([
        ['ADD.AB #7999, $1', 'DAT.F $0, $2', 'DAT.F $0, $1'],
        ['SUB.AB #3, $1', 'DAT.F $0, $1', 'DAT.F $0, $-2'],
        ['MUL.AB #-1, $1', 'DAT.F $0, $-1', 'DAT.F $0, $1'],
    ])('%s wraps modulo coresize', (code, before, after) => {
        const r = exec([code, before]);
        expect(r.cell(1)).toBe(after);
        expect(r.sim.getWithInfoAt(1).instruction.bOperand.address).toBeGreaterThanOrEqual(0);
    });
});

describe('DIV, MOD', () => {
    // Source DAT.F #2, #4; destination DAT.F $7, $13.
    test.each([
        ['DIV', 'A', '$3, $13'], ['DIV', 'B', '$7, $3'], ['DIV', 'AB', '$7, $6'], ['DIV', 'BA', '$1, $13'],
        ['DIV', 'F', '$3, $3'], ['DIV', 'X', '$1, $6'], ['DIV', 'I', '$3, $3'],
        ['MOD', 'A', '$1, $13'], ['MOD', 'B', '$7, $1'], ['MOD', 'AB', '$7, $1'], ['MOD', 'BA', '$3, $13'],
        ['MOD', 'F', '$1, $1'], ['MOD', 'X', '$3, $1'], ['MOD', 'I', '$1, $1'],
    ])('%s.%s gives DAT.F %s', (op, m, expected) => {
        const r = exec([`${op}.${m} $1, $2`, 'DAT.F #2, #4', 'DAT.F $7, $13']);
        expect(r.cell(2)).toBe(`DAT.F ${expected}`);
        expect(r.alive).toBe(true);
    });

    // Source DAT.F #0, #4: the A-number divisor is zero.
    test.each([
        ['DIV', 'A', '$7, $13', false], ['DIV', 'B', '$7, $3', true], ['DIV', 'AB', '$7, $13', false],
        ['DIV', 'BA', '$1, $13', true], ['DIV', 'F', '$7, $3', false], ['DIV', 'X', '$1, $13', false],
        ['DIV', 'I', '$7, $3', false],
        ['MOD', 'A', '$7, $13', false], ['MOD', 'B', '$7, $1', true], ['MOD', 'AB', '$7, $13', false],
        ['MOD', 'BA', '$3, $13', true], ['MOD', 'F', '$7, $1', false], ['MOD', 'X', '$3, $13', false],
        ['MOD', 'I', '$7, $1', false],
    ])('%s.%s with a zero A divisor gives DAT.F %s (process alive: %p)', (op, m, expected, alive) => {
        const r = exec([`${op}.${m} $1, $2`, 'DAT.F #0, #4', 'DAT.F $7, $13']);
        expect(r.cell(2)).toBe(`DAT.F ${expected}`);
        expect(r.alive).toBe(alive);
    });

    test('two zero divisors write nothing and kill the process', () => {
        const r = exec(['DIV.F $1, $2', 'DAT.F #0, #0', 'DAT.F $7, $13']);
        expect(r.cell(2)).toBe('DAT.F $7, $13');
        expect(r.alive).toBe(false);
    });

    test('division by zero still applies operand side effects first', () => {
        const r = exec(['DIV.AB #0, <1', 'DAT.F $0, $2']);
        expect(r.cell(1)).toBe('DAT.F $0, $1');
        expect(r.alive).toBe(false);
    });
});

describe('JMP', () => {
    test.each(MODIFIERS)('JMP.%s jumps to the A pointer', (m) => {
        expect(exec([`JMP.${m} $2, $0`]).ips).toEqual([2]);
    });

    test('still evaluates its B operand: JMP 0, <1 decrements the next B number', () => {
        const r = exec(['JMP.B $0, <1', 'DAT.F $0, $5']);
        expect(r.cell(1)).toBe('DAT.F $0, $4');
        expect(r.ips).toEqual([0]);
    });
});

// Fields of the destination that JMZ / JMN / DJN select (redcode.md 4.9).
const SELECTED: Record<string, 'a' | 'b' | 'ab'> = { A: 'a', BA: 'a', B: 'b', AB: 'b', F: 'ab', X: 'ab', I: 'ab' };
const FIELD_CASES = [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
] as const;

describe('JMZ, JMN', () => {
    const cases = MODIFIERS.flatMap((m) => FIELD_CASES.map(([a, b]) => [m, a, b] as const));

    test.each(cases)('JMZ.%s on DAT.F $%i, $%i', (m, a, b) => {
        const fields = SELECTED[m]!;
        const zero = (!fields.includes('a') || a === 0) && (!fields.includes('b') || b === 0);
        expect(exec([`JMZ.${m} $3, $1`, `DAT.F $${a}, $${b}`]).ips).toEqual([zero ? 3 : 1]);
    });

    test.each(cases)('JMN.%s on DAT.F $%i, $%i', (m, a, b) => {
        const fields = SELECTED[m]!;
        const nonZero = (fields.includes('a') && a !== 0) || (fields.includes('b') && b !== 0);
        expect(exec([`JMN.${m} $3, $1`, `DAT.F $${a}, $${b}`]).ips).toEqual([nonZero ? 3 : 1]);
    });

    test('documented JMZ.F cases: only dat 0, 0 jumps', () => {
        const jumps = FIELD_CASES.map(([a, b]) => exec(['JMZ.F $3, $1', `DAT.F $${a}, $${b}`]).ips[0] === 3);
        expect(jumps).toEqual([true, false, false, false]);
    });

    test('JMN.F jumps when either field is non-zero (ICWS\'94, overriding the docs table)', () => {
        const jumps = FIELD_CASES.map(([a, b]) => exec(['JMN.F $3, $1', `DAT.F $${a}, $${b}`]).ips[0] === 3);
        expect(jumps).toEqual([false, true, true, true]);
    });
});

describe('DJN', () => {
    test.each([
        ['A', 'DAT.F $0, $2', 1], ['BA', 'DAT.F $0, $2', 1],
        ['B', 'DAT.F $1, $1', 3], ['AB', 'DAT.F $1, $1', 3],
        ['F', 'DAT.F $0, $1', 3], ['X', 'DAT.F $0, $1', 3], ['I', 'DAT.F $0, $1', 3],
    ])('DJN.%s on DAT.F $1, $2 leaves %s and continues at %i', (m, after, ip) => {
        const r = exec([`DJN.${m} $3, $1`, 'DAT.F $1, $2']);
        expect(r.cell(1)).toBe(after);
        expect(r.ips).toEqual([ip]);
    });

    test.each([
        ['DJN.B', 'DAT.F $0, $1', 'DAT.F $0, $0', 1],
        ['DJN.B', 'DAT.F $0, $2', 'DAT.F $0, $1', 3],
        ['DJN.F', 'DAT.F $1, $1', 'DAT.F $0, $0', 1],
        ['DJN.F', 'DAT.F $0, $0', 'DAT.F $-1, $-1', 3],
    ])('documented case: %s on %s becomes %s and continues at %i', (op, before, after, ip) => {
        const r = exec([`${op} $3, $1`, before]);
        expect(r.cell(1)).toBe(after);
        expect(r.ips).toEqual([ip]);
    });

    test('tests the decremented Destination Register, not core', () => {
        // The B post-increment lands on the destination after its register copy:
        // core goes 0 -> 1 -> 0 (no jump if core were tested), the register 0 -> -1, so it jumps.
        const r = exec(['DJN.B $3, >1', 'DAT.F $0, $0']);
        expect(r.cell(1)).toBe('DAT.F $0, $0');
        expect(r.ips).toEqual([3]);
    });
});

describe('SEQ, SNE, CMP', () => {
    // Source DAT.F $1, $2 at +1, destination at +2.
    const cases: [string, string, string][] = [
        ['A', 'DAT.F $1, $9', 'DAT.F $9, $2'],
        ['B', 'DAT.F $9, $2', 'DAT.F $1, $9'],
        ['AB', 'DAT.F $9, $1', 'DAT.F $1, $9'],
        ['BA', 'DAT.F $2, $9', 'DAT.F $9, $2'],
        ['F', 'DAT.F $1, $2', 'DAT.F $1, $9'],
        ['X', 'DAT.F $2, $1', 'DAT.F $1, $2'],
        ['I', 'DAT.F $1, $2', 'DAT.F $1, #2'],
    ];
    const ipAfter = (op: string, m: string, dest: string) => exec([`${op}.${m} $1, $2`, 'DAT.F $1, $2', dest]).ips[0];

    test.each(cases)('%s: SEQ and CMP skip on %s, not on %s; SNE is the negation', (m, equal, unequal) => {
        for (const op of ['SEQ', 'CMP']) {
            expect(ipAfter(op, m, equal)).toBe(2);
            expect(ipAfter(op, m, unequal)).toBe(1);
        }
        expect(ipAfter('SNE', m, equal)).toBe(1);
        expect(ipAfter('SNE', m, unequal)).toBe(2);
    });

    test.each(['DAT.A $1, $2', 'NOP.F $1, $2', 'DAT.F #1, $2', 'DAT.F $1, @2'])(
        'SEQ.I does not skip when only the opcode, modifier or a mode differs (%s)',
        (dest) => {
            expect(ipAfter('SEQ', 'I', dest)).toBe(1);
            expect(ipAfter('SNE', 'I', dest)).toBe(2);
        },
    );

    test('CMP is stored as SEQ, so SEQ.I treats CMP and SEQ instructions as equal', () => {
        const r = exec(['SEQ.I $1, $2', 'CMP.A $0, $0', 'SEQ.A $0, $0']);
        expect(r.cell(1)).toBe('SEQ.A $0, $0');
        expect(r.ips).toEqual([2]);
    });
});

describe('SLT', () => {
    // Source DAT.F $3, $5 at +1.
    test.each([
        ['A', 'DAT.F $4, $0', 'DAT.F $3, $9'],
        ['B', 'DAT.F $0, $6', 'DAT.F $9, $5'],
        ['AB', 'DAT.F $0, $4', 'DAT.F $9, $3'],
        ['BA', 'DAT.F $6, $0', 'DAT.F $5, $9'],
        ['F', 'DAT.F $4, $6', 'DAT.F $4, $5'],
        ['X', 'DAT.F $6, $4', 'DAT.F $6, $3'],
        ['I', 'DAT.F $4, $6', 'DAT.F $2, $6'],
    ])('SLT.%s skips on %s but not on %s', (m, less, notLess) => {
        expect(exec([`SLT.${m} $1, $2`, 'DAT.F $3, $5', less]).ips).toEqual([2]);
        expect(exec([`SLT.${m} $1, $2`, 'DAT.F $3, $5', notLess]).ips).toEqual([1]);
    });

    test('compares normalised unsigned values: -1 is coresize - 1', () => {
        expect(exec(['SLT.AB #-1, $1', 'DAT.F $0, $5']).ips).toEqual([1]);
        expect(exec(['SLT.AB #5, $1', 'DAT.F $0, $-1']).ips).toEqual([2]);
    });
});

describe('SPL', () => {
    test.each(MODIFIERS)('SPL.%s queues IP+1, then the new process at the A pointer', (m) => {
        const r = exec([`SPL.${m} $2, $0`]);
        expect(r.ips).toEqual([1, 2]);
    });

    test('documented order: a: spl c / b: jmp 0 / c: jmp 0 executes a, b, c', () => {
        const sim = new Simulator();
        sim.initialise({ seed: 1 }, [warrior(['SPL.B $2, $0', 'JMP.B $0, $0', 'JMP.B $0, $0'])]);
        const executed: number[] = [];
        for (let i = 0; i < 3; i++) {
            sim.step();
            executed.push(sim.getCoreView().lastExecuted);
        }
        expect(executed).toEqual([0, 1, 2]);
    });

    test('at maxTasks SPL creates no process and continues at IP+1', () => {
        const r = exec(['SPL.B $0, $0'], { options: { maxTasks: 1 } });
        expect(r.ips).toEqual([1]);
    });

    test('the queue never exceeds maxTasks', () => {
        const r = exec(['SPL.B $0, $0', 'JMP.B $-1, $0'], { steps: 50, options: { maxTasks: 3 } });
        expect(r.ips.length).toBe(3);
    });
});

describe('NOP', () => {
    test.each(MODIFIERS)('NOP.%s continues at IP+1', (m) => {
        expect(exec([`NOP.${m} $5, $5`]).ips).toEqual([1]);
    });

    test('evaluates its operands', () => {
        const r = exec(['NOP.F }1, <2', 'DAT.F $0, $0', 'DAT.F $0, $0']);
        expect(r.cell(1)).toBe('DAT.F $1, $0');
        expect(r.cell(2)).toBe('DAT.F $0, $-1');
    });
});

describe('addressing modes', () => {
    test('# resolves to the executing instruction: MOV.I #123, $1 behaves like an imp', () => {
        const r = exec(['MOV.I #123, $1'], { steps: 3 });
        expect([r.cell(1), r.cell(2), r.cell(3)]).toEqual(Array(3).fill('MOV.I #123, $1'));
        expect(r.ips).toEqual([3]);
    });

    test('$ is relative to the executing instruction: MOV.I $0, $1 is an imp', () => {
        const r = exec(['MOV.I $0, $1'], { steps: 2 });
        expect(r.cell(2)).toBe('MOV.I $0, $1');
        expect(r.ips).toEqual([2]);
    });

    test('* uses the intermediate A number, relative to the intermediate (documented example)', () => {
        const r = exec(['MOV.I *1, $2', 'DAT.F $2, $0', 'DAT.F $0, $0', 'JMP.B $0, $0']);
        expect(r.cell(2)).toBe('JMP.B $0, $0');
    });

    test('@ uses the intermediate B number', () => {
        const r = exec(['MOV.I @1, $2', 'DAT.F $0, $2', 'DAT.F $0, $0', 'JMP.B $0, $0']);
        expect(r.cell(2)).toBe('JMP.B $0, $0');
    });

    test('{ decrements the intermediate A number before use (documented example)', () => {
        const r = exec(['MOV.I {1, $2', 'DAT.F $0, $0', 'NOP.F $0, $0']);
        expect(r.cell(1)).toBe('DAT.F $-1, $0');
        expect(r.cell(2)).toBe('MOV.I {1, $2');
    });

    test('< decrements the intermediate B number before use', () => {
        const r = exec(['MOV.I <1, $2', 'DAT.F $0, $0', 'NOP.F $0, $0']);
        expect(r.cell(1)).toBe('DAT.F $0, $-1');
        expect(r.cell(2)).toBe('MOV.I <1, $2');
    });

    test('} uses then increments the intermediate A number; the documented example leaves core unchanged', () => {
        const r = exec(['MOV.I }1, $1', 'DAT.F $0, $0']);
        expect([r.cell(0), r.cell(1)]).toEqual(['MOV.I }1, $1', 'DAT.F $0, $0']);
    });

    test('} copies the Source Register before the increment', () => {
        const r = exec(['MOV.I }1, $2', 'DAT.F $0, $0', 'NOP.F $0, $0']);
        expect(r.cell(1)).toBe('DAT.F $1, $0');
        expect(r.cell(2)).toBe('DAT.F $0, $0');
    });

    test('> uses then increments the intermediate B number', () => {
        const r = exec(['MOV.I >1, $2', 'DAT.F $0, $0', 'NOP.F $0, $0']);
        expect(r.cell(1)).toBe('DAT.F $0, $1');
        expect(r.cell(2)).toBe('DAT.F $0, $0');
    });

    test.each([
        ['*1', 'DAT.F $3, $0', 'DAT.F $3, $0'],
        ['@1', 'DAT.F $0, $3', 'DAT.F $0, $3'],
        ['{1', 'DAT.F $4, $0', 'DAT.F $3, $0'],
        ['<1', 'DAT.F $0, $4', 'DAT.F $0, $3'],
        ['}1', 'DAT.F $3, $0', 'DAT.F $4, $0'],
        ['>1', 'DAT.F $0, $3', 'DAT.F $0, $4'],
    ])('B operand %s with intermediate %s writes to +4 and leaves %s', (operand, before, after) => {
        const r = exec([`MOV.I $0, ${operand}`, before, 'NOP.F $0, $0', 'NOP.F $0, $0', 'NOP.F $0, $0']);
        expect(r.cell(4)).toBe(`MOV.I $0, ${operand}`);
        expect(r.cell(1)).toBe(after);
    });

    test('A side effects are applied to core before the B operand is evaluated', () => {
        // A: >1 reads pointer 1 (-> +2), then bumps it to 2. B: @1 then sees 2 (-> +3).
        const r = exec(['MOV.I >1, @1', 'DAT.F $0, $1', 'NOP.F $7, $7', 'DAT.F $0, $0']);
        expect(r.cell(3)).toBe('NOP.F $7, $7');
        expect(r.cell(1)).toBe('DAT.F $0, $2');
    });

    test('both operands pre-decrementing one cell see each other\'s decrement', () => {
        const r = exec(['MOV.I <1, <1', 'DAT.F $0, $3', 'NOP.F $0, $0', 'NOP.F $9, $9']);
        expect(r.cell(1)).toBe('DAT.F $0, $1');
        expect(r.cell(2)).toBe('NOP.F $9, $9');
    });

    test('operand numbers come from the instruction register, not core (guide.md 7.6 divergence)', () => {
        // The docs' trace ends with 0: mov.i >0, $1 / 1: mov.i >0, $0, the imp-like result.
        // Under ICWS'94 the B operand $0 uses the register copy, so address 0 is overwritten
        // with the pre-increment source copy and address 1 is untouched: the process then dies.
        const r = exec(['MOV.I >0, $0', 'DAT.F $0, $0']);
        expect([r.cell(0), r.cell(1)]).toEqual(['MOV.I >0, $0', 'DAT.F $0, $0']);
        expect(r.ips).toEqual([1]);
        expect(r.sim.step()).toBe(false);
        expect(r.sim.result!.outcome).toBe('NONE');
    });

    test('arithmetic reads the Destination Register: a later B post-increment on the destination is lost', () => {
        const r = exec(['ADD.AB #5, >1', 'DAT.F $0, $0']);
        expect(r.cell(1)).toBe('DAT.F $0, $5');
    });

    test('increments and decrements wrap: 0 - 1 = coresize - 1 and coresize - 1 + 1 = 0', () => {
        const r = exec(['NOP.F <1, >2', 'DAT.F $0, $0', 'DAT.F $0, $-1']);
        expect(r.sim.getWithInfoAt(1).instruction.bOperand.address).toBe(7999);
        expect(r.sim.getWithInfoAt(2).instruction.bOperand.address).toBe(0);
    });
});

describe('core wraparound', () => {
    test('40 + 41 = 1 in a core of 80', () => {
        const r = exec(['ADD.AB #40, $1', 'DAT.F $0, $41'], { options: { coresize: 80, minSeparation: 1 } });
        expect(r.sim.getWithInfoAt(1).instruction.bOperand.address).toBe(1);
    });

    test('addresses wrap past the end of core in both directions', () => {
        const options = { coresize: 10, minSeparation: 1, instructionLimit: 5 };
        const back = exec(['MOV.I $0, $-1', 'JMP.B $-2, $0'], { options, steps: 2 });
        expect(back.cell(9)).toBe('MOV.I $0, $-1');
        expect(back.cell(-1)).toBe('MOV.I $0, $-1');
        expect(back.ips).toEqual([9]);
        const forward = exec(['JMP.B $9, $0'], { options });
        expect(forward.ips).toEqual([9]);
        // Pointer 1 + 9 wraps to address 0, so the MOV copies itself.
        const indirect = exec(['MOV.I @1, $2', 'DAT.F $0, $9', 'DAT.F $0, $0'], { options });
        expect(indirect.cell(2)).toBe('MOV.I @1, $2');
    });
});

describe('read and write limits (guide.md 9.2 fold)', () => {
    const options: ISimulatorOptions = {
        coresize: 80,
        minSeparation: 8,
        instructionLimit: 8,
        initialInstruction: toPublicInstruction(ins('NOP.F $7, $7'), 0),
    };
    const program = ['MOV.I $5, $1', 'DAT.F $0, $0', 'DAT.F $0, $0', 'DAT.F $0, $0', 'DAT.F $0, $0', 'DAT.F $5, $5'];

    test('defaults (limit = coresize) have no effect', () => {
        expect(exec(program, { options }).cell(1)).toBe('DAT.F $5, $5');
        expect(exec(['MOV.I $0, $30'], { options }).cell(30)).toBe('MOV.I $0, $30');
    });

    test('reads beyond half the read limit fold back: offset 5 with limit 8 reads at -3', () => {
        expect(exec(program, { options: { ...options, readDistance: 8 } }).cell(1)).toBe('NOP.F $7, $7');
        expect(exec(['MOV.I $8, $1'], { options: { ...options, readDistance: 8 } }).cell(1)).toBe('MOV.I $8, $1');
    });

    test('writes fold with the write limit: offset 5 with limit 8 writes at -3', () => {
        const r = exec(['MOV.I $0, $5'], { options: { ...options, writeDistance: 8 } });
        expect(r.cell(-3)).toBe('MOV.I $0, $5');
        expect(r.cell(5)).toBe('NOP.F $7, $7');
    });

    test('indirect pointers fold too, and pre-decrements use the write pointer', () => {
        const r = exec(['MOV.I <1, $2', 'DAT.F $0, $7', 'DAT.F $0, $0'], { options: { ...options, readDistance: 8 } });
        // Pointer 1 + (7 - 1) = 7 folds to -1.
        expect(r.cell(1)).toBe('DAT.F $0, $6');
        expect(r.cell(2)).toBe('NOP.F $7, $7');
    });

    test('jumps go to the folded read pointer', () => {
        expect(exec(['JMP.B $5, $0'], { options: { ...options, readDistance: 8 } }).ips).toEqual([77]);
    });

    test('limits that do not divide coresize are rejected', () => {
        expect(() => exec(['DAT.F $0, $0'], { options: { ...options, readDistance: 7 } })).toThrow('must divide coresize');
    });
});
