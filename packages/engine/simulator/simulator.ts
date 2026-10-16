/**
 * The Simulator class: one independent round engine. The developer.md free
 * functions in ./index.ts delegate to a module-level instance; matches, hills,
 * benchmarks and the TUI may create their own instances.
 * OWNER: simulator engineer. Public method signatures are frozen.
 */

import {
    Mode,
    Modifier,
    Opcode,
    type ICoreAccessEventArgs,
    type ICoreLocation,
    type ICoreView,
    type IInstruction,
    type IMetaData,
    type IParseResult,
    type IPSpaceView,
    type IPublishProvider,
    type IResolvedOptions,
    type IRoundResult,
    type ISimulatorOptions,
    type IState,
    type IWarrior,
    type IWarriorProcessView,
} from '../types.ts';
import { fold, fromPublicInstruction, type IInstructionSpec } from '../instruction.ts';
import { parseSucceeded, readLoadFormat, type IWarriorProgram } from '../loadformat.ts';
import { resolveOptions } from '../options.ts';
import { createRng } from '../rng.ts';
import { Core } from './core.ts';
import { EventPublisher, warriorRef } from './events.ts';
import { executeOne } from './executor.ts';
import { loadProgram, placeWarriors } from './loader.ts';
import { ProcessQueue } from './processes.ts';
import { PSpace } from './pspace.ts';
import type { IRoundState, IWarriorState } from './state.ts';

/** Pre-decoded warrior, so runMatch decodes each parse result once per match, not once per round. */
export interface IWarriorInput {
    program: IWarriorProgram;
    metaData: IMetaData;
    /** True when the source IParseResult has its own `data` property. */
    hasData: boolean;
    data?: any;
}

/** Access arrays use Uint8Array warrior ids. */
const MAX_WARRIORS = 255;

/**
 * Decode and validate parse results (throws naming the warrior index on Error
 * messages, empty input or a load-format violation).
 */
export function toWarriorInputs(parseResults: readonly IParseResult[]): IWarriorInput[] {
    if (!Array.isArray(parseResults) || parseResults.length === 0) {
        throw new Error('At least one parse result is required');
    }
    return parseResults.map((result, i): IWarriorInput => {
        if (!parseSucceeded(result)) throw new Error(`Warrior ${i} has parse errors`);
        let program: IWarriorProgram;
        try {
            program = readLoadFormat(result.tokens);
        } catch (e) {
            throw new Error(`Warrior ${i} has an invalid load format: ${(e as Error).message}`);
        }
        const input: IWarriorInput = {
            program,
            metaData: { name: result.metaData.name, author: result.metaData.author, strategy: result.metaData.strategy },
            hasData: 'data' in result,
        };
        if (input.hasData) input.data = result.data;
        return input;
    });
}

function validInstruction(ins: IInstruction): IInstructionSpec {
    const spec = fromPublicInstruction(ins);
    const inRange = (v: number, max: number): boolean => Number.isInteger(v) && v >= 0 && v <= max;
    if (
        !inRange(spec.opcode, Opcode.STP) ||
        !inRange(spec.modifier, Modifier.I) ||
        !inRange(spec.aMode, Mode.BPostIncrement) ||
        !inRange(spec.bMode, Mode.BPostIncrement) ||
        !Number.isInteger(spec.aNumber) ||
        !Number.isInteger(spec.bNumber)
    ) {
        throw new Error('Option initialInstruction is not a valid instruction');
    }
    return spec;
}

export class Simulator {
    private state: IRoundState | undefined;
    private events: EventPublisher = new EventPublisher(null, []);
    private view: ICoreView | undefined;

    /**
     * developer.md initialiseSimulator. Discards all previous round state.
     * `pspace` carries P-space over from the previous round of the same match
     * (spec/pspace.md); omitted or null starts a new match with a fresh one.
     * The simulator writes each round's results into it.
     */
    initialise(options: ISimulatorOptions, parseResults: IParseResult[], provider?: IPublishProvider | null, pspace?: PSpace | null): void {
        this.initialiseWarriors(options, toWarriorInputs(parseResults), provider, pspace);
    }

