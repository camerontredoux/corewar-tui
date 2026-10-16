/**
 * Game controller: match and round state, speed, run/pause, scoring. Pure: no
 * OpenTUI, no timers. The app calls `advance(now)` once per frame; tests drive
 * it directly with a fake simulator.
 */

import {
    DEFAULT_OPTIONS,
    PRESETS,
    createRng,
    type ICoreLocation,
    type ICoreView,
    type IParseResult,
    type IPSpaceView,
    type IRoundResult,
    type ISimulatorOptions,
    type IWarriorProcessView,
    type PresetName,
    type PSpace,
    type Simulator,
} from '../engine/index.ts';

/** The part of the engine's Simulator the TUI uses (a real Simulator satisfies it). */
export type SimulatorLike = Pick<
    Simulator,
    'initialise' | 'step' | 'getCoreView' | 'getProcessView' | 'getWithInfoAt' | 'result' | 'getPSpace' | 'getPSpaceView'
>;

export interface MatchWarrior {
    /** Library id (see library.ts). */
    id: string;
    name: string;
    source: IParseResult;
}

export interface MatchSettings {
    preset: PresetName | 'custom';
    options: ISimulatorOptions;
    rounds: number;
}

export type Phase = 'idle' | 'running' | 'paused' | 'round-over' | 'match-over' | 'error';

export interface Tally {
    won: number;
    drawn: number;
    lost: number;
}

export interface WarriorStatus extends Tally {
    id: number;
    name: string;
    alive: boolean;
    taskCount: number;
    /** win% * 3 + draw% over the rounds played (0-300). */
    score: number;
}

/** Steps per frame, slowest to fastest. Infinity = unthrottled (time-sliced). */
export const SPEEDS: readonly number[] = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, Infinity];
export const DEFAULT_SPEED_INDEX = SPEEDS.indexOf(100);
export const DEFAULT_ROUNDS = 10;
/** Pause between rounds while playing, so the result is visible. */
export const ROUND_PAUSE_MS = 900;
/** Executions per chunk in unthrottled mode, between clock checks. */
const MAX_SPEED_CHUNK = 2000;

const { pSpaceSize: _standardPSpace, ...standardOptions } = PRESETS.standard;

/**
 * The engine's presets (guide.md 9.1), except that the app's standard core has
 * 4000 cells, so the board is easier to read. Its P-space size follows the core size.
 */
export const APP_PRESETS: Readonly<Record<PresetName, Readonly<ISimulatorOptions>>> = Object.freeze({
    ...PRESETS,
    standard: { ...standardOptions, coresize: 4000 },
});

export function defaultSettings(): MatchSettings {
    return { preset: 'standard', options: { ...APP_PRESETS.standard }, rounds: DEFAULT_ROUNDS };
}

export function speedLabel(index: number): string {
    const s = SPEEDS[index]!;
    return s === Infinity ? 'max' : `${s}/f`;
}

/** given = win% * 3 + draw% (developer.md 4.1.1). */
export function scoreOf(t: Tally, rounds: number): number {
    return rounds === 0 ? 0 : ((t.won * 3 + t.drawn) * 100) / rounds;
}

/**
 * One round's outcome per warrior. WIN: winner won, the rest lost. DRAW (or
 * NONE for a lone warrior): survivors drew, dead warriors lost.
 */
export function roundOutcomes(result: IRoundResult, alive: readonly boolean[]): ('won' | 'drawn' | 'lost')[] {
    return alive.map((isAlive, id) => {
        if (result.outcome === 'WIN') return id === result.winnerId ? 'won' : 'lost';
        return isAlive ? 'drawn' : 'lost';
    });
}

export class GameController {
    phase: Phase = 'idle';
    settings: MatchSettings = defaultSettings();
    warriors: MatchWarrior[] = [];
    /** 0-based index of the current round. */
    round = 0;
    speedIndex = DEFAULT_SPEED_INDEX;
    error = '';
    tallies: Tally[] = [];
    roundsPlayed = 0;
    lastResult: IRoundResult | undefined;
    view: ICoreView | null = null;
    processes: IWarriorProcessView[] = [];
    /** Called after the phase changes (the app opens the results overlay on 'match-over'). */
    onPhaseChange?: (phase: Phase, previous: Phase) => void;

