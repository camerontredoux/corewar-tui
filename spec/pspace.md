# P-space: Implementation Spec (extension)

This file is **not** a restatement of the corewar docs. The docs mention P-space only by name (the `PSPACESIZE` constant, "see P-Space"). The user asked for P-space as an extension. The rules below follow pMARS 0.9.5, the de facto ICWS'94 P-space extension.

Every rule marked **Confirmed** was checked by an experiment with `./pmars` as a black box: the `-A` assembler output, `-b -r N` match scores, and the `-e` debugger (`registers` prints the current warrior's P-space). The pMARS source in `src/` was not read. The oracle harness (`packages/engine/oracle/`) checks these rules again on every `bun run oracle` (see section 7).

Terms:

- **P-space**: memory that belongs to a warrior and that keeps its contents from one round of a match to the next. The core does not contain it. Only `LDP` and `STP` can get to it.
- **Cell**: one value of P-space. Cells hold numbers in `[0, coresize)`, like core fields.
- **Result cell**: P-space cell 0.
- **PIN**: P-space identification number. Warriors with the same PIN share their P-space.
- **Match**: a series of rounds between the same warriors (`runMatch`, one pairing of a hill or a benchmark, or a TUI match).

## 1. Size

| Rule | Status |
|---|---|
| Each P-space has `pSpaceSize` cells. The option is also the value of the `PSPACESIZE` predefined constant. | Confirmed (`-S n` changes both) |
| `pSpaceSize` is an integer from 1 to `coresize`. Other values are an error. | Confirmed (`-S 0`, `-S -5` and `-S 8001` with `-s 8000` are rejected) |
| Default: `coresize / k` for the largest `k` from 16 down to 1 that divides `coresize`. This is `coresize / 16` when 16 divides `coresize`. | Confirmed for 15 core sizes, for example 8000 -> 500, 80 -> 5, 100 -> 10, 96 -> 6, 30 -> 2, 8001 -> 889, 13 -> 1, 97 -> 97 |
| Presets: standard, beginner, lp and icws88 500; nano 5; tiny 50; large 3465. Each value is the default for the preset's core size. | Derived |

## 2. Instructions

`LDP` (load from P-space) copies a P-space cell into core. `STP` (store to P-space) copies a core value into a P-space cell. Both take two operands, all addressing modes and all modifiers. Operand evaluation is the same as for every other ICWS'94 instruction, including the side effects of `<`, `>`, `{` and `}`.

| Rule | Status |
|---|---|
| `LDP` reads the cell whose index is a field of the source register (the A-operand instruction) and writes the value into a field of the B-target cell in core. | Confirmed |
| `STP` writes a field of the source register into the cell whose index is a field of the destination register (the B-operand instruction). | Confirmed |
| The index is taken modulo `pSpaceSize`. The field is already in `[0, coresize)`, so `-1` is `coresize - 1`. When `pSpaceSize` divides `coresize`, `-1` is the last cell. | Confirmed (also with sizes that do not divide `coresize`, for example `-S 7`, `-S 3`, `-S 11`) |
| Stored values are already folded into `[0, coresize)` because they come from core fields. | Confirmed |
| Neither instruction changes the process queue: the next instruction is the one that follows. | Confirmed |

Modifiers:

| Modifier | `LDP`: index field -> written core field | `STP`: value field -> index field |
|---|---|---|
| `.A` | A -> A | A -> A |
| `.B` | B -> B | B -> B |
| `.AB` | A -> B | A -> B |
| `.BA` | B -> A | B -> A |
| `.F`, `.X`, `.I` | B -> B (as `.B`) | B -> B (as `.B`) |

All rows are Confirmed.

Default modifiers (when the source omits the modifier) follow the ICWS'94 rule for `SLT`: `.AB` when the A mode is `#`, otherwise `.B`. Confirmed: pMARS `-A` output for all 64 mode pairs of `ldp` and of `stp` matches ours.

Parser rules:

| Rule | Status |
|---|---|
| `LDP` and `STP` need two operands. One operand is an error. | Confirmed ("Incomplete operand") |
| The opcodes are case-insensitive, like all opcodes. | Confirmed |
| With `standard` ICWS'88 or ICWS'86, `LDP`, `STP` and `PIN` are errors. | Confirmed for `LDP` and `PIN` (`pmars -8` rejects them); derived for `STP` |
| `Opcode.LDP` is 17 and `Opcode.STP` is 18, after the documented values 0 to 16. | Derived (our API) |

## 3. The result cell

| Rule | Status |
|---|---|
| Before round 1, cell 0 of every warrior is `coresize - 1`. Read as a signed number, that is -1. | Confirmed (7999 with core size 8000; 199 with core size 200 and `-S 7`) |
| At the end of every round, the simulator sets cell 0 of each warrior: 0 if the warrior died; otherwise the number of warriors still alive. A win gives the winner 1. A draw between two survivors gives each 2. | Confirmed (two and three warriors) |
| Cell 0 is private to each warrior, even when warriors share the rest of their P-space by PIN. | Confirmed |
| `LDP` and `STP` can use cell 0 during a round. `STP` to cell 0 changes the value that the warrior reads back in the same round. At the end of the round the simulator writes the result again, so the stored value does not survive to the next round. | Confirmed |
| The result is recorded however the round ends: a win, a draw at `maximumCycles`, or the end of a one-warrior round. | Confirmed for win and draw; derived for one warrior |

## 4. Other cells

| Rule | Status |
|---|---|
| Cells 1 to `pSpaceSize - 1` start at 0 at the start of a match. | Confirmed |
| They keep their values from one round to the next for the whole match. | Confirmed |
| A new match starts with new P-space. In our engine: every `runMatch` call, every hill pairing and every benchmark pairing, and every new TUI match. | Derived (pMARS has one match per run) |

## 5. PIN

`PIN <expression>` is an assembler directive that gives the warrior a PIN.

| Rule | Status |
|---|---|
| Warriors with the same PIN share cells 1 to `pSpaceSize - 1`. | Confirmed |
| Warriors with different PINs, or without a PIN, have private P-space. | Confirmed (with the PIN 0 exception in section 8) |
| PINs are compared as written, not folded into the core: `PIN 5` and `PIN 8005` do not share with core size 8000, nor do `PIN -1` and `PIN 7999`. | Confirmed |
| The operand is a constant expression. Labels, `EQU` constants and the predefined constants (for example `PSPACESIZE`, `CORESIZE * 2`) work. A label in front of `PIN` is allowed. | Confirmed |
| An undefined symbol, a second operand (`PIN 1, 2`) or an addressing mode (`PIN #3`) is an error. | Confirmed |
| A bare `PIN` (no operand) is `PIN 0`. We also warn. | Confirmed (the warning is ours) |
| With several `PIN` directives, the last one counts. We also warn. | Confirmed (the warning is ours) |
| A `PIN` after `END` is ignored, like everything after `END`. | Confirmed |
| `pmars -A` prints the PIN as a `PIN <number>` line after the instructions. Our load file keeps it as a `PIN <number>` line after `ORG` (`packages/engine/loadformat.ts`), so the simulator can see it. | Confirmed (pMARS output); the line position is ours |

## 6. Our API

| Item | Where |
|---|---|
| `ISimulatorOptions.pSpaceSize`, `IParseOptions.pSpaceSize`, `defaultPSpaceSize(coresize)` | `types.ts`, `options.ts` |
| `IWarriorProgram.pin`, `emitPinTokens` | `loadformat.ts` |
| `PSpace` (one match's P-space: cells, sharing, result cells) | `simulator/pspace.ts`, exported by the barrel |
| `Simulator.initialise(options, parseResults, provider?, pspace?)` and `initialiseWarriors(..., pspace?)`. Pass the previous round's `getPSpace()` to continue a match. Omit it or pass `null` to start a new match. A P-space that does not fit (other warrior count, size, core size or PINs) makes initialise throw. | `simulator/simulator.ts` |
| `Simulator.getPSpace()` (the live P-space) and `getPSpaceView(): IPSpaceView[]` (a copy per warrior, cell 0 included, for display) | `simulator/simulator.ts`, `types.ts` |

The developer.md free functions are unchanged. They start a new P-space on each `initialiseSimulator`.

## 7. Oracle coverage

`bun run oracle` compares these rules with `./pmars`:

- Assembly: P-space sources in the corpus (`LDP`/`STP` with all modes and modifiers, `PSPACESIZE`, `PIN` forms) and `examples/sunset.red`, which now assembles with no errors and the same instructions as pMARS. The PIN is compared too.
- Named battles: five hand-written P-space warriors (`pspace/switch-on-loss`, `round-counter`, `pin-pair`, `modifier-tour`, `cell-zero`) in `oracle/corpus.ts`, played against every other named warrior over 10 rounds. Every round start compares both warriors' P-space with pMARS's debugger output.
- Fuzz: generated warriors that use `LDP`/`STP` heavily, P-switchers that branch on cell 0, and PINs 1 and 2 (so that some pairs share P-space). One fuzz setting uses `-S 7` with core size 200, a size that does not divide the core.

## 8. Differences from pMARS

- **PIN 0 and warriors without a PIN.** In pMARS, a warrior without a PIN shares the P-space of an earlier warrior (lower in the command line order) that has `PIN 0`. A later `PIN 0` warrior does not share with an earlier warrior without a PIN. For example, `PIN 0` then no PIN share, but no PIN then `PIN 0` do not. We keep a warrior without a PIN private in every case, because the extension describes P-space without a PIN as private, and an order-dependent rule would make the result of a pairing depend on which warrior is listed first. `PIN 0` is an ordinary PIN in our engine. The fuzz corpus does not use `PIN 0`, so the oracle does not test this case.
- **Warnings.** We warn about a bare `PIN` and about several `PIN` directives. pMARS accepts both without a message.
