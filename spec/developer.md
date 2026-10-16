# Developer reference: programmatic API

This file specifies the public programmatic API of the Corewar library: the Parser, the Simulator, the Matches API, the publish/subscribe messages, and the enumerations they use. Everything here comes from the "Developer reference" section of the official docs, and nothing else:

| Short tag | Page |
|---|---|
| `[dev]` | https://corewar-docs.readthedocs.io/en/latest/developer/ |
| `[parser]` | https://corewar-docs.readthedocs.io/en/latest/developer/parser/ |
| `[sim]` | https://corewar-docs.readthedocs.io/en/latest/developer/simulator/ |
| `[matches]` | https://corewar-docs.readthedocs.io/en/latest/developer/matches/ |
| `[enum]` | https://corewar-docs.readthedocs.io/en/latest/developer/enumerations/ |

Conventions used in this file:

- **Doc example (verbatim)** blocks are copied character for character from the docs, including typos, missing commas and trailing whitespace. They are the source of truth for field names. They are not always valid TypeScript.
- **TypeScript contract** blocks are our normative translation of the docs into TypeScript. Where a contract goes beyond what the docs say, an `> AMBIGUITY:` note next to it gives the question and the recommended answer.
- Quoted prose in `>` blocks without the `AMBIGUITY:` prefix is verbatim doc text.

Other parts of the official docs (Redcode language, opcodes, modifiers, addressing modes, Match Settings) are linked from these pages but belong to other spec files. Where the developer pages refer to them, this file says so.

---

## 1. Overview `[dev]`

Verbatim from the overview page:

> This area of the docs will provides a technical reference for the corewar npm package.

> The Corewar library provides a redcode parser, corewar simulator and hill and benchmark functionality and is used by corewar.io.

> The Corewar library provides an API to access the libraries functionality. The library uses a pubsub mechanism to publish messages in resopnse to events within the simulator.

> The Corewar API is divded into the following sections:
>
> - Parser
> - Simulator
> - Matches

So the library has three API areas plus a shared set of enumerations:

1. **Parser** (section 2): turns Redcode source text into tokens, metadata and diagnostics.
2. **Simulator** (section 3): loads parse results into a core, runs them, and publishes events.
3. **Matches** (section 4): runs multi-round matches, hills and benchmarks on top of the Simulator.
4. **Enumerations** (section 5): numeric enums shared by all three.

Events go out through a publish/subscribe ("pubsub") provider that the caller supplies (section 3.2 and 6).

### 1.1 Building `[dev]`

> Corewar is written in Typescript packaged using webpack and built by running:

```
npm build

```

> AMBIGUITY: `npm build` is not a working npm command (npm has no `build` lifecycle alias for scripts). Should our build be invoked as `npm build`? Recommended: define a `build` script in `package.json` and invoke it with `npm run build`. The webpack requirement describes the original packaging and is not a functional requirement; any bundler that produces an importable TypeScript/JavaScript package is acceptable.

### 1.2 Testing `[dev]`

> Corewar is extensively unit tested using Mocha, Chai, Sinon and sinon-chai. Code coverage is supplied using Istanbul.

> Corewar contains unit tests for the Parser, Simulator and Matches APIs along with integration tests for the Parser.

> To execute the tests and see code coverage run:

```
npm test

```

> Unit test debugging is configured to run in VS Code

Requirements derived from this:

- `npm test` runs the whole test suite and prints a coverage report.
- There are unit tests for the Parser, Simulator and Matches APIs, and integration tests for the Parser.

> AMBIGUITY: Do we have to use Mocha, Chai, Sinon, sinon-chai and Istanbul specifically? Recommended: no. Those name the original project's tools. Any test runner with coverage (for example Vitest with its built-in coverage) meets the requirement as long as `npm test` runs the tests and reports coverage. The VS Code debugging configuration is optional.

---

## 2. Parser API `[parser]`

> The Parser API provides the following functions which allow redcode to be parsed to an in memory load format.

### 2.1 `parse(redcode: string): IParseResult`

Doc signature (verbatim heading): `parse(redcode: string): IParseResult`

> Parse a redcode document and return an `IParseResult` which consists of the tokenised program and any associated messages.

> The `IParseResult` has the following structure:

**Doc example (verbatim):**

```
{
    metaData: {
        name: string,
        author: string,
        strategy: string
    },
    tokens: [{
        position: {
            line: number,
            char: number
        },
        lexeme: string,
        category: number
    }],
    messages: [{
        type: number;
        position: {
            line: number,
            char: number
        },
        text: string
    }],
    data?: any
}

```

> Token Category and Message Type are enumerations.

