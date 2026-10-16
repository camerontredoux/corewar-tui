/**
 * Our side of the pMARS differential tests: assemble, run one round, run a
 * match and trace a round with this engine, in the normalised forms that
 * pmars.ts produces from pMARS output. Used by oracle.test.ts (against the
 * recorded fixtures) and by run.ts (against a live ./pmars).
 */

import { MessageType, Opcode, type IParseOptions, type IParseResult, type IPSpaceView, type ISimulatorOptions } from '../types.ts';
import { MODE_SYMBOLS, MODIFIER_NAMES, OPCODE_NAMES, fold, type IInstructionSpec } from '../instruction.ts';
import { readLoadFormat } from '../loadformat.ts';
import { parse } from '../parser/index.ts';
import { defaultPSpaceSize } from '../options.ts';
import { Simulator } from '../simulator/simulator.ts';
import type { PSpace } from '../simulator/pspace.ts';

/** One pMARS command-line configuration: -s -c -p -l -d, and -S when `pspace` is set. */
export interface IOracleSettings {
    coresize: number;
    cycles: number;
    processes: number;
    length: number;
    distance: number;
    /** P-space size (-S); the default follows the core size. */
    pspace?: number;
}

/** A load file: start offset and instructions as `OPC.MOD m n, m n`, numbers folded into [0, coresize), and the PIN. */
export interface IAssembly {
    ok: boolean;
    start: number;
    instructions: string[];
    /** The PIN line's value, when there is one. */
    pin?: number;
}

/** The P-space size the settings give. */
export const pspaceSize = (s: IOracleSettings): number => s.pspace ?? defaultPSpaceSize(s.coresize);

/**
 * A warrior's P-space as the pMARS debugger shows it: cell 0 in angle
 * brackets, then the next cells, at most 10 in all (the debugger shows
 * whatever follows a smaller P-space, so those cells are not compared).
 */
export function pspaceText(cells: readonly number[], size: number): string {
    const shown = cells.slice(0, Math.min(size, 10));
    return [`<${shown[0]}>`, ...shown.slice(1)].join(' ');
}

const ourPSpaceTexts = (views: readonly IPSpaceView[], s: IOracleSettings): string[] => views.map((v) => pspaceText(v.cells, pspaceSize(s)));

/** One round: the winner's index (null for a tie) and the pMARS cycle in which the round ended. */
export interface IRoundOutcome {
    winner: number | null;
    /** Pass over the warriors (1-based) of the last execution; `cycles` for a tie. */
    end: number;
}

/** Our round outcome plus the number of instructions executed. */
export interface IOurRound extends IRoundOutcome {
    executions: number;
}

/** Match totals, as pMARS prints them: wins of warrior 1, wins of warrior 2, ties. */
export type IMatchTotals = [number, number, number];

export function parseOptions(s: IOracleSettings): IParseOptions {
    return { coresize: s.coresize, maximumCycles: s.cycles, maxTasks: s.processes, instructionLimit: s.length, minSeparation: s.distance, pSpaceSize: pspaceSize(s) };
}

/** Two warriors, warrior 1 at 0 and warrior 2 at `position` (pMARS -F), counted in pMARS cycles. */
export function simulatorOptions(s: IOracleSettings, position: number, firstWarrior = 0): ISimulatorOptions {
    return {
        coresize: s.coresize,
        maximumCycles: s.cycles,
        maxTasks: s.processes,
        instructionLimit: s.length,
        minSeparation: s.distance,
        pSpaceSize: pspaceSize(s),
        cycleUnit: 'pmars',
        loadAddresses: [0, position],
        firstWarrior,
        seed: 0,
        trackAccess: false,
    };
}

/** `OPC.MOD m n, m n` with folded numbers. `cmpAsSeq` merges CMP into SEQ (they are one opcode in core). */
export function formatInstruction(spec: IInstructionSpec, coresize: number, cmpAsSeq = false): string {
    const opcode = cmpAsSeq && spec.opcode === Opcode.CMP ? Opcode.SEQ : spec.opcode;
    const a = `${MODE_SYMBOLS[spec.aMode]}${fold(spec.aNumber, coresize)}`;
    const b = `${MODE_SYMBOLS[spec.bMode]}${fold(spec.bNumber, coresize)}`;
    return `${OPCODE_NAMES[opcode]}.${MODIFIER_NAMES[spec.modifier]} ${a}, ${b}`;
}

const hasErrors = (r: IParseResult): boolean => r.messages.some((m) => m.type === MessageType.Error);

/** Assembles as `pmars -A` does: one warrior, so WARRIORS is 1. */
export function ourAssembly(source: string, s: IOracleSettings): IAssembly {
    const result = parse(source, { ...parseOptions(s), warriors: 1 });
    if (hasErrors(result)) return { ok: false, start: 0, instructions: [] };
    const program = readLoadFormat(result.tokens);
    const out: IAssembly = {
        ok: true,
        start: fold(program.startOffset, s.coresize),
        instructions: program.instructions.map((spec) => formatInstruction(spec, s.coresize)),
    };
    if (program.pin !== undefined) out.pin = program.pin;
    return out;
}

function parseAll(sources: readonly string[], s: IOracleSettings): IParseResult[] {
    return sources.map((source, i) => {
        const result = parse(source, parseOptions(s));
        if (hasErrors(result)) throw new Error(`warrior ${i + 1} does not assemble: ${result.messages[0]?.text}`);
        return result;
    });
}

/**
 * One round with warrior 1 (or `firstWarrior`) moving first. `pspace` is the
 * P-space left by the previous round of the match (null: round 1); the round
 * leaves its own in `pspaceAfter`.
 */
