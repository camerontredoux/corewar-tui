/**
 * P-space (spec/pspace.md): the PSpace store, LDP/STP in the executor, the
 * result cell between rounds and PIN sharing. Expected values were confirmed
 * against pMARS 0.9.5 (the setups mirror those experiments).
 */

import { describe, expect, test } from 'bun:test';
import { MODIFIER_NAMES } from '../instruction.ts';
import type { IParseResult, ISimulatorOptions } from '../types.ts';
import { PSpace } from './pspace.ts';
import { Simulator } from './simulator.ts';
import { cell, warrior } from './testing.ts';

const LOOP = ['JMP.B $0, $0'];
const DIE = ['DAT.F $0, $0'];

/** Runs `steps` executions of the warriors (warrior i at address 1000 * i). */
function run(warriors: IParseResult[], steps: number, options: ISimulatorOptions = {}, pspace: PSpace | null = null): Simulator {
    const sim = new Simulator();
    sim.initialise({ seed: 1, loadAddresses: warriors.map((_, i) => 1000 * i), ...options }, warriors, null, pspace);
    sim.step(steps);
    return sim;
}

/** Plays rounds until each ends, carrying the P-space; returns the simulator of the last round. */
function rounds(warriors: IParseResult[], count: number, options: ISimulatorOptions = {}): Simulator {
    let pspace: PSpace | null = null;
    let sim!: Simulator;
    for (let r = 0; r < count; r++) {
        sim = new Simulator();
        sim.initialise({ seed: r, maximumCycles: 20, loadAddresses: warriors.map((_, i) => 1000 * i), firstWarrior: r % warriors.length, ...options }, warriors, null, pspace);
        sim.run();
        pspace = sim.getPSpace();
    }
    return sim;
}

const cells = (sim: Simulator, w = 0): number[] => sim.getPSpaceView()[w]!.cells;

describe('PSpace', () => {
    test('starts with -1 (coresize - 1) in cell 0 and 0 elsewhere', () => {
        const p = new PSpace([null, null], 5, 80);
        expect(p.view(0)).toEqual({ warriorId: 0, pin: null, cells: [79, 0, 0, 0, 0] });
        expect(p.view(1).cells).toEqual([79, 0, 0, 0, 0]);
    });

    test('indexes modulo the size', () => {
        const p = new PSpace([null], 7, 200);
        p.store(0, 9, 11);
        expect(p.load(0, 2)).toBe(11);
        expect(p.load(0, 16)).toBe(11);
        p.store(0, 14, 5);
        expect(p.load(0, 0)).toBe(5);
    });

    test('recordRound: 0 for the dead, the number of survivors for the living', () => {
        const p = new PSpace([null, null, null], 4, 80);
        p.recordRound([true, false, true]);
        expect([0, 1, 2].map((w) => p.load(w, 0))).toEqual([2, 0, 2]);
        p.recordRound([false, true, false]);
        expect([0, 1, 2].map((w) => p.load(w, 0))).toEqual([0, 1, 0]);
    });

    test('the same PIN shares every cell but cell 0; other PINs and no PIN are private', () => {
        const p = new PSpace([5, 5, 6, null, null], 4, 80);
        p.store(0, 1, 11);
        p.store(0, 0, 22);
        expect(p.view(1).cells).toEqual([79, 11, 0, 0]);
        for (const w of [2, 3, 4]) expect(p.view(w).cells).toEqual([79, 0, 0, 0]);
        p.store(3, 2, 33);
        expect(p.view(4).cells).toEqual([79, 0, 0, 0]);
    });

    test('PIN 0 is an ordinary PIN: a warrior without a PIN does not share it (pMARS does, spec/pspace.md)', () => {
        const p = new PSpace([0, null, 0], 4, 80);
        p.store(0, 3, 9);
        expect(p.load(1, 3)).toBe(0);
        expect(p.load(2, 3)).toBe(9);
    });

    test('PINs are compared exactly, not folded into the core', () => {
        const p = new PSpace([5, 85, -75], 4, 80);
        p.store(0, 1, 1);
        expect(p.load(1, 1)).toBe(0);
        expect(p.load(2, 1)).toBe(0);
    });

    test('clone copies contents and sharing, independently of the original', () => {
        const p = new PSpace([1, 1, null], 4, 80);
        p.store(0, 2, 7);
        p.store(2, 0, 3);
        const copy = p.clone();
        expect(copy.view(1).cells).toEqual([79, 0, 7, 0]);
        expect(copy.view(2).cells).toEqual([3, 0, 0, 0]);
        copy.store(1, 3, 9);
        expect(copy.load(0, 3)).toBe(9);
        expect(p.load(0, 3)).toBe(0);
    });

    test('rejects sizes below 1', () => {
        expect(() => new PSpace([null], 0, 80)).toThrow();
    });
});

