/**
 * P-space (spec/pspace.md): each warrior's private memory that survives from
 * one round of a match to the next. OWNER: simulator engineer.
 *
 * - Every warrior has `size` cells holding values in [0, coresize). LDP and
 *   STP index it modulo `size`.
 * - Warriors with the same PIN share one array of cells. A warrior without a
 *   PIN has its own.
 * - Cell 0 is the result cell. It is private to each warrior, even when the
 *   rest is shared, and the simulator sets it at the end of every round: 0
 *   when the warrior died, otherwise the number of warriors still alive.
 *   Before the first round it holds -1 (coresize - 1). STP to cell 0 changes
 *   the warrior's own result cell until the round ends.
 * - Every other cell starts at 0.
 *
 * One PSpace lives for a whole match: pass it to every round's initialise
 * (Simulator.initialise / initialiseWarriors). A new PSpace is a new match.
 */

import type { IPSpaceView } from '../types.ts';
import { fold } from '../instruction.ts';

export class PSpace {
    /** Cells of each warrior; warriors with the same PIN share one array. Index 0 is unused. */
    private readonly cells: Int32Array[];
    /** Each warrior's result cell (cell 0). */
    private readonly results: Int32Array;

    /**
     * @param pins     one entry per warrior: its PIN, or null for a private P-space
     * @param size     cells per P-space (the pSpaceSize option)
     * @param coresize values are kept in [0, coresize)
     */
    constructor(
        readonly pins: readonly (number | null)[],
        readonly size: number,
        readonly coresize: number,
    ) {
        if (!Number.isInteger(size) || size < 1) throw new Error(`P-space size must be a positive integer, got ${size}`);
        if (!Number.isInteger(coresize) || coresize < 1) throw new Error(`coresize must be a positive integer, got ${coresize}`);
        const shared = new Map<number, Int32Array>();
        this.cells = pins.map((pin) => {
            if (pin === null) return new Int32Array(size);
            let cells = shared.get(pin);
            if (!cells) shared.set(pin, (cells = new Int32Array(size)));
            return cells;
        });
        this.results = new Int32Array(pins.length).fill(coresize - 1);
    }

    /** Number of warriors. */
    get warriorCount(): number {
        return this.pins.length;
    }

    /** LDP: the value of cell `index` (any integer; taken modulo size) for warrior `warriorId`. */
    load(warriorId: number, index: number): number {
        const i = index % this.size;
        return i === 0 ? this.results[warriorId]! : this.cells[warriorId]![i]!;
    }

    /** STP: store `value` (already in [0, coresize)) into cell `index` modulo size. */
    store(warriorId: number, index: number, value: number): void {
        const i = index % this.size;
        if (i === 0) this.results[warriorId] = value;
        else this.cells[warriorId]![i] = value;
    }

    /** End of a round: each warrior's result cell becomes 0 if it died, else the number of survivors. */
    recordRound(alive: readonly boolean[]): void {
        let survivors = 0;
        for (const a of alive) if (a) survivors++;
        for (let w = 0; w < this.results.length; w++) this.results[w] = alive[w] ? fold(survivors, this.coresize) : 0;
    }

    /** An independent copy with the same contents and sharing (for replaying a round). */
    clone(): PSpace {
        const copy = new PSpace(this.pins, this.size, this.coresize);
        copy.results.set(this.results);
        const done = new Set<Int32Array>();
        this.cells.forEach((cells, w) => {
            if (done.has(cells)) return;
            done.add(cells);
            copy.cells[w]!.set(cells);
        });
        return copy;
    }

    /** A fresh copy of warrior `warriorId`'s cells as LDP sees them. */
    view(warriorId: number): IPSpaceView {
        const cells = Array.from(this.cells[warriorId]!);
        cells[0] = this.results[warriorId]!;
        return { warriorId, pin: this.pins[warriorId]!, cells };
    }
}
