/**
 * End-to-end tests: real Redcode through parse(), then the simulator and matches.
 * OWNER: simulator engineer.
 */

import { describe, expect, test } from 'bun:test';
import { MessageTopic, MessageType, Standard, type IParseResult, type ISimulatorOptions } from '../types.ts';
import { PRESETS, parseOptionsFor } from '../options.ts';
import { parse } from '../parser/index.ts';
import { DWARF, IMP, MICE, SAMPLES, SCANNER, SILK, STONE } from '../samples.ts';
import { defaultBenchmark, runBenchmark, runMatch } from '../matches/index.ts';
import { Simulator } from '../simulator/simulator.ts';
import { cell, recorder } from '../simulator/testing.ts';

const p = (source: string, options: ISimulatorOptions = {}) => parse(source, parseOptionsFor(options));

function sim(sources: IParseResult[], options: ISimulatorOptions = {}, provider?: ReturnType<typeof recorder>) {
    const s = new Simulator();
    s.initialise({ seed: 5, ...options }, sources, provider);
    return s;
}

describe('every sample parses and runs', () => {
    test.each(Object.keys(SAMPLES))('%s', (name) => {
        const result = p(SAMPLES[name]!);
        expect(result.messages.filter((m) => m.type === MessageType.Error)).toEqual([]);
        const s = sim([result], { maximumCycles: 2000 });
        expect(() => s.run()).not.toThrow();
    });
});