describe('LDP', () => {
    // P-space cell 3 holds 103 and cell 5 holds 105; the source is DAT.F $3, $5 and the target DAT.F $1111, $2222.
    test.each([
        ['A', 'DAT.F $103, $2222'],
        ['B', 'DAT.F $1111, $105'],
        ['AB', 'DAT.F $1111, $103'],
        ['BA', 'DAT.F $105, $2222'],
        ['F', 'DAT.F $1111, $105'],
        ['X', 'DAT.F $1111, $105'],
        ['I', 'DAT.F $1111, $105'],
    ])('LDP.%s writes %s', (m, expected) => {
        const sim = run([warrior(['STP.AB #103, #3', 'STP.AB #105, #5', `LDP.${m} $2, $3`, 'JMP.B $0, $0', 'DAT.F $3, $5', 'DAT.F $1111, $2222'])], 3);
        expect(cell(sim, 5)).toBe(expected);
        expect(cell(sim, 4)).toBe('DAT.F $3, $5');
        expect(sim.getProcessView()[0]!.instructionPointers).toEqual([3]);
    });

    test('before any round has ended, cell 0 reads -1 and the rest 0', () => {
        const lines = ['LDP.AB #0, $5', 'LDP.AB #1, $5', 'LDP.AB #2, $5', 'LDP.AB #499, $5', 'JMP.B $0, $0', ...Array<string>(4).fill('DAT.F $0, $9')];
        const sim = run([warrior(lines)], 4);
        expect([5, 6, 7, 8].map((a) => cell(sim, a))).toEqual(['DAT.F $0, $-1', 'DAT.F $0, $0', 'DAT.F $0, $0', 'DAT.F $0, $0']);
        expect(cell(sim, 4)).toBe('JMP.B $0, $0');
    });

    test('an immediate B operand loads into the LDP itself', () => {
        const sim = run([warrior(['STP.AB #9, #1', 'LDP.AB #1, #0'])], 2);
        expect(cell(sim, 1)).toBe('LDP.AB #1, #9');
    });

    // P-space cells 1..7 hold 101..107. Cell 9 is DAT.F $2, $3, cells 10, 11 and 12 have B 0, 4 and 5
    // ({2 reaches cell 10, so it loads cell 0: -1).
    test.each([
        ['LDP.AB #2, $6', 102],
        ['LDP.B $2, $6', 103],
        ['LDP.B @2, $6', 105],
        ['LDP.B *2, $6', 104],
        ['LDP.B <2, $6', 104],
        ['LDP.B >2, $6', 105],
        ['LDP.B {2, $6', -1],
        ['LDP.B }2, $6', 104],
    ])('%s loads %i', (line, value) => {
        const store = Array.from({ length: 7 }, (_, k) => `STP.AB #${101 + k}, #${k + 1}`);
        const data = ['DAT.F $2, $3', 'DAT.F $0, $0', 'DAT.F $0, $4', 'DAT.F $0, $5', 'DAT.F $0, $0'];
        const sim = run([warrior([...store, line, 'JMP.B $0, $0', ...data])], 8);
        expect(cells(sim).slice(1, 8)).toEqual([101, 102, 103, 104, 105, 106, 107]);
        expect(cell(sim, 13)).toBe(`DAT.F $0, $${value}`);
    });

    test('the target is reached through the B operand like a MOV destination', () => {
        const sim = run([warrior(['STP.AB #42, #1', 'LDP.AB #1, @2', 'JMP.B $0, $0', 'DAT.F $0, $2', 'DAT.F $0, $0', 'DAT.F $0, $0'])], 2);
        expect(cell(sim, 5)).toBe('DAT.F $0, $42');
        expect(cell(sim, 3)).toBe('DAT.F $0, $2');
    });
});

