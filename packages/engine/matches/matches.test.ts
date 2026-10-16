import { describe, expect, test } from 'bun:test';
import { MessageTopic, MessageType, Standard, type IParseResult } from '../types.ts';
import { recorder, warrior } from '../simulator/testing.ts';
import { createHill, runBenchmark, runMatch, scoreCounts, submitToHill, tallyRounds } from './index.ts';

const LOOP = ['JMP.B $0, $0'];
const DIE = ['DAT.F $0, $0'];
const IMP = ['MOV.I $0, $1'];
const DWARF = ['ADD.AB #4, $3', 'MOV.I $2, @2', 'JMP.B $-2, $0', 'DAT.F #0, #0'];
const QUICK = { maximumCycles: 2000 };

describe('scoreCounts', () => {
    test('given = win% * 3 + draw%, taken = loss% * 3 + draw%, unrounded', () => {
        expect(scoreCounts(5, 3, 2, 10)).toEqual({ given: 180, taken: 90 });
        expect(scoreCounts(4, 2, 4, 10)).toEqual({ given: 140, taken: 140 });
        expect(scoreCounts(1, 0, 2, 3).given).toBeCloseTo(100, 10);
        expect(scoreCounts(10, 0, 0, 10)).toEqual({ given: 300, taken: 0 });
        expect(scoreCounts(0, 0, 0, 0)).toEqual({ given: 0, taken: 0 });
    });
});

describe('tallyRounds', () => {
    test('WIN: winner won, others lost; DRAW and NONE: survivors drew, the dead lost', () => {
        const sources = [warrior(LOOP), warrior(LOOP), warrior(LOOP)];
        const t = tallyRounds(sources, [
            { result: { winnerId: 1, outcome: 'WIN' }, survivors: [false, true, false] },
            { result: { winnerId: null, outcome: 'DRAW' }, survivors: [true, false, true] },
        ]);
        expect(t.map((w) => [w.won, w.drawn, w.lost])).toEqual([[0, 1, 1], [1, 0, 1], [0, 1, 1]]);
        expect(t[0]!.source).toBe(sources[0]!);
        const single = tallyRounds([sources[0]!], [
            { result: { winnerId: null, outcome: 'NONE' }, survivors: [true] },
            { result: { winnerId: null, outcome: 'NONE' }, survivors: [false] },
        ]);
        expect([single[0]!.won, single[0]!.drawn, single[0]!.lost]).toEqual([0, 1, 1]);
    });

    test('without survivor data, DRAW is drawn for everyone and NONE is lost', () => {
        const t = tallyRounds([warrior(LOOP), warrior(LOOP)], [
            { result: { winnerId: null, outcome: 'DRAW' } },
            { result: { winnerId: null, outcome: 'NONE' } },
        ]);
        expect(t.map((w) => [w.won, w.drawn, w.lost])).toEqual([[0, 1, 1], [0, 1, 1]]);
    });
});

