/**
 * runMatch (developer.md 4). OWNER: simulator engineer.
 * Per round r: options.seed = per-round seed from createRng(match.seed),
 * options.firstWarrior = r % N; initialise, run, collect ROUND_END.
 * P-space (spec/pspace.md) is fresh for each runMatch call and carried from
 * round to round within it.
 * Publishes MATCH_END once and returns the same payload.
 */

import { MessageTopic, type IMatch, type IMatchResult, type IPublishProvider, type IRoundResult } from '../types.ts';
import { timeSeed } from '../options.ts';
import { createRng } from '../rng.ts';
import { Simulator, toWarriorInputs } from '../simulator/simulator.ts';
import type { PSpace } from '../simulator/pspace.ts';
import { tallyRounds } from './scoring.ts';

export function runMatch(match: IMatch, messageProvider?: IPublishProvider | null): IMatchResult {
    if (!Number.isInteger(match.rounds) || match.rounds < 0) {
        throw new Error(`Match rounds must be a non-negative integer, got ${match.rounds}`);
    }
    const sources = match.warriors.map((w) => w.source);
    const inputs = toWarriorInputs(sources);
    const rng = createRng(match.seed ?? match.options?.seed ?? timeSeed());
    const simulator = new Simulator();
    const rounds: { result: IRoundResult; survivors: boolean[] }[] = [];
    let pspace: PSpace | null = null;

    for (let r = 0; r < match.rounds; r++) {
        const options = { ...match.options, seed: rng.nextUint32(), firstWarrior: r % inputs.length, trackAccess: false };
        simulator.initialiseWarriors(options, inputs, messageProvider, pspace);
        pspace = simulator.getPSpace();
        const result = simulator.runRound();
        rounds.push({ result, survivors: simulator.getProcessView().map((w) => w.alive) });
    }

    const payload: IMatchResult = { rounds: match.rounds, warriors: tallyRounds(sources, rounds) };
    messageProvider?.publishSync(MessageTopic.MATCH_END, payload);
    return payload;
}