describe('STP', () => {
    // Source DAT.F $201, $202, index operand DAT.F $6, $7, P-space size 10.
    test.each([
        ['A', 6, 201],
        ['B', 7, 202],
        ['AB', 7, 201],
        ['BA', 6, 202],
        ['F', 7, 202],
        ['X', 7, 202],
        ['I', 7, 202],
    ])('STP.%s stores into cell %i the value %i', (m, index, value) => {
        const sim = run([warrior([`STP.${m} $2, $3`, 'JMP.B $0, $0', 'DAT.F $201, $202', 'DAT.F $6, $7'])], 1, { pSpaceSize: 10 });
        const expected = [7999, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        expected[index] = value;
        expect(cells(sim)).toEqual(expected);
    });

    test('every modifier is accepted with every addressing mode', () => {
        for (const m of MODIFIER_NAMES) {
            for (const a of ['#', '$', '@', '*', '{', '}', '<', '>']) {
                for (const b of ['#', '$', '@', '*', '{', '}', '<', '>']) {
                    const sim = run([warrior([`STP.${m} ${a}1, ${b}2`, 'DAT.F $3, $4', 'DAT.F $5, $6'])], 1, { pSpaceSize: 10 });
                    expect(sim.getProcessView()[0]!.instructionPointers).toEqual([1]);
                    expect(cells(sim).filter((v) => v !== 0).length).toBeLessThanOrEqual(2);
                }
            }
        }
    });

    test('indices are folded into the core, then taken modulo the P-space size', () => {
        const lines = ['STP.AB #-1, #13', 'STP.AB #5, #-1', 'STP.AB #6, #10', 'LDP.AB #-4, $2', 'JMP.B $0, $0', 'DAT.F $0, $9'];
        const ten = run([warrior(lines)], 4, { pSpaceSize: 10 });
        expect(cells(ten)).toEqual([6, 0, 0, 7999, 0, 0, 0, 0, 0, 5]);
        expect(cell(ten, 5)).toBe('DAT.F $0, $0');
        const seven = run([warrior(lines)], 4, { pSpaceSize: 7 });
        expect(cells(seven)).toEqual([7999, 0, 0, 6, 0, 5, 7999]);
    });

    test('values are normalised like core fields', () => {
        const sim = run([warrior(['STP.AB #-3, #1', 'STP.AB #8005, #2'])], 2, { pSpaceSize: 4 });
        expect(cells(sim)).toEqual([7999, 7997, 5, 0]);
    });

    test('a store to cell 0 is read back until the round ends', () => {
        const sim = run([warrior(['STP.AB #77, #0', 'LDP.AB #0, $2', 'JMP.B $0, $0', 'DAT.F $0, $0'])], 2);
        expect(cell(sim, 3)).toBe('DAT.F $0, $77');
        expect(cells(sim)[0]).toBe(77);
    });
});

describe('the result cell between rounds', () => {
    test('a draw leaves the number of survivors; a store to cell 0 is overwritten', () => {
        const sim = rounds([warrior(['STP.AB #77, #0', 'STP.AB #55, #3', 'JMP.B $0, $0']), warrior(LOOP)], 2);
        expect(cells(sim, 0).slice(0, 4)).toEqual([2, 0, 0, 55]);
        expect(cells(sim, 1).slice(0, 4)).toEqual([2, 0, 0, 0]);
    });

    test('the winner gets 1 and the loser 0', () => {
        const sim = rounds([warrior(LOOP), warrior(DIE)], 2);
        expect(cells(sim, 0)[0]).toBe(1);
        expect(cells(sim, 1)[0]).toBe(0);
    });

    test('a lone warrior gets 1 if it survives, 0 if it dies', () => {
        expect(cells(rounds([warrior(LOOP)], 2))[0]).toBe(1);
        expect(cells(rounds([warrior(DIE)], 2))[0]).toBe(0);
    });

    test('with three warriors, the dead get 0 and each survivor the number of survivors', () => {
        const sim = rounds([warrior(LOOP), warrior(DIE), warrior(LOOP)], 2);
        expect(sim.getPSpaceView().map((v) => v.cells[0])).toEqual([2, 0, 2]);
    });

    test('a round that has not ended leaves the previous result', () => {
        const first = rounds([warrior(LOOP), warrior(DIE)], 1);
        const sim = run([warrior(LOOP), warrior(DIE)], 1, {}, first.getPSpace());
        expect(sim.isRunning).toBe(true);
        expect(cells(sim, 1)[0]).toBe(0);
        expect(cells(sim, 0)[0]).toBe(1);
    });

    test('the result is folded into the core', () => {
        const sim = rounds([warrior(LOOP)], 1, { coresize: 80, pSpaceSize: 5, minSeparation: 1, loadAddresses: [0] });
        expect(cells(sim)).toEqual([1, 0, 0, 0, 0]);
    });
});

describe('PIN in the simulator', () => {
    test('warriors with the same PIN see each other’s stores, except cell 0', () => {
        const writer = warrior(['STP.AB #77, #0', 'STP.AB #55, #3', 'JMP.B $0, $0'], { pin: 5 });
        const reader = warrior(['JMP.B $2, $0', 'DAT.F $0, $0', 'LDP.AB #0, $3', 'LDP.AB #3, $3', 'JMP.B $0, $0', 'DAT.F $0, $0', 'DAT.F $0, $0'], { pin: 5 });
        const sim = run([writer, reader], 6);
        expect(cell(sim, 1005)).toBe('DAT.F $0, $-1');
        expect(cell(sim, 1006)).toBe('DAT.F $0, $55');
        expect(sim.getPSpaceView().map((v) => v.cells.slice(0, 4))).toEqual([[77, 0, 0, 55], [7999, 0, 0, 55]]);
        expect(sim.getPSpaceView().map((v) => v.pin)).toEqual([5, 5]);
    });

    test('different PINs and missing PINs stay private', () => {
        const store = (pin?: number) => warrior(['STP.AB #11, #3', 'JMP.B $0, $0'], pin === undefined ? {} : { pin });
        for (const pins of [[5, 6], [undefined, undefined], [0, undefined], [undefined, 0], [5, 8005]]) {
            const sim = run(pins.map(store), 2);
            expect(sim.getPSpaceView().map((v) => v.cells[3])).toEqual([11, 11]);
            const one = run([store(pins[0]), warrior(LOOP, pins[1] === undefined ? {} : { pin: pins[1] })], 2);
            expect(one.getPSpaceView().map((v) => v.cells[3])).toEqual([11, 0]);
        }
    });

    test('a shared P-space persists across rounds', () => {
        const sim = rounds([warrior(['STP.AB #9, #4', 'JMP.B $0, $0'], { pin: 3 }), warrior(LOOP, { pin: 3 })], 2);
        expect(cells(sim, 1)[4]).toBe(9);
    });
});

describe('Simulator.initialise with a P-space', () => {
    test('rejects a P-space made for other warriors or settings', () => {
        const ws = [warrior(LOOP), warrior(LOOP)];
        const sim = new Simulator();
        expect(() => sim.initialise({}, ws, null, new PSpace([null], 500, 8000))).toThrow(/does not fit/);
        expect(() => sim.initialise({}, ws, null, new PSpace([null, null], 10, 8000))).toThrow(/does not fit/);
        expect(() => sim.initialise({ coresize: 800 }, ws, null, new PSpace([null, null], 50, 8000))).toThrow(/does not fit/);
        expect(() => sim.initialise({}, ws, null, new PSpace([1, null], 500, 8000))).toThrow(/different PINs/);
        expect(() => sim.initialise({}, ws, null, new PSpace([null, null], 500, 8000))).not.toThrow();
    });

    test('without one, every round starts fresh', () => {
        const ws = [warrior(['STP.AB #9, #4', 'JMP.B $0, $0']), warrior(LOOP)];
        expect(cells(run(ws, 2))[4]).toBe(9);
        expect(cells(run(ws, 0)).slice(0, 5)).toEqual([7999, 0, 0, 0, 0]);
    });
});
