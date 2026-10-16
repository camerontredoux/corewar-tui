/**
 * Scoring helpers (developer.md 4.1.1, guide.md 10). OWNER: simulator engineer.
 */

import type { IMatchWarriorResult, IParseResult, IRoundResult } from '../types.ts';

/** given = win% * 3 + draw%; taken = loss% * 3 + draw% (percent 0-100, unrounded). */
export function scoreCounts(won: number, drawn: number, lost: number, rounds: number): { given: number; taken: number } {
    if (rounds <= 0) return { given: 0, taken: 0 };
    const percent = (n: number): number => (n / rounds) * 100;
    return {
        given: percent(won) * 3 + percent(drawn),
        taken: percent(lost) * 3 + percent(drawn),
    };
}

/**
 * Fold round outcomes into per-warrior results. WIN: winner won, others lost.
 * DRAW and NONE: a warrior that survived to the cycle limit drew, a dead one lost
 * (guide.md 1: "all survivors draw"). Without `survivors`, DRAW counts as drawn for
 * everyone and NONE as lost.
 */
export function tallyRounds(
    sources: readonly IParseResult[],
    rounds: readonly { result: IRoundResult; survivors?: readonly boolean[] }[],
): IMatchWarriorResult[] {
    return sources.map((source, id): IMatchWarriorResult => {
        let won = 0;
        let drawn = 0;
        let lost = 0;
        for (const { result, survivors } of rounds) {
            if (result.outcome === 'WIN') {
                if (result.winnerId === id) won++;
                else lost++;
            } else if (survivors ? survivors[id] : result.outcome === 'DRAW') drawn++;
            else lost++;
        }
        return { source, won, drawn, lost, ...scoreCounts(won, drawn, lost, rounds.length) };
    });
}