    private matchSeed = 0;
    private roundSeeds: number[] = [];
    private roundCounted = false;
    private roundEndedAt = 0;
    /** Keep playing into the next round when this one ends. */
    private autoContinue = false;
    /** Finish the current round as fast as possible, then start the next one. */
    private skipping = false;
    /**
     * P-space as it was when the current round started (spec/pspace.md), so
     * a restart replays the round exactly. The next round continues from the
     * simulator's live P-space instead, which holds this round's results.
     */
    private roundStartPSpace: PSpace | null = null;

    constructor(
        private readonly sim: SimulatorLike,
        private readonly now: () => number = () => performance.now(),
    ) {}

    get rounds(): number {
        return this.settings.rounds;
    }

    get speed(): number {
        return SPEEDS[this.speedIndex]!;
    }

    get maximumCycles(): number {
        return this.settings.options.maximumCycles ?? DEFAULT_OPTIONS.maximumCycles;
    }

    get coresize(): number {
        return this.settings.options.coresize ?? DEFAULT_OPTIONS.coresize;
    }

    get cycle(): number {
        return this.view?.cycle ?? 0;
    }

    /** True while the frame loop has work to do. */
    get wantsFrames(): boolean {
        return this.phase === 'running' || (this.phase === 'round-over' && this.autoContinue);
    }

    status(): WarriorStatus[] {
        return this.warriors.map((w, id) => {
            const t = this.tallies[id] ?? { won: 0, drawn: 0, lost: 0 };
            const p = this.processes[id];
            return {
                id,
                name: w.name,
                alive: p?.alive ?? false,
                taskCount: p?.taskCount ?? 0,
                ...t,
                score: scoreOf(t, this.roundsPlayed),
            };
        });
    }

    /** Start a new match. Seed is optional (time-based when absent), for replays and tests. */
    startMatch(warriors: MatchWarrior[], settings: MatchSettings = this.settings, seed?: number, play = false): void {
        this.warriors = warriors;
        this.settings = settings;
        this.matchSeed = (seed ?? Math.floor(Math.random() * 0x100000000)) >>> 0;
        const rng = createRng(this.matchSeed);
        this.roundSeeds = Array.from({ length: Math.max(1, settings.rounds) }, () => rng.nextUint32());
        this.tallies = warriors.map(() => ({ won: 0, drawn: 0, lost: 0 }));
        this.roundsPlayed = 0;
        this.skipping = false;
        this.roundStartPSpace = null;
        this.startRound(0, play, null);
    }

    /** Replay the current round from cycle 0 with the same placement. */
    restartRound(): void {
        if (this.warriors.length === 0) return;
        if (this.roundCounted) this.uncountRound();
        this.skipping = false;
        this.startRound(this.round, this.phase === 'running', this.roundStartPSpace?.clone() ?? null);
    }

    /** Finish the current round (fast) and move on; or start the next one if it has ended. */
    nextRound(): void {
        if (this.phase === 'round-over') {
            this.startNextRound(this.autoContinue);
        } else if (this.phase === 'running' || this.phase === 'paused') {
            this.skipping = true;
            this.autoContinue = this.phase === 'running';
            this.setPhase('running');
        }
    }

    togglePause(): void {
        if (this.phase === 'running') {
            this.skipping = false;
            this.autoContinue = false;
            this.setPhase('paused');
        } else if (this.phase === 'paused') {
            this.autoContinue = true;
            this.setPhase('running');
        } else if (this.phase === 'round-over') {
            if (this.autoContinue) this.autoContinue = false;
            else this.startNextRound(true);
        } else if (this.phase === 'match-over' && this.warriors.length > 0) {
            this.startMatch(this.warriors, this.settings, undefined, true);
        }
    }

    /** Execute one instruction (pausing first if running). */
    stepOnce(): void {
        if (this.phase === 'running') this.togglePause();
        if (this.phase === 'round-over') {
            this.autoContinue = false;
            this.startNextRound(false);
            return;
        }
        if (this.phase === 'paused') this.runSteps(1);
    }

    speedUp(): void {
        this.speedIndex = Math.min(SPEEDS.length - 1, this.speedIndex + 1);
    }

    speedDown(): void {
        this.speedIndex = Math.max(0, this.speedIndex - 1);
    }

