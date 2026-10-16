# Architecture

This project is a from-scratch Corewar (ICWS'94 Redcode) engine in TypeScript, with a terminal UI built on OpenTUI. This file defines the module boundaries, who owns which files, the internal representations, and the contracts between the parser, the simulator and the UI.

The specs in `spec/` are the source of truth. Where they leave a question open, we follow their `AMBIGUITY` recommendations, except where section 4 of this file records a different decision.

## 1. Constraints

- Runtime: Bun 1.4. Tests run with `bun test`. TypeScript is strict.
- The engine (`packages/engine/`) has no UI dependencies. Only `packages/tui/` may import `@opentui/core`, which is pinned to exactly `0.6.6`. A test in `packages/engine/index.test.ts` fails if any engine file imports `@opentui/*`.
- Do not modify, move or read the user's files in the project root: `pmars`, `src/` (pMARS C source), `examples/` and `warriors/`. Do not use the corewar.io GitHub repo, the `corewar` npm package or pMARS as a reference.
- Our code lives in `packages/` so that it never collides with `src/`. `bunfig.toml` sets the test root to `packages`.
- P-space (`LDP`, `STP`, `PIN`) is an extension beyond the docs, added at the user's request. `spec/pspace.md` gives its rules, which follow pMARS.

## 2. Directory layout

```
package.json            scripts: test (with coverage), typecheck, build, start
tsconfig.json           strict; includes packages/**/*.ts
bunfig.toml             [test] root = "packages"
ARCHITECTURE.md         this file
packages/
  engine/               the library; zero UI dependencies
    index.ts            public barrel: named exports + default `corewar` object
    types.ts            every public type and enum (developer.md), plus extensions
    instruction.ts      internal instruction encoding, mnemonic tables, disassembly
    loadformat.ts       the parser -> simulator contract (reader and writers)
    options.ts          option defaults, presets, validation, parser settings
    rng.ts              seedable PRNG (mulberry32)
    samples.ts          built-in sample warriors (guide.md section 12)
    *.test.ts           smoke and contract tests for the files above
    parser/
      index.ts          parse(), re-exports serialise()
      lexer.ts          source -> source tokens with 1-based positions
      preprocessor.ts   metadata, ;assert, EQU, FOR/ROF, END cut-off, constants
      expression.ts     constant-expression evaluator
      assembler.ts      labels, defaults, start offset, load-format emission
      serialiser.ts     serialise()
    simulator/
      index.ts          developer.md free functions over a module-level Simulator
      simulator.ts      Simulator class (one round engine)
      state.ts          internal round state
      core.ts           core memory and access arrays
      processes.ts      per-warrior task queue (ring buffer)
      loader.ts         placement and loading
      executor.ts       fetch / decode / execute of one instruction
      pspace.ts         PSpace: one match's P-space (cells, PIN sharing, result cells)
      events.ts         message batching and ordering
    matches/
      index.ts          Matches API exports
      match.ts          runMatch()
      scoring.ts        given/taken and won/drawn/lost tallies
      hill.ts           createHill(), submitToHill()
      benchmark.ts      defaultBenchmark(), runBenchmark()
    integration/        cross-module tests (parser + simulator), created by the simulator engineer
  tui/
    main.ts             TUI entry point (placeholder; built in a later phase)
```

Tests sit next to the code they test (`foo.ts` and `foo.test.ts`). Fixtures sit in a `fixtures/` folder inside the owning module.

## 3. File ownership

Each file has exactly one owner. Do not edit a file that you do not own. If you need a change in another person's file, ask its owner.

| Owner | Files |
|---|---|
| Architect (frozen after this phase) | `package.json`, `tsconfig.json`, `bunfig.toml`, `.gitignore`, `ARCHITECTURE.md`, `packages/engine/index.ts`, `types.ts`, `instruction.ts`, `loadformat.ts`, `options.ts`, `rng.ts`, `samples.ts`, and their `*.test.ts` files |
| Parser engineer | everything under `packages/engine/parser/` |
| Simulator engineer | everything under `packages/engine/simulator/`, `packages/engine/matches/` and `packages/engine/integration/` |
| TUI (later phase) | everything under `packages/tui/` |

Inside your own directory you may add, split, rename or delete files and change internal signatures. These signatures are frozen, because the barrel and the other side depend on them:

- Parser: `parse(redcode: string, options?: IParseOptions): IParseResult` and `serialise(tokens: IToken[]): string`, exported from `parser/index.ts`.
- Simulator: the free functions and re-exports in `simulator/index.ts`, and the public methods of the `Simulator` class in `simulator/simulator.ts`.
- Matches: the exports of `matches/index.ts`.

### 3.1 Changing frozen files

The shared files are designed so that neither engineer needs to change them. If you find a real gap (for example a missing type), do not edit the file. Put a local type in your own directory, and raise the gap with the architect, who will make the change in one place for both engineers. Dependencies (`bun add`) also go through the architect.

## 4. Decisions

These decisions resolve conflicts between the specs, or between the specs and the lead's instructions.

| Topic | Decision |
|---|---|
| Operand evaluation | ICWS'94. Operand numbers come from the instruction-register copy. Intermediate pointer fields are read from core at evaluation time. The `mov.i >0, $0` example in guide.md 7.6 is **not** followed: under our model, address 0 is overwritten with `mov.i >0, $0` and address 1 stays `dat.f $0, $0`. A test records this divergence. |
| Cycle | Option `cycleUnit`, default `'execution'`: one cycle is one instruction executed by one warrior (the docs' definition). `'pmars'` advances `cycle` once per pass over the live warriors (see section 7.3). `maximumCycles`, `IState.cycle` and `RUN_PROGRESS.cycle` all use the chosen unit. |
| Load format | `IParseResult.tokens` is the redcode.md load file as tokens (section 6). Ordinary comments are removed (redcode.md DoD 1611). Only the metadata comment lines are kept, as `Comment` tokens. This overrides the developer.md 2.1 recommendation to keep all comments. |
| Lexemes | Load-format tokens carry normalised lexemes (`MOV`, `.I`, `-1`, `5334`), not the raw source text. Their `position` still points at the source text they came from. |
| Metadata | `metaData.name`, `author` and `strategy` are `""` when absent (developer.md). The emitted load-file comments use `;name Nameless` and `;author Blameless` when absent (redcode.md). A `;strategy` comment line is emitted once per source strategy line. |
| Parser settings | `parse(redcode, options?)` takes an optional `IParseOptions` for the predefined constants (`CORESIZE` and so on), the `instructionLimit` length check and the standard. Defaults come from `resolveParseOptions()`. `PSPACESIZE` is the `pSpaceSize` option (spec/pspace.md 1). |
| Standard | The parser always uses the '94 grammar. The `;redcode-NN` source line only selects the emitted `;redcode` comment. When the caller passes `options.standard` as `ICWS88` or `ICWS86`, an opcode, modifier or mode outside that standard is a parser Error (guide.md DoD 626). The simulator stores `standard` and treats every standard as '94. |
| CMP | The parser keeps `CMP` in tokens. The loader stores `CMP` as `SEQ` in core, so `SEQ.I` comparisons treat them as equal. |
| Default mode | `$` for every opcode, including `DAT` (redcode.md). A single-operand `dat x` puts `x` in B and inserts `#0` as A (ICWS'94 / pMARS): `dat 7` is `DAT.F #0, $7`. |
| Warrior length | The parser reports an Error when the count exceeds `instructionLimit`. `initialiseSimulator` also throws in that case, because its options can differ from the parse options. |
| Warrior id | `warriorId` is the 0-based index in the `parseResults` array. Access arrays use a `Uint8Array`, so at most 255 warriors. |
| `startAddress` | `IWarrior.startAddress` is the absolute address of the warrior's first loaded instruction (the developer.md wording). The initial process starts at `startAddress + startOffset`. |
| Turn rotation | Option `firstWarrior` (default 0) picks the warrior that moves first. `runMatch` sets it to `round % N` (guide.md 5). |
| Seed | Option `seed`. `resolveOptions()` replaces a missing seed with a time-based one, and `IState.options.seed` records it, so any round can be replayed. `runMatch` derives each round's seed from `IMatch.seed` with `createRng(seed).nextUint32()`. |
| Read/write limits | `readDistance` and `writeDistance` default to `coresize` (no effect) and must divide `coresize`. The simulator engineer implements the guide.md 9.2 fold, because guide.md DoD 627 and 628 list it. With the defaults the hot path must not pay for it (use a flag). |
| Event payloads | `warriorData` / `winnerData` appear only when the parse result has its own `data` property (`'data' in result`). |
| pMARS oracle | `packages/engine/oracle/` compares the engine with pMARS 0.9.5 as a black box. `oracle.test.ts` replays recorded fixtures (`oracle/fixtures/*.json`), so `bun test` never needs pMARS; `bun run oracle` regenerates them from `./pmars` and exits 0 when it is absent. Where the docs are silent or contradictory we follow pMARS; documented exceptions sit in `oracle/fixtures.ts`. |
| P-space | `spec/pspace.md`. Option `pSpaceSize` (default `defaultPSpaceSize(coresize)`). One `PSpace` object lives for a whole match: `Simulator.initialise` / `initialiseWarriors` take it as an optional last argument, and `getPSpace()` returns it after the round. `runMatch` passes it from round to round and creates a new one per call, so every hill and benchmark pairing starts fresh. The TUI controller does the same and keeps a copy of the round-start P-space for its restart command. A warrior without a PIN is always private (one documented difference from pMARS, spec/pspace.md 8). |
| Matches events | `runMatch` forwards every simulator message to its provider, as developer.md 4 describes. Hills and benchmarks call it with a `null` provider. |

## 5. Internal representation

### 5.1 Instructions and core

Core is a struct of arrays, owned by `simulator/core.ts`. The encoding is defined in `instruction.ts`:

| Array | Type | Content |
|---|---|---|
| `op` | `Uint16Array` | `opcode << 9 \| modifier << 6 \| aMode << 3 \| bMode` (`packOp`) |
| `a` | `Int32Array` | A-number, always in `[0, coresize)` |
| `b` | `Int32Array` | B-number, always in `[0, coresize)` |

- `opModKey(op)` (`op >>> 6`) is a key below `OPMOD_KEY_COUNT` (152: opcodes 0 to 18, times 8 modifier slots). The executor dispatches on it with one `switch` or a table of handlers. It does no string or object work.
- A `mov.i` copies three array entries. A comparison of two whole instructions (`SEQ.I`) compares three integers.
- The instruction register, source register and destination register are local numeric variables in the executor (`irOp`, `irA`, `irB`, and so on). Each execution allocates no objects.
- `IInstructionSpec` (`{opcode, modifier, aMode, aNumber, bMode, bNumber}`) is the decoded, allocation-friendly form used outside the hot loop: by the load format, `Core.read()` and the disassembler.
- `IInstruction` (the public shape with `aOperand` and `bOperand`) is built only on demand, by `getWithInfoAt` and `IState` snapshots. `toPublicInstruction()` and `fromPublicInstruction()` convert.
- `fold(x, size)` is the one true-modulo helper.

### 5.2 Processes

- Each warrior has a `ProcessQueue`: a FIFO ring buffer on an `Int32Array` with capacity `maxTasks`. It is allocated once per round and never resized.
- At fetch, the executor removes the head of the queue. After execution, it appends the next IP, unless the process died (`DAT`, or division by zero). `SPL` appends `IP+1` first, then the new process if `size < maxTasks`. Because the head is removed first, the queue never exceeds `maxTasks`.
- Turn order is a fixed array of warriors plus an `alive` flag. After each execution, the turn passes to the next live warrior in id order, wrapping round.

### 5.3 Matches fast path

- `toWarriorInputs()` decodes and validates the parse results once. `runMatch` then calls `Simulator.initialiseWarriors()` once per round with the decoded programs.
- With a `null` provider and `trackAccess: false`, `run()` must not allocate objects per execution. Target: 100 rounds of 80,000 cycles for two warriors in a few seconds.

## 6. Load format: the parser -> simulator contract

The simulator reads exactly these fields of an `IParseResult`, and nothing else:

| Field | How the simulator uses it |
|---|---|
| `messages` | If any message has `type === MessageType.Error`, `initialiseSimulator` throws an `Error` that names the warrior index (`parseSucceeded()` in `loadformat.ts`). |
| `tokens` | Decoded only by `readLoadFormat(tokens)` into `IWarriorProgram { instructions, startOffset, pin? }`. |
| `metaData` | Copied to `IWarrior.name`, `author` and `strategy`. |
| `data` | Echoed as `warriorData` / `winnerData` if the result has its own `data` property. The simulator never reads its contents. |

The grammar of `tokens` is defined in the header comment of `loadformat.ts`. In short, there is one line per `EOL` token:

```
;redcode-94                 Comment EOL           (metadata lines first)
;name dwarf                 Comment EOL
;author Blameless           Comment EOL
ORG 1                       Preprocessor Number EOL   (always present; offset may lie outside [0, length))
PIN 7                       Preprocessor Number EOL   (only when the source has a PIN directive)
DAT.F #0, #0                Opcode Modifier Mode Number Comma Mode Number EOL
ADD.AB #4, $-1
MOV.I $-2, @-2
JMP.B $-2, $0
```

Rules:

1. The parser builds its token output **only** with the writers in `loadformat.ts`: `emitCommentLine`, `emitOrgTokens`, `emitPinTokens` and `emitInstructionTokens`. This guarantees that the reader accepts it.
2. Every instruction has all six fields. The parser fills in default modes and modifiers.
3. Numbers are signed and relative, and the parser does not fold them. The loader folds them into `[0, coresize)`.
4. The parser emits the start offset as written. If it lies outside the warrior it warns, and execution starts outside the code, as in pMARS (redcode.md 10).
5. `serialise(parse(src).tokens)` produces the redcode.md load file. This follows from the developer.md 2.2 spacing rules.
6. Simulator and match tests that must not depend on the parser build warriors with `programToParseResult()`.

## 7. Simulator behaviour

### 7.1 Loader

- Warrior 0 loads at absolute address 0.
- Each later warrior loads at an address chosen uniformly at random, with the seeded RNG, from all addresses that satisfy this rule against every warrior already placed: for warriors P (at `p`, length `lp`) and Q (at `q`, length `lq`), the forward distance from `p` to `q` is at least `max(minSeparation, lp)`, and the forward distance from `q` to `p` is at least `max(minSeparation, lq)`. Code therefore never overlaps.
- If no address fits, `initialiseSimulator` throws. It never loops.
- Option `loadAddresses` (default `null`) replaces the random placement with fixed addresses, one per warrior in warrior order, folded into the core. It ignores `minSeparation` but still rejects overlapping code. `runMatch` uses the same addresses in every round. The pMARS oracle tests use it to mirror `pmars -F`.
- For two warriors with lengths up to `minSeparation`, this rule reduces to guide.md 5: `minSeparation + rand(coresize - 2 * minSeparation + 1)`.

### 7.2 One execution

The executor takes these steps:

1. Fetch: remove the head IP of the current warrior's queue and copy the cell into the instruction register.
2. Evaluate the A operand, then the B operand (pre-decrement before use, post-increment after the register copy; A side effects happen before B).
3. Execute the opcode, then append the next IP or IPs (section 5.2).
4. Record accesses (section 8), count the execution, update `cycle`, and check for the end of the round.

### 7.3 Counting and round end

- `executions` counts instructions executed this round.
- When `cycleUnit` is `'execution'`, `cycle === executions`.
- When `cycleUnit` is `'pmars'`, `cycle` advances by one each time the turn passes from a warrior to a warrior at the same or an earlier turn-order position, counted from `firstWarrior`. That is, `cycle` advances once per pass over the live warriors.
- After every execution, the round ends:
  - with `'WIN'` when two or more warriors started and exactly one is alive;
  - with `'NONE'` when one warrior started and it has no tasks left;
  - when `cycle === maximumCycles`, with `'DRAW'` (two or more warriors started) or `'NONE'` (one warrior started).
- When the round ends, the simulator writes each warrior's P-space result cell: 0 if it died, otherwise the number of warriors alive (spec/pspace.md 3).

## 8. Visualiser hook

The TUI must draw every core cell each frame without subscribing to `CORE_ACCESS`. The simulator therefore keeps three per-cell arrays, which it updates on every access when `options.trackAccess` is true (the default):

| Array | Type | Content |
|---|---|---|
| `accessKind` | `Uint8Array` | `0` if untouched this round, otherwise `AccessType + 1` (1 read, 2 write, 3 execute) |
| `accessWarrior` | `Uint8Array` | warrior id of that access |
| `accessStamp` | `Uint32Array` | value of `executions` when the access happened |

Recording rule: if `accessStamp[a]` equals the current execution, keep the stronger access (execute > write > read, which is the numeric order). Otherwise, overwrite. This gives guide.md 8.3 "last event wins, execute > write > read within one step" with one comparison.

API (in `types.ts`, implemented by `Simulator` and re-exported by the barrel):

- `getCoreView(): ICoreView` returns the live arrays with no copy, plus live `executions`, `cycle` and `lastExecuted` (the white "current instruction" cell). The arrays are replaced on every `initialiseSimulator`, so the TUI fetches a new view after each initialise. A renderer can repaint only the cells whose `accessStamp` is greater than the last stamp it painted.
- `getProcessView(): IWarriorProcessView[]` returns, for each warrior: `alive`, `taskCount`, `instructionPointers` (next to run first), `loadAddress` and `length`. The TUI uses `loadAddress` and `length` to draw each warrior's footprint before step 1. Loading does not mark the access arrays.
- `getWithInfoAt(address)` gives the instruction and the last access of one cell, for the cell inspector. Its `access` comes from the same three arrays.
- The TUI also uses the default singleton through `getDefaultSimulator()`, or its own instance from `createSimulator()`.

Hills, benchmarks and `runMatch` set `trackAccess: false`.

## 9. Event ordering

Topics are the `MessageTopic` values. A `null` or `undefined` provider means nothing is published and no payloads are built.

| When | Messages, in order |
|---|---|
| End of `initialiseSimulator` | `CORE_INITIALISE {state}`, `TASK_COUNT` (all warriors, count 1), `RUN_PROGRESS` (cycle 0), `NEXT_EXECUTION` |
| Each execution | `CORE_ACCESS` (one array: the execute first, then reads and writes in the order they happened; pointer reads are `read`, pre-decrement and post-increment are `write`), then `TASK_COUNT` (only warriors whose count changed; omitted if none), then `ROUND_END` if the round ended here |
| End of a `step(n)` call | `RUN_PROGRESS` (if the integer percent changed, or the round ended), then `NEXT_EXECUTION` (only if the round is still running) |
| End of a `run()` call | `RUN_PROGRESS`. No `NEXT_EXECUTION`. |
| `republish()` | `CORE_INITIALISE` (current state), one `CORE_ACCESS` with the last access of every touched cell, `TASK_COUNT` (all warriors), `RUN_PROGRESS`, then `NEXT_EXECUTION` if running, or `ROUND_END` if ended |
| End of `runMatch` | `MATCH_END` (once) |

Other rules from developer.md 3.2 to 3.6 apply. `ROUND_END` is published exactly once per round (except through `republish`). `step` and `run` after the round has ended do nothing and publish nothing. `step(0)` executes nothing. `step` throws on a negative or non-integer argument. Every function except `initialiseSimulator` throws `Error("Simulator not initialised")` before the first initialise.

## 10. Test strategy

- Every module has unit tests next to it. Run `bun test` (with coverage) and `bun run typecheck` before you hand work back.
- Test at the public seams: `parse` / `serialise` for the parser, and `Simulator` / free functions / pubsub messages for the simulator. Test internal files directly only when the public seam cannot reach a case cheaply (for example the expression evaluator or the placement function).
- Simulator unit tests build warriors with `programToParseResult()`, so they do not wait for the parser.
- Use a recording provider (`{ publishSync(type, payload) { log.push([type, payload]) } }`) to assert message order and payloads.
- Freeze the `serialise` output format with snapshot tests.
- Integration tests in `packages/engine/integration/` parse the sample warriors and run them. Until the parser lands, guard them with `test.skipIf`.
- Add a performance test that runs 100 rounds of 80,000 cycles for two sample warriors with a `null` provider. Report the time, and fail only on a generous limit (for example 30 s) so that the test is not flaky.

### 10.1 Definition-of-Done ownership

| Checklist | Parser engineer | Simulator engineer |
|---|---|---|
| `spec/developer.md` | Parser API items (`parse`, `IParseResult` shape, `parse` never throws, 1-based positions, `""` metadata, `serialise` and its snapshot tests), "Unit tests exist for the Parser API", "Integration tests exist for the Parser" | Simulator API items (options and defaults, `step`, `run`, `getWithInfoAt`, `republish`, all six simulator messages, `warriorData`), Matches items (`runMatch`, `MATCH_END`, scoring), "Unit tests exist for the Simulator API" and "for the Matches API" |
| `spec/redcode.md` | Every item marked P: operands, opcode parsing, modifiers, default modifiers, addressing-mode parsing, parser output, labels, EQU, expressions, special constants and `;assert`, FOR/ROF, ORG/END, comments, metadata | Every item marked S: opcode execution, addressing-mode execution. Also the P+S items 1534 (an ICWS'88 warrior parses and runs) and 1694 (metadata is not loaded into core) as integration tests |
| `spec/guide.md` | 624 (a warrior over the length limit is a parser error), 626 (an instruction outside the standard is a parser error), 650 and 651 (samples parse; the unlabeled Dwarf assembles like `dwarf`) | Core, loader, processes, execution, round end, match settings (621 to 629, using `options.ts`), hills, benchmarks, and the strategy behaviour items 652 to 657 as integration tests |

Already done by the architect: every enum item in `spec/developer.md`, "`npm test` prints coverage" (`bun test --coverage`), "build produces an importable package" (`bun run build`), option defaults and merge (`options.ts`), presets including nano (guide.md 630), and settings validation for limits that do not divide the core size (guide.md 629, partly; the loader adds the "warriors do not fit" check).

Not assigned in this phase: the visualisation items in guide.md (631 to 640) and the "cycle units shown in the UI" item (618). They belong to the TUI phase.
