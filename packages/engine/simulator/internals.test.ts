import { describe, expect, test } from 'bun:test';
import { resolveOptions } from '../options.ts';
import { createRng } from '../rng.ts';
import { Core } from './core.ts';
import { placeWarriors } from './loader.ts';
import { ProcessQueue } from './processes.ts';
import { ins } from './testing.ts';

describe('ProcessQueue', () => {
    test('is FIFO across the ring wrap and never exceeds its capacity', () => {
        const q = new ProcessQueue(3);
        q.push(1);
        q.push(2);
        q.push(3);
        expect(q.shift()).toBe(1);
        q.push(4);
        expect(q.toArray()).toEqual([2, 3, 4]);
        expect([q.shift(), q.shift(), q.peek(), q.size]).toEqual([2, 3, 4, 1]);
        q.clear();
        expect(q.size).toBe(0);
        expect(q.toArray()).toEqual([]);
    });
});

describe('Core', () => {
    test('stores folded fields and reads them back', () => {
        const core = new Core(80, ins('DAT.F $0, $0'));
        core.write(-1, ins('MOV.I <-3, >83'));
        expect(core.read(79)).toEqual(ins('MOV.I <77, >3'));
        expect(core.read(0)).toEqual(ins('DAT.F $0, $0'));
    });
});

describe('placeWarriors', () => {
    const options = (o = {}) => resolveOptions({ seed: 0, ...o });

    test('warrior 0 at 0; others keep at least minSeparation and their length both ways', () => {
        const rng = createRng(1);
        for (let trial = 0; trial < 200; trial++) {
            const at = placeWarriors([5, 5, 5], options({ coresize: 400, minSeparation: 100 }), rng);
            expect(at[0]).toBe(0);
            for (let i = 0; i < 3; i++) {
                for (let j = 0; j < 3; j++) {
                    if (i !== j) expect((at[j]! - at[i]! + 400) % 400).toBeGreaterThanOrEqual(100);
                }
            }
        }
    });

    test('a long warrior widens its gap beyond minSeparation', () => {
        const rng = createRng(2);
        for (let trial = 0; trial < 100; trial++) {
            const [, b] = placeWarriors([150, 10], options({ coresize: 400, minSeparation: 10, instructionLimit: 150 }), rng);
            expect(b!).toBeGreaterThanOrEqual(150);
            expect(b!).toBeLessThanOrEqual(390);
        }
    });

    test('a tight fit leaves exactly one place; no fit throws', () => {
        expect(placeWarriors([1, 1], options({ coresize: 200, minSeparation: 100 }), createRng(3))).toEqual([0, 100]);
        expect(() => placeWarriors([1, 1, 1], options({ coresize: 200, minSeparation: 100 }), createRng(3))).toThrow('Cannot place warrior 2');
    });

    test('positions are uniform over the legal range', () => {
        const rng = createRng(4);
        const counts = new Map<number, number>();
        for (let i = 0; i < 3000; i++) {
            const b = placeWarriors([1, 1], options({ coresize: 206, minSeparation: 100 }), rng)[1]!;
            counts.set(b, (counts.get(b) ?? 0) + 1);
        }
        expect([...counts.keys()].sort((x, y) => x - y)).toEqual([100, 101, 102, 103, 104, 105, 106]);
        for (const c of counts.values()) expect(c).toBeGreaterThan(300);
    });
});
