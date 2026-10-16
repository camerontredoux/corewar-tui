# Spec: Guide to Corewar (corewar-docs, "Guide" section)

This file restates the "Guide to Corewar" section of the corewar.io docs so that the TypeScript engine and terminal UI can be built from it. The pages it covers are the ones under the Sources heading below, and it uses nothing else. The Redcode Reference (opcodes, modifiers, addressing modes, parser) is a separate section and is specified elsewhere. This file links to it only where the Guide does.

Conventions used here:

- **Docs say** means a rule the docs state outright. Implement it as written.
- `> AMBIGUITY:` marks a place where the docs are unclear or say nothing. Each note gives the open question and the ICWS'94 / pMARS-standard answer I recommend. Those recommendations are not in the docs. They are defaults the implementation should adopt unless someone decides otherwise.
- `[page]` tags in the checklist name the source page.

## Sources

| Tag | URL | Title |
|---|---|---|
| index | https://corewar-docs.readthedocs.io/en/latest/ | Corewar.io (docs home) |
| guide | https://corewar-docs.readthedocs.io/en/latest/corewar/ | Corewar Guide |
| core | https://corewar-docs.readthedocs.io/en/latest/corewar/core/ | Core |
| warriors | https://corewar-docs.readthedocs.io/en/latest/corewar/warriors/ | Warriors |
| loader | https://corewar-docs.readthedocs.io/en/latest/corewar/loader/ | Loader |
| visualisation | https://corewar-docs.readthedocs.io/en/latest/corewar/visualisation/ | Visualisation |
| processes | https://corewar-docs.readthedocs.io/en/latest/corewar/processes/ | Processes |
| execution | https://corewar-docs.readthedocs.io/en/latest/corewar/execution/ | Execution |
| match_settings | https://corewar-docs.readthedocs.io/en/latest/corewar/match_settings/ | Match Settings |
| hills | https://corewar-docs.readthedocs.io/en/latest/corewar/hills/ | Hills |
| benchmarks | https://corewar-docs.readthedocs.io/en/latest/corewar/benchmarks/ | Benchmarks |
| strategies | https://corewar-docs.readthedocs.io/en/latest/corewar/strategies/ | Strategies |

All pages were fetched on 2026-10-14. The docs home page says: "Note, these docs are currently in the very early stages of development and are by no means complete." Many of the AMBIGUITY notes below exist because the pages are short.

---

## 1. Docs home (index)

- The docs fall into three areas: **Guide to Corewar**, **Redcode Reference**, and **Developer Reference**. This file covers only the first.
- Logo image: `https://corewar-docs.readthedocs.io/en/latest/images/logo-small.png` (alt text `corewar.io`). This is branding only and has no spec content.

---

## 2. Game overview (guide)

The docs say:

1. Corewar is a coding game. Players write programs called **warriors**, which compete in a simulated memory called the **core**.
2. Warriors try to eliminate each other by making the opponent execute illegal instructions such as `DAT`.
3. Warriors are written in **redcode**, an assembly-like language. **Each instruction occupies exactly one memory address in the core.**
4. A **round** runs over a number of turns called **cycles**. **In each cycle, one warrior executes a single instruction.**
5. If a warrior is eliminated, the other warrior wins the round.
6. If the maximum number of cycles is reached, the round is a **draw**.
7. A **match** usually has several rounds. Points are awarded for wins and draws, and the warrior with the most points at the end wins the match.
8. Warriors compete in continuous leagues called **hills**. Each time a warrior is submitted to a hill, a round robin is played, the warriors are ranked by performance, and the lowest-ranked warrior is pushed off.

> AMBIGUITY: What does "cycle" mean? The Guide defines a cycle as *one warrior executing one instruction* (see also processes: "In the first cycle of the round, the first warrior executes an instruction. In the next cycle, the next warrior executes an instruction."). In ICWS'94 and pMARS, a cycle is one instruction executed by *each* live warrior, so `maxCycles = 80000` lets each warrior execute 80000 instructions. Under the Guide's definition, two warriors would get only 40000 each. **Recommendation:** count in pMARS units internally. The engine has a `step()` that executes one warrior's instruction (a "turn" in the Guide's sense). A cycle counter advances after every live warrior has had one turn, and the round ends as a draw when `cycle === maxCycles`. Expose both counters in the UI. Document the choice, because it doubles round length compared with a literal reading of the Guide.

> AMBIGUITY: How do rounds end and get scored with more than two warriors? The docs only cover two ("the other warrior wins"). **Recommendation (pMARS):** the round ends when at most one warrior is alive (if more than one warrior was loaded), or when the cycle limit is reached. If exactly one warrior is alive, it wins. If more than one is alive at the cycle limit, all survivors draw. If one warrior was loaded on its own, the round ends only when that warrior dies or the cycle limit is reached.

> AMBIGUITY: How many points does a round win or draw give in a match, and how many rounds does a match have? The docs say "points awarded for wins and draws" without values. **Recommendation:** win = 3, draw = 1, loss = 0, which matches the hill formula `Win% * 3 + Draw%`. Make the number of rounds a match setting `rounds` with default **100**. KOTH hills commonly use 100 or 250. The pMARS CLI default is 1, which is not useful for matches.

---

## 3. Core (core)

### 3.1 Concept

- The core is computer memory inside the Corewar virtual machine (simulator).
- Each position in the core is an **address**. Each address holds exactly **one redcode instruction**.
- At the start of a round, all competing warriors are loaded into the core: each warrior's instructions are copied into **successive** core addresses.
- Instructions can change core contents, including the executing warrior's own instructions. Warriors try to corrupt their opponents by overwriting or modifying the opponent's area of the core.

### 3.2 Initialisation

- **At the start of every round, a new core is initialised.** Core is never carried over between rounds.
- Core size comes from the round's rules (match settings). **The default core size is 8000.**
- **By default, every address is initialised to `DAT.F $0, $0`.**

### 3.3 Addresses