    /** Same as initialise but with pre-decoded warriors (matches fast path). */
    initialiseWarriors(options: ISimulatorOptions, warriors: readonly IWarriorInput[], provider?: IPublishProvider | null, pspace?: PSpace | null): void {
        // Validate everything before touching the current round.
        const o: IResolvedOptions = resolveOptions(options);
        if (warriors.length === 0) throw new Error('At least one parse result is required');
        if (warriors.length > MAX_WARRIORS) throw new Error(`At most ${MAX_WARRIORS} warriors are supported`);
        if (o.firstWarrior >= warriors.length) {
            throw new Error(`Option firstWarrior (${o.firstWarrior}) must be below the warrior count (${warriors.length})`);
        }
        const lengths = warriors.map((w) => w.program.instructions.length);
        lengths.forEach((length, i) => {
            if (length > o.instructionLimit) {
                throw new Error(`Warrior ${i} has ${length} instructions, more than instructionLimit ${o.instructionLimit}`);
            }
        });
        const initial = validInstruction(o.initialInstruction);
        const pins = warriors.map((w) => w.program.pin ?? null);
        if (pspace) {
            if (pspace.warriorCount !== warriors.length || pspace.size !== o.pSpaceSize || pspace.coresize !== o.coresize) {
                throw new Error(
                    `The P-space (${pspace.warriorCount} warriors, size ${pspace.size}, core ${pspace.coresize}) does not fit this round ` +
                        `(${warriors.length} warriors, size ${o.pSpaceSize}, core ${o.coresize})`,
                );
            }
            if (pspace.pins.some((pin, i) => pin !== pins[i])) throw new Error('The P-space was made for warriors with different PINs');
        }
        const addresses = placeWarriors(lengths, o, createRng(o.seed));

        const core = new Core(o.coresize, initial);
        const warriorStates = warriors.map((w, id): IWarriorState => {
            const loadAddress = addresses[id]!;
            loadProgram(core, w.program, loadAddress);
            const queue = new ProcessQueue(o.maxTasks);
            const startAddress = fold(loadAddress + w.program.startOffset, o.coresize);
            queue.push(startAddress);
            return {
                id,
                metaData: w.metaData,
                hasData: w.hasData,
                data: w.data,
                loadAddress,
                length: lengths[id]!,
                startAddress,
                queue,
                alive: true,
            };
        });

        const events = new EventPublisher(provider, warriorStates);
        const state: IRoundState = {
            options: o,
            core,
            warriors: warriorStates,
            nextWarrior: o.firstWarrior,
            liveCount: warriorStates.length,
            executions: 0,
            cycle: 0,
            lastExecuted: -1,
            result: undefined,
            limited: o.readDistance < o.coresize || o.writeDistance < o.coresize,
            trackAccess: o.trackAccess,
            tracing: o.trackAccess || events.enabled,
            pspace: pspace ?? new PSpace(pins, o.pSpaceSize, o.coresize),
        };
        this.state = state;
        this.events = events;
        this.view = {
            size: core.size,
            accessKind: core.accessKind,
            accessWarrior: core.accessWarrior,
            accessStamp: core.accessStamp,
            get executions() {
                return state.executions;
            },
            get cycle() {
                return state.cycle;
            },
            get lastExecuted() {
                return state.lastExecuted;
            },
            get nextWarrior() {
                return state.nextWarrior;
            },
        };

        if (events.enabled) {
            events.coreInitialise(this.getState());
            events.allTaskCounts();
            events.runProgress(0, o.maximumCycles, true);
            this.publishNextExecution();
        }
    }

    private get round(): IRoundState {
        if (!this.state) throw new Error('Simulator not initialised');
        return this.state;
    }

    private publishNextExecution(): void {
        const s = this.round;
        this.events.nextExecution(s.nextWarrior, s.warriors[s.nextWarrior]!.queue.peek());
    }

    /** developer.md step. */
    step(steps = 1): boolean {
        const s = this.round;
        if (!Number.isInteger(steps) || steps < 0) throw new Error(`step() needs a non-negative integer, got ${steps}`);
        if (s.result) return false;
        const events = this.events;
        for (let i = 0; i < steps && !s.result; i++) executeOne(s, events);
        if (events.enabled) {
            events.runProgress(s.cycle, s.options.maximumCycles, s.result !== undefined);
            if (!s.result) this.publishNextExecution();
        }
        return s.result === undefined;
    }

