/** Test doubles shared by the TUI tests: a scriptable simulator and parse results. */

import {
    AccessType,
    MessageType,
    Mode,
    Modifier,
    Opcode,
    PSpace,
    type ICoreLocation,
    type ICoreView,
    type IParseResult,
    type IPSpaceView,
    type IPublishProvider,
    type IRoundResult,
    type ISimulatorOptions,
    type IWarriorProcessView,
} from '../engine/index.ts';
import type { CapturedFrame, RGBA } from '@opentui/core';
import type { SimulatorLike } from './controller.ts';

export function fakeParseResult(name: string, errors: string[] = []): IParseResult {
    return {
        metaData: { name, author: '', strategy: '' },
        tokens: [],
        messages: errors.map((text) => ({ type: MessageType.Error, position: { line: 1, char: 1 }, text })),
    };
}

/** A mutable ICoreView of the given size. */
export function fakeView(size: number): ICoreView & { executions: number; cycle: number; lastExecuted: number; nextWarrior: number } {
    return {
        size,
        accessKind: new Uint8Array(size),
        accessWarrior: new Uint8Array(size),
        accessStamp: new Uint32Array(size),
        executions: 0,
        cycle: 0,
        lastExecuted: -1,
        nextWarrior: 0,
    };
}

/**
 * Deterministic fake: warrior w is loaded at w * (size / n); each execution
 * runs the next warrior in turn at its next address. The round ends at
 * `options.maximumCycles` (DRAW) or at `winAt` executions with `winner` winning.
 * It keeps a real PSpace (8 cells, no PINs) and records each round's result in it.
 */
export class FakeSimulator implements SimulatorLike {
    initialised: { options: ISimulatorOptions; sources: IParseResult[]; pspace: PSpace | null }[] = [];
    view = fakeView(1);
    winAt = Infinity;
    winner = 0;
    failInit: string | null = null;
    private n = 0;
    private max = 0;
    private ended: IRoundResult | undefined;
    private ips: number[] = [];
    private pspace: PSpace | null = null;

    initialise(options: ISimulatorOptions, sources: IParseResult[], _provider?: IPublishProvider | null, pspace?: PSpace | null): void {
        if (this.failInit) throw new Error(this.failInit);
        this.initialised.push({ options, sources, pspace: pspace ?? null });
        this.pspace = pspace ?? new PSpace(sources.map(() => null), 8, options.coresize ?? 8000);
        const size = options.coresize ?? 8000;
        this.view = fakeView(size);
        this.n = sources.length;
        this.max = options.maximumCycles ?? 80000;
        this.ended = undefined;
        this.ips = sources.map((_, w) => Math.floor((w * size) / sources.length));
    }

    step(steps = 1): boolean {
        for (let i = 0; i < steps && !this.ended; i++) {
            const v = this.view;
            const w = v.executions % this.n;
            const a = this.ips[w]!;
            v.executions++;
            v.cycle = v.executions;
            v.accessKind[a] = AccessType.execute + 1;
            v.accessWarrior[a] = w;
            v.accessStamp[a] = v.executions;
            v.lastExecuted = a;
            this.ips[w] = (a + 1) % v.size;
            v.nextWarrior = v.executions % this.n;
            if (v.executions >= this.winAt) this.ended = { winnerId: this.winner, outcome: 'WIN' };
            else if (v.executions >= this.max) this.ended = { winnerId: null, outcome: 'DRAW' };
            if (this.ended) this.pspace!.recordRound(this.getProcessView().map((p) => p.alive));
        }
        return !this.ended;
    }

    getCoreView(): ICoreView {
        return this.view;
    }

    getProcessView(): IWarriorProcessView[] {
        return this.ips.map((ip, w) => {
            const alive = !(this.ended?.outcome === 'WIN' && w !== this.winner);
            return { warriorId: w, alive, taskCount: alive ? 1 : 0, instructionPointers: alive ? [ip] : [], loadAddress: Math.floor((w * this.view.size) / this.n), length: 4 };
        });
    }

    getPSpace(): PSpace {
        if (!this.pspace) throw new Error('Simulator not initialised');
        return this.pspace;
    }

    getPSpaceView(): IPSpaceView[] {
        return this.ips.map((_, w) => this.getPSpace().view(w));
    }

    getWithInfoAt(address: number): ICoreLocation {
        const v = this.view;
        const kind = v.accessKind[address]!;
        return {
            instruction: {
                address,
                opcode: Opcode.MOV,
                modifier: Modifier.I,
                aOperand: { mode: Mode.Direct, address: 0 },
                bOperand: { mode: Mode.Direct, address: 1 },
            },
            access: kind ? { warriorId: v.accessWarrior[address]!, accessType: kind - 1, address } : undefined,
        };
    }

    get result(): IRoundResult | undefined {
        return this.ended;
    }
}

/** Character and colours of one screen cell. */
export function cellAt(frame: CapturedFrame, x: number, y: number): { char: string; fg: string; bg: string } {
    let col = 0;
    for (const span of frame.lines[y]!.spans) {
        const chars = [...span.text];
        for (const ch of chars) {
            if (col === x) return { char: ch, fg: hex(span.fg), bg: hex(span.bg) };
            col += span.width / chars.length;
        }
    }
    throw new Error(`no cell at ${x},${y}`);
}

export function hex(c: RGBA): string {
    return '#' + c.toInts().slice(0, 3).map((n) => n.toString(16).padStart(2, '0')).join('');
}