export function ourRound(sources: readonly string[], s: IOracleSettings, position: number, firstWarrior = 0, pspace: PSpace | null = null): IOurRound & { pspaceAfter: PSpace } {
    const sim = new Simulator();
    sim.initialise(simulatorOptions(s, position, firstWarrior), parseAll(sources, s), null, pspace);
    const view = sim.getCoreView();
    let passesBefore = 0;
    let executions = 0;
    while (sim.isRunning) {
        passesBefore = view.cycle;
        sim.step(1);
        executions++;
    }
    const result = sim.result!;
    const pspaceAfter = sim.getPSpace();
    return result.outcome === 'WIN'
        ? { winner: result.winnerId, end: passesBefore + 1, executions, pspaceAfter }
        : { winner: null, end: s.cycles, executions, pspaceAfter };
}

/**
 * How a later round starts, as the pMARS debugger shows it: first mover, each
 * warrior's task pointer and each warrior's P-space (pspaceText), in warrior order.
 */
export interface IRoundStartRecord {
    first: number;
    heads: [number, number];
    pspace: [string, string];
}

/** Totals of a match, each round's execution count, and disagreements with the recorded round starts. */
export interface IOurMatch {
    totals: IMatchTotals;
    rounds: IOurRound[];
    problems: string[];
}

/**
 * A pMARS `-r n -F position` match: round 1 with warrior 2 at `position`,
 * later rounds where `starts` puts it (pMARS places them at random). The
 * first mover rotates as in runMatch (round r: warrior r mod 2); each
 * recorded start is checked against that and against warrior 1 at 0.
 * Rounds without a recorded start are not played.
 */
export function ourMatch(sources: readonly string[], s: IOracleSettings, position: number, starts: readonly IRoundStartRecord[]): IOurMatch {
    const origins = sources.map((source) => ourAssembly(source, s).start);
    const totals: IMatchTotals = [0, 0, 0];
    const rounds: IOurRound[] = [];
    const problems: string[] = [];
    let pspace: PSpace | null = null;
    const play = (at: number, first: number): void => {
        const { pspaceAfter, ...round } = ourRound(sources, s, at, first, pspace);
        pspace = pspaceAfter;
        totals[round.winner ?? 2]!++;
        rounds.push(round);
    };
    play(position, 0);
    starts.forEach((start, i) => {
        const r = i + 1;
        if (start.first !== r % 2) problems.push(`round ${r + 1}: pMARS moves warrior ${start.first + 1} first, we move warrior ${(r % 2) + 1}`);
        if (fold(start.heads[0] - origins[0]!, s.coresize) !== 0) problems.push(`round ${r + 1}: pMARS loads warrior 1 away from 0`);
        const ours = ourPSpaceTexts([pspace!.view(0), pspace!.view(1)], s);
        ours.forEach((text, w) => {
            if (text !== start.pspace[w]) problems.push(`round ${r + 1}: warrior ${w + 1} starts with P-space ${text}, pMARS ${start.pspace[w]}`);
        });
        play(fold(start.heads[1] - origins[1]!, s.coresize), r % 2);
    });
    return { totals, rounds, problems };
}

/**
 * Executions after which a trace records the state: every one up to 32,
 * then every 16th up to `limit`.
 */
export function checkpoints(limit: number): number[] {
    const out: number[] = [];
    for (let k = 1; k <= limit; k += k < 32 ? 1 : 16) out.push(k);
    return out;
}

/**
 * The state after each checkpoint execution count, while the round runs:
 * every core cell that is not DAT.F $0, $0, the warrior to move next, the
 * completed passes, each warrior's task count and next pointer, and each
 * warrior's P-space (pspaceText).
 */
export function ourTrace(sources: readonly string[], s: IOracleSettings, position: number, ks: readonly number[]): string[] {
    const sim = new Simulator();
    sim.initialise(simulatorOptions(s, position), parseAll(sources, s), null);
    const view = sim.getCoreView();
    const states: string[] = [];
    let done = 0;
    for (const k of ks) {
        sim.step(k - done);
        done = k;
        if (!sim.isRunning) break;
        const cells: string[] = [];
        for (let address = 0; address < s.coresize; address++) {
            const ins = sim.getWithInfoAt(address).instruction;
            const spec: IInstructionSpec = {
                opcode: ins.opcode,
                modifier: ins.modifier,
                aMode: ins.aOperand.mode,
                aNumber: ins.aOperand.address,
                bMode: ins.bOperand.mode,
                bNumber: ins.bOperand.address,
            };
            const text = formatInstruction(spec, s.coresize, true);
            if (text !== 'DAT.F $0, $0') cells.push(`${address} ${text}`);
        }
        const queues = sim.getProcessView().map((w) => queueText(w.warriorId, w.taskCount, w.instructionPointers[0]));
        const pspaces = ourPSpaceTexts(sim.getPSpaceView(), s);
        states.push(stateText(cells, sim.getState().warriorIndex + 1, view.cycle, queues, pspaces));
    }
    return states;
}

/**
 * A warrior's task count and next instruction pointer. The pMARS debugger
 * shows the rest of a queue only partially, so the order of later tasks is
 * checked through the next pointer at successive checkpoints.
 */
export function queueText(warriorId: number, count: number, head: number | undefined): string {
    return `q${warriorId + 1} ${count}@${head ?? '-'}`;
}

/** The one textual state format both sides produce. */
export function stateText(cells: readonly string[], next: number, passes: number, queues: readonly string[], pspaces: readonly string[]): string {
    return [...cells, `next ${next}`, `passes ${passes}`, ...queues, ...pspaces.map((p, w) => `p${w + 1} ${p}`)].join('\n');
}

/** CRC-32 of a trace, so fixtures stay small. */
export function traceHash(states: readonly string[]): string {
    return Bun.hash.crc32(states.join('\n--\n')).toString(16).padStart(8, '0');
}