    /** developer.md run. */
    run(): void {
        const s = this.round;
        if (s.result) return;
        const events = this.events;
        while (!s.result) executeOne(s, events);
        if (events.enabled) events.runProgress(s.cycle, s.options.maximumCycles, true);
    }

    /** run() and return the round result (also published as ROUND_END). */
    runRound(): IRoundResult {
        this.run();
        return this.round.result!;
    }

    /** developer.md getWithInfoAt. Side-effect free. */
    getWithInfoAt(address: number): ICoreLocation {
        const s = this.round;
        if (!Number.isInteger(address)) throw new Error(`getWithInfoAt() needs an integer address, got ${address}`);
        const at = fold(address, s.core.size);
        const location: ICoreLocation = { instruction: s.core.toPublic(at) };
        const access = this.accessAt(at);
        if (access) location.access = access;
        return location;
    }

    private accessAt(address: number): ICoreAccessEventArgs | undefined {
        const core = this.round.core;
        const kind = core.accessKind[address]!;
        if (kind === 0) return undefined;
        return { ...warriorRef(this.round.warriors[core.accessWarrior[address]!]!), accessType: kind - 1, address };
    }

    /** developer.md republish. */
    republish(): void {
        const s = this.round;
        const events = this.events;
        if (!events.enabled) return;
        events.coreInitialise(this.getState());
        const accesses: ICoreAccessEventArgs[] = [];
        for (let a = 0; a < s.core.size; a++) {
            const access = this.accessAt(a);
            if (access) accesses.push(access);
        }
        events.coreAccess(accesses);
        events.allTaskCounts();
        events.runProgress(s.cycle, s.options.maximumCycles, true);
        if (s.result) events.roundEnd(s.result);
        else this.publishNextExecution();
    }

    /** True after initialise until the round ends. */
    get isRunning(): boolean {
        return this.state !== undefined && this.state.result === undefined;
    }

    /** The round result once ended, else undefined. */
    get result(): IRoundResult | undefined {
        return this.state?.result;
    }

    /** Current IState snapshot (the CORE_INITIALISE payload shape). */
    getState(): IState {
        const s = this.round;
        const size = s.core.size;
        const initial = s.options.initialInstruction;
        const options: IResolvedOptions = {
            ...s.options,
            initialInstruction: { ...initial, aOperand: { ...initial.aOperand }, bOperand: { ...initial.bOperand } },
        };
        return {
            cycle: s.cycle,
            warriors: s.warriors.map((w): IWarrior => {
                const warrior: IWarrior = {
                    id: w.id,
                    name: w.metaData.name,
                    author: w.metaData.author,
                    strategy: w.metaData.strategy,
                    startAddress: w.loadAddress,
                    tasks: [],
                    taskIndex: 0,
                };
                if (w.hasData) warrior.data = w.data;
                warrior.tasks = w.queue.toArray().map((instructionPointer) => ({ instructionPointer, warrior }));
                return warrior;
            }),
            warriorIndex: s.nextWarrior,
            options,
            core: { getSize: () => size },
        };
    }

    /** Visualiser hook: live zero-copy access arrays. Replace after each initialise. */
    getCoreView(): ICoreView {
        this.round;
        return this.view!;
    }

    /**
     * The match's P-space as used by this round. Pass it to the next round's
     * initialise to carry it over; clone() it first to replay a round.
     */
    getPSpace(): PSpace {
        return this.round.pspace;
    }

    /** Each warrior's P-space cells (fresh copies), by warriorId. */
    getPSpaceView(): IPSpaceView[] {
        const pspace = this.round.pspace;
        return this.round.warriors.map((w) => pspace.view(w.id));
    }

    /** Visualiser hook: per-warrior process positions, by warriorId. */
    getProcessView(): IWarriorProcessView[] {
        return this.round.warriors.map((w) => ({
            warriorId: w.id,
            alive: w.alive,
            taskCount: w.queue.size,
            instructionPointers: w.queue.toArray(),
            loadAddress: w.loadAddress,
            length: w.length,
        }));
    }
}
