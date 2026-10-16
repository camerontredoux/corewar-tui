/**
 * Test helpers for simulator and match tests. Not part of the public API.
 * `ins()` reads exactly the load-file instruction syntax (`MOV.I $0, $1`), so
 * tests stay readable without depending on the parser.
 * OWNER: simulator engineer.
 */

import type { IParseResult, IPublishProvider } from '../types.ts';
import {
    fromPublicInstruction,
    formatInstruction,
    modeFromSymbol,
    modifierFromName,
    opcodeFromName,
    type IInstructionSpec,
} from '../instruction.ts';
import { programToParseResult } from '../loadformat.ts';
import type { Simulator } from './simulator.ts';

const LINE = /^\s*([a-z]+)\.([a-z]+)\s+([#$*@{}<>])(-?\d+)\s*,\s*([#$*@{}<>])(-?\d+)\s*$/i;

export function ins(text: string): IInstructionSpec {
    const m = LINE.exec(text);
    if (!m) throw new Error(`test instruction must look like "MOV.I $0, $1": ${text}`);
    const spec = {
        opcode: opcodeFromName(m[1]!),
        modifier: modifierFromName(m[2]!),
        aMode: modeFromSymbol(m[3]!),
        aNumber: Number(m[4]),
        bMode: modeFromSymbol(m[5]!),
        bNumber: Number(m[6]),
    };
    if (spec.opcode === undefined || spec.modifier === undefined) throw new Error(`bad test instruction: ${text}`);
    return spec as IInstructionSpec;
}

export interface IWarriorOptions {
    start?: number;
    name?: string;
    data?: unknown;
    /** The warrior's PIN (spec/pspace.md). */
    pin?: number;
}

/** A parse result for the given load-file lines. Pass `data` (even undefined) via the options key to attach data. */
export function warrior(lines: readonly string[], options: IWarriorOptions = {}): IParseResult {
    const result = programToParseResult(
        { instructions: lines.map(ins), startOffset: options.start ?? 0, ...(options.pin === undefined ? {} : { pin: options.pin }) },
        { name: options.name ?? '' },
    );
    if ('data' in options) result.data = options.data;
    return result;
}

/** The cell at `address` in load-file syntax with signed numbers (`DAT.F $0, $-1`). */
export function cell(sim: Simulator, address: number): string {
    const ins = sim.getWithInfoAt(address).instruction;
    return formatInstruction(fromPublicInstruction(ins), { signedFor: sim.getState().core.getSize() });
}

export interface IRecorder extends IPublishProvider {
    log: [string, any][];
    topics(): string[];
    payloads(topic: string): any[];
    clear(): void;
}

export function recorder(): IRecorder {
    const log: [string, any][] = [];
    return {
        log,
        publishSync(type, payload) {
            log.push([type, payload]);
        },
        topics: () => log.map(([t]) => t),
        payloads: (topic) => log.filter(([t]) => t === topic).map(([, p]) => p),
        clear: () => {
            log.length = 0;
        },
    };
}
