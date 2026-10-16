/**
 * Public barrel (developer.md section 6): named exports plus a default
 * `corewar` singleton with the same functions as methods.
 * OWNER: architect. FROZEN after the scaffold phase.
 */

import { parse, serialise } from './parser/index.ts';
import {
    createSimulator,
    getCoreView,
    getDefaultSimulator,
    getProcessView,
    getWithInfoAt,
    initialiseSimulator,
    republish,
    run,
    step,
} from './simulator/index.ts';
import { createHill, defaultBenchmark, runBenchmark, runMatch, submitToHill } from './matches/index.ts';

// ---- Functions -------------------------------------------------------------
export { parse, serialise };
export { initialiseSimulator, step, run, getWithInfoAt, republish };
export { getCoreView, getProcessView, createSimulator, getDefaultSimulator };
export { Simulator, PSpace } from './simulator/index.ts';
export { runMatch, createHill, submitToHill, runBenchmark, defaultBenchmark };
export { scoreCounts } from './matches/index.ts';

// ---- Shared helpers --------------------------------------------------------
export {
    DEFAULT_INITIAL_INSTRUCTION,
    DEFAULT_OPTIONS,
    DEFAULT_ROUNDS,
    DEFAULT_HILL_SIZE,
    PRESETS,
    preset,
    resolveOptions,
    resolveParseOptions,
    parseOptionsFor,
    defaultPSpaceSize,
} from './options.ts';
export { formatInstruction, fold, OPCODE_NAMES, MODIFIER_NAMES, MODE_SYMBOLS } from './instruction.ts';
export type { IInstructionSpec, IFormatOptions } from './instruction.ts';
export { readLoadFormat, parseSucceeded, programToParseResult, LoadFormatError } from './loadformat.ts';
export type { IWarriorProgram } from './loadformat.ts';
export { createRng, type IRng } from './rng.ts';
export * as samples from './samples.ts';

// ---- Enums -----------------------------------------------------------------
export {
    TokenCategory,
    MessageType,
    Standard,
    Opcode,
    Modifier,
    Mode,
    AccessType,
    MessageTopic,
} from './types.ts';

// ---- Types -----------------------------------------------------------------
export type {
    IPosition,
    IMetaData,
    IToken,
    IMessage,
    IParseResult,
    IOperand,
    IInstruction,
    IOptions,
    ModeType,
    IPublishProvider,
    ICoreLocation,
    ICoreAccessEventArgs,
    CoreAccessPayload,
    IState,
    IWarrior,
    ITask,
    ICore,
    ICoreInitialiseEventArgs,
    IRunProgressEventArgs,
    IRoundResult,
    RoundOutcome,
    ITaskCountEventArgs,
    TaskCountPayload,
    INextExecutionEventArgs,
    IMatch,
    IMatchWarrior,
    IMatchResult,
    IMatchWarriorResult,
    CycleUnit,
    ISimulatorOptions,
    IResolvedOptions,
    IParseOptions,
    PresetName,
    IHill,
    IHillWarrior,
    IHillRanking,
    IHillSubmitResult,
    IBenchmark,
    IBenchmarkOpponentResult,
    IBenchmarkResult,
    ICoreView,
    IWarriorProcessView,
    IPSpaceView,
} from './types.ts';

/** Default-export singleton: `corewar.parse(...)`, `corewar.step()`, ... */
const corewar = {
    parse,
    serialise,
    initialiseSimulator,
    step,
    run,
    getWithInfoAt,
    republish,
    runMatch,
    getCoreView,
    getProcessView,
    createSimulator,
    createHill,
    submitToHill,
    runBenchmark,
    defaultBenchmark,
};

export default corewar;
