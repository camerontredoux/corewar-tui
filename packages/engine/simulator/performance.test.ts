import { describe, expect, test } from 'bun:test';
import type { IParseResult } from '../types.ts';
import { Simulator } from './simulator.ts';
import { warrior } from './testing.ts';

// Two warriors that always survive to the cycle limit, so every round runs all 80000 cycles:
// an imp, and a splitter that fills its queue to maxTasks and keeps incrementing a counter.
// (When the imp reaches the splitter it turns it into more imps; still a draw.)
const IMP = warrior(['MOV.I $0, $1']);
const SPINNER = warrior(['SPL.B $0, $0', 'ADD.AB #7, $2', 'JMP.B $-1, $0', 'DAT.F #0, #0']);

function msPerRound(parseResults: IParseResult[], trackAccess: boolean, rounds: number): number {
    const sim = new Simulator();
    sim.initialise({ seed: 1, trackAccess }, parseResults);
    sim.runRound(); // warm-up
    const start = performance.now();
    for (let r = 0; r < rounds; r++) {
        sim.initialise({ seed: r, trackAccess, firstWarrior: r % parseResults.length }, parseResults);
        const result = sim.runRound();
        expect(sim.getCoreView().cycle).toBe(80000);
        expect(result.outcome).toBe('DRAW');
    }
    return (performance.now() - start) / rounds;
}

describe('performance (2 warriors, 80000 cycles, standard core)', () => {
    // 100 rounds each with a null provider (ARCHITECTURE.md 10). Limits are generous to avoid flakiness.
    test('access tracking off: under 50 ms per round', () => {
        const ms = msPerRound([IMP, SPINNER], false, 100);
        console.log(`trackAccess off: ${ms.toFixed(2)} ms/round`);
        expect(ms).toBeLessThan(50);
    });

    test('access tracking on (TUI): under 100 ms per round', () => {
        const ms = msPerRound([IMP, SPINNER], true, 100);
        console.log(`trackAccess on: ${ms.toFixed(2)} ms/round`);
        expect(ms).toBeLessThan(100);
    });
});
