/**
 * Recorded pMARS answers (fixtures/*.json, written by run.ts) and the
 * comparisons against this engine, shared by oracle.test.ts and run.ts.
 */

import { join } from 'node:path';
import type { ICorpusEntry } from './corpus.ts';
import { ourAssembly, ourMatch, ourTrace, traceHash, type IAssembly, type IMatchTotals, type IOracleSettings, type IRoundStartRecord } from './ours.ts';

export const FIXTURES = join(import.meta.dir, 'fixtures');

/** Fuzz pairs: rounds per match and the trace length in executions. */
export const FUZZ_ROUNDS = 4;
export const FUZZ_LIMIT = 1000;
/** Named warriors: rounds per match and trace checkpoints (the core has 8000 cells). */
export const NAMED_ROUNDS = 10;
export const BATTLE_CHECKPOINTS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 100, 1000, 10000];

/**
 * Corpus entries where we deliberately differ from pMARS, with the reason.
 * Keyed by corpus entry name.
 */
export const ASSEMBLY_EXCEPTIONS: Readonly<Record<string, string>> = {
    'label on its own line before for':
        'redcode.md 8.4 binds a label-only line to the next instruction, and the docs FOR example depends on it; pMARS makes the label the loop counter',
    'trailing label': 'we resolve a label after the last instruction to the warrior length; pMARS rejects it as undefined (a superset, redcode.md 8.4)',
};

export interface IAssemblyFixture {
    settings: IOracleSettings;
    entries: (ICorpusEntry & { pmars: IAssembly })[];
}

export interface IBattleRecord {
    /** Round 1 winner (0 or 1), -1 for a tie. */
    winner: number;
    end: number;
    /** `-r rounds -F pos` totals. */
    match: IMatchTotals;
    /** Starts of rounds 2.. as the debugger showed them; shorter than rounds - 1 when one could not be found. */
    starts: IRoundStartRecord[];
    /** Number of trace states and their hash. */
    trace: [number, string];
}

export interface IBattleFixture {
    settings: IOracleSettings;
    rounds: number;
    checkpoints: readonly number[];
    warriors: ICorpusEntry[];
    pairs: ({ w: [number, number]; pos: number } & IBattleRecord)[];
}

export interface IFuzzFixture {
    settings: readonly IOracleSettings[];
    rounds: number;
    limit: number;
    warriors: string[];
    pairs: ({ s: number; w: [number, number]; pos: number } & IBattleRecord)[];
}

export function compareAssembly(fixture: IAssemblyFixture): string[] {
    const problems: string[] = [];
    for (const entry of fixture.entries) {
        if (entry.name in ASSEMBLY_EXCEPTIONS) continue;
        const ours = ourAssembly(entry.source, fixture.settings);
        const theirs = entry.pmars;
        if (ours.ok !== theirs.ok) {
            problems.push(`assembly '${entry.name}': pMARS ${theirs.ok ? 'accepts' : 'rejects'} it, we ${ours.ok ? 'accept' : 'reject'} it`);
        } else if (ours.start !== theirs.start) {
            problems.push(`assembly '${entry.name}': start ${ours.start}, pMARS ${theirs.start}`);
        } else if (ours.pin !== theirs.pin) {
            problems.push(`assembly '${entry.name}': PIN ${ours.pin ?? 'none'}, pMARS ${theirs.pin ?? 'none'}`);
        } else {
            const n = Math.max(ours.instructions.length, theirs.instructions.length);
            for (let i = 0; i < n; i++) {
                if (ours.instructions[i] !== theirs.instructions[i]) {
                    problems.push(`assembly '${entry.name}' line ${i + 1}: ours '${ours.instructions[i]}', pMARS '${theirs.instructions[i]}'`);
                    break;
                }
            }
        }
    }
    return problems;
}

/** Differences between a recorded pMARS battle and this engine, as messages. */
export function compareBattle(
    sources: readonly string[],
    s: IOracleSettings,
    rounds: number,
    ks: readonly number[],
    pair: { w: [number, number]; pos: number } & IBattleRecord,
): string[] {
    const pairSources = [sources[pair.w[0]]!, sources[pair.w[1]]!];
    const label = `battle w${pair.w[0]} vs w${pair.w[1]} at ${pair.pos} (core ${s.coresize}, ${s.processes} processes)`;
    const problems: string[] = [];
    // Round 1 is the match's first round; later rounds replay pMARS's placements.
    const match = ourMatch(pairSources, s, pair.pos, pair.starts);
    const round = match.rounds[0]!;
    if ((round.winner ?? -1) !== pair.winner || round.end !== pair.end) {
        problems.push(`${label}: round 1 winner ${round.winner ?? 'none'} in cycle ${round.end}, pMARS ${pair.winner < 0 ? 'none' : pair.winner} in cycle ${pair.end}`);
    }
    if (pair.starts.length !== rounds - 1) {
        problems.push(`${label}: pMARS round ${pair.starts.length + 2} did not start where our round ${pair.starts.length + 1} ended`);
    } else {
        problems.push(...match.problems.map((p) => `${label}: ${p}`));
        if (match.totals.join() !== pair.match.join()) problems.push(`${label}: ${rounds} rounds give ${match.totals.join('/')}, pMARS ${pair.match.join('/')}`);
    }
    const trace = ourTrace(pairSources, s, pair.pos, ks);
    if (trace.length !== pair.trace[0] || traceHash(trace) !== pair.trace[1]) {
        problems.push(`${label}: trace differs (${trace.length} states, pMARS ${pair.trace[0]})`);
    }
    return problems;
}