- Every core position has an **absolute address** (0 .. coreSize-1). Warriors use **relative addresses** in practice and **cannot learn the absolute address** of the instructions they execute.
- Relative addresses are relative to the address of the **currently executing instruction**, so a warrior works the same wherever it is loaded.
- **All addressing and all arithmetic use modular arithmetic modulo the core size.** No number or address can be below 0 or at or above the core size. A value that exceeds the core size wraps back round to zero.

Worked example from the docs (core size 80):

```
40 + 41 = 1
```

```
Add the two numbers together
40 + 41 = 81

Divide the result by the core size (80) and take the remainder
81 % 80 = 1
```

- Because addressing is relative and modular, the core behaves like a **circle (ring), not a grid**.

> AMBIGUITY: How should negative intermediate values be normalised? The docs say numbers are never negative. **Recommendation (ICWS'94):** store every field as an integer in `[0, coreSize)`. Normalise with `((x % coreSize) + coreSize) % coreSize`, because JS `%` can return a negative result. The parser turns literal negatives into this form at load time (for example `-1` becomes `coreSize-1`). Subtraction must wrap too: `(a - b + coreSize) % coreSize`. Comparisons such as `SLT` compare the normalised unsigned values. For display, the UI may show values above `coreSize/2` as negatives (the pMARS convention). Make that a display option only.

> AMBIGUITY: Does "maximum number which can be represented" (match_settings, Core Size) mean field values are also modulo core size? **Recommendation:** yes. A-number and B-number values are always reduced modulo core size, as in ICWS'94.

---

## 4. Warriors (warriors)

The docs say:

- Players compete by writing warriors: programs in the assembly-like language **redcode**.
- Example warrior "Dwarf" as given on this page (no modifiers, no labels):

```
add #4, 3
mov 2, @2
jmp -2
dat #0, #0
```

- A warrior is a sequence of **instructions, one per line**. The example has four instructions, so when loaded it occupies **four consecutive core addresses**.
- A warrior owns **one or more processes**, which execute its instructions sequentially.
- **If a process executes an illegal instruction (usually a `dat`), that process is terminated.**
- **If all of a warrior's processes are terminated, the warrior is eliminated from the round.**
- Objective: be the warrior that is still running (has active processes) after all other warriors have been terminated.
- Language details are in the Redcode Reference, which is outside the scope of this file.

> AMBIGUITY: Which instructions are "illegal" besides `DAT`? The text says "usually a dat". **Recommendation (ICWS'94):** a process is terminated when it executes `DAT` (any modifier), and when `DIV` or `MOD` divides by zero. For `.F`/`.X`/`.I`, if either half divides by zero the process dies, but any half that did not divide by zero is still written, as in ICWS'94. No other opcode kills a process.

> AMBIGUITY: Is the Dwarf on this page the same program as the `;name dwarf` in strategies? Yes. Under ICWS'94 default-modifier rules (opcode `add` with `#` A-mode gives `.AB`, `mov` with no immediates gives `.I`, `jmp` gives `.B`, `dat` gives `.F`), this version assembles to the same code as the strategies version. Ship one sample file, `dwarf.red`, and keep this unlabeled form as a parser fixture.

---

## 5. Loader (loader, match_settings)

The docs say:

1. At the start of each round, **the parsed output of each warrior is loaded into the core**.
2. Warriors are loaded at **randomly selected addresses**, but **never closer together than the Minimum Separation** match setting.
3. Because placement is random, successive rounds with the same warriors can give very different results. Matches are therefore run over enough rounds to give a fair picture of each warrior's performance and remove "lucky" wins.
4. On load, each parsed instruction is placed **sequentially** (warrior instruction `i` goes to `loadAddress + i` mod coreSize).
5. Each warrior gets **exactly one initial process**. Its instruction pointer points at the warrior's **first instruction to execute, as set by the `ORG` or `END` directive**.
6. **If there is no `ORG` or `END` directive, execution starts at the first instruction of the parsed output** (offset 0).

> AMBIGUITY: How is minimum separation measured? **Recommendation (pMARS):** separation is the circular distance between the **load (start-of-code) addresses** of any two warriors, and `distance(a,b) = min(|a-b|, coreSize-|a-b|)` must be `>= minSeparation` for every pair. Additionally, no warrior's code may overlap another's: require `minSeparation >= maxLength`, or check the overlap explicitly. pMARS checks the distance from the end of one warrior to the start of the next going forward round the ring. That is equivalent to the above when `minSeparation >= maxLength`, so validate `minSeparation >= maxLength` when settings are created.

> AMBIGUITY: How does the random placement algorithm work? **Recommendation (pMARS):** the first warrior always loads at absolute address 0. This costs nothing, because warriors cannot see absolute addresses. Each later warrior gets a uniformly random address among the positions that satisfy the separation rule against all already-placed warriors. If no position fits (too many warriors for the core), raise a configuration error rather than looping forever. For two warriors this simplifies to: warrior 2 starts at `minSeparation + rand(coreSize - 2*minSeparation + 1)`.

> AMBIGUITY: Is the RNG seedable? The docs don't say. **Recommendation:** use an injectable, seedable PRNG (for example mulberry32 or xorshift) so matches can be replayed and tested deterministically. Expose `seed` as an optional match setting. If it is unset, seed from time.

> AMBIGUITY: What if a warrior has both `ORG` and `END <label>`? **Recommendation (pMARS):** the later directive in source order wins, and the parser emits a warning. An `ORG`/`END` operand is an offset relative to the warrior's first instruction. The start offset is reduced modulo the warrior length. In pMARS, a start offset outside `[0, length)` is an error, so report a parser error.

> AMBIGUITY: What is the ordering in the warrior list? **Recommendation:** warriors are executed in the order they were given to the match. The first warrior in that list moves each round so the same warrior does not always move first (pMARS rotates the starting warrior). In round `r` (0-based), turn order starts at warrior `r mod N`.

> AMBIGUITY: Should addresses be pre-initialised other than through warrior code? No. Every address not covered by a warrior keeps the initial `DAT.F $0, $0` (core page).

---

## 6. Processes (processes, match_settings)

The docs say:

- Every warrior has one or more **processes**. It starts with **one** process when loaded and gains more by executing `spl`.
- Warriors take turns executing **one process per turn**. In cycle 1 the first warrior executes an instruction, in the next cycle the next warrior does, and once every warrior has had a turn, the first warrior goes again.
- When `spl` executes, the executing warrior gains a new process. On its turns the warrior then alternates between its processes: one per turn, round robin.
- The docs' turn-order example, for warriors "imp" (one process A) and "paper" (processes A and B):

```
Imp (A)
Paper (A)
Imp (A)
Paper (B)
Imp (A)
Paper (A)
etc..
```

- **A warrior does not get more turns for having more processes.** Each of Paper's processes runs at half the speed of Imp's single process. In general, each of a warrior's `k` processes runs at `1/k` of the warrior's turn rate.
- Benefit of many processes: resilience (harder to kill). Cost: the complexity of multi-threaded programming.
- **Maximum Processes** (match_settings): the maximum number of processes each warrior can have at one time. **Executing `spl` when at the limit does not create a new process, so it effectively acts as a `nop`.**

Implementation model (consistent with the above):

- Each warrior has a **FIFO process queue** of instruction pointers.
- On the warrior's turn, take the process at the head. After execution, the process (if still alive) goes to the tail, so the "next process in the list" becomes active.
- The game has a **circular list of active (live) warriors**. After each turn the active-warrior pointer moves to the next live warrior.

> AMBIGUITY: Where does the new `spl` process go in the queue? **Recommendation (ICWS'94):** when `SPL` executes, first enqueue the current process's next instruction (`IP+1`) at the tail, then enqueue the new process (at the evaluated A-address) at the tail, if under the limit. The new process therefore runs after the parent's continuation. Under the limit, the queue grows by one. At the limit, only `IP+1` is enqueued, which is the "acts as nop" behaviour.

> AMBIGUITY: What is the default maximum process count? The docs give no default. **Recommendation:** 8000 (the same as core size) for the standard preset. See section 9.

> AMBIGUITY: What happens when a warrior's last process dies mid-turn? **Recommendation:** remove the warrior from the active-warrior list immediately, check the round-end condition (section 7.5), and move the turn pointer to the next live warrior.

---

## 7. Execution (execution)

### 7.1 Model

Each turn (the Guide calls it a "cycle", see section 2) executes one instruction using **Fetch > Decode > Execute**.

The simulator uses notional registers:

| Register | Purpose |
|---|---|
| Instruction Register | The executing instruction |
| Source Register | The source instruction |
| Destination Register | The destination instruction |

**The registers hold copies of instructions.** Changes to the original core instructions after they are copied do not affect the register contents. Implement the registers as value copies (`{opcode, modifier, aMode, aNumber, bMode, bNumber}` cloned structs), never as references into core.

### 7.2 Fetch

1. Determine the **current warrior** (warriors page, section 5 ordering).
2. Determine the **current process** for that warrior (processes, section 6).
3. Read that process's **instruction pointer** (IP).
4. Copy the instruction at core address IP into the **Instruction Register**.

### 7.3 Decode

1. Evaluate the **A operand** of the Instruction Register according to its addressing mode. Evaluation yields a core address. **Copy the instruction at that address into the Source Register.**
2. Then evaluate the **B operand** according to its addressing mode. **Copy the instruction at the resulting address into the Destination Register.**
3. Order matters: any side effect of A-operand evaluation (pre-decrement or post-increment) has already been applied to core before the B operand is evaluated (see the worked example).

### 7.4 Execute

1. **First, increment the current process's IP** (IP = IP + 1 mod coreSize), so that by default the process runs the next instruction next time.
2. Use the Instruction Register's **opcode and modifier** to choose the operation.
3. Perform the operation with the Source Register as source and the Destination Register as destination. Results are written to **core** at the evaluated destination (or source) **address**.
4. Some opcodes (for example `jmp`) **overwrite the current process's IP**.
5. **Finally, move the current warrior's active process to the next process in its process list, and move the game's active warrior to the next warrior in the list of active warriors.**

> AMBIGUITY: How does "increment IP then possibly overwrite" combine with the queue model? **Recommendation (ICWS'94, equivalent):** dequeue the process at fetch. At execute, compute the next IP (IP+1, or the jump target, or skip IP+2 for `SKIP`-type opcodes such as `SEQ`/`SNE`/`CMP`/`SLT` when the condition holds). Enqueue that IP at the tail unless the opcode was `DAT` (or a division by zero), in which case the process is not re-enqueued. `SPL` enqueues IP+1 and then the new process (section 6).

> AMBIGUITY: Decode side effects. The docs' example covers post-increment `>` on the A operand only. **Recommendation (ICWS'94):** for indirect modes (`@ < > * { }`), the pointer is read from the field of the instruction at `IP + operand` *in core*. Pre-decrements (`<` `{`) are applied to core **before** the pointer is used. Post-increments (`>` `}`) are applied to core **after** the target address has been computed, and also after the Source/Destination register has been copied. A-operand side effects all happen before B-operand evaluation. Full mode semantics belong to the Redcode Reference spec.

> AMBIGUITY: Do read and write limits apply during decode? See section 9 (Read limit / Write limit). They fold the evaluated addresses.

### 7.5 Round end

Combining guide, warriors, and match_settings:

- A warrior with zero processes is **eliminated** (removed from the active-warrior list).
- If a warrior is eliminated and only one warrior remains, **that warrior wins the round**.
- If the **Maximum Cycles** setting is reached first, **the round is a draw**.

> AMBIGUITY: Should the round end be checked after every turn or after every full cycle? **Recommendation:** check for elimination after every turn, so the round ends at once when the second-to-last warrior dies. Check for the cycle-limit draw when the cycle counter reaches `maxCycles` (section 2 note).

### 7.6 Worked example (verbatim from the docs)

"The executing instruction is modified during evaluation of addressing modes."

Initial core (numbers are absolute addresses):

```
0000: mov.i >0, $0
0001: dat.f $0, $0
```

A naive reading: the B post-increment indirect (`>`) mode increases the `B` number from 0 to 1, then the instruction at address 0 is copied to address 1, which would give:

```
0000: mov.i >0, $1
0001: mov.i >0, $1
```

**That is wrong.** The correct trace:

After **fetch**:

| Instruction Register | Source Register | Destination Register |
|---|---|---|
| `0000: mov.i >0, $0` | | |

**Decode, A operand:** mode `>` means the instruction pointed to by the B number is used as the source address. The B number is `0`, so the current instruction is copied to the Source Register:

| Instruction Register | Source Register | Destination Register |
|---|---|---|
| `0000: mov.i >0, $0` | `0001: mov.i >0, $0` | |

Then the post-increment is applied to the B operand **in core**:

```
0000: mov.i >0, $1
0001: dat.f $0, $0
```

The Source Register still holds `mov.i >0, $0`.

**Decode, B operand:** mode `$` (direct). The B number is now `1` (read from core after the increment), which refers to the second instruction (`dat.f $0, $0`), so that instruction is copied to the Destination Register:

| Instruction Register | Source Register | Destination Register |
|---|---|---|
| `0000: mov.i >0, $0` | `0000: mov.i >0, $0` | `0001: dat.f $0, $0` |

**Execute:** copy the Source Register instruction to the address held for the Destination Register (address 1). Resulting core:

```
0000: mov.i >0, $1
0001: mov.i >0, $0
```

"So in fact, this instruction will continue to execute safely, in a similar fashion to the classic `imp`."

> AMBIGUITY: Address labels in the example tables. The second table labels the Source Register `0001: mov.i >0, $0` and the third labels it `0000: mov.i >0, $0`. The source is address 0 (B number 0 relative to IP 0), so `0000` is correct and the `0001` label is a typo in the docs. Use `0000` in tests.

> AMBIGUITY: In the docs' trace, the B operand `$0` is evaluated using the **core** instruction's B number after the A-operand post-increment (0 became 1), not the Instruction Register's copy (still 0). That conflicts with "registers are copies". ICWS'94 evaluates both operands from the Instruction Register's values. Under ICWS'94 the destination is address 0, the copy `mov.i >0, $0` overwrites address 0 (undoing the increment), address 1 stays `dat.f $0, $0`, and the process dies on its next turn. **Decision needed:** pick one model and record it in the engine spec. **Recommendation:** use ICWS'94 (read operand values from the Instruction Register copy) for compatibility with the wider Corewar ecosystem and the standard warrior corpus. Keep this docs example as a test that states the chosen result and notes the divergence from the docs.

---

## 8. Visualisation (visualisation) — drives the terminal UI

### 8.1 What the docs say

1. A game is usually shown as a **grid in which each cell is one core address**.
2. **Layout:** addresses run **left to right within a row, and rows run top to bottom** (row-major). Address 0 is top-left. Which address comes first is arbitrary, because of relative addressing. The core could equally be drawn as a **ring**.
3. **Initial state:** all addresses are loaded with a `dat` instruction, and these initially loaded addresses are drawn as **solid grey cells**.
4. **Warrior colours:** each warrior is given a **unique colour**, and its instructions are then written to the core.
5. **Execute:** each time a warrior executes an instruction, the executed cell is **filled with the warrior's colour** (solid fill).
6. **Write:** when a warrior writes to core (modifies or replaces an instruction), the cell is **drawn with an X in the warrior's colour**.
7. **Read:** when a warrior reads from a core address, **a dot is placed in the cell in the warrior's colour**.
8. **Current instruction:** **one cell is filled white** to show the instruction currently being executed.

### 8.2 Images on the page

| Image | URL | Alt | What it shows (from viewing the image) |
|---|---|---|---|
| Core grid | https://corewar-docs.readthedocs.io/en/latest/images/core.png | `core` | 571x410 px. A dense grid of small square cells on a very dark slate/charcoal background with thin grey gridlines. Most cells are blank (dark). Many cells hold an **X** drawn in thin lines, in either **orange/amber** or **green/teal**, often in long horizontal runs (bombing or copy trails). A few short horizontal runs of **solid filled** cells in **salmon/red**, **teal**, and **yellow** mark executed cells (warrior code and process paths). Small **red** marks, probably dots or X marks in a third colour, are scattered. **One solid white cell** (right of centre) is the currently executing instruction. |
| Execution | https://corewar-docs.readthedocs.io/en/latest/images/execution.png | `execute` | 185x71 px. Three adjacent cells: two **solid light-blue** cells (executed by a blue warrior) and one **solid white** cell (the current instruction), framed by dark gridlines. |
| Write | https://corewar-docs.readthedocs.io/en/latest/images/write.png | `write` | 71x71 px. One dark cell with a thin **light-blue X** corner to corner (a write by the blue warrior). |

Note: the images show the "empty" (initial `DAT`) cells as **dark charcoal with grey gridlines**, not as obviously "solid grey". Treat "grey" as the neutral, non-warrior cell colour.

### 8.3 Terminal UI mapping (implementation guidance)

Cell state model. Each address tracks:

- `owner`: the warrior id that last touched the cell (or none)
- `lastEvent`: one of `none | load | execute | write | read`
- `isCurrent`: true when the cell is the instruction being executed in the current/last step

Recommended rendering (one or two terminal columns per cell):

| State | Docs rule | Terminal glyph / style |
|---|---|---|
| Initial `DAT.F $0,$0`, untouched | solid grey | `·` or space on a dim grey background (neutral) |
| Executed by warrior W | filled with W's colour | `█` (or a space with W's background colour) |
| Written by warrior W | X in W's colour | `x` / `╳` in W's foreground colour on the neutral background |
| Read by warrior W | dot in W's colour | `•` / `.` in W's foreground colour |
| Currently executing instruction | filled white | `█` white (or white background), overriding all else |

- Grid width: choose columns to fit the terminal, wrapping row-major (address `a` at row `floor(a/cols)`, column `a % cols`). Keep the ring nature in mind: nothing special happens at the wrap from the last cell back to address 0.
- Assign each warrior a distinct colour from a fixed palette, and do not use white or grey for warriors, since those are reserved for "current" and "empty". The docs' images suggest orange, green/teal, blue, red, and yellow.

> AMBIGUITY: Which visual wins when a cell is read, written, and executed (possibly by different warriors)? **Recommendation:** "last event wins". Each cell shows its most recent event, in the colour of the warrior that caused it, with the white "current" highlight on top. If several events happen to one cell in a single step, the order of precedence is execute > write > read.

> AMBIGUITY: How are a warrior's freshly loaded instructions shown before they execute? The docs say instructions "are written to the core" after colours are assigned, but give no glyph. **Recommendation:** draw loaded cells as a write (X) in the warrior's colour at round start, so each warrior's footprint is visible before step 1, and make this configurable.

> AMBIGUITY: Does the white "current instruction" mark one cell overall or one per warrior? The docs say "one cell within the visualisation will be filled with white". **Recommendation:** one cell, the instruction executed in the most recent step. Optionally offer a per-warrior "next IP" marker as a separate toggle.

> AMBIGUITY: Do highlights fade or decay? The docs mention no fading. **Recommendation:** marks persist until overwritten by a later event (no fading by default). Optionally provide a "heat"/decay mode that dims marks older than N steps, off by default.

> AMBIGUITY: Can a cell be inspected? The docs mention none. **Recommendation:** a cursor-selectable cell inspector showing the absolute address, the disassembled instruction (`OPCODE.MOD Amode A, Bmode B`, for example `mov.i >0, $1`), last event, owner, and whether any process IPs point at it. Also show a disassembly window of about ±10 addresses around the selected cell or the current instruction.

> AMBIGUITY: Should process positions be shown? The docs don't show them. **Recommendation:** show per-warrior panels with process count, a live/eliminated flag, and the head-of-queue IP. Optionally mark every live process IP with an underline or brackets.

> AMBIGUITY: What controls exist? The docs mention none. **Recommendation:** play/pause, single-step (one turn), step one full cycle, speed up/down (steps per frame), run to end of round, next round, restart, and quit. Show the current cycle / maxCycles, round / rounds, and running scores in a status bar.

---

## 9. Match settings (match_settings, core, hills)

The docs list these settings. **The only default the docs state is Core Size = 8000** (core page). All other defaults below are recommendations.

| Setting | Docs definition | Docs default | Recommended default (ICWS'94 / KOTH '94 standard) | Effect / validation |
|---|---|---|---|---|
| Core Size | Number of instructions the core can store. Also the **maximum number that can be represented** in the simulation (all values modulo core size). | **8000** | 8000 | Integer >= 1. All addresses and field values are taken modulo it. |
| Maximum Cycles | Number of cycles to execute before the round ends in a **draw**. | not stated | 80000 | See the section 2 note on cycle units. |
| Maximum Processes | Maximum number of processes **each** warrior can have at one time. `spl` at the limit has no effect (effectively `nop`). | not stated | 8000 | Integer >= 1. |
| Maximum Warrior Length | Maximum number of instructions in a warrior. **A longer warrior is a parser error.** | not stated | 100 | Checked at parse time against the instruction count. |
| Minimum Separation | The loader will not place warriors closer than this many addresses at the start of a round. | not stated | 100 | Must be `>= maxLength` and leave room for all warriors (`N * minSep <= coreSize`). |
| Standard | Which redcode standard is used to parse warriors. **Using instructions outside the selected standard is a parser error.** | not stated | ICWS'94 (draft, with pMARS extensions) | Values defined in the Redcode Reference ("standards"). |
| Read limit | Instructions further than this from the executing instruction cannot be read. A read address beyond the limit (relative to the executing instruction) **wraps round to stay within the limit**, so reads are confined to a "mini-core". *Not implemented in corewar.io.* | not stated | = Core Size (no restriction) | See note below. |
| Write limit | As read limit, for writes: addresses beyond the limit wrap round so writes are confined to a "mini-core". *Not implemented in corewar.io.* | not stated | = Core Size (no restriction) | See note below. |

Settings not on this page but implied elsewhere in the Guide:

| Setting | Source | Recommended default |
|---|---|---|
| Rounds per match | guide ("a match usually has multiple rounds"), loader ("number of rounds large enough...") | 100 |
| Number of warriors | guide/processes (two-warrior examples; "each warrior") | 2 (allow N >= 1) |
| RNG seed | not in docs | unset (time-based); settable for replay/tests |

### 9.1 Presets

The docs name one preset: a **'nano' hill, where the core size is limited to 80 addresses** (hills page). No other preset values are given.

> AMBIGUITY: Full preset values. **Recommendation** (the standard KOTH/pMARS hill parameters used by the Corewar community):

| Preset | Core Size | Max Cycles | Max Processes | Max Length | Min Separation | Read/Write limit | Standard |
|---|---|---|---|---|---|---|---|
| standard ('94 draft / '94nop) | 8000 | 80000 | 8000 | 100 | 100 | 8000 | ICWS'94 |
| beginner | 8000 | 80000 | 8000 | 100 | 100 | 8000 | ICWS'94 |
| nano | **80** (docs) | 800 | 80 | 5 | 5 | 80 | ICWS'94 |
| tiny | 800 | 8000 | 800 | 20 | 20 | 800 | ICWS'94 |
| limited process (LP) | 8000 | 80000 | 8 | 200 | 200 | 8000 | ICWS'94 |
| large / huge | 55440 | 500000 | 10000 | 200 | 200 | 55440 | ICWS'94 |
| '88 | 8000 | 80000 | 8000 | 100 | 100 | 8000 | ICWS'88 |

### 9.2 Read and write limits

> AMBIGUITY: How exactly does an address "wrap around to restrict it to the limit"? **Recommendation (pMARS "fold"):** for a relative offset `o` in `[0, coreSize)` and limit `L`, `t = o % L`, and if `t > L/2` then `t += coreSize - L`. The folded offset is then added to the executing instruction's address. Reads (operand evaluation for source and pointer reads) use the read limit. Writes (destination writes and pre/post increment writes) use the write limit. With `L === coreSize` folding has no effect. Validate `coreSize % L === 0`, as pMARS requires. These limits are optional (corewar.io doesn't implement them), so implement them behind the setting and keep the default unrestricted.

---

## 10. Hills (hills, guide)

The docs say. Note that corewar.io itself "does not yet support hills".

1. A hill is an **eternally running league**. It holds a current list of warriors, **ranked by past performance**.
2. **Submitting a new warrior starts a new season.** In a season every warrior on the hill plays **every other warrior** in a **round robin**.
3. Each match-up between a pair is played over **a number of rounds**.
4. When a match-up finishes, each warrior is scored from the percentages of rounds it **won, drew, and lost**:

```
Score = Win% * 3 + Draw%
```

5. When all matches are done, warriors are ranked best to worst. **The worst warrior is eliminated ("pushed off" the hill).**
6. **Every surviving warrior's age increases by one.** Age therefore counts how many seasons a warrior has survived.
7. **Each hill has its own match settings.** All warriors are **parsed** against those settings and all matches are **run** with them. Example: a "nano" hill with core size 80.

Worked example (derived from the formula, not in the docs): a warrior that wins 40%, draws 20%, and loses 40% of a match-up scores `40*3 + 20 = 140`. The range is 0..300.

> AMBIGUITY: Is a warrior's season score the sum or the average of its match-up scores? **Recommendation (KOTH):** a warrior's hill score is the **average** of its per-match-up scores against every other warrior (equivalently, its total W/D/L percentages over all opponents). Rank by that score descending. Break ties by more wins, then by greater age, then by earlier submission.

> AMBIGUITY: Is someone pushed off on every submission, or only when the hill is full? **Recommendation:** give the hill a capacity `hillSize` (KOTH standard 20, or 25 counting the challenger). Remove the worst warrior only when there are more than `hillSize` warriors after the season. A new warrior that comes last is itself pushed off, and the other warriors still age by one.

> AMBIGUITY: What age does a new warrior start with? **Recommendation:** age 0 on entry. It becomes 1 if it survives its first season, since the docs say surviving warriors age by one at the end of each season, and that includes the newcomer.

> AMBIGUITY: How many rounds per match-up? **Recommendation:** use the `rounds` setting (default 100). KOTH commonly uses 100 for '94 hills and 250 for nano/tiny.

> AMBIGUITY: What if a submission fails to parse? **Recommendation:** reject it before the season starts. It does not enter the hill and no warrior ages.

---

## 11. Benchmarks (benchmarks)

The docs say:

1. A benchmark is a **fixed collection of warriors**, chosen to give a consistent difficulty across a wide, representative range of strategies.
2. To benchmark a warrior, it plays **each benchmark warrior in turn**, over a number of rounds per opponent.
3. **Scoring is the same as on a hill**: from the percentages of rounds won and drawn (`Score = Win% * 3 + Draw%`).
4. Uses: comparing variants of your own warrior to predict hill performance, and comparing different warriors directly.

> AMBIGUITY: How are the per-opponent scores combined? **Recommendation:** report a per-opponent table (W/D/L counts, percentages, score) and an overall benchmark score equal to the **average** of the per-opponent scores (range 0..300). Only the warrior under test is scored.

> AMBIGUITY: Which warriors make up a benchmark? The docs list none. **Recommendation:** ship a default benchmark made of the built-in strategy samples from section 12 (dwarf, stone, mice, silk, scanner, plus imp), run with the standard preset. Allow user-defined benchmarks as a list of warrior files plus a settings preset.

> AMBIGUITY: Should benchmark results be reproducible? **Recommendation:** yes, when a seed is given. The same warrior, benchmark, and seed must give the same score.

---

## 12. Strategies (strategies) — built-in sample warriors

The docs say:

- The three main strategies follow **rock, paper, scissors**:
  - **Rock**: a warrior that rapidly bombs the core with `dat` instructions.
  - **Paper**: a warrior that replicates, making multiple parallel copies.
  - **Scissors**: a warrior that scans the core looking for other warriors.
- There are many variations and some distinct sub-strategies. Many warriors combine several strategies into **hybrids**.
- Matchup tendencies: **rock beats scissors, paper beats rock, scissors beats paper.**

### 12.1 Rock (bombers)

Rocks (bombers) rapidly copy bombs, usually `dat`, across the core, hoping to hit and usually kill another warrior outright. The original rock is **Dwarf**, by **A. K. Dewdney** (the creator of Corewar).

**Sample: `dwarf`** (verbatim)

```
;name dwarf
start   add.ab  #4, bmb
        mov.i   bmb, @bmb
        jmp     start
bmb     dat     #0, #0
```

Behaviour: copies the `dat` to the address held in the `dat`'s B field. Each loop iteration adds 4 to that pointer, so it eventually bombs every fourth instruction in the core.

The ICWS'94 standard brought the common **stone**, a stronger bomber that uses '94 modifiers.

**Sample: `stone`** (verbatim)

```
;name stone
start mov.i <2, 3
      add.f d1, start
      jmp   start
      dat   #0
d1    dat   #-4, #4
end start
```

Behaviour: copies a bomb each loop iteration, and also **decrements the B field** of instructions in the core. That can damage other warriors without killing them, stunning them until stone lands the killing blow.

Why rock beats scissors: bombers are simple, small programs that fill the core with bombs, and each bomb is a decoy that confuses scanners. Scissors are long, complex programs, which makes them big targets.

### 12.2 Paper (replicators)

Papers make many copies of themselves throughout the core, each copy with its own processes, which makes them very resilient.

**Sample: `mice`** (verbatim). An early looping paper. It copies itself by looping over its own code to a destination address. After each copy, `spl` creates a process for the new clone, and the destination address is increased.

```
;name mice
mov.ab  #12, -1
mov.i   @-2, <5
djn     -1, -3
spl     @3, 0
add.ab  #653, 2
jmz     -5, -6
dat     #0, #833
```

**Sample: `silk`** (verbatim). A more advanced paper. It uses several processes to copy itself in one pass through the code, with no loop over the program. The boot code creates **6 processes** that all execute the `mov`, so six instructions are copied. The copy runs much faster this way.

```
;name silk
      spl     1
      mov     -1,       0
      spl     1

paper spl     @paper,   2364
      mov.i   }paper,   >paper
      mov.i   bmb,      >paper
      mov.i   bmb,      {-61
      mov.i   bmb,      {4000
silk  jmp     @0,       {paper
bmb   dat.f   <2667,    <2*2667
```

Why paper beats rock (stone): losing some copies doesn't stop the others, and the survivors actually run faster because each process executes more often when there are fewer of them (processes, section 6). Eventually the paper bombs or overwrites the stone.

Why paper loses to scissors: scissors use `spl` bombs that make the paper spawn lots of useless processes, so the remaining working copies run slower and slower.

### 12.3 Scissors (scanners)

Scissors scan the core for other warriors. When one finds a target, it bombs that area heavily, usually with `spl`, so the victim spawns processes uncontrollably and spends most of its time running useless `spl` instructions.

**Sample: `scanner`** (verbatim; the docs give no `;name`, so the file is named `scanner.red`)

```
scn add   #10, ptr
ptr jmz.f scn, 5
    mov.i 2, >ptr
    jmp   -1
```

Behaviour: uses `jmz` to test scanned addresses for an instruction whose A or B field is non-zero. The scanned address goes up by 10 each iteration, so every tenth instruction is scanned. When a non-zero field is found, the process falls through to the `mov`, which copies a `dat` over the scanned address and then over every address from there up to the scanner itself. The docs call it "a very simple example of a (not very good) scanner". It could be improved by wiping with one or more `spl` before a `dat` (stun, then kill), and by scanning more addresses per iteration.

Why scissors beat paper: they find papers fast, stun them with `spl` bombs, and finish with a `dat` clear. Why scissors lose to rock: the rock's bombs give the scanner false positives.

### 12.4 Sample-warrior notes

> AMBIGUITY: `stone` has `dat #0`, a single-operand `DAT`. **Recommendation (ICWS'94):** a single operand on `DAT` is the **B** operand, and A defaults to `$0`, giving `DAT.F $0, #0`. pMARS fills A as `$0`; some docs say `#0`. The A value is 0 either way, but the mode affects `.I`-level comparisons, so pick one and record it in the parser spec.

> AMBIGUITY: Default modifiers in the samples (for example silk's `mov -1, 0`, `spl 1`, `jmp @0, {paper`, and dwarf's `jmp start`). **Recommendation:** apply ICWS'94 default-modifier rules from the Redcode Reference. `mov` with no `#` gives `.I`, `spl`/`jmp`/`djn` give `.B`, and a single-operand `jmp`/`spl` gets B = `$0`.

> AMBIGUITY: Silk's `bmb dat.f <2667, <2*2667` uses an arithmetic expression (`2*2667` = 5334). The parser must evaluate constant expressions, as the Redcode Reference/parser spec covers. `{4000` with core 8000 equals `{-4000`.

> AMBIGUITY: Start addresses. `stone` uses `end start` (start offset 0). `dwarf`'s `start` label is at offset 0 and it has no `end`, so it starts at its first instruction. `mice`, `silk`, and `scanner` have no `ORG`/`END`, so they start at their first instruction (loader rule).

> AMBIGUITY: Silk's process count. The docs say the boot code "creates 6 processes". Tracing it under ICWS'94 confirms the figure. `spl 1` (offset 0) gives 2 processes at offset 1. The first runs `mov -1, 0`, which copies `spl 1` over offset 1. The second process therefore executes `spl 1` at offset 1, giving 3 processes at offset 2. `spl 1` at offset 2 doubles them to 6, and all 6 reach `paper`. Test: with Max Processes >= 6 and no opponent, silk has 6 processes after its boot (before its first `paper` iteration).

> AMBIGUITY: The processes page mentions "imp" without code. **Recommendation:** also ship `imp.red` as `MOV.I $0, $1` (`mov 0, 1`). That is the classic imp, and it is referenced (but not listed) in processes and execution.

Built-in sample set to ship: `dwarf.red`, `stone.red`, `mice.red`, `silk.red`, `scanner.red` (verbatim from docs), plus the unlabeled Dwarf variant from the warriors page as a parser fixture, and optionally `imp.red` (not verbatim; recommended).

---

## Definition of Done checklist

- [ ] A new core is initialised at the start of every round; nothing carries over between rounds. [core]
- [ ] Default core size is 8000 when no setting is given. [core]
- [ ] Every core address is initialised to `DAT.F $0, $0`. [core]
- [ ] Each core address holds exactly one instruction; each warrior instruction occupies one address. [core][guide][warriors]
- [ ] All address and arithmetic results are reduced modulo core size into `[0, coreSize)`; `40 + 41 = 1` with core size 80 (`81 % 80 = 1`). [core]
- [ ] Negative intermediate values normalise into `[0, coreSize)` (for example `-1` becomes `coreSize-1`). [core]
- [ ] Operand addresses are relative to the currently executing instruction's address. [core]
- [ ] Warriors have no access to absolute addresses (behaviour is independent of load address). [core]
- [ ] Addressing wraps round the end of core (address `coreSize-1` + 1 = address 0). [core]
- [ ] Each warrior's parsed instructions are loaded sequentially into consecutive core addresses. [loader][core][warriors]
- [ ] Warriors are loaded at random addresses. [loader]
- [ ] No two warriors are loaded closer than Minimum Separation (circular distance between start addresses). [loader][match_settings]
- [ ] Warrior code never overlaps (settings validation enforces `minSeparation >= maxLength` and room for all warriors). [loader]
- [ ] Placement uses a seedable RNG; the same seed reproduces the same placements. [loader]
- [ ] Each warrior starts with exactly one process. [loader][processes]
- [ ] The initial process starts at the `ORG`/`END`-specified instruction. [loader]
- [ ] With no `ORG`/`END`, the initial process starts at the warrior's first instruction. [loader]
- [ ] Each turn, exactly one warrior executes exactly one instruction. [guide][processes]
- [ ] Warriors take turns in order and wrap to the first after the last. [processes]
- [ ] The starting warrior rotates between rounds. [loader] (recommendation)
- [ ] Each warrior's processes execute in round-robin order, one per turn of that warrior. [processes]
- [ ] Turn order for imp(A) and paper(A, B) matches `Imp (A), Paper (A), Imp (A), Paper (B), Imp (A), Paper (A)`. [processes]
- [ ] A warrior with more processes gets no extra turns (each of `k` processes runs at `1/k` speed). [processes]
- [ ] `spl` adds a new process to the executing warrior; `IP+1` is queued before the new process. [processes]
- [ ] `spl` at Maximum Processes creates no process and behaves as `nop` (the process continues at `IP+1`). [match_settings]
- [ ] A process that executes `dat` is terminated. [warriors][guide]
- [ ] A process that divides by zero (`div`/`mod`) is terminated. [warriors] (recommendation)
- [ ] A warrior with no processes is eliminated from the round and gets no further turns. [warriors]
- [ ] Fetch copies the instruction at the current process's IP into an Instruction Register (a value copy). [execution]
- [ ] Decode evaluates the A operand first, copies the instruction at its address into the Source Register, then evaluates the B operand and copies into the Destination Register. [execution]
- [ ] A-operand side effects (pre-decrement/post-increment) are applied to core before B-operand evaluation. [execution]
- [ ] Register contents are copies and are unaffected by later core changes in the same step. [execution]
- [ ] Execute increments the process IP first, then performs the opcode/modifier operation with source and destination registers. [execution]
- [ ] Jump-type opcodes overwrite the process IP. [execution]
- [ ] After execution, the warrior's active process moves to its next process and the game moves to the next active warrior. [execution]
- [ ] The worked example `mov.i >0, $0` / `dat.f $0, $0` gives the documented or the deliberately chosen result (see the section 7.6 decision), with a test recording the divergence. [execution]
- [ ] A round ends with a win when only one warrior remains alive. [guide]
- [ ] A round ends in a draw when Maximum Cycles is reached with more than one warrior alive. [guide][match_settings]
- [ ] Cycle units (turn versus full cycle) are implemented as documented in this spec and shown in the UI. [guide]
- [ ] With N > 2 warriors, the round continues until at most one survives; survivors at the cycle limit all draw. [guide] (recommendation)
- [ ] A match runs a configurable number of rounds and awards points for wins and draws (3/1/0); the warrior with the most points wins. [guide]
- [ ] Match setting Core Size is configurable (default 8000). [match_settings][core]
- [ ] Match setting Maximum Cycles is configurable (default 80000). [match_settings]
- [ ] Match setting Maximum Processes is configurable per warrior (default 8000). [match_settings]
- [ ] Match setting Maximum Warrior Length is configurable (default 100); a longer warrior gives a parser error. [match_settings]
- [ ] Match setting Minimum Separation is configurable (default 100). [match_settings]
- [ ] Match setting Standard is configurable; an instruction outside the standard gives a parser error. [match_settings]
- [ ] Match setting Read limit folds read addresses into a mini-core around the executing instruction (default = core size, no effect). [match_settings]
- [ ] Match setting Write limit folds write addresses likewise (default = core size, no effect). [match_settings]
- [ ] Settings validation rejects impossible configurations (separation versus core size, limits not dividing core size). [match_settings]
- [ ] A 'nano' preset exists with core size 80, and the other standard presets exist as tabulated. [hills][match_settings]
- [ ] The visualisation draws the core as a grid, one cell per address, row-major left-to-right, top-to-bottom. [visualisation]
- [ ] Untouched initial `dat` cells are drawn in the neutral grey style. [visualisation]
- [ ] Each warrior has a unique colour (not white or grey). [visualisation]
- [ ] An executed cell is filled solid in the executing warrior's colour. [visualisation]
- [ ] A written cell is drawn with an X in the writing warrior's colour. [visualisation]
- [ ] A read cell is drawn with a dot in the reading warrior's colour. [visualisation]
- [ ] Exactly one cell, the instruction currently being executed, is shown white. [visualisation]
- [ ] Cell display follows "last event wins", with current-white on top. [visualisation] (recommendation)
- [ ] The UI provides step, play/pause, speed, round navigation, and a cell inspector with disassembly. [visualisation] (recommendation)
- [ ] The UI shows cycle count, round number, scores, and per-warrior process counts. [visualisation] (recommendation)
- [ ] A hill holds a ranked list of warriors with settings applied to parsing and to matches. [hills]
- [ ] Submitting a warrior triggers a round robin among all hill warriors over N rounds per pair. [hills]
- [ ] The match-up score is `Win% * 3 + Draw%` (0..300); for example 40% wins, 20% draws gives 140. [hills]
- [ ] After a season, warriors are ranked and the worst is pushed off (when over capacity). [hills]
- [ ] Surviving warriors' age increases by 1 each season. [hills]
- [ ] A submission that fails to parse under the hill settings is rejected. [hills] (recommendation)
- [ ] A benchmark plays the test warrior against each benchmark warrior in turn over N rounds. [benchmarks]
- [ ] Benchmark scoring uses the hill formula per opponent, plus an overall average. [benchmarks]
- [ ] Benchmark results are reproducible with a seed. [benchmarks] (recommendation)
- [ ] The built-in samples `dwarf`, `stone`, `mice`, `silk`, `scanner` are shipped verbatim and parse without errors under the standard preset. [strategies]
- [ ] The warriors-page Dwarf (`add #4, 3` ...) parses and assembles to the same code as the strategies `dwarf`. [warriors][strategies]
- [ ] `dwarf` bombs every fourth address (B pointer of `bmb` advances by 4 each loop). [strategies]
- [ ] `stone` starts at `start` (via `end start`) and decrements B fields while bombing. [strategies]
- [ ] `silk` reaches 6 processes after its 3-instruction boot. [strategies]
- [ ] `mice` and `silk` replicate (multiple live copies with processes after a fixed number of cycles). [strategies]
- [ ] `scanner` scans every tenth address and falls through to the `mov` clear on finding non-zero fields. [strategies]
- [ ] An `imp` sample (`mov.i $0, $1`) survives indefinitely alone, like the execution-page example. [processes][execution] (recommendation)
