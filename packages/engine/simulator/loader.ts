/**
 * Placement and loading. OWNER: simulator engineer.
 * Placement rule (ARCHITECTURE.md "Loader"): warrior 0 at address 0; each later
 * warrior uniformly at random among addresses where, against every placed
 * warrior, the circular forward distance each way is >= max(minSeparation,
 * length of the warrior it starts after). Throws if no address fits.
 * options.loadAddresses replaces the random placement; it only has to avoid overlapping code.
 */

import type { IRng } from '../rng.ts';
import type { IResolvedOptions } from '../types.ts';
import type { IWarriorProgram } from '../loadformat.ts';
import type { Core } from './core.ts';

/** Load addresses, one per warrior, in warrior order. */
export function placeWarriors(lengths: readonly number[], options: IResolvedOptions, rng: IRng): number[] {
    const size = options.coresize;
    const minSeparation = options.minSeparation;
    lengths.forEach((length, i) => {
        if (length > size) throw new Error(`Warrior ${i} (${length} instructions) does not fit in a core of ${size}`);
    });

    const placed: number[] = [];
    const fitsWith = (q: number, lq: number, separation: number): boolean => {
        for (let i = 0; i < placed.length; i++) {
            const p = placed[i]!;
            const lp = lengths[i]!;
            const forward = q >= p ? q - p : q - p + size;
            const back = p >= q ? p - q : p - q + size;
            if (forward < Math.max(separation, lp) || back < Math.max(separation, lq)) return false;
        }
        return true;
    };
    const fits = (q: number, lq: number): boolean => fitsWith(q, lq, minSeparation);

    const fixed = options.loadAddresses;
    if (fixed) {
        if (fixed.length !== lengths.length) {
            throw new Error(`Option loadAddresses has ${fixed.length} addresses for ${lengths.length} warriors`);
        }
        fixed.forEach((address, w) => {
            const q = ((address % size) + size) % size;
            if (!fitsWith(q, lengths[w]!, 0)) throw new Error(`Option loadAddresses: warrior ${w} at ${address} overlaps another warrior`);
            placed.push(q);
        });
        return placed;
    }

    for (let w = 0; w < lengths.length; w++) {
        if (w === 0) {
            placed.push(0);
            continue;
        }
        const length = lengths[w]!;
        let count = 0;
        for (let q = 0; q < size; q++) if (fits(q, length)) count++;
        if (count === 0) {
            throw new Error(
                `Cannot place warrior ${w}: ${lengths.length} warriors do not fit in a core of ${size} with minSeparation ${minSeparation}`,
            );
        }
        let pick = rng.nextInt(count);
        for (let q = 0; q < size; q++) {
            if (fits(q, length) && pick-- === 0) {
                placed.push(q);
                break;
            }
        }
    }
    return placed;
}

/** Copy a program into core at `address`, folding every number into [0, coresize). CMP is stored as SEQ. */
export function loadProgram(core: Core, program: IWarriorProgram, address: number): void {
    program.instructions.forEach((spec, i) => core.write(address + i, spec));
}