describe('runMatch', () => {
    test('publishes MATCH_END once, last, with the same payload it returns', () => {
        const p = recorder();
        const a = warrior(LOOP, { data: 'a' });
        const b = warrior(DIE);
        const result = runMatch({ rounds: 4, options: QUICK, warriors: [{ source: a }, { source: b }], seed: 1 }, p);
        expect(p.payloads(MessageTopic.MATCH_END)).toEqual([result]);
        expect(p.topics().at(-1)).toBe('MATCH_END');
        expect(result.rounds).toBe(4);
        expect(result.warriors).toHaveLength(2);
        expect(result.warriors[0]!.source).toBe(a);
        expect(result.warriors[1]!.source).toBe(b);
        expect(result.warriors.map((w) => [w.won, w.drawn, w.lost, w.given, w.taken])).toEqual([
            [4, 0, 0, 300, 0],
            [0, 0, 4, 0, 300],
        ]);
    });

    test('forwards every round\'s simulator messages, one ROUND_END per round', () => {
        const p = recorder();
        runMatch({ rounds: 3, options: QUICK, warriors: [{ source: warrior(LOOP) }, { source: warrior(DIE) }], seed: 2 }, p);
        expect(p.payloads(MessageTopic.CORE_INITIALISE)).toHaveLength(3);
        expect(p.payloads(MessageTopic.ROUND_END)).toHaveLength(3);
        expect(p.payloads(MessageTopic.MATCH_END)).toHaveLength(1);
    });

    test('rotates the first warrior every round', () => {
        const p = recorder();
        runMatch({ rounds: 4, options: QUICK, warriors: [{ source: warrior(LOOP) }, { source: warrior(LOOP) }], seed: 3 }, p);
        expect(p.payloads(MessageTopic.CORE_INITIALISE).map((x) => x.state.warriorIndex)).toEqual([0, 1, 0, 1]);
    });

    test('rotation decides a race: the warrior that moves first wins the DAT race', () => {
        // Two lone DATs: whoever moves first dies first.
        const result = runMatch({ rounds: 10, options: QUICK, warriors: [{ source: warrior(DIE) }, { source: warrior(DIE) }], seed: 4 });
        expect(result.warriors.map((w) => [w.won, w.lost])).toEqual([[5, 5], [5, 5]]);
    });

    test('draws at the cycle limit; won + drawn + lost = rounds', () => {
        const result = runMatch({ rounds: 5, options: QUICK, warriors: [{ source: warrior(LOOP) }, { source: warrior(IMP) }], seed: 5 });
        for (const w of result.warriors) {
            expect(w.won + w.drawn + w.lost).toBe(5);
            expect(w.given).toBe(w.won * 60 + w.drawn * 20);
        }
    });

    test('a single-warrior match scores NONE rounds as drawn when the warrior survives, lost when it dies', () => {
        expect(runMatch({ rounds: 2, options: QUICK, warriors: [{ source: warrior(LOOP) }], seed: 6 }).warriors[0]).toMatchObject({ drawn: 2, lost: 0 });
        expect(runMatch({ rounds: 2, options: QUICK, warriors: [{ source: warrior(DIE) }], seed: 6 }).warriors[0]).toMatchObject({ drawn: 0, lost: 2 });
    });

    test('is reproducible with a seed, and different seeds place warriors differently', () => {
        const play = (seed: number) => {
            const p = recorder();
            runMatch({ rounds: 6, options: { maximumCycles: 4000 }, warriors: [{ source: warrior(DWARF) }, { source: warrior(IMP) }], seed }, p);
            return p.payloads(MessageTopic.CORE_INITIALISE).map((x) => x.state.warriors[1].startAddress);
        };
        expect(play(42)).toEqual(play(42));
        expect(play(42)).not.toEqual(play(43));
    });

    test('three warriors: a warrior that died before a draw at the cycle limit loses', () => {
        const result = runMatch({
            rounds: 6,
            options: QUICK,
            warriors: [{ source: warrior(DWARF) }, { source: warrior(LOOP) }, { source: warrior(DIE) }],
            seed: 7,
        });
        for (const w of result.warriors) expect(w.won + w.drawn + w.lost).toBe(6);
        expect(result.warriors[2]).toMatchObject({ won: 0, drawn: 0, lost: 6 });
        expect(result.warriors[1]!.won + result.warriors[1]!.drawn).toBe(6);
    });

    test('zero rounds publishes an empty result; bad input throws', () => {
        const p = recorder();
        const result = runMatch({ rounds: 0, warriors: [{ source: warrior(LOOP) }] }, p);
        expect(result.warriors[0]).toMatchObject({ won: 0, drawn: 0, lost: 0, given: 0, taken: 0 });
        expect(p.topics()).toEqual(['MATCH_END']);
        expect(() => runMatch({ rounds: -1, warriors: [{ source: warrior(LOOP) }] })).toThrow('rounds');
        expect(() => runMatch({ rounds: 1, warriors: [] })).toThrow();
    });

    test('works without a provider', () => {
        expect(runMatch({ rounds: 1, options: QUICK, warriors: [{ source: warrior(LOOP) }, { source: warrior(DIE) }], seed: 8 }).warriors[0]!.won).toBe(1);
    });
});

