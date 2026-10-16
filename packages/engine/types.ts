/**
 * Public types and enumerations of the Corewar engine.
 *
 * OWNER: architect. FROZEN after the scaffold phase. Engineers do not edit this
 * file. Part A is the API from spec/developer.md with exact names and values.
 * Part B holds the documented extensions (options beyond IOptions, hills,
 * benchmarks, the visualiser hook). If a change is unavoidable, raise it with
 * the architect; see ARCHITECTURE.md "Changing frozen files".
 */

// ===========================================================================
// Part A. spec/developer.md public API
// ===========================================================================

// ---- Enumerations (spec/developer.md section 5). Never renumber. -----------

/** Semantic category of a parser token (developer.md 5.1). */
export enum TokenCategory {
    Label = 0,
    Opcode = 1,
    Preprocessor = 2,
    Modifier = 3,
    Mode = 4,
    Number = 5,
    Comma = 6,
    Maths = 7,
    EOL = 8,
    Comment = 9,
    Unknown = 10,
}

/** Severity of a parser message (developer.md 5.2). */
export enum MessageType {
    Error = 0,
    Warning = 1,
    Info = 2,
}

/** Redcode standard (developer.md 5.3). */
export enum Standard {
    ICWS86 = 0,
    ICWS88 = 1,
    ICWS94draft = 2,
}

/**
 * Instruction opcode (developer.md 5.4). LDP and STP are the P-space
 * extension (spec/pspace.md); they extend the documented values 0-16.
 */
export enum Opcode {
    DAT = 0,
    MOV = 1,
    ADD = 2,
    SUB = 3,
    MUL = 4,
    DIV = 5,
    MOD = 6,
    JMP = 7,
    JMZ = 8,
    JMN = 9,
    DJN = 10,
    CMP = 11,
    SEQ = 12,
    SNE = 13,
    SLT = 14,
    SPL = 15,
    NOP = 16,
    /** P-space extension: load a P-space cell into core. */
    LDP = 17,
    /** P-space extension: store a core value into a P-space cell. */
    STP = 18,
}

/** Instruction modifier (developer.md 5.5). */
export enum Modifier {
    A = 0,
    B = 1,
    AB = 2,
    BA = 3,
    F = 4,
    X = 5,
    I = 6,
}

/** Operand addressing mode (developer.md 5.6). */
export enum Mode {
    Immediate = 0, // #
    Direct = 1, // $
    AIndirect = 2, // *
    BIndirect = 3, // @
    APreDecrement = 4, // {
    BPreDecrement = 5, // <
    APostIncrement = 6, // }
    BPostIncrement = 7, // >
}

/** The docs call the Mode enum "ModeType" inside IOptions. */
export type ModeType = Mode;

/** Kind of core access in CORE_ACCESS (developer.md 3.6.2 / 5.7). */
export enum AccessType {
    read = 0,
    write = 1,
    execute = 2,
}

/** Pubsub topic strings (developer.md 3.6). */
export enum MessageTopic {
    CORE_INITIALISE = 'CORE_INITIALISE',
    CORE_ACCESS = 'CORE_ACCESS',
    RUN_PROGRESS = 'RUN_PROGRESS',
    ROUND_END = 'ROUND_END',
    TASK_COUNT = 'TASK_COUNT',
    NEXT_EXECUTION = 'NEXT_EXECUTION',
    MATCH_END = 'MATCH_END',
}

// ---- Parser (developer.md section 2) ---------------------------------------

/** Source position. Both fields are 1-based (developer.md 2.1 AMBIGUITY). */
export interface IPosition {
    line: number;
    char: number;
}

export interface IMetaData {
    name: string;
    author: string;
    strategy: string;
}

export interface IToken {
    position: IPosition;
    /** The source text that produced the token. */
    lexeme: string;
    category: TokenCategory;
}

export interface IMessage {
    type: MessageType;
    position: IPosition;
    text: string;
}

export interface IParseResult {
    metaData: IMetaData;
    /** Load-format token stream; see ARCHITECTURE.md "Load format". */
    tokens: IToken[];
    messages: IMessage[];
    /** Caller data. parse() never sets it; the simulator echoes it as warriorData/winnerData. */
    data?: any;
}

// ---- Simulator (developer.md section 3) ------------------------------------

export interface IOperand {
    mode: ModeType;
    address: number;
}

export interface IInstruction {
    address: number;
    opcode: Opcode;
    modifier: Modifier;
    aOperand: IOperand;
    bOperand: IOperand;
}

/** Options from developer.md 3.1.1. All optional; see options.ts for defaults. */
export interface IOptions {
    coresize?: number; // default 8000
    maximumCycles?: number; // default 80000
    initialInstruction?: IInstruction; // default DAT.F $0, $0
    instructionLimit?: number; // default 100
    maxTasks?: number; // default 8000
    minSeparation?: number; // default 100
    standard?: Standard; // default ICWS94draft
    readDistance?: number; // default coresize (no effect)
    writeDistance?: number; // default coresize (no effect)
}

