/**
 * Option defaults, presets and validation, shared by parser, simulator and
 * matches.
 *
 * OWNER: architect. FROZEN after the scaffold phase.
 */

import {
    Mode,
    Modifier,
    Opcode,
    Standard,
    type CycleUnit,
    type IInstruction,
    type IParseOptions,
    type IResolvedOptions,
    type ISimulatorOptions,
    type PresetName,
} from './types.ts';

/** DAT.F $0, $0 (developer.md 3.1.1). */
export const DEFAULT_INITIAL_INSTRUCTION: Readonly<IInstruction> = Object.freeze({
    address: 0,
    opcode: Opcode.DAT,
    modifier: Modifier.F,
    aOperand: Object.freeze({ mode: Mode.Direct, address: 0 }),
    bOperand: Object.freeze({ mode: Mode.Direct, address: 0 }),
});

/** Defaults for every documented option. readDistance/writeDistance default to coresize. */
export const DEFAULT_OPTIONS = Object.freeze({
    coresize: 8000,
    maximumCycles: 80000,
    instructionLimit: 100,
    maxTasks: 8000,
    minSeparation: 100,
    standard: Standard.ICWS94draft,
    cycleUnit: 'execution' as CycleUnit,
    firstWarrior: 0,
    trackAccess: true,
});

/** Default rounds per match / pairing (guide.md 9). */
export const DEFAULT_ROUNDS = 100;
/** Default hill capacity (guide.md 10). */
export const DEFAULT_HILL_SIZE = 20;

/** Presets from guide.md 9.1. Read/write distance equal coresize (no limit). */
export const PRESETS: Readonly<Record<PresetName, Readonly<ISimulatorOptions>>> = Object.freeze({
    standard: { coresize: 8000, maximumCycles: 80000, maxTasks: 8000, instructionLimit: 100, minSeparation: 100, standard: Standard.ICWS94draft, pSpaceSize: 500 },
    beginner: { coresize: 8000, maximumCycles: 80000, maxTasks: 8000, instructionLimit: 100, minSeparation: 100, standard: Standard.ICWS94draft, pSpaceSize: 500 },
    nano: { coresize: 80, maximumCycles: 800, maxTasks: 80, instructionLimit: 5, minSeparation: 5, standard: Standard.ICWS94draft, pSpaceSize: 5 },
    tiny: { coresize: 800, maximumCycles: 8000, maxTasks: 800, instructionLimit: 20, minSeparation: 20, standard: Standard.ICWS94draft, pSpaceSize: 50 },
    lp: { coresize: 8000, maximumCycles: 80000, maxTasks: 8, instructionLimit: 200, minSeparation: 200, standard: Standard.ICWS94draft, pSpaceSize: 500 },
    large: { coresize: 55440, maximumCycles: 500000, maxTasks: 10000, instructionLimit: 200, minSeparation: 200, standard: Standard.ICWS94draft, pSpaceSize: 3465 },
    icws88: { coresize: 8000, maximumCycles: 80000, maxTasks: 8000, instructionLimit: 100, minSeparation: 100, standard: Standard.ICWS88, pSpaceSize: 500 },
});

export function preset(name: PresetName, overrides: ISimulatorOptions = {}): ISimulatorOptions {
    return { ...PRESETS[name], ...overrides };
}

const isPositiveInt = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0;

function requirePositiveInt(name: string, value: unknown): void {
    if (!isPositiveInt(value)) throw new Error(`Option ${name} must be a positive integer, got ${String(value)}`);
}

/**
 * Default P-space size for a core size (spec/pspace.md, confirmed against
 * pMARS): coresize / k for the largest k <= 16 that divides coresize. That is
 * coresize / 16 when it divides evenly (8000 -> 500), otherwise the smallest
 * divisor of coresize that is at least coresize / 16 (100 -> 10, 8001 -> 889).
 */
export function defaultPSpaceSize(coresize: number): number {
    for (let k = 16; k > 1; k--) if (coresize % k === 0) return coresize / k;
    return coresize;
}

/** A fresh time-based uint32 seed. */
export function timeSeed(): number {
    return (Date.now() ^ Math.floor(Math.random() * 0x100000000)) >>> 0;
}

/**
 * Merge options with defaults field by field and validate them.
 * Throws a descriptive Error on invalid values. `seed` is resolved here, so the
 * returned object fully reproduces the round's placement.
 */