describe('hills', () => {
    const settings = { options: { ...QUICK }, rounds: 4, seed: 9 };
    const failed: IParseResult = { ...warrior(LOOP), messages: [{ type: MessageType.Error, position: { line: 1, char: 1 }, text: 'bad' }] };

    test('createHill defaults: standard options, 100 rounds, size 20, empty', () => {
        const hill = createHill();
        expect([hill.rounds, hill.hillSize, hill.warriors]).toEqual([100, 20, []]);
        expect(hill.options.coresize).toBe(8000);
    });

    test('a submission with parse errors or over the instruction limit is rejected and nothing ages', () => {
        let hill = createHill(settings);
        hill = submitToHill(hill, 'loop', warrior(LOOP)).hill;
        const rejected = submitToHill(hill, 'bad', failed);
        expect(rejected).toEqual({ accepted: false, hill, ranking: [], pushedOff: [] });
        const tooLong = submitToHill(createHill({ ...settings, options: { ...QUICK, instructionLimit: 2 } }), 'big', warrior(DWARF));
        expect(tooLong.accepted).toBe(false);
    });

    test("an ICWS'88 hill rejects '94-only opcodes and modes and accepts '88 code", () => {
        const hill = createHill({ ...settings, options: { ...QUICK, standard: Standard.ICWS88 } });
        expect(submitToHill(hill, 'ldp', warrior(['LDP.AB #0, $1', 'JMP.B $-1, $0'])).accepted).toBe(false);
        expect(submitToHill(hill, 'nop', warrior(['NOP.F $0, $0'])).accepted).toBe(false);
        expect(submitToHill(hill, 'star', warrior(['JMP.B *0, $0'])).accepted).toBe(false);
        expect(submitToHill(hill, 'cmp', warrior(['CMP.I $0, $1', 'JMP.B $-1, $0'])).accepted).toBe(true);
        expect(submitToHill(hill, 'dwarf', warrior(DWARF)).accepted).toBe(true);
    });

    test('a season is a round robin; ranking by average score; survivors age; input hill untouched', () => {
        let hill = createHill({ ...settings, hillSize: 3 });
        hill = submitToHill(hill, 'loop', warrior(LOOP)).hill;
        expect(hill.warriors.map((w) => [w.id, w.age])).toEqual([['loop', 1]]);
        const second = submitToHill(hill, 'die', warrior(DIE));
        expect(hill.warriors).toHaveLength(1);
        expect(second.ranking.map((r) => [r.warrior.id, r.score, r.won, r.lost])).toEqual([
            ['loop', 300, 4, 0],
            ['die', 0, 0, 4],
        ]);
        expect(second.hill.warriors.map((w) => [w.id, w.age])).toEqual([['loop', 2], ['die', 1]]);
        const third = submitToHill(second.hill, 'imp', warrior(IMP));
        // loop: 4 wins vs die, draws vs imp -> (300 + 100) / 2
        expect(third.ranking[0]).toMatchObject({ score: 200 });
        expect(third.ranking.at(-1)!.warrior.id).toBe('die');
        expect(third.pushedOff).toEqual([]);
    });

    test('the worst is pushed off only when over capacity; a newcomer that comes last is pushed off itself', () => {
        let hill = createHill({ ...settings, hillSize: 2 });
        hill = submitToHill(hill, 'a', warrior(LOOP)).hill;
        hill = submitToHill(hill, 'b', warrior(IMP)).hill;
        const result = submitToHill(hill, 'loser', warrior(DIE));
        expect(result.pushedOff.map((w) => w.id)).toEqual(['loser']);
        // a and b tie on score (200) and wins (4); a is older.
        expect(result.hill.warriors.map((w) => [w.id, w.age])).toEqual([['a', 3], ['b', 2]]);
    });

    test('ties break on wins, then age, then earlier submission', () => {
        let hill = createHill({ ...settings, hillSize: 5 });
        hill = submitToHill(hill, 'first', warrior(LOOP)).hill;
        const result = submitToHill(hill, 'second', warrior(LOOP));
        expect(result.ranking.map((r) => [r.warrior.id, r.score])).toEqual([['first', 100], ['second', 100]]);
    });

    test('resubmitting an id replaces the old warrior', () => {
        let hill = createHill(settings);
        hill = submitToHill(hill, 'w', warrior(DIE)).hill;
        hill = submitToHill(hill, 'x', warrior(LOOP)).hill;
        const result = submitToHill(hill, 'w', warrior(LOOP));
        expect(result.hill.warriors.map((w) => w.id).sort()).toEqual(['w', 'x']);
        expect(result.hill.warriors.find((w) => w.id === 'w')!.age).toBe(1);
    });
});