/**
 * Receives simulator and match messages. `type` is a MessageTopic value.
 * A null/undefined provider is allowed: the engine then publishes nothing and
 * does not build payload objects at all.
 */
export interface IPublishProvider {
    publishSync(type: string, payload: any): void;
}

export interface ICoreAccessEventArgs {
    warriorId: number;
    /** Omitted when the warrior has no data. */
    warriorData?: any;
    accessType: AccessType;
    /** Absolute address, 0 .. coresize - 1. */
    address: number;
}

export type CoreAccessPayload = ICoreAccessEventArgs[];

export interface ICoreLocation {
    /** A copy; mutating it does not change core. */
    instruction: IInstruction;
    /** Most recent access this round (see ARCHITECTURE.md "Access tracking"), or undefined. */
    access?: ICoreAccessEventArgs;
}

export interface ITask {
    instructionPointer: number;
    warrior: IWarrior;
}

export interface IWarrior {
    id: number;
    data?: any;
    name: string;
    author: string;
    strategy: string;
    startAddress: number;
    /** Task queue, next-to-run first. */
    tasks: ITask[];
    /** Index into tasks of the next task to run (always 0 in snapshots, kept for the documented shape). */
    taskIndex: number;
}

export interface ICore {
    getSize(): number;
}

export interface IState {
    cycle: number;
    warriors: IWarrior[];
    warriorIndex: number;
    options: IResolvedOptions;
    core: ICore;
}

export interface ICoreInitialiseEventArgs {
    state: IState;
}

export interface IRunProgressEventArgs {
    runProgress: number;
    cycle: number;
    maximumCycles: number;
}

export type RoundOutcome = 'WIN' | 'DRAW' | 'NONE';

export interface IRoundResult {
    winnerId: number | null;
    winnerData?: any;
    outcome: RoundOutcome;
}

export interface ITaskCountEventArgs {
    warriorId: number;
    warriorData?: any;
    taskCount: number;
}

export type TaskCountPayload = ITaskCountEventArgs[];

export interface INextExecutionEventArgs {
    warriorId: number;
    warriorData?: any;
    address: number;
}

// ---- Matches (developer.md section 4) --------------------------------------

export interface IMatchWarrior {
    source: IParseResult;
}

export interface IMatch {
    rounds: number;
    options?: ISimulatorOptions;
    warriors: IMatchWarrior[];
    /** Extension: seed for the whole match. Round r uses a seed derived from it. Unset = time-based. */
    seed?: number;
}

export interface IMatchWarriorResult {
    /** The caller's IParseResult object itself (not a copy). */
    source: IParseResult;
    won: number;
    drawn: number;
    lost: number;
    /** win% * 3 + draw%, percentages 0-100, not rounded. */
    given: number;
    /** loss% * 3 + draw%, percentages 0-100, not rounded. */
    taken: number;
}

export interface IMatchResult {
    rounds: number;
    warriors: IMatchWarriorResult[];
}

// ===========================================================================
// Part B. Extensions (not in developer.md; documented in ARCHITECTURE.md)
// ===========================================================================

/**
 * How `cycle` / `maximumCycles` are counted.
 * - 'execution' (default, the docs' definition): one cycle is one instruction
 *   executed by one warrior. Two warriors get maximumCycles / 2 turns each.
 * - 'pmars': the cycle counter advances once every live warrior has had one
 *   turn, so each warrior can execute up to maximumCycles instructions.
 */
export type CycleUnit = 'execution' | 'pmars';

/** IOptions plus engine extensions. Accepted wherever IOptions is. */
export interface ISimulatorOptions extends IOptions {
    /** Cycle counting rule; default 'execution'. */
    cycleUnit?: CycleUnit;
    /** Placement RNG seed (uint32). Default: time-based, resolved once per initialise. */
    seed?: number;
    /** warriorId that takes the first turn. Default 0. runMatch passes round % N. */
    firstWarrior?: number;
    /**
     * Maintain the per-cell access arrays for the visualiser hook (CoreView).
     * Default true. runMatch/hills/benchmarks turn it off for speed.
     */
    trackAccess?: boolean;
    /**
     * Fixed load address of each warrior, in warrior order, instead of the
     * random placement (like pMARS `-F`). Folded into [0, coresize). Must give
     * one address per warrior and keep the warriors' code from overlapping;
     * minSeparation is not applied. Default null (random placement).
     */
    loadAddresses?: readonly number[] | null;
    /**
     * Cells in each warrior's P-space (spec/pspace.md), also the PSPACESIZE
     * constant. 1 to coresize. Default: coresize / k for the largest k <= 16
     * that divides coresize, as in pMARS (8000 -> 500, 100 -> 10).
     */
    pSpaceSize?: number;
}

/** Options after defaults are applied (IState.options). Assignable to Required<IOptions>. */
export type IResolvedOptions = Required<ISimulatorOptions>;

/**
 * Options the parser needs: predefined constants (CORESIZE, MAXCYCLES, ...),
 * the instructionLimit length check, and standard-specific opcode checks.
 * parse(redcode) with no options uses the defaults from options.ts.
 */