(The doc links "Token Category" to the enumerations page's Token Categories table and "Message Type" to its Message Type table; see sections 5.1 and 5.2.)

**TypeScript contract:**

```ts
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
    lexeme: string;            // the original source text that produced the token
    category: TokenCategory;   // numeric enum, section 5.1
}

export interface IMessage {
    type: MessageType;         // numeric enum, section 5.2
    position: IPosition;
    text: string;
}

export interface IParseResult {
    metaData: IMetaData;
    tokens: IToken[];
    messages: IMessage[];
    data?: any;                // caller-supplied; see section 3.1 and the AMBIGUITY below
}

export function parse(redcode: string): IParseResult;
```

Field by field:

| Field | Type | Meaning |
|---|---|---|
| `metaData` | object | Warrior metadata taken from the source. |
| `metaData.name` | `string` | Warrior name. |
| `metaData.author` | `string` | Warrior author. |
| `metaData.strategy` | `string` | Warrior strategy text. |
| `tokens` | `IToken[]` | The tokenised program, in source order. |
| `tokens[].position.line` | `number` | Source line of the token. |
| `tokens[].position.char` | `number` | Character offset of the token within its line. |
| `tokens[].lexeme` | `string` | "The lexeme contains the original text which produced the token." |
| `tokens[].category` | `number` | A Token Category value (section 5.1). |
| `messages` | `IMessage[]` | Diagnostics produced while parsing. |
| `messages[].type` | `number` | A Message Type value (section 5.2): Error, Warning or Info. |
| `messages[].position.line` | `number` | Source line the message refers to. |
| `messages[].position.char` | `number` | Character offset the message refers to. |
| `messages[].text` | `string` | Human-readable message text. |
| `data` | `any`, optional | Caller data attached to the warrior. The Simulator echoes it back in events as `warriorData` / `winnerData`. |

> AMBIGUITY: Are `position.line` and `position.char` 0-based or 1-based? The docs don't say. Recommended: `line` is 1-based (first line is 1) and `char` is 1-based (first character is 1), so positions can be shown to users directly. Use the same convention for tokens and messages, and test it.

> AMBIGUITY: What goes in `metaData.name` / `author` / `strategy` when the source has no such comment, and how are multiple `;strategy` lines combined? The docs don't say (the comment syntax belongs to the Redcode spec, not this page). Recommended: missing fields are the empty string `""`, never `undefined`. If there are several strategy lines, join their text with `"\n"` in source order. If `name` or `author` appears more than once, the last one wins.

> AMBIGUITY: `parse` never says it throws. Does it throw on invalid input? Recommended: `parse` never throws for any string input, including `""`. Every problem is reported as an entry in `messages` with `type` Error (0). A parse result "succeeded" when `messages` has no entry with `type === MessageType.Error`.

> AMBIGUITY: Does `parse` ever set `data`? The docs show `data?: any` in the result but only describe callers adding it ("adding a data property to the parseResults", section 3.1). Recommended: `parse` never sets `data`. Only callers set it, and the Simulator passes it through unchanged and never reads its contents.

> AMBIGUITY: What exactly is in `tokens` (only the final load-format instructions after preprocessing, or every lexeme in the source)? The page calls the output an "in memory load format" yet the Token Categories enum (5.1) includes `Preprocessor`, `Comment` and `Unknown`. Recommended: `tokens` is the token stream after preprocessing (labels resolved, `EQU`/`FOR` expanded, comments kept as `Comment` tokens), and it is enough on its own for the Simulator to load the warrior. Each token's `position` still points at the source text it came from. Coordinate the exact token stream with the Redcode/parser spec file.

### 2.2 `serialise(tokens: IToken[]): string`

Doc signature (verbatim heading): `serialise(tokens: IToken[]): string`

> Serialises the array of tokens to a single, human readable string.

> The `serialise` function takes a single parameter which is an array of tokens with the following structure:

**Doc example (verbatim):**

```
[{
    position: {
        line: number,
        char: number
    },
    lexeme: string,
    category: number
}]

```

> The lexeme contains the original text which produced the token.

> A list of valid values for category can be found here.

("here" links to the Token Categories table, section 5.1.)

**TypeScript contract:**

```ts
export function serialise(tokens: IToken[]): string;
```

Note the British spelling `serialise`. The export name must be exactly that.

> AMBIGUITY: The exact output format of `serialise` is not given beyond "a single, human readable string". Recommended deterministic format: walk the tokens in order. An `EOL` (8) token emits `"\n"`. Every other token emits its `lexeme`. Put a single space between two consecutive non-EOL tokens on the same line, except no space before a `Comma` (6) token and no space after a `Mode` (4) token or after a `.` joining an opcode and a `Modifier` (3). So `MOV.I $0, $1` round-trips to `MOV.I $0, $1`. Output for `[]` is `""`. Freeze this format in snapshot tests.

> AMBIGUITY: Does `serialise` check `category` values? Recommended: no. It only reads `lexeme` and `category` (for spacing) and does not throw on unknown categories. Treat unknown categories like `Unknown` (10).

---

## 3. Simulator API `[sim]`

> The Simulator API allows warriors parsed using the Parser to be loaded into a Corewar simulator and run against each other.

The Simulator is stateful: `initialiseSimulator` sets up a round, and `step`, `run`, `getWithInfoAt` and `republish` act on that round.

### 3.1 `initialiseSimulator(options: IOptions, parseResults: IParseResult[], messageProvider: IPublishProvider)`

Doc signature (verbatim heading): `initialiseSimulator(options: IOptions, parseResults: IParseResult[], messageProvider: IPublishProvider)`

> Setup the simulator for specific options and parseResult (parsed redcode).
> `IParseResults` are produced as output from the Parser module.
> Additional, data can be associated with a warrior when it is loaded into core by adding a data property to the parseResults given to the initialise function.
> A pubsub provider can be specified to receive Messages.

**TypeScript contract:**

```ts
export function initialiseSimulator(
    options: IOptions,
    parseResults: IParseResult[],
    messageProvider: IPublishProvider
): void;
```

Behaviour required by the docs:

- Takes the options (section 3.1.1), one `IParseResult` per warrior (from `parse`), and a pubsub provider.
- Loads every warrior into core.
- If a parse result has a `data` property, that value is the warrior's "data" and is echoed as `warriorData` / `winnerData` in every message about that warrior (section 3.6).
- Messages (section 3.6) go to `messageProvider`.
- Publishes `CORE_INITIALISE` with the initial core and process state (section 3.6.1).

> AMBIGUITY: The return type is not documented. Recommended: `void`.

> AMBIGUITY: The shape of `IPublishProvider` is not documented, only that it is "a pubsub provider". Recommended contract:
>
> ```ts
> export interface IPublishProvider {
>     publishSync(type: string, payload: any): void;
> }
> ```
>
> The Simulator calls `publishSync(messageType, payload)` synchronously, where `messageType` is exactly one of the message names in section 3.6 (`'CORE_INITIALISE'`, `'CORE_ACCESS'`, `'RUN_PROGRESS'`, `'ROUND_END'`, `'TASK_COUNT'`, `'NEXT_EXECUTION'`) and, for the Matches API, `'MATCH_END'`. The docs say a provider "can be specified", which reads as optional. So when `messageProvider` is `null` or `undefined`, the Simulator runs normally and publishes nothing.

> AMBIGUITY: What happens with parse results that contain Error messages, or with an empty `parseResults` array? Recommended: `initialiseSimulator` throws an `Error` naming the offending warrior index if any parse result has a message with `type === MessageType.Error`, or if `parseResults` is empty. One warrior is allowed (that is the `'NONE'` outcome in `ROUND_END`).

> AMBIGUITY: How is a warrior's `warriorId` assigned? The docs only say "Each warrior has a unique id". Recommended: `warriorId` is the warrior's 0-based index in the `parseResults` array passed to `initialiseSimulator`.

> AMBIGUITY: Where are warriors placed, and is placement random? The docs only give `minSeparation` (default 100). Recommended: warrior 0 loads at absolute address 0. Each later warrior loads at a random address such that the distance (modulo `coresize`) from the start of any earlier warrior's code to the start of its own code is at least `minSeparation` + the earlier warrior's length, and the warriors don't overlap. Randomness comes from an injectable RNG so tests are deterministic. Use the full placement rules from the Match Settings spec file if it defines them.

> AMBIGUITY: Calling `initialiseSimulator` again. Recommended: each call throws away all previous state and starts a fresh round, so a multi-round match calls it once per round.

#### 3.1.1 Options (`IOptions`)

> The following options object can be provided to `initialiseSimulator`. See Match Settings for more info.

> All attributes are optional and will be defaulted as described.

**Doc example (verbatim):**

```
{

    coresize?: number,                  // default 8000
    maximumCycles?: number,             // default 80000
    initialInstruction?: {              // default DAT.F $0, $0
        address: number,
        opcode: number,
        modifier: number,
        aOperand: {
            mode: ModeType,
            address: number
        },
        bOperand: {
            mode: ModeType,
            address: number
        }
    },
    instructionLimit?: number,          // default 100
    maxTasks?: number,                  // default 8000
    minSeparation?: number,             // default 100
    standard?: number,                  // default ICWS94draft
    readDistance?: number,
    writeDistance?: number
}

```

> Standard, Opcode and Modifier are enumerations

> `readDistance` and `writeDistance` are not implemented within the current version of corewar.io

**TypeScript contract:**

```ts
export interface IOperand {
    mode: ModeType;     // Mode enum, section 5.6
    address: number;
}

export interface IInstruction {
    address: number;
    opcode: Opcode;     // section 5.4
    modifier: Modifier; // section 5.5
    aOperand: IOperand;
    bOperand: IOperand;
}

export interface IOptions {
    coresize?: number;                 // default 8000
    maximumCycles?: number;            // default 80000
    initialInstruction?: IInstruction; // default DAT.F $0, $0
    instructionLimit?: number;         // default 100
    maxTasks?: number;                 // default 8000
    minSeparation?: number;            // default 100
    standard?: Standard;               // default ICWS94draft (= 2)
    readDistance?: number;             // no default documented; not implemented upstream
    writeDistance?: number;            // no default documented; not implemented upstream
}

export type ModeType = Mode; // the doc uses the name "ModeType" for the Mode enum
```

| Option | Type | Default | Meaning (see the Match Settings spec for full semantics) |
|---|---|---|---|
| `coresize` | `number` | `8000` | Number of locations in core. |
| `maximumCycles` | `number` | `80000` | Cycles after which the round ends in a draw (see `RUN_PROGRESS`, `ROUND_END`). |
| `initialInstruction` | `IInstruction` | `DAT.F $0, $0` | Instruction that fills every core location before warriors load. |
| `instructionLimit` | `number` | `100` | Maximum warrior length in instructions. |
| `maxTasks` | `number` | `8000` | Maximum tasks (processes) per warrior. |
| `minSeparation` | `number` | `100` | Minimum distance between loaded warriors. |
| `standard` | `number` (Standard enum) | `ICWS94draft` (2) | Redcode standard. |
| `readDistance` | `number` | not documented | Read limit. Not implemented upstream. |
| `writeDistance` | `number` | not documented | Write limit. Not implemented upstream. |

The default `initialInstruction` `DAT.F $0, $0` as an `IInstruction` value is:

```ts
{
    address: 0,
    opcode: Opcode.DAT,         // 0
    modifier: Modifier.F,       // 4
    aOperand: { mode: Mode.Direct, address: 0 },  // Direct = 1 ($)
    bOperand: { mode: Mode.Direct, address: 0 }
}
```

Merge rules: each missing option is replaced by its default independently. A partial options object such as `{ coresize: 800 }` keeps every other default.

> AMBIGUITY: What does `initialInstruction.address` mean? Every core location gets a copy. Recommended: ignore the supplied value. Each copy's `address` is set to its own core index, `0 .. coresize - 1`.

> AMBIGUITY: How are `readDistance` / `writeDistance` handled? The docs say they are "not implemented within the current version of corewar.io". Recommended: accept both and default each to `coresize`. With that default they have no effect. Implementing them (limiting read/write reach to ±distance, folded per ICWS'94) is optional and out of scope unless the Match Settings spec says otherwise. Never reject options because they are present.

> AMBIGUITY: Is there option validation? Recommended: `initialiseSimulator` throws a descriptive `Error` when a numeric option is not a positive integer (`coresize`, `maximumCycles`, `instructionLimit`, `maxTasks`), when `minSeparation` is negative, or when `standard` is not a Standard member. It also throws when a warrior is longer than `instructionLimit`, or when the warriors can't fit in core with `minSeparation`.

> AMBIGUITY: Do `standard` values other than ICWS94draft change behaviour (for example, rejecting ICWS'94-only opcodes under ICWS86/88)? The developer pages don't say. Recommended: store and expose `standard`. Behaviour differences between standards are governed by the Redcode spec files. If those are silent, treat every standard as ICWS94draft.

### 3.2 `step(steps?: number): boolean`

Doc signature (verbatim heading): `step(steps?: number): boolean`

> Step the simulator forward number of cycles specified by steps (default 1).
> Returns false if the round has ended.

**TypeScript contract:**

```ts
export function step(steps?: number): boolean; // steps defaults to 1
```

- Advances the simulation by `steps` cycles (default `1`).
- Returns `false` if the round has ended. Otherwise returns `true`.
- Publishes `NEXT_EXECUTION` once per call (section 3.6.6).

> AMBIGUITY: What is one "cycle"? Is it one instruction executed by one warrior, or one instruction from every live warrior? Recommended: one cycle is one instruction executed by the current warrior's current task, after which the turn passes to the next live warrior. `maximumCycles` and `RUN_PROGRESS.cycle` count these single executions. Check this against the Match Settings spec's definition of max cycles. If that spec defines a cycle as one execution per warrior, follow it and update this note.

> AMBIGUITY: What happens if the round ends partway through `step(n)`? Recommended: stop at once (execute no further cycles), publish `ROUND_END` exactly once, and return `false`. Calling `step` after the round has ended does nothing, publishes nothing, and returns `false`.

> AMBIGUITY: Does "Returns false if the round has ended" mean the round ended during this call or was already over? Recommended: return `false` in both cases, and `true` only if the round is still running after the call.

> AMBIGUITY: Calling `step`, `run`, `getWithInfoAt` or `republish` before `initialiseSimulator`. Recommended: throw an `Error("Simulator not initialised")`.

> AMBIGUITY: `steps` of `0`, a negative number, or a non-integer. Recommended: `0` executes nothing and returns whether the round is still running. Throw on negative or non-integer values.

### 3.3 `run()`

Doc signature (verbatim heading): `run()`

> Run the simulator to the end of the match

**TypeScript contract:**

```ts
export function run(): void;
```

> AMBIGUITY: The docs say "to the end of the match", but the Simulator only knows about one round (matches belong to the Matches API). Recommended: `run()` steps until the current round ends (a win, or `maximumCycles` reached), publishing the same messages as repeated `step()` calls, including exactly one `ROUND_END`. The return type is undocumented, so return `void`. Calling `run()` on a round that has ended does nothing.

### 3.4 `getWithInfoAt(address: number): ICoreLocation`

Doc signature (verbatim heading): `getWithInfoAt(address: number): ICoreLocation`

> Return the instruction at the specified core address.

**TypeScript contract (fields beyond `instruction` are a recommendation, see AMBIGUITY):**

```ts
export interface ICoreAccessEventArgs {
    warriorId: number;
    warriorData?: any;
    accessType: AccessType;
    address: number;
}

export interface ICoreLocation {
    instruction: IInstruction;          // the instruction stored at the address
    access?: ICoreAccessEventArgs;      // most recent access to this location, if any
}

export function getWithInfoAt(address: number): ICoreLocation;
```

> AMBIGUITY: `ICoreLocation` has no documented fields. The name "WithInfo" suggests more than the bare instruction. Recommended: `{ instruction: IInstruction; access?: ICoreAccessEventArgs }`. `instruction` is a copy (changing it must not change core). `access` is the last read/write/execute of that location this round, in the same shape as a `CORE_ACCESS` entry, and is `undefined` if nothing has touched it.

> AMBIGUITY: Out-of-range addresses. Recommended: fold `address` into `0 .. coresize - 1` with a true modulo, so negative numbers work too (for example `-1` means `coresize - 1`). The returned `instruction.address` is the folded address.

> AMBIGUITY: Does `getWithInfoAt` publish anything or count as a `CORE_ACCESS`? Recommended: no. It is a side-effect-free inspection call.

### 3.5 `republish(): void`

Doc signature (verbatim heading): `republish(): void`

> Trigger a resending of all pubsub messages for the current round.
> This can be used to build up a picture of the current state of the simulator from scratch.

**TypeScript contract:**

```ts
export function republish(): void;
```

> AMBIGUITY: "All pubsub messages for the current round" could mean replaying every message published so far, or publishing a snapshot of the current state. Recommended: publish a snapshot that is enough to rebuild the current state from scratch, in this order: `CORE_INITIALISE` with the *current* `IState`; then one `CORE_ACCESS` array containing the last access of every location accessed so far this round (so a visualiser can repaint ownership); then `TASK_COUNT` for all warriors; then `RUN_PROGRESS`; then `NEXT_EXECUTION` if the round is still running, or `ROUND_END` if it has ended. `republish` does not advance the simulation.

### 3.6 Messages (events) `[sim]`

> The following messages are published by the simulator:

The message name is the pubsub topic string (see the `IPublishProvider` AMBIGUITY in 3.1). Each payload is described below.

```ts
export enum MessageTopic {  // recommended constant names; the string values are the doc headings
    CORE_INITIALISE = 'CORE_INITIALISE',
    CORE_ACCESS = 'CORE_ACCESS',
    RUN_PROGRESS = 'RUN_PROGRESS',
    ROUND_END = 'ROUND_END',
    TASK_COUNT = 'TASK_COUNT',
    NEXT_EXECUTION = 'NEXT_EXECUTION',
    MATCH_END = 'MATCH_END',   // published by the Matches API, section 4
}
```

#### 3.6.1 `CORE_INITIALISE`

> Contains the initial state of the simulator core and process tree.

**Doc example (verbatim):**

```
{
  state: IState
}

```

**TypeScript contract (the `IState` fields are a recommendation, see AMBIGUITY):**

```ts
export interface ICoreInitialiseEventArgs {
    state: IState;
}

export interface ITask {
    instructionPointer: number;   // absolute core address this task executes next
    warrior: IWarrior;            // owning warrior
}

export interface IWarrior {
    id: number;                   // warriorId
    data?: any;                   // IParseResult.data
    name: string;                 // from metaData
    author: string;               // from metaData
    strategy: string;             // from metaData
    startAddress: number;         // absolute address of the warrior's first instruction
    tasks: ITask[];               // task (process) queue, next-to-run first
    taskIndex: number;            // index into tasks of the next task to run
}

export interface ICore {
    getSize(): number;            // = coresize
}

export interface IState {
    cycle: number;                // cycles executed so far this round
    warriors: IWarrior[];         // all warriors, indexed by warriorId
    warriorIndex: number;         // index of the warrior that executes next
    options: Required<IOptions>;  // effective options after defaults are applied
    core: ICore;                  // read access to the core; per-location data via getWithInfoAt
}
```

> AMBIGUITY: `IState` is referenced but never defined. The docs only say it holds "the initial state of the simulator core and process tree". Recommended: the shape above. It covers what the docs describe (core, the per-warrior process/task tree, the current cycle) and is the minimum a UI needs to draw an empty board. Publish it at the end of `initialiseSimulator`, after all warriors are loaded. Payload consumers must treat `state` as read-only.

#### 3.6.2 `CORE_ACCESS`

> Published when a warrior reads to, writes from or executes within the core

**Doc example (verbatim):**

```
[{
  warriorId: number,      // Each warrior has a unique id
  warriorData?: any,      // Any data supplied with this warrior's initial parse result
  accessType: AccessType, // AccessType can be 0=read, 1=write or 2=execute
  address: number         // Absolute address within the core
}]

```

**TypeScript contract:**

```ts
export enum AccessType {
    read = 0,
    write = 1,
    execute = 2,
}

export type CoreAccessPayload = ICoreAccessEventArgs[]; // see section 3.4
```

| Field | Type | Meaning |
|---|---|---|
| `warriorId` | `number` | "Each warrior has a unique id". |
| `warriorData` | `any`, optional | "Any data supplied with this warrior's initial parse result" (`IParseResult.data`). |
| `accessType` | `AccessType` | `0` = read, `1` = write, `2` = execute. |
| `address` | `number` | "Absolute address within the core" (`0 .. coresize - 1`). |

The payload is an **array**.

> AMBIGUITY: `AccessType` isn't on the enumerations page. Its values are only given inline (`0=read, 1=write or 2=execute`). Recommended: export it as an enum with exactly those values, as shown above. (The doc's wording "reads to, writes from" is swapped. The meaning is plainly read, write, execute.)

> AMBIGUITY: How are accesses batched into arrays? Recommended: publish one `CORE_ACCESS` message per executed cycle, holding every access in that cycle in the order it happened: the execute of the instruction first, then the reads and writes made while evaluating operands and running the opcode. Report an indirect operand's pointer read as a `read`, and a pre-decrement/post-increment as a `write` of the pointer location. Leave `warriorData` out when the warrior had no `data`.

#### 3.6.3 `RUN_PROGRESS`

> Used to monitor progress towards the end of the round

**Doc example (verbatim; note the trailing space after `{` and the missing commas, both as in the docs):**

```
{ 
  runProgress: number   // Indicates current cycle as a percentage of maximum cycles
  cycle: number         // The current cycle
  maximumCycles: number // The maximum number of cycles, after which the round will end in a draw
}

```

**TypeScript contract:**

```ts
export interface IRunProgressEventArgs {
    runProgress: number;    // cycle / maximumCycles * 100
    cycle: number;          // the current cycle
    maximumCycles: number;  // round ends in a draw after this many cycles
}
```

| Field | Type | Meaning |
|---|---|---|
| `runProgress` | `number` | "Indicates current cycle as a percentage of maximum cycles". |
| `cycle` | `number` | "The current cycle". |
| `maximumCycles` | `number` | "The maximum number of cycles, after which the round will end in a draw". |

So a round that reaches `maximumCycles` without a winner ends in a draw.

> AMBIGUITY: How often is `RUN_PROGRESS` published? Recommended: once at the end of every `step()` / `run()` call in which the integer part of `runProgress` changed, plus once when the round ends. Publishing every cycle would flood subscribers.

> AMBIGUITY: What range does `runProgress` have, and is it rounded? Recommended: `runProgress = (cycle / maximumCycles) * 100`, a non-rounded number from `0` to `100`.

#### 3.6.4 `ROUND_END`

> Published at the end of the round to indicate the outcome

**Doc example (verbatim):**

```
{
  winnerId: number,  // The unique id of the winning warrior or null
  winnerData?: any,  // Any data supplied with this warrior's initial parse result
  outcome: string    // Can be 'WIN', 'DRAW' or 'NONE'. 'NONE' indicates a single warrior battle
}

```

**TypeScript contract:**

```ts
export type RoundOutcome = 'WIN' | 'DRAW' | 'NONE';

export interface IRoundResult {
    winnerId: number | null;  // id of the winning warrior, or null
    winnerData?: any;         // IParseResult.data of the winner
    outcome: RoundOutcome;
}
```

| Field | Type | Meaning |
|---|---|---|
| `winnerId` | `number \| null` | "The unique id of the winning warrior or null". |
| `winnerData` | `any`, optional | "Any data supplied with this warrior's initial parse result". |
| `outcome` | `string` | `'WIN'`, `'DRAW'` or `'NONE'`. "'NONE' indicates a single warrior battle". |

Outcome rules (the doc gives the values; the conditions are our recommendation):

- `'WIN'`: two or more warriors started and exactly one still has tasks. `winnerId` is that warrior's id and `winnerData` its data.
- `'DRAW'`: two or more warriors started and `maximumCycles` was reached with more than one still alive. `winnerId` is `null` and `winnerData` is absent.
- `'NONE'`: one warrior started. The round ends when it runs out of tasks or `maximumCycles` is reached. `winnerId` is `null` and `winnerData` is absent.

> AMBIGUITY: The doc types `winnerId` as `number` but says it may be `null`. Recommended: type it `number | null`. Use `null` (not `undefined`) for DRAW and NONE.

> AMBIGUITY: Is `ROUND_END` published exactly once? Recommended: yes, exactly once per round, at the moment the round ends (from inside `step` or `run`). Re-sending it only happens through `republish`.

#### 3.6.5 `TASK_COUNT`

> Published whenever a warrior creates or loses a task.

**Doc example (verbatim):**

```
[{
  warriorId: number,  // The unique id of the warrior
  warriorData?: any,  // Any data supplied with this warrior's initial parse result
  taskCount: number   // The warrior's current task count
}]

```

**TypeScript contract:**

```ts
export interface ITaskCountEventArgs {
    warriorId: number;   // the unique id of the warrior
    warriorData?: any;   // IParseResult.data
    taskCount: number;   // the warrior's current task count
}

export type TaskCountPayload = ITaskCountEventArgs[];
```

The payload is an **array**.

> AMBIGUITY: Which warriors go in the array? Recommended: one entry for each warrior whose task count changed during the cycle (an `SPL` that added a task, or a task killed by executing `DAT` or by division by zero). Publish at most one `TASK_COUNT` per cycle, and only if some count changed. An `SPL` refused because the warrior is at `maxTasks` is not a change. `republish` and the end of `initialiseSimulator` send entries for all warriors (initial count 1 each).

#### 3.6.6 `NEXT_EXECUTION`

> Published once per call to step and indicates the next address which will be executed

**Doc example (verbatim):**

```
{
  warriorId: number,  // The unique id of the next warrior
  warriorData?: any,  // Any data supplied with this warrior's initial parse result
  address: number     // The address in core at which the next warrior will execute
}

```

**TypeScript contract:**

```ts
export interface INextExecutionEventArgs {
    warriorId: number;   // the unique id of the next warrior
    warriorData?: any;   // IParseResult.data
    address: number;     // core address at which that warrior will execute next
}
```

> AMBIGUITY: For `step(n)` with `n > 1`, is "once per call to step" one message per call or one per cycle? Recommended: follow the doc literally. Publish one `NEXT_EXECUTION` at the end of each `step()` call, describing the warrior and task that will run on the next cycle. If the round ended during the call, don't publish it. `run()` publishes none. `initialiseSimulator` publishes one after `CORE_INITIALISE`, so a UI can show the first instruction pointer.

### 3.7 Message ordering within one cycle (recommended)

> AMBIGUITY: The docs don't specify the order of messages. Recommended order per executed cycle: `CORE_ACCESS` (if any accesses), then `TASK_COUNT` (if any count changed), then `ROUND_END` (if the round ended in this cycle). At the end of a `step()`/`run()` call: `RUN_PROGRESS` (subject to the throttle in 3.6.3), then `NEXT_EXECUTION` (step only, round not ended). At the end of `initialiseSimulator`: `CORE_INITIALISE`, `TASK_COUNT` (all warriors), `RUN_PROGRESS` (cycle 0), `NEXT_EXECUTION`.

---

## 4. Matches API `[matches]`

> The Matches API allows hills, benchmarks and multiround matches to be executed using the Simulator.

> The Matches API is currently under development with limited functionality available

The page's `## Functions` heading has **no content**. No Matches functions are documented. The only documented Matches item is the `MATCH_END` message.

> AMBIGUITY: There are no documented Matches entry points, yet the overview says the library provides "hill and benchmark functionality". What should we build? Recommended minimal entry point, built on the Simulator API (section 3) and publishing through the same `IPublishProvider`:
>
> ```ts
> export interface IMatchWarrior {
>     source: IParseResult;
> }
>
> export interface IMatch {
>     rounds: number;
>     options?: IOptions;
>     warriors: IMatchWarrior[];
> }
>
> export function runMatch(match: IMatch, messageProvider: IPublishProvider): IMatchResult;
> ```
>
> `runMatch` calls `initialiseSimulator` and `run` once per round, collects every round's `ROUND_END` outcome, publishes `MATCH_END` once at the end, and returns the same payload. Hills and benchmarks (each warrior against every other, or against a fixed set) are optional extras built on `runMatch`. They aren't required by these pages, so leave them out unless another spec file asks for them.

### 4.1 Messages

#### 4.1.1 `MATCH_END`

> Published at the end of a multi-round match to indicate the outcome

**Doc example (verbatim):**

```
{
  rounds: number;   // The number of rounds in the match
  warriors: [
    source: IParseResult;   // The parsed output of the warrior
    won: number;            // The number of rounds won by the warrior
    drawn: number;          // The number of rounds drawn by the warrior
    lost: number;           // The number of rounds lost by the warrior
    given: number;          // The number of points awarded to the warrior given by win percentage multiplied by three plus draw percentage
    taken: number;          // The number of points awarded to the warrior's opponent given by loss percentage multiplied by three plus draw percentage
  ];
}

```

**TypeScript contract:**

```ts
export interface IMatchWarriorResult {
    source: IParseResult;  // the parsed output of the warrior
    won: number;           // rounds won by the warrior
    drawn: number;         // rounds drawn by the warrior
    lost: number;          // rounds lost by the warrior
    given: number;         // points awarded to the warrior
    taken: number;         // points awarded to the warrior's opponent
}

export interface IMatchResult {
    rounds: number;                   // number of rounds in the match
    warriors: IMatchWarriorResult[];  // one entry per warrior, in match order
}
```

| Field | Type | Meaning |
|---|---|---|
| `rounds` | `number` | "The number of rounds in the match". |
| `warriors[].source` | `IParseResult` | "The parsed output of the warrior". |
| `warriors[].won` | `number` | "The number of rounds won by the warrior". |
| `warriors[].drawn` | `number` | "The number of rounds drawn by the warrior". |
| `warriors[].lost` | `number` | "The number of rounds lost by the warrior". |
| `warriors[].given` | `number` | "The number of points awarded to the warrior given by win percentage multiplied by three plus draw percentage". |
| `warriors[].taken` | `number` | "The number of points awarded to the warrior's opponent given by loss percentage multiplied by three plus draw percentage". |

Scoring formulas from the doc text:

```
given = (won  / rounds * 100) * 3 + (drawn / rounds * 100)
taken = (lost / rounds * 100) * 3 + (drawn / rounds * 100)
```

Invariant: `won + drawn + lost === rounds` for every warrior.

Worked example (ours, not from the docs): 10 rounds, warrior A wins 5, draws 3, loses 2. Then `given = 50*3 + 30 = 180` and `taken = 20*3 + 30 = 90`.

> AMBIGUITY: The doc writes `warriors` as `[ source: ...; won: ...; ... ]`, which isn't valid TypeScript. Recommended: `warriors` is an array of objects, one per warrior (`IMatchWarriorResult[]`), in the same order the warriors were supplied.

> AMBIGUITY: Should "percentage" be 0-100 or 0-1, and is the result rounded? Recommended: 0-100, so `given` and `taken` range from 0 to 300. Don't round.

> AMBIGUITY: How do round outcomes map to won/drawn/lost when there are more than two warriors, or a `'NONE'` single-warrior round? Recommended: in a `'WIN'` round the winner gets `won += 1` and every other warrior `lost += 1`. In a `'DRAW'` round every warrior gets `drawn += 1`. In a `'NONE'` round (one warrior) the warrior gets `drawn += 1` if it survived to `maximumCycles`, otherwise `lost += 1`.

> AMBIGUITY: Does `source` include `data`? Recommended: `source` is the exact `IParseResult` object the caller supplied, `data` included, not a copy.

---

## 5. Enumerations `[enum]`

> The following enumerations are used by the corewar library's API.

Every enum is numeric. The values below are verbatim from the docs and must not be renumbered. Member names are given as TypeScript identifiers; the "Meaning (verbatim)" column is the docs' text.

### 5.1 Token Categories (`TokenCategory`)

> Semantic meaning of tokens produced by the Parser.

| Value | Meaning (verbatim) |
|---|---|
| 0 | Label |
| 1 | Opcode |
| 2 | Preprocessor |
| 3 | Modifier |
| 4 | Mode |
| 5 | Number |
| 6 | Comma |
| 7 | Maths |
| 8 | EOL |
| 9 | Comment |
| 10 | Unknown |

```ts
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
```

> AMBIGUITY: Which lexemes go in which category? The docs give only the names. Recommended: `Label` for label names (definitions and references). `Opcode` for the opcode mnemonic. `Preprocessor` for `EQU`, `END`, `ORG`, `FOR`, `ROF` and other pseudo-ops. `Modifier` for the modifier text including its leading `.` (for example `.AB`). `Mode` for one of `# $ * @ { < } >`. `Number` for numeric literals. `Comma` for `,`. `Maths` for `+ - * / %` and parentheses. `EOL` for end of line. `Comment` for `;` to end of line. `Unknown` for anything else (and the parser should also emit an Error message for it). Coordinate with the Redcode/parser spec file.

### 5.2 Message Type (`MessageType`)

> Message types which can be returned by the Parser

| Value | Meaning (verbatim) |
|---|---|
| 0 | Error |
| 1 | Warning |
| 2 | Info |

```ts
export enum MessageType {
    Error = 0,
    Warning = 1,
    Info = 2,
}
```

### 5.3 Standard (`Standard`)

> Standard refers to the Corewar Standard used.

| Value | Meaning (verbatim) |
|---|---|
| 0 | ICWS86 |
| 1 | ICWS88 |
| 2 | ICWS94draft |

```ts
export enum Standard {
    ICWS86 = 0,
    ICWS88 = 1,
    ICWS94draft = 2,
}
```

The default for `IOptions.standard` is `ICWS94draft` (`2`).

### 5.4 Opcode (`Opcode`)

> Opcode refers to the opcode the instruction represents.

| Value | Meaning (verbatim) |
|---|---|
| 0 | DAT |
| 1 | MOV |
| 2 | ADD |
| 3 | SUB |
| 4 | MUL |
| 5 | DIV |
| 6 | MOD |
| 7 | JMP |
| 8 | JMZ |
| 9 | JMN |
| 10 | DJN |
| 11 | CMP |
| 12 | SEQ |
| 13 | SNE |
| 14 | SLT |
| 15 | SPL |
| 16 | NOP |

```ts
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
}
```

> AMBIGUITY: `CMP` (11) and `SEQ` (12) get separate values, but in ICWS'94 they are the same instruction. Recommended: keep both values. The parser keeps whichever mnemonic the source used, and the Simulator executes `CMP` exactly like `SEQ`. The opcode semantics spec file is authoritative.

> AMBIGUITY: There's no `LDP`/`STP` (P-space) member. Recommended: P-space opcodes are out of scope for this API. The parser reports them as an Error.
>
> RESOLVED: `spec/pspace.md` adds P-space as an extension. `LDP` is 17 and `STP` is 18. The documented members keep their values.

### 5.5 Modifier (`Modifier`)

> The Modifier for the instruction's operand.

| Value | Meaning (verbatim) |
|---|---|
| 0 | A |
| 1 | B |
| 2 | AB |
| 3 | BA |
| 4 | F |
| 5 | X |
| 6 | I |

```ts
export enum Modifier {
    A = 0,
    B = 1,
    AB = 2,
    BA = 3,
    F = 4,
    X = 5,
    I = 6,
}
```

### 5.6 Mode (`Mode`, referred to as `ModeType` in `IOptions`)

> The Addressing Mode of the instruction's operand.

| Value | Meaning (verbatim) |
|---|---|
| 0 | Immediate (`#`) |
| 1 | Direct (`$`) |
| 2 | A Indirect (`*`) |
| 3 | B Indirect (`@`) |
| 4 | A Pre Decrement (`{`) |
| 5 | B Pre Decrement (`<`) |
| 6 | A Post Increment (`}`) |
| 7 | B Post Increment (`>`) |

```ts
export enum Mode {
    Immediate = 0,        // #
    Direct = 1,           // $
    AIndirect = 2,        // *
    BIndirect = 3,        // @
    APreDecrement = 4,    // {
    BPreDecrement = 5,    // <
    APostIncrement = 6,   // }
    BPostIncrement = 7,   // >
}

export type ModeType = Mode;
```

### 5.7 AccessType (`AccessType`)

Not on the enumerations page; defined inline in the `CORE_ACCESS` message (`[sim]`): "AccessType can be 0=read, 1=write or 2=execute". See section 3.6.2.

| Value | Meaning |
|---|---|
| 0 | read |
| 1 | write |
| 2 | execute |

### 5.8 Placeholder tables on the enumerations page

The enumerations page ends with four more sections, each headed `## Enumeration`, each with an empty Value/Meaning table (one empty row). They define nothing.

> AMBIGUITY: Do the four empty "Enumeration" sections imply missing enums? Recommended: treat them as unfilled template placeholders and implement nothing for them. The only enums referenced elsewhere in the developer pages but missing from this page are `AccessType` (5.7) and the round `outcome` strings (`'WIN' | 'DRAW' | 'NONE'`, section 3.6.4), and both are covered.

---

## 6. Public surface summary

The package's top-level exports:

```ts
// Parser [parser]
export function parse(redcode: string): IParseResult;
export function serialise(tokens: IToken[]): string;

// Simulator [sim]
export function initialiseSimulator(options: IOptions, parseResults: IParseResult[], messageProvider: IPublishProvider): void;
export function step(steps?: number): boolean;
export function run(): void;
export function getWithInfoAt(address: number): ICoreLocation;
export function republish(): void;

// Matches [matches] (recommended; not documented)
export function runMatch(match: IMatch, messageProvider: IPublishProvider): IMatchResult;

// Types
export type {
    IPosition, IMetaData, IToken, IMessage, IParseResult,
    IOperand, IInstruction, IOptions, ModeType,
    IPublishProvider, ICoreLocation, ICoreAccessEventArgs,
    IState, IWarrior, ITask, ICore,
    ICoreInitialiseEventArgs, IRunProgressEventArgs, IRoundResult, RoundOutcome,
    ITaskCountEventArgs, INextExecutionEventArgs,
    IMatch, IMatchWarrior, IMatchResult, IMatchWarriorResult,
};

// Enums
export { TokenCategory, MessageType, Standard, Opcode, Modifier, Mode, AccessType, MessageTopic };
```

> AMBIGUITY: The docs show the functions as free functions, without saying whether they are top-level exports or methods on an exported object. Recommended: export each as a named top-level function (as above), and also as methods on a default-exported singleton `corewar` object (`corewar.parse(...)`, `corewar.step()` and so on), so both styles work. The Simulator state is a single module-level instance.

---

## Definition of Done checklist

- [ ] `npm run build` (or the documented `npm build` equivalent) produces an importable package written in TypeScript `[dev]`
- [ ] `npm test` runs all tests and prints a code coverage report `[dev]`
- [ ] Unit tests exist for the Parser API `[dev]`
- [ ] Unit tests exist for the Simulator API `[dev]`
- [ ] Unit tests exist for the Matches API `[dev]`
- [ ] Integration tests exist for the Parser `[dev]`
- [ ] Events are delivered through a caller-supplied pubsub provider `[dev]` `[sim]`
- [ ] `parse(redcode: string)` is exported and returns an `IParseResult` `[parser]`
- [ ] `IParseResult.metaData.name` is a string `[parser]`
- [ ] `IParseResult.metaData.author` is a string `[parser]`
- [ ] `IParseResult.metaData.strategy` is a string `[parser]`
- [ ] `IParseResult.tokens` is an array of tokens `[parser]`
- [ ] Each token has `position.line` (number) `[parser]`
- [ ] Each token has `position.char` (number) `[parser]`
- [ ] Each token has `lexeme` (string) containing the original text that produced it `[parser]`
- [ ] Each token has `category` (number) taken from Token Categories `[parser]` `[enum]`
- [ ] `IParseResult.messages` is an array of messages `[parser]`
- [ ] Each message has `type` (number) taken from Message Type `[parser]` `[enum]`
- [ ] Each message has `position.line` and `position.char` (numbers) `[parser]`
- [ ] Each message has `text` (string) `[parser]`
- [ ] `IParseResult` accepts an optional `data?: any` property `[parser]`
- [ ] `parse` never throws; problems are reported as Error messages (AMBIGUITY resolution) `[parser]`
- [ ] Position base (1-based line and char) is fixed and tested (AMBIGUITY resolution) `[parser]`
- [ ] Missing metadata fields are `""` (AMBIGUITY resolution) `[parser]`
- [ ] `serialise(tokens: IToken[])` is exported (British spelling) and returns a string `[parser]`
- [ ] `serialise` output is a single, human-readable string built from the token lexemes `[parser]`
- [ ] `serialise` output format is deterministic and snapshot-tested (AMBIGUITY resolution) `[parser]`
- [ ] `initialiseSimulator(options, parseResults, messageProvider)` is exported `[sim]`
- [ ] `initialiseSimulator` loads every parse result into core as a warrior `[sim]`
- [ ] A `data` property on a parse result is associated with that warrior and echoed as `warriorData`/`winnerData` `[sim]`
- [ ] `initialiseSimulator` accepts an options object in which every attribute is optional `[sim]`
- [ ] Option `coresize` defaults to 8000 `[sim]`
- [ ] Option `maximumCycles` defaults to 80000 `[sim]`
- [ ] Option `initialInstruction` defaults to `DAT.F $0, $0` `[sim]`
- [ ] `initialInstruction` has fields `address`, `opcode`, `modifier`, `aOperand{mode,address}`, `bOperand{mode,address}` `[sim]`
- [ ] Option `instructionLimit` defaults to 100 `[sim]`
- [ ] Option `maxTasks` defaults to 8000 `[sim]`
- [ ] Option `minSeparation` defaults to 100 `[sim]`
- [ ] Option `standard` defaults to ICWS94draft (2) `[sim]` `[enum]`
- [ ] Options `readDistance` and `writeDistance` are accepted without error (not required to be implemented) `[sim]`
- [ ] Partial options are merged with the defaults field by field `[sim]`
- [ ] `step(steps?: number): boolean` is exported `[sim]`
- [ ] `step()` with no argument advances exactly 1 cycle `[sim]`
- [ ] `step(n)` advances n cycles `[sim]`
- [ ] `step` returns `false` once the round has ended, otherwise `true` `[sim]`
- [ ] `run()` is exported and runs the simulator until the round ends `[sim]`
- [ ] `getWithInfoAt(address: number): ICoreLocation` is exported and returns the instruction at that core address `[sim]`
- [ ] `republish(): void` is exported and resends the messages needed to rebuild the current round's state from scratch `[sim]`
- [ ] `CORE_INITIALISE` is published with payload `{ state: IState }` holding the initial core and process tree `[sim]`
- [ ] `CORE_ACCESS` is published when a warrior reads, writes or executes core `[sim]`
- [ ] `CORE_ACCESS` payload is an array of `{ warriorId, warriorData?, accessType, address }` `[sim]`
- [ ] `CORE_ACCESS.accessType` uses 0=read, 1=write, 2=execute `[sim]`
- [ ] `CORE_ACCESS.address` is an absolute core address `[sim]`
- [ ] Every warrior has a unique `warriorId` `[sim]`
- [ ] `RUN_PROGRESS` is published with `{ runProgress, cycle, maximumCycles }` `[sim]`
- [ ] `RUN_PROGRESS.runProgress` equals current cycle as a percentage of `maximumCycles` `[sim]`
- [ ] The round ends in a draw when `maximumCycles` is reached `[sim]`
- [ ] `ROUND_END` is published at the end of the round with `{ winnerId, winnerData?, outcome }` `[sim]`
- [ ] `ROUND_END.winnerId` is the winner's id or `null` `[sim]`
- [ ] `ROUND_END.outcome` is `'WIN'`, `'DRAW'` or `'NONE'` `[sim]`
- [ ] `ROUND_END.outcome` is `'NONE'` for a single-warrior battle `[sim]`
- [ ] `TASK_COUNT` is published whenever a warrior creates or loses a task `[sim]`
- [ ] `TASK_COUNT` payload is an array of `{ warriorId, warriorData?, taskCount }` `[sim]`
- [ ] `NEXT_EXECUTION` is published once per call to `step` with `{ warriorId, warriorData?, address }` `[sim]`
- [ ] `NEXT_EXECUTION.address` is the address the next warrior will execute `[sim]`
- [ ] `warriorData` in every message equals the `data` supplied with that warrior's parse result `[sim]`
- [ ] A Matches API exists for running multi-round matches on top of the Simulator `[matches]`
- [ ] `MATCH_END` is published at the end of a multi-round match `[matches]`
- [ ] `MATCH_END.rounds` is the number of rounds in the match `[matches]`
- [ ] `MATCH_END.warriors[]` has one entry per warrior `[matches]`
- [ ] `MATCH_END.warriors[].source` is the warrior's `IParseResult` `[matches]`
- [ ] `MATCH_END.warriors[].won` is the number of rounds won `[matches]`
- [ ] `MATCH_END.warriors[].drawn` is the number of rounds drawn `[matches]`
- [ ] `MATCH_END.warriors[].lost` is the number of rounds lost `[matches]`
- [ ] `MATCH_END.warriors[].given` = win% × 3 + draw% `[matches]`
- [ ] `MATCH_END.warriors[].taken` = loss% × 3 + draw% `[matches]`
- [ ] `TokenCategory` enum: Label=0, Opcode=1, Preprocessor=2, Modifier=3, Mode=4, Number=5, Comma=6, Maths=7, EOL=8, Comment=9, Unknown=10 `[enum]`
- [ ] `MessageType` enum: Error=0, Warning=1, Info=2 `[enum]`
- [ ] `Standard` enum: ICWS86=0, ICWS88=1, ICWS94draft=2 `[enum]`
- [ ] `Opcode` enum: DAT=0, MOV=1, ADD=2, SUB=3, MUL=4, DIV=5, MOD=6, JMP=7, JMZ=8, JMN=9, DJN=10, CMP=11, SEQ=12, SNE=13, SLT=14, SPL=15, NOP=16 `[enum]`
- [ ] `Modifier` enum: A=0, B=1, AB=2, BA=3, F=4, X=5, I=6 `[enum]`
- [ ] `Mode` enum: Immediate(#)=0, Direct($)=1, A Indirect(*)=2, B Indirect(@)=3, A Pre Decrement({)=4, B Pre Decrement(<)=5, A Post Increment(})=6, B Post Increment(>)=7 `[enum]`
- [ ] `AccessType` enum: read=0, write=1, execute=2 `[sim]`
- [ ] Every enum is exported for API consumers `[enum]`
