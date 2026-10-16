/**
 * Per-warrior FIFO task queue on a fixed Int32Array ring buffer (capacity
 * maxTasks, never reallocated). OWNER: simulator engineer. Internal.
 */

export class ProcessQueue {
    private readonly buffer: Int32Array;
    private head = 0;
    private count = 0;

    constructor(readonly capacity: number) {
        this.buffer = new Int32Array(capacity);
    }

    get size(): number {
        return this.count;
    }

    /** Append an instruction pointer at the tail. Caller guarantees size < capacity. */
    push(ip: number): void {
        let tail = this.head + this.count;
        if (tail >= this.capacity) tail -= this.capacity;
        this.buffer[tail] = ip;
        this.count++;
    }

    /** Remove and return the head instruction pointer. Caller guarantees size > 0. */
    shift(): number {
        const ip = this.buffer[this.head]!;
        this.head = this.head + 1 === this.capacity ? 0 : this.head + 1;
        this.count--;
        return ip;
    }

    /** The head instruction pointer without removing it. Caller guarantees size > 0. */
    peek(): number {
        return this.buffer[this.head]!;
    }

    /** Instruction pointers, head first (fresh array). */
    toArray(): number[] {
        const out: number[] = [];
        for (let i = 0, at = this.head; i < this.count; i++, at = at + 1 === this.capacity ? 0 : at + 1) {
            out.push(this.buffer[at]!);
        }
        return out;
    }

    clear(): void {
        this.head = 0;
        this.count = 0;
    }
}