    /**
     * One frame's worth of simulation. Steps `speed` executions, or for 'max'
     * (and while skipping a round) as many as fit in `budgetMs`.
     * Returns true when anything changed.
     */
    advance(budgetMs = 12): boolean {
        if (this.phase === 'round-over' && this.autoContinue) {
            if (this.now() - this.roundEndedAt >= ROUND_PAUSE_MS) {
                this.startNextRound(true);
                return true;
            }
            return false;
        }
        if (this.phase !== 'running') return false;
        if (this.skipping || this.speed === Infinity) {
            const start = this.now();
            while (this.phase === 'running' && this.now() - start < budgetMs) this.runSteps(MAX_SPEED_CHUNK);
        } else {
            this.runSteps(this.speed);
        }
        return true;
    }

    /** A warrior's P-space in the current round, or undefined when there is no live round. */
    pspace(warriorId: number): IPSpaceView | undefined {
        if (!this.view) return undefined;
        try {
            return this.sim.getPSpaceView()[warriorId];
        } catch {
            return undefined;
        }
    }

    /** Cell inspector data, or undefined when there is no live round. */
    inspect(address: number): ICoreLocation | undefined {
        if (!this.view) return undefined;
        try {
            return this.sim.getWithInfoAt(address);
        } catch {
            return undefined;
        }
    }

    private runSteps(n: number): void {
        let running: boolean;
        try {
            running = this.sim.step(n);
        } catch (e) {
            this.fail(e);
            return;
        }
        this.processes = this.sim.getProcessView();
        if (!running) this.endRound();
    }

    /** The round after the current one, carrying the P-space over (with this round's results). */
    private startNextRound(play: boolean): void {
        let pspace: PSpace | null = null;
        try {
            pspace = this.sim.getPSpace();
        } catch {
            // No round loaded (an earlier error): start from a fresh P-space.
        }
        this.startRound(this.round + 1, play, pspace);
    }

    private startRound(index: number, play: boolean, pspace: PSpace | null): void {
        if (index >= this.settings.rounds) return;
        this.round = index;
        this.roundCounted = false;
        this.lastResult = undefined;
        this.autoContinue = play;
        this.error = '';
        const n = this.warriors.length;
        try {
            const options: ISimulatorOptions = {
                ...this.settings.options,
                seed: this.roundSeeds[index],
                firstWarrior: n > 0 ? index % n : 0,
                trackAccess: true,
            };
            const sources = this.warriors.map((w) => w.source);
            try {
                this.sim.initialise(options, sources, null, pspace);
            } catch (e) {
                // A warrior reloaded from the editor may have a new PIN: keep playing with a fresh P-space.
                if (!pspace) throw e;
                this.sim.initialise(options, sources, null, null);
            }
            this.roundStartPSpace = this.sim.getPSpace().clone();
            this.view = this.sim.getCoreView();
            this.processes = this.sim.getProcessView();
        } catch (e) {
            this.fail(e);
            return;
        }
        this.setPhase(play ? 'running' : 'paused');
    }

    private endRound(): void {
        const result = this.sim.result ?? { winnerId: null, outcome: 'DRAW' as const };
        this.lastResult = result;
        roundOutcomes(
            result,
            this.warriors.map((_, id) => this.processes[id]?.alive ?? false),
        ).forEach((o, id) => this.tallies[id]![o]++);
        this.roundsPlayed++;
        this.roundCounted = true;
        this.roundEndedAt = this.now();
        const last = this.round + 1 >= this.settings.rounds;
        const skipped = this.skipping;
        this.skipping = false;
        if (last) this.autoContinue = false;
        this.setPhase(last ? 'match-over' : 'round-over');
        if (skipped && !last) this.startNextRound(this.autoContinue);
    }

    private uncountRound(): void {
        if (!this.lastResult) return;
        roundOutcomes(
            this.lastResult,
            this.warriors.map((_, id) => this.processes[id]?.alive ?? false),
        ).forEach((o, id) => this.tallies[id]![o]--);
        this.roundsPlayed--;
        this.roundCounted = false;
    }

    private fail(e: unknown): void {
        this.error = e instanceof Error ? e.message : String(e);
        this.view = null;
        this.processes = [];
        this.skipping = false;
        this.autoContinue = false;
        this.setPhase('error');
    }

    private setPhase(phase: Phase): void {
        const previous = this.phase;
        this.phase = phase;
        if (phase !== previous) this.onPhaseChange?.(phase, previous);
    }
}