export function resolveOptions(options: ISimulatorOptions | undefined | null = {}): IResolvedOptions {
    const o = options ?? {};
    const coresize = o.coresize ?? DEFAULT_OPTIONS.coresize;
    requirePositiveInt('coresize', coresize);

    const resolved: IResolvedOptions = {
        coresize,
        maximumCycles: o.maximumCycles ?? DEFAULT_OPTIONS.maximumCycles,
        initialInstruction: cloneInstruction(o.initialInstruction ?? DEFAULT_INITIAL_INSTRUCTION),
        instructionLimit: o.instructionLimit ?? DEFAULT_OPTIONS.instructionLimit,
        maxTasks: o.maxTasks ?? DEFAULT_OPTIONS.maxTasks,
        minSeparation: o.minSeparation ?? DEFAULT_OPTIONS.minSeparation,
        standard: o.standard ?? DEFAULT_OPTIONS.standard,
        readDistance: o.readDistance ?? coresize,
        writeDistance: o.writeDistance ?? coresize,
        cycleUnit: o.cycleUnit ?? DEFAULT_OPTIONS.cycleUnit,
        seed: o.seed ?? timeSeed(),
        firstWarrior: o.firstWarrior ?? DEFAULT_OPTIONS.firstWarrior,
        trackAccess: o.trackAccess ?? DEFAULT_OPTIONS.trackAccess,
        loadAddresses: o.loadAddresses ?? null,
        pSpaceSize: o.pSpaceSize ?? defaultPSpaceSize(coresize),
    };

    requirePositiveInt('maximumCycles', resolved.maximumCycles);
    requirePositiveInt('instructionLimit', resolved.instructionLimit);
    requirePositiveInt('maxTasks', resolved.maxTasks);
    requirePositiveInt('pSpaceSize', resolved.pSpaceSize);
    if (resolved.pSpaceSize > resolved.coresize) {
        throw new Error(`Option pSpaceSize (${resolved.pSpaceSize}) must not exceed coresize (${resolved.coresize})`);
    }
    if (!Number.isInteger(resolved.minSeparation) || resolved.minSeparation < 0) {
        throw new Error(`Option minSeparation must be a non-negative integer, got ${resolved.minSeparation}`);
    }
    if (!(resolved.standard in Standard) || typeof resolved.standard !== 'number') {
        throw new Error(`Option standard must be a Standard value, got ${String(resolved.standard)}`);
    }
    for (const key of ['readDistance', 'writeDistance'] as const) {
        requirePositiveInt(key, resolved[key]);
        if (resolved.coresize % resolved[key] !== 0) {
            throw new Error(`Option ${key} (${resolved[key]}) must divide coresize (${resolved.coresize})`);
        }
    }
    if (resolved.cycleUnit !== 'execution' && resolved.cycleUnit !== 'pmars') {
        throw new Error(`Option cycleUnit must be 'execution' or 'pmars', got ${String(resolved.cycleUnit)}`);
    }
    if (!Number.isInteger(resolved.seed)) throw new Error(`Option seed must be an integer, got ${resolved.seed}`);
    resolved.seed = resolved.seed >>> 0;
    if (!Number.isInteger(resolved.firstWarrior) || resolved.firstWarrior < 0) {
        throw new Error(`Option firstWarrior must be a non-negative integer, got ${resolved.firstWarrior}`);
    }
    if (resolved.loadAddresses !== null) {
        if (!Array.isArray(resolved.loadAddresses) || !resolved.loadAddresses.every(Number.isInteger)) {
            throw new Error(`Option loadAddresses must be an array of integers, got ${String(resolved.loadAddresses)}`);
        }
        resolved.loadAddresses = [...resolved.loadAddresses];
    }
    return resolved;
}

/** Parser settings with defaults applied (redcode.md predefined constants). */
export type IResolvedParseOptions = Required<IParseOptions>;

export function resolveParseOptions(options: IParseOptions | undefined | null = {}): IResolvedParseOptions {
    const o = options ?? {};
    const coresize = o.coresize ?? DEFAULT_OPTIONS.coresize;
    return {
        coresize,
        maximumCycles: o.maximumCycles ?? DEFAULT_OPTIONS.maximumCycles,
        instructionLimit: o.instructionLimit ?? DEFAULT_OPTIONS.instructionLimit,
        maxTasks: o.maxTasks ?? DEFAULT_OPTIONS.maxTasks,
        minSeparation: o.minSeparation ?? DEFAULT_OPTIONS.minSeparation,
        standard: o.standard ?? DEFAULT_OPTIONS.standard,
        readDistance: o.readDistance ?? coresize,
        writeDistance: o.writeDistance ?? coresize,
        warriors: o.warriors ?? 2,
        rounds: o.rounds ?? 1,
        pSpaceSize: o.pSpaceSize ?? defaultPSpaceSize(coresize),
    };
}

/** Parser options matching a simulator configuration (for hills and the TUI). */
export function parseOptionsFor(options: ISimulatorOptions, warriors = 2, rounds = 1): IParseOptions {
    const { coresize, maximumCycles, instructionLimit, maxTasks, minSeparation, standard, readDistance, writeDistance, pSpaceSize } = options;
    const out: IParseOptions = { warriors, rounds };
    if (coresize !== undefined) out.coresize = coresize;
    if (maximumCycles !== undefined) out.maximumCycles = maximumCycles;
    if (instructionLimit !== undefined) out.instructionLimit = instructionLimit;
    if (maxTasks !== undefined) out.maxTasks = maxTasks;
    if (minSeparation !== undefined) out.minSeparation = minSeparation;
    if (standard !== undefined) out.standard = standard;
    if (readDistance !== undefined) out.readDistance = readDistance;
    if (writeDistance !== undefined) out.writeDistance = writeDistance;
    if (pSpaceSize !== undefined) out.pSpaceSize = pSpaceSize;
    return out;
}

function cloneInstruction(ins: IInstruction): IInstruction {
    return {
        address: ins.address,
        opcode: ins.opcode,
        modifier: ins.modifier,
        aOperand: { mode: ins.aOperand.mode, address: ins.aOperand.address },
        bOperand: { mode: ins.bOperand.mode, address: ins.bOperand.address },
    };
}