describe('known behaviour with the parsed samples', () => {
    test('imp alone survives to the cycle limit', () => {
        const s = sim([p(IMP)]);
        expect(s.runRound().outcome).toBe('NONE');
        expect(s.getProcessView()[0]!.alive).toBe(true);
        expect(s.getCoreView().cycle).toBe(80000);
    });

    test('imp vs imp: a tie at maximum cycles', () => {
        expect(sim([p(IMP), p(IMP)]).runRound()).toEqual({ winnerId: null, outcome: 'DRAW' });
    });

    test('dwarf bombs every fourth address', () => {
        const s = sim([p(DWARF)]);
        s.step(3 * 25);
        for (let k = 1; k <= 25; k++) {
            expect(cell(s, 3 + 4 * k)).toBe(`DAT.F #0, #${4 * k}`);
            expect([1, 2, 3].map((d) => cell(s, 3 + 4 * k + d))).not.toContain(`DAT.F #0, #${4 * k}`);
        }
    });

    test('imp vs dwarf over 100 rounds: the imp never wins, most rounds draw', () => {
        const result = runMatch({ rounds: 100, warriors: [{ source: p(IMP) }, { source: p(DWARF) }], seed: 1 });
        const [imp, dwarf] = result.warriors;
        expect(imp!.won).toBe(0);
        expect(dwarf!.won + dwarf!.drawn).toBe(100);
        expect(dwarf!.drawn).toBeGreaterThan(dwarf!.won);
    });

    test('silk boots into 6 processes at paper, with a TASK_COUNT for each change', () => {
        const rec = recorder();
        const s = sim([p(SILK)], {}, rec);
        s.step(6);
        expect(s.getProcessView()[0]!.instructionPointers).toEqual([3, 3, 3, 3, 3, 3]);
        expect(rec.payloads(MessageTopic.TASK_COUNT).map((x) => x[0].taskCount)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    test('mice makes copies of itself; stone and scanner run to the limit alone', () => {
        const mice = sim([p(MICE)], { maximumCycles: 5000 });
        mice.run();
        expect(mice.getProcessView()[0]!.taskCount).toBeGreaterThan(1);
        for (const source of [STONE, SCANNER]) {
            const s = sim([p(source)], { maximumCycles: 5000 });
            expect(s.runRound().outcome).toBe('NONE');
            expect(s.getProcessView()[0]!.alive).toBe(true);
        }
    });

    test('the guide.md 7.6 example parsed from Redcode: ICWS\'94 result, not the docs\' imp-like trace', () => {
        const s = sim([p('mov.i >0, $0\ndat.f $0, $0\n')]);
        s.step();
        expect([cell(s, 0), cell(s, 1)]).toEqual(['MOV.I >0, $0', 'DAT.F $0, $0']);
        expect(s.step()).toBe(false);
    });
});

describe('strategy behaviour (guide.md 12)', () => {
    test('stone starts at start (end start) and decrements B fields while bombing', () => {
        const parsed = p(STONE);
        const s = sim([parsed]);
        expect(s.getProcessView()[0]!.instructionPointers).toEqual([0]);
        s.step(300);
        let decremented = 0;
        for (let a = 5; a < 8000; a++) if (cell(s, a) === 'DAT.F $0, $-1') decremented++;
        expect(decremented).toBeGreaterThan(50);
    });

    test('mice and silk replicate: live processes in many copies far from the original', () => {
        for (const source of [MICE, SILK]) {
            const s = sim([p(source)]);
            s.step(3000);
            const ips = s.getProcessView()[0]!.instructionPointers;
            const far = ips.filter((a) => a >= 100 && a < 7900);
            expect(far.length).toBeGreaterThan(10);
            expect(new Set(far.map((a) => Math.floor(a / 50))).size).toBeGreaterThan(5);
        }
    });

    test('scanner scans every tenth address', () => {
        const s = sim([p(SCANNER)]);
        for (let k = 1; k <= 20; k++) {
            s.step(2); // add, jmz back to scn
            expect(cell(s, 1)).toBe(`JMZ.F $-1, $${5 + 10 * k}`);
            expect(s.getProcessView()[0]!.instructionPointers).toEqual([0]);
        }
    });

    test('scanner falls through to the mov clear on a non-zero field and kills a wide target', () => {
        const target = p('for 10\ndat #1, #1\nrof\nloop jmp loop, #1\nend loop\n');
        const result = runMatch({ rounds: 10, warriors: [{ source: p(SCANNER) }, { source: target }], seed: 1 });
        expect(result.warriors[0]).toMatchObject({ won: 10, lost: 0 });
    });
});

describe('redcode.md items checked end to end', () => {
    test('an ICWS\'88 warrior (no modifiers, END n) parses under ICWS88 and runs', () => {
        const options = { standard: Standard.ICWS88 };
        const parsed = p('bomb  dat #0\ndwarf add #4, bomb\n      mov bomb, @bomb\n      jmp dwarf\n      end dwarf\n', options);
        expect(parsed.messages).toEqual([]);
        const s = sim([parsed], options);
        expect(s.getProcessView()[0]!.instructionPointers).toEqual([1]);
        s.step(30);
        for (let k = 1; k <= 10; k++) expect(cell(s, 4 * k).startsWith('DAT.F')).toBe(true);
        expect(cell(s, 4 * 10)).toMatch(/#40$/);
        expect(s.isRunning).toBe(true);
    });

    test('metadata is in the parse result but not loaded into core', () => {
        const parsed = p(';redcode-94\n;name meta\n;author someone\n;strategy one line\nmov 0, 1\n');
        expect(parsed.metaData).toMatchObject({ name: 'meta', author: 'someone' });
        const s = sim([parsed]);
        expect(s.getProcessView()[0]!.length).toBe(1);
        expect([cell(s, 0), cell(s, 1), cell(s, 7999)]).toEqual(['MOV.I $0, $1', 'DAT.F $0, $0', 'DAT.F $0, $0']);
    });
});

describe('matches and benchmarks with parsed warriors', () => {
    test('a nano-preset match parses and plays under the preset settings', () => {
        const nano = PRESETS.nano;
        const result = runMatch({ rounds: 20, options: nano, warriors: [{ source: p(DWARF, nano) }, { source: p(IMP, nano) }], seed: 2 });
        for (const w of result.warriors) expect(w.won + w.drawn + w.lost).toBe(20);
    });

    test('the default benchmark: six opponents, reproducible with a seed', () => {
        const bench = defaultBenchmark({ ...PRESETS.standard, maximumCycles: 8000 }, 4, 3);
        expect(bench.warriors).toHaveLength(6);
        const a = runBenchmark(p(STONE), bench);
        const b = runBenchmark(p(STONE), bench);
        expect(a.opponents).toHaveLength(6);
        expect(a.score).toBe(b.score);
        expect(a.score).toBeGreaterThanOrEqual(0);
        expect(a.score).toBeLessThanOrEqual(300);
    });
});
