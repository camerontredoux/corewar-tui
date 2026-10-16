import { describe, expect, test } from 'bun:test';
import { GameController, ROUND_PAUSE_MS, SPEEDS, defaultSettings, roundOutcomes, scoreOf, type MatchSettings } from './controller.ts';
import { FakeSimulator, fakeParseResult } from './test-fakes.ts';

function setup(opts: { rounds?: number; maximumCycles?: number } = {}) {
    const sim = new FakeSimulator();
    let clock = 0;
    const c = new GameController(sim, () => clock);
    const settings: MatchSettings = {
        ...defaultSettings(),
        rounds: opts.rounds ?? 3,
        options: { coresize: 80, maximumCycles: opts.maximumCycles ?? 1000 },
    };
    const warriors = ['a', 'b'].map((n) => ({ id: `builtin/${n}.red`, name: n, source: fakeParseResult(n) }));
    c.startMatch(warriors, settings, 42);
    return { sim, c, tick: (ms: number) => (clock += ms) };
}

describe('GameController', () => {
    test('a new match loads round 1 paused, with seeded placement and first-warrior rotation', () => {
        const { sim, c } = setup();
        expect(c.phase).toBe('paused');
        expect(c.round).toBe(0);
        const init = sim.initialised[0]!;
        expect(init.options).toMatchObject({ coresize: 80, firstWarrior: 0, trackAccess: true });
        expect(typeof init.options.seed).toBe('number');
        expect(init.sources.map((s) => s.metaData.name)).toEqual(['a', 'b']);
    });

    test('advance steps `speed` executions per frame only while running', () => {
        const { sim, c } = setup();
        c.advance();
        expect(sim.view.executions).toBe(0);
        c.togglePause();
        c.speedIndex = SPEEDS.indexOf(20);
        c.advance();
        expect(sim.view.executions).toBe(20);
        expect(c.cycle).toBe(20);
    });

    test('max speed steps in time-sliced chunks until the frame budget is used', () => {
        const sim = new FakeSimulator();
        let clock = 0;
        const c = new GameController(sim, () => (clock += 3)); // every clock read costs 3 ms
        c.startMatch([fakeParseResult('a'), fakeParseResult('b')].map((source, i) => ({ id: `${i}`, name: `${i}`, source })), {
            ...defaultSettings(),
            options: { coresize: 80, maximumCycles: 1_000_000 },
        });
        c.speedIndex = SPEEDS.length - 1;
        expect(c.speed).toBe(Infinity);
        c.togglePause();
        c.advance(12);
        expect(sim.view.executions).toBeGreaterThan(2000);
        expect(sim.view.executions).toBeLessThan(20000);
        expect(c.phase).toBe('running');
    });

    test('step pauses and executes exactly one instruction', () => {
        const { sim, c } = setup();
        c.togglePause();
        c.stepOnce();
        expect(c.phase).toBe('paused');
        expect(sim.view.executions).toBe(1);
    });

    test('speed changes clamp to the ladder', () => {
        const { c } = setup();
        for (let i = 0; i < 50; i++) c.speedDown();
        expect(c.speed).toBe(1);
        for (let i = 0; i < 50; i++) c.speedUp();
        expect(c.speed).toBe(Infinity);
    });

    test('a finished round is tallied, then the next round starts after a pause with the next warrior first', () => {
        const { sim, c, tick } = setup();
        sim.winAt = 10;
        sim.winner = 1;
        c.togglePause();
        c.advance();
        expect(c.phase).toBe('round-over');
        expect(c.status().map((s) => [s.won, s.lost])).toEqual([
            [0, 1],
            [1, 0],
        ]);
        c.advance();
        expect(c.phase).toBe('round-over');
        tick(ROUND_PAUSE_MS);
        c.advance();
        expect(c.phase).toBe('running');
        expect(c.round).toBe(1);
        const [r0, r1] = sim.initialised;
        expect(r1!.options.firstWarrior).toBe(1);
        expect(r1!.options.seed).not.toBe(r0!.options.seed);
    });

    test('the last round ends the match, reports it once, and scores win% * 3 + draw%', () => {
        const { sim, c } = setup({ rounds: 2, maximumCycles: 10 });
        const phases: string[] = [];
        c.onPhaseChange = (p) => phases.push(p);
        c.togglePause();
        c.advance(); // round 1: draw at cycle 10
        c.nextRound(); // still playing, so round 2 starts running
        sim.winAt = 4;
        c.advance(); // round 2: warrior 0 wins
        expect(c.phase).toBe('match-over');
        expect(phases.filter((p) => p === 'match-over')).toHaveLength(1);
        const [a, b] = c.status();
        expect([a!.won, a!.drawn, a!.lost, a!.score]).toEqual([1, 1, 0, 200]);
        expect([b!.won, b!.drawn, b!.lost, b!.score]).toEqual([0, 1, 1, 50]);
    });

    test('next round while paused finishes the current round and stops at the start of the next', () => {
        const { sim, c } = setup({ maximumCycles: 50 });
        c.nextRound();
        for (let i = 0; i < 10 && c.round === 0; i++) c.advance();
        expect(c.round).toBe(1);
        expect(c.phase).toBe('paused');
        expect(c.roundsPlayed).toBe(1);
        expect(sim.view.executions).toBe(0);
    });

    test('restarting an ended round replays the same placement and does not count it twice', () => {
        const { sim, c } = setup({ maximumCycles: 10 });
        c.togglePause();
        c.advance();
        expect(c.roundsPlayed).toBe(1);
        c.restartRound();
        expect(c.roundsPlayed).toBe(0);
        expect(c.status().every((s) => s.drawn === 0)).toBe(true);
        expect(sim.initialised[1]!.options.seed).toBe(sim.initialised[0]!.options.seed);
    });

    test('P-space carries over to the next round and is fresh for a new match (spec/pspace.md)', () => {
        const { sim, c } = setup({ rounds: 3, maximumCycles: 10 });
        expect(sim.initialised[0]!.pspace).toBeNull();
        expect(c.pspace(0)!.cells[0]).toBe(79);
        c.togglePause();
        c.advance(); // round 1: draw, both survive
        c.nextRound();
        const carried = sim.initialised[1]!.pspace!;
        expect(carried).not.toBeNull();
        expect(carried.view(0).cells[0]).toBe(2);
        expect(c.pspace(1)!.cells[0]).toBe(2);
        sim.winAt = 4;
        sim.winner = 1;
        c.advance(); // round 2: warrior 1 wins
        c.nextRound();
        expect(sim.initialised[2]!.pspace).toBe(carried);
        expect([0, 1].map((w) => c.pspace(w)!.cells[0])).toEqual([0, 1]);
        c.startMatch(c.warriors, c.settings);
        expect(sim.initialised[3]!.pspace).toBeNull();
        expect(c.pspace(0)!.cells[0]).toBe(79);
    });

    test('restarting a round restores the P-space it started with', () => {
        const { sim, c } = setup({ rounds: 3, maximumCycles: 10 });
        c.togglePause();
        c.advance(); // round 1: draw
        c.nextRound();
        sim.getPSpace().store(0, 3, 42); // as STP would during round 2
        c.restartRound();
        const restarted = sim.initialised.at(-1)!.pspace!;
        expect(restarted.view(0).cells.slice(0, 4)).toEqual([2, 0, 0, 0]);
        expect(restarted).not.toBe(sim.initialised[1]!.pspace);
    });

    test('a round whose P-space no longer fits (a warrior reloaded with a new PIN) starts with a fresh one', () => {
        const { sim, c } = setup({ rounds: 3, maximumCycles: 10 });
        c.togglePause();
        c.advance();
        let calls = 0;
        const original = sim.initialise.bind(sim);
        sim.initialise = (options, sources, provider, pspace) => {
            if (pspace && calls++ === 0) throw new Error('The P-space was made for warriors with different PINs');
            original(options, sources, provider, pspace);
        };
        c.nextRound();
        expect(c.phase).not.toBe('error');
        expect(c.round).toBe(1);
        expect(sim.initialised.at(-1)!.pspace).toBeNull();
    });

    test('an engine error becomes the error phase instead of throwing', () => {
        const sim = new FakeSimulator();
        sim.failInit = 'warriors do not fit';
        const c = new GameController(sim);
        c.startMatch([{ id: 'x', name: 'x', source: fakeParseResult('x') }], defaultSettings());
        expect(c.phase).toBe('error');
        expect(c.error).toBe('warriors do not fit');
        expect(c.view).toBeNull();
    });
});

describe('scoring', () => {
    test('a draw counts as lost for warriors already dead (N > 2)', () => {
        expect(roundOutcomes({ winnerId: null, outcome: 'DRAW' }, [true, false, true])).toEqual(['drawn', 'lost', 'drawn']);
        expect(roundOutcomes({ winnerId: 2, outcome: 'WIN' }, [false, false, true])).toEqual(['lost', 'lost', 'won']);
    });

    test('score is win% * 3 + draw%', () => {
        expect(scoreOf({ won: 1, drawn: 2, lost: 1 }, 4)).toBe(125);
        expect(scoreOf({ won: 0, drawn: 0, lost: 0 }, 0)).toBe(0);
    });
});
