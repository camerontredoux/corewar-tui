/**
 * Seedable PRNG (mulberry32). Same seed, same sequence, on every platform.
 *
 * OWNER: architect. FROZEN after the scaffold phase.
 */

export interface IRng {
    /** Uniform float in [0, 1). */
    next(): number;
    /** Uniform integer in [0, n). n must be a positive integer. */
    nextInt(n: number): number;
    /** Uniform uint32; used to derive per-round seeds from a match seed. */
    nextUint32(): number;
}

export function createRng(seed: number): IRng {
    let state = seed >>> 0;
    const nextUint32 = (): number => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return (t ^ (t >>> 14)) >>> 0;
    };
    return {
        nextUint32,
        next: () => nextUint32() / 0x100000000,
        nextInt: (n: number) => Math.floor((nextUint32() / 0x100000000) * n),
    };
}