describe('benchmarks', () => {
    const bench = (seed?: number) => ({
        name: 'test',
        warriors: [warrior(DIE), warrior(LOOP), warrior(DWARF)],
        options: { maximumCycles: 4000 },
        rounds: 6,
        ...(seed === undefined ? {} : { seed }),
    });

    test('plays each opponent in turn and averages the per-opponent scores', () => {
        const b = bench(10);
        const result = runBenchmark(warrior(LOOP), b);
        expect(result.opponents.map((o) => o.opponent)).toEqual(b.warriors);
        expect(result.opponents[0]).toMatchObject({ won: 6, drawn: 0, lost: 0, score: 300 });
        expect(result.opponents[1]).toMatchObject({ won: 0, drawn: 6, lost: 0, score: 100 });
        for (const o of result.opponents) expect(o.won + o.drawn + o.lost).toBe(6);
        const average = result.opponents.reduce((s, o) => s + o.score, 0) / 3;
        expect(result.score).toBeCloseTo(average, 10);
    });

    test('is reproducible with a seed', () => {
        const a = runBenchmark(warrior(IMP), bench(11));
        const b = runBenchmark(warrior(IMP), bench(11));
        expect(a.opponents.map((o) => [o.won, o.drawn, o.lost])).toEqual(b.opponents.map((o) => [o.won, o.drawn, o.lost]));
    });

    test('an empty benchmark scores 0', () => {
        expect(runBenchmark(warrior(LOOP), { ...bench(1), warriors: [] }).score).toBe(0);
    });
});

describe('P-space across rounds (spec/pspace.md)', () => {
    // Survives (loops) only while P-space cell 1 is 0, and sets cell 1 in its first round.
    const ONCE = ['LDP.AB #1, $5', 'JMN.B $3, $4', 'STP.AB #1, #1', 'JMP.B $0, $0', 'DAT.F $0, $0', 'DAT.F $0, $0'];
    // Loops only when the result cell is 0 (it lost the previous round); dies otherwise.
    const SWITCH = ['LDP.AB #0, $3', 'JMZ.B $3, $2', 'DAT.F $0, $0', 'DAT.F $0, $0', 'JMP.B $0, $0'];
    const match = (a: string[], b: string[], rounds: number, seed = 1) =>
        runMatch({ rounds, options: QUICK, warriors: [{ source: warrior(a) }, { source: warrior(b) }], seed }).warriors.map((w) => [w.won, w.drawn, w.lost]);

    test('runMatch carries P-space from round to round', () => {
        expect(match(ONCE, LOOP, 3)).toEqual([[0, 1, 2], [2, 1, 0]]);
    });

    test('the result cell drives a P-switcher: -1 before round 1, 2 after a draw, 0 after a loss', () => {
        // Round 1: cell 0 is -1, so SWITCH dies (loss). Round 2: 0, so it loops (draw). Round 3: 2, so it dies.
        expect(match(SWITCH, LOOP, 3)).toEqual([[0, 1, 2], [2, 1, 0]]);
    });

    test('every match starts with fresh P-space', () => {
        expect(match(ONCE, LOOP, 3, 1)).toEqual(match(ONCE, LOOP, 3, 2));
        expect(match(ONCE, LOOP, 1)).toEqual([[0, 1, 0], [0, 1, 0]]);
    });

    test('warriors with the same PIN share P-space across the match', () => {
        // The reader dies once it sees cell 1 set; only the writer sets it.
        const reader = (pin: number) => warrior(['LDP.AB #1, $3', 'JMN.B $2, $2', 'JMP.B $0, $0', 'DAT.F $0, $0'], { pin });
        const writer = warrior(['STP.AB #1, #1', 'JMP.B $0, $0'], { pin: 7 });
        const play = (pin: number) =>
            runMatch({ rounds: 2, options: QUICK, warriors: [{ source: writer }, { source: reader(pin) }], seed: 1 }).warriors.map((w) => [w.won, w.drawn, w.lost]);
        expect(play(7)).toEqual([[2, 0, 0], [0, 0, 2]]);
        expect(play(8)).toEqual([[0, 2, 0], [0, 2, 0]]);
    });

    test('benchmarks and hills give each pairing its own fresh P-space', () => {
        const benchmark = { name: 'loops', warriors: [warrior(LOOP), warrior(LOOP)], options: QUICK, rounds: 3, seed: 1 };
        const result = runBenchmark(warrior(ONCE), benchmark);
        expect(result.opponents.map((o) => [o.won, o.drawn, o.lost])).toEqual([[0, 1, 2], [0, 1, 2]]);

        let hill = createHill({ options: QUICK, rounds: 3, seed: 1 });
        hill = submitToHill(hill, 'a', warrior(LOOP)).hill;
        hill = submitToHill(hill, 'b', warrior(LOOP)).hill;
        const ranking = submitToHill(hill, 'c', warrior(ONCE)).ranking;
        expect(ranking.find((r) => r.warrior.id === 'c')).toMatchObject({ won: 0, drawn: 2, lost: 4 });
    });
});
