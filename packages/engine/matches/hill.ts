/**
 * Hills (guide.md 10). OWNER: simulator engineer.
 */

import type {
    IHill,
    IHillRanking,
    IHillSubmitResult,
    IHillWarrior,
    IParseResult,
    ISimulatorOptions,
} from '../types.ts';
import { Standard } from '../types.ts';
import { LEGACY_MODES, LEGACY_OPCODES } from '../parser/assembler.ts';
import { DEFAULT_HILL_SIZE, DEFAULT_ROUNDS, PRESETS, resolveOptions, timeSeed } from '../options.ts';
import { createRng } from '../rng.ts';
import { toWarriorInputs } from '../simulator/simulator.ts';
import { runMatch } from './match.ts';

export interface ICreateHillOptions {
    options?: ISimulatorOptions;
    rounds?: number;
    hillSize?: number;
    seed?: number;
}

export function createHill(init: ICreateHillOptions = {}): IHill {
    const hill: IHill = {
        options: { ...(init.options ?? PRESETS.standard) },
        rounds: init.rounds ?? DEFAULT_ROUNDS,
        hillSize: init.hillSize ?? DEFAULT_HILL_SIZE,
        warriors: [],
    };
    if (init.seed !== undefined) hill.seed = init.seed;
    return hill;
}

/**
 * True when the source decodes, fits the hill's instructionLimit, and uses only
 * the opcodes and modes of the hill's standard (guide.md: a submission that
 * fails to parse under the hill settings is rejected). Modifiers can't be
 * checked here: the load format always carries one, explicit or defaulted.
 */
function acceptable(source: IParseResult, options: ISimulatorOptions): boolean {
    try {
        const [input] = toWarriorInputs([source]);
        const resolved = resolveOptions({ ...options, seed: 0 });
        const { instructions } = input!.program;
        if (instructions.length > resolved.instructionLimit) return false;
        if (resolved.standard === Standard.ICWS94draft) return true;
        return instructions.every(
            (ins) => LEGACY_OPCODES.has(ins.opcode) && LEGACY_MODES.has(ins.aMode) && LEGACY_MODES.has(ins.bMode),
        );
    } catch {
        return false;
    }
}

/**
 * Submit a parsed warrior: reject on parse errors; otherwise play a season
 * (every pair, hill.rounds each), rank by average score (ties: wins, age,
 * earlier submission), push off the worst while over hillSize, age survivors.
 * Returns a new hill; the input hill is not mutated. A warrior with the same
 * id as one already on the hill replaces it.
 */
export function submitToHill(hill: IHill, id: string, source: IParseResult): IHillSubmitResult {
    if (!acceptable(source, hill.options)) return { accepted: false, hill, ranking: [], pushedOff: [] };

    const submitted = hill.warriors.reduce((max, w) => Math.max(max, w.submitted), -1) + 1;
    const contenders: IHillWarrior[] = [...hill.warriors.filter((w) => w.id !== id), { id, source, age: 0, submitted }];
    const rng = createRng(hill.seed ?? timeSeed());
    const tallies = contenders.map((warrior) => ({ warrior, given: 0, won: 0, drawn: 0, lost: 0 }));

    for (let i = 0; i < contenders.length; i++) {
        for (let j = i + 1; j < contenders.length; j++) {
            const result = runMatch({
                rounds: hill.rounds,
                options: hill.options,
                warriors: [{ source: contenders[i]!.source }, { source: contenders[j]!.source }],
                seed: rng.nextUint32(),
            });
            for (const [index, r] of [[i, result.warriors[0]!], [j, result.warriors[1]!]] as const) {
                const t = tallies[index]!;
                t.given += r.given;
                t.won += r.won;
                t.drawn += r.drawn;
                t.lost += r.lost;
            }
        }
    }

    const opponents = contenders.length - 1;
    const ranking: IHillRanking[] = tallies
        .map((t) => ({ warrior: t.warrior, score: opponents > 0 ? t.given / opponents : 0, won: t.won, drawn: t.drawn, lost: t.lost }))
        .sort(
            (x, y) =>
                y.score - x.score ||
                y.won - x.won ||
                y.warrior.age - x.warrior.age ||
                x.warrior.submitted - y.warrior.submitted,
        );

    const survivors = ranking.slice(0, hill.hillSize).map((r) => r.warrior);
    const pushedOff = ranking.slice(hill.hillSize).map((r) => r.warrior);
    return {
        accepted: true,
        hill: { ...hill, warriors: survivors.map((w) => ({ ...w, age: w.age + 1 })) },
        ranking,
        pushedOff,
    };
}
