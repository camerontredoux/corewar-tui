import { describe, expect, test } from 'bun:test';
import { DEFAULT_INITIAL_INSTRUCTION, PRESETS, resolveOptions } from './options.ts';
import { createRng } from './rng.ts';
import { Standard } from './types.ts';

describe('resolveOptions', () => {
    test('applies the developer.md defaults', () => {
        const o = resolveOptions({});
        expect(o).toMatchObject({
            coresize: 8000, maximumCycles: 80000, instructionLimit: 100, maxTasks: 8000,
            minSeparation: 100, standard: Standard.ICWS94draft, readDistance: 8000, writeDistance: 8000,
            cycleUnit: 'execution', firstWarrior: 0, trackAccess: true, loadAddresses: null,
        });
        expect(o.initialInstruction).toEqual(DEFAULT_INITIAL_INSTRUCTION);
    });

    test('merges partial options field by field; distances follow coresize', () => {
        const o = resolveOptions({ coresize: 800, seed: 7 });
        expect(o).toMatchObject({ coresize: 800, maximumCycles: 80000, readDistance: 800, seed: 7 });
    });

    test('rejects invalid values with a descriptive error', () => {
        expect(() => resolveOptions({ coresize: 0 })).toThrow('coresize');
        expect(() => resolveOptions({ minSeparation: -1 })).toThrow('minSeparation');
        expect(() => resolveOptions({ standard: 9 as Standard })).toThrow('standard');
        expect(() => resolveOptions({ coresize: 8000, readDistance: 3000 })).toThrow('divide');
    });

    test('nano preset has core size 80', () => {
        expect(resolveOptions(PRESETS.nano).coresize).toBe(80);
    });
});

test('rng: the same seed reproduces the same sequence', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 5 }, () => a.nextInt(8000));
    expect(Array.from({ length: 5 }, () => b.nextInt(8000))).toEqual(seqA);
    expect(seqA.every((n) => n >= 0 && n < 8000)).toBe(true);
});