export interface IParseOptions {
    coresize?: number;
    maximumCycles?: number;
    instructionLimit?: number;
    maxTasks?: number;
    minSeparation?: number;
    standard?: Standard;
    readDistance?: number;
    writeDistance?: number;
    /** Value of the WARRIORS predefined constant. Default 2. */
    warriors?: number;
    /** Value of the ROUNDS predefined constant. Default 1. */
    rounds?: number;
    /** Value of the PSPACESIZE predefined constant. Default as ISimulatorOptions.pSpaceSize. */
    pSpaceSize?: number;
}

/** Named settings presets from spec/guide.md 9.1. */
export type PresetName = 'standard' | 'beginner' | 'nano' | 'tiny' | 'lp' | 'large' | 'icws88';

// ---- Hills and benchmarks (spec/guide.md sections 10 and 11) ---------------

export interface IHillWarrior {
    /** Stable caller-chosen identifier (for example a file name). */
    id: string;
    source: IParseResult;
    /** Seasons survived. New warriors start at 0. */
    age: number;
    /** Monotonic submission order, used as the last tie-break. */
    submitted: number;
}

export interface IHill {
    options: ISimulatorOptions;
    /** Rounds per pairing. Default 100. */
    rounds: number;
    /** Capacity. The worst warrior is pushed off only when there are more than hillSize. Default 20. */
    hillSize: number;
    warriors: IHillWarrior[];
    seed?: number;
}

export interface IHillRanking {
    warrior: IHillWarrior;
    /** Average of per-opponent `given` scores (0..300). */
    score: number;
    won: number;
    drawn: number;
    lost: number;
}

export interface IHillSubmitResult {
    /** False when the source has parse errors; the hill is then unchanged. */
    accepted: boolean;
    /** The hill after the season (a new object; the input is not mutated). */
    hill: IHill;
    /** Ranking best-first, before anyone was pushed off. */
    ranking: IHillRanking[];
    /** Warriors removed this season (empty when within capacity or rejected). */
    pushedOff: IHillWarrior[];
}

export interface IBenchmark {
    name: string;
    warriors: IParseResult[];
    options: ISimulatorOptions;
    /** Rounds per opponent. Default 100. */
    rounds: number;
    seed?: number;
}

export interface IBenchmarkOpponentResult {
    opponent: IParseResult;
    won: number;
    drawn: number;
    lost: number;
    /** win% * 3 + draw% against this opponent (0..300). */
    score: number;
}

export interface IBenchmarkResult {
    warrior: IParseResult;
    opponents: IBenchmarkOpponentResult[];
    /** Average of per-opponent scores (0..300). */
    score: number;
}

// ---- Visualiser hook (see ARCHITECTURE.md "Visualiser hook") ---------------

/**
 * Live, zero-copy view of the simulator's per-cell access arrays (the
 * visualiser hook). The arrays belong to the simulator, are only maintained
 * when options.trackAccess is true, and are REPLACED on every
 * initialiseSimulator call: fetch a new view after each initialise. Read only.
 *
 * accessKind[a]    0 = untouched this round, otherwise AccessType + 1
 *                  (1 = read, 2 = write, 3 = execute).
 * accessWarrior[a] warriorId of that access (ignore when accessKind is 0).
 * accessStamp[a]   value of `executions` when that access happened (1 for
 *                  the first executed instruction of the round). A renderer
 *                  repaints only cells with accessStamp > its last painted
 *                  stamp. Within one execution the strongest access wins:
 *                  execute > write > read; across executions the latest wins.
 * Loading warriors does not mark cells; draw footprints from
 * IWarriorProcessView.loadAddress / length if wanted.
 */
export interface ICoreView {
    readonly size: number;
    readonly accessKind: Uint8Array;
    readonly accessWarrior: Uint8Array;
    readonly accessStamp: Uint32Array;
    /** Instructions executed so far this round (live). */
    readonly executions: number;
    /** `cycle` as reported in RUN_PROGRESS (live; equals executions when cycleUnit is 'execution'). */
    readonly cycle: number;
    /** Address executed by the most recent execution, or -1 before the first (live). */
    readonly lastExecuted: number;
    /** Id of the warrior that runs the next execution (live). */
    readonly nextWarrior: number;
}

/** Per-warrior process snapshot for the visualiser. A fresh object per call. */
export interface IWarriorProcessView {
    warriorId: number;
    alive: boolean;
    taskCount: number;
    /** Instruction pointers, next-to-run first. */
    instructionPointers: number[];
    /** Absolute address of the warrior's first loaded instruction. */
    loadAddress: number;
    /** Number of instructions loaded. */
    length: number;
}

/**
 * A warrior's P-space for the visualiser (spec/pspace.md). A fresh copy per
 * call. Cell 0 is the warrior's result cell as LDP sees it.
 */
export interface IPSpaceView {
    warriorId: number;
    /** The warrior's PIN, or null when its P-space is private. */
    pin: number | null;
    /** Every cell, values in [0, coresize). */
    cells: number[];
}
