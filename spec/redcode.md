# Redcode Reference: Implementation Spec

This file restates the **Redcode reference** section of the official corewar docs
(`https://corewar-docs.readthedocs.io/en/latest/redcode/...`) as implementation-ready rules for a
from-scratch TypeScript Corewar (ICWS'94) implementation. It covers the parser (source text to load
format) and the per-instruction execution semantics that the Redcode pages define.

Source pages, with the short tag used in the checklist:

| Tag | URL |
| --- | --- |
| `(index)` | https://corewar-docs.readthedocs.io/en/latest/redcode/ |
| `(operands)` | https://corewar-docs.readthedocs.io/en/latest/redcode/operands/ |
| `(opcodes)` | https://corewar-docs.readthedocs.io/en/latest/redcode/opcodes/ |
| `(modifiers)` | https://corewar-docs.readthedocs.io/en/latest/redcode/modifiers/ |
| `(addressing_modes)` | https://corewar-docs.readthedocs.io/en/latest/redcode/addressing_modes/ |
| `(org)` | https://corewar-docs.readthedocs.io/en/latest/redcode/org/ |
| `(parser)` | https://corewar-docs.readthedocs.io/en/latest/redcode/parser/ |
| `(labels)` | https://corewar-docs.readthedocs.io/en/latest/redcode/labels/ |
| `(preprocessor)` | https://corewar-docs.readthedocs.io/en/latest/redcode/preprocessor/ |
| `(comments)` | https://corewar-docs.readthedocs.io/en/latest/redcode/comments/ |
| `(metadata)` | https://corewar-docs.readthedocs.io/en/latest/redcode/metadata/ |

How to read this file:

- Text stated as a rule without qualification comes from the docs.
- **Derived** marks a rule the docs imply but do not spell out (for example, a per-modifier table
  built from the general modifier table).
- `> AMBIGUITY:` notes mark places where the docs are silent, unclear, or contradict themselves. Each
  note states the question and a recommended answer (the most standard ICWS'94 / pMARS-compatible
  behaviour). Where a recommendation contradicts a doc example, the checklist follows the
  recommendation and says so.
- The docs reference an "Execution", "Processes" and "P-Space" page. Those pages are outside this
  section; only what the Redcode pages say about them is included here.

---

## 1. Overview `(index)`

Redcode is the language used to write warriors for Corewar. It resembles assembly language: each
instruction has an **opcode** and **two operands**.

```
mov 0, 1
```

Here the opcode is `mov` and the operands are `0` and `1`. Before a warrior can be loaded into the
game, the redcode must be processed by a **Parser**. The parsed output of the instruction above is:

```
MOV.I $0, $1
```

Beyond the input's opcode and operands, the parsed output contains the **modifier** (`.I`) and the
**addressing mode** of each operand (`$`). The source may (but need not) specify the modifier and
addressing modes. Different modifiers and addressing modes change the behaviour of opcodes.

### Standards

- The current standard is **ICWS'94**.
- Older, legacy standards: **1986** and **1988**.
- ICWS'94 is a superset of the older standards and was designed to be backwards compatible: a warrior
  written to the 1988 spec should parse and execute correctly under ICWS'94.

---

## 2. Core concepts and notation used in this spec

These terms are used throughout. They are consistent with the docs; where the docs do not define a
term precisely, the definition here is the recommended one.

- **Instruction** (load-format): `{ opcode, modifier, aMode, aNumber, bMode, bNumber }`. Every loaded
  instruction has all six fields (see Parser defaults, section 7).
- **A operand / B operand**: the first and second operand. Each is an addressing mode plus a number
  (`(operands)`).
- **A number / B number** (also "A field / B field"): the numeric part of the A / B operand.
- **CORESIZE**: number of instructions in the core. All runtime arithmetic is modulo CORESIZE ("mod
  maths", `(opcodes)`).
- **PC**: the address of the instruction being executed.
- **Source instruction**: the instruction referenced by the A operand. The opcode reads values from
  it. A copy of it is taken during A-operand evaluation (the docs call this the `Source Register`,
  `(addressing_modes)`).
- **Destination instruction**: the instruction referenced by the B operand. The opcode writes to it
  (or, for tests and comparisons, reads from it).
- **A pointer / B pointer**: the core addresses that the A and B operands resolve to.

> AMBIGUITY: Number representation at runtime. The docs say all operations use mod maths and give
> results as `(...) % CORESIZE`, and show negative numbers in source and parsed output (for example
> `$-1`). Recommendation (ICWS'94): store every field in core as an integer in `[0, CORESIZE-1]`. The
> loader normalises each parsed number `n` with `((n % CORESIZE) + CORESIZE) % CORESIZE`. All runtime
> comparisons (`slt`, zero tests, equality) use these normalised unsigned values, so `-1` is stored and
> compared as `CORESIZE-1`. Every arithmetic result is normalised the same way.

---

## 3. Operands `(operands)`

- Each redcode instruction contains **two operands**. An operand is an **addressing mode** plus a
  **number**. The first operand is the `A` operand, the second the `B` operand.

  ```
  mov.i $1, #2
  ```

  The A operand is `$1` (A mode `$` direct, A number `1`). The B operand is `#2` (B mode `#`
  immediate, B number `2`).
- If no addressing mode is specified for an operand, the parser inserts the default `$` (direct). (But
  see the conflicting rule for `dat` in section 7.2.)
- Some opcodes need only one operand to parse. In that case the parser inserts `$0` as the other
  operand, and **the opcode determines whether the `A` or `B` operand is inserted**:
  - `dat`: the single written operand becomes the **B** operand. The inserted operand is the **A**
    operand, value 0 (`dat 7` gives `DAT.F $0, $7`, `(opcodes)`; we insert `#0`, see the note below).
  - `jmp`, `spl`, `nop`: the single written operand is the **A** operand. The inserted operand is the
    **B** operand, `$0` (`jmp 5` gives `JMP.B $5, $0`).

> AMBIGUITY: Which operand is inserted for a single-operand instruction. `(parser)` says "If an
> instruction has only a single operand, the `B` operand is defaulted to zero", but `(operands)` says
> the opcode decides, and `(opcodes)` says that for `dat` "the A operand is defaulted to 0" with the
> example `dat 7` giving `DAT.F $0, $7`. Recommendation (ICWS'94 / pMARS): for `dat` the written
> operand is B and A is inserted as `0`. For every other single-operand opcode the written operand is
> A and B is inserted as `$0`.
> Decision (lead's divergence rule, checked against pMARS 0.9.5): the docs contradict themselves on
> the inserted A operand's mode, so follow ICWS'94 / pMARS: the inserted A operand is **`#0`**, and
> `dat 7` gives `DAT.F #0, $7`. (The written operand keeps the ordinary `$` default.)

---

## 4. Opcodes `(opcodes)`

### 4.1 The opcode set

Exactly these opcodes are valid:

```
dat mov add sub mul div mod jmp jmz jmn djn cmp seq sne slt spl nop
```

- `cmp` is an **alias for `seq`**, kept to support legacy standards. `cmp` and `seq` behave exactly
  the same.
- Different opcodes have different default modifiers. Some need only a single operand (section 7).

> AMBIGUITY: Opcode case. Examples use both lower case (`mov 0, 1`) and upper case (`MOV.I $0, $1`,
> `DAT.F 1, <1`). Recommendation: opcodes, modifiers and directives (`ORG`, `END`, `EQU`, `FOR`, `ROF`)
> are case-insensitive. Parsed output uses upper case (section 7.4).

> AMBIGUITY: `cmp` in parsed output. Since `cmp` is an alias, should `cmp` stay `CMP` in the output or
> become `SEQ`? Recommendation: keep the opcode the author wrote (`CMP` stays `CMP`) in parsed output,
> and treat `CMP` and `SEQ` as the same opcode at execution time. That includes `seq.i`-style
> whole-instruction comparison: two instructions that differ only in `CMP` versus `SEQ` should compare
> **equal**, so the loader should canonicalise `CMP` to `SEQ` in core. (pMARS loads both as one
> opcode.)

> AMBIGUITY: P-space opcodes. `(preprocessor)` lists a `PSPACESIZE` constant ("see P-Space"), but the
> opcode list has no `ldp`/`stp`. Recommendation: do not support `ldp`/`stp` as part of this section.
> Treat them as unknown opcodes (a parse error) unless a P-space spec adds them.
>
> RESOLVED: `spec/pspace.md` now adds P-space as an extension (`LDP`, `STP`, `PIN`), at the user's request.

### 4.2 Execution model (shared by all opcodes)

From the Redcode pages:

- When an instruction executes, the addressing modes of its A and B operands are evaluated first, to
  find the source and destination instructions. Some modes increment or decrement numbers during this
  evaluation (`(addressing_modes)`).
- Process termination by `dat` or by division by zero happens **after** the operand addressing modes
  have been evaluated, so their increments and decrements still take effect (`(opcodes)`).
- Every instruction, `nop` included, takes **a single cycle** (`(opcodes)`, under Nop).

> AMBIGUITY: Exact evaluation order. The docs defer to an "Execution" page outside this section.
> Recommendation (ICWS'94), which matches both worked examples in `(addressing_modes)`:
>
> 1. Fetch the instruction at PC into an instruction register (IR).
> 2. Evaluate the **A operand** using IR's A mode and A number. This gives the A pointer. Apply any
>    pre-decrement to core before the pointer is computed. Copy the instruction at the A pointer into
>    the **Source Register**. Then apply any post-increment to core.
> 3. Evaluate the **B operand** the same way. This gives the B pointer. Pre-decrement first, then copy
>    the instruction at the B pointer into the Destination Register, then post-increment.
> 4. Execute the opcode. It reads source values from the Source Register. Writes go to core at the B
>    pointer. Tests and comparisons on destination values read the Destination Register, except for
>    `djn` (see 4.10).
> 5. Queue the next PC: `PC+1`; `PC+2` for a skip; the A pointer for a jump. Nothing is queued if the
>    process dies.
>
> The A operand is fully evaluated, including its post-increment, before the B operand is evaluated.

### 4.3 Notation for per-modifier tables (Derived)

`S` is the Source Register (copy of the source instruction). `D` is the destination instruction in
core at the B pointer. `S.a`/`S.b` and `D.a`/`D.b` are their A/B numbers. `←` means "write to core".
Every arithmetic result is taken mod CORESIZE and normalised to `[0, CORESIZE-1]`.

### 4.4 `dat`: Data

- A process that executes `dat` is **removed from the process queue** (terminated). This is the main
  way warriors are killed.
- Termination happens **after** operand addressing modes are evaluated. Example: executing the first
  instruction of

  ```
  DAT.F 1, <1 ; <--this instruction is executed
  DAT.F 1, 1
  ```

  still decrements the second instruction's B operand, giving:

  ```
  DAT.F 1, <1 
  DAT.F 1, 0 ; <--this instruction was modified
  ```
- Default modifier: `.f`.
- Only one operand is needed to parse. With one operand, the **A operand defaults to 0** and the
  written operand becomes B. Example: `dat 7` parses as `DAT.F $0, $7` (docs; we insert `#0`, see section 3).
- Modifiers have no effect on execution (Derived: the process dies whatever the modifier is).

### 4.5 `mov`: Move

- Copies data from the address referenced by the A operand to the address referenced by the B
  operand. The modifier decides which data is copied.
- Default modifier: `.i` (but see the defaulting table in 7.3, which overrides this per mode).

Per-modifier semantics (Derived from the modifiers table):

| Modifier | Effect |
| --- | --- |
| `.a` | `D.a ← S.a` |
| `.b` | `D.b ← S.b` |
| `.ab` | `D.b ← S.a` |
| `.ba` | `D.a ← S.b` |
| `.f` | `D.a ← S.a`; `D.b ← S.b` |
| `.x` | `D.b ← S.a`; `D.a ← S.b` |
| `.i` | whole instruction: `D ← S` (opcode, modifier, both modes, both numbers) |

The next instruction is `PC+1`.

### 4.6 `add`, `sub`, `mul`: arithmetic

- `add` adds the number(s) at the address referenced by the A operand to the number(s) at the address
  referenced by the B operand. Result: `(A + B) % CORESIZE`.
- `sub` subtracts the number(s) referenced by the A operand **from** the number(s) referenced by the B
  operand. Doc formula: `(A - B) % CORESIZE`.
- `mul` multiplies the number(s) referenced by the A operand by the number(s) referenced by the B
  operand. Result: `(A * B) % CORESIZE`.
- The modifier decides which data is used. **`.i` has the same effect as `.f`.**
- Default modifier for each: `.ab` per `(opcodes)` (but see 7.3).

Per-modifier semantics, where `op` is `+`, `-` or `*` (Derived):

| Modifier | Effect |
| --- | --- |
| `.a` | `D.a ← (D.a op S.a) mod CORESIZE` |
| `.b` | `D.b ← (D.b op S.b) mod CORESIZE` |
| `.ab` | `D.b ← (D.b op S.a) mod CORESIZE` |
| `.ba` | `D.a ← (D.a op S.b) mod CORESIZE` |
| `.f`, `.i` | `D.a ← (D.a op S.a)`; `D.b ← (D.b op S.b)` (each mod CORESIZE) |
| `.x` | `D.a ← (D.a op S.b)`; `D.b ← (D.b op S.a)` (each mod CORESIZE) |

> AMBIGUITY: Operand order for `sub`. The prose says the A-referenced number is subtracted *from* the
> B-referenced number (B − A), but the formula is written `(A - B) % CORESIZE`. Recommendation
> (ICWS'94): the destination value minus the source value, `D.x ← (D.x − S.y) mod CORESIZE`,
> normalised into `[0, CORESIZE-1]`. Read the formula's `A`/`B` loosely.

> AMBIGUITY: Which `D` value is used. Recommendation (ICWS'94): read the current destination value
> (the Destination Register taken after B-operand evaluation, which equals core at the B pointer at
> that moment) and write the result to core at the B pointer.

### 4.7 `div` and `mod`

- `div` divides the number(s) referenced by the **B** operand by the number(s) referenced by the **A**
  operand. The quotient is **always rounded down**. Doc formula: `floor(A / B) % CORESIZE`.
- `mod` divides the B-referenced number(s) by the A-referenced number(s) and stores the
  **remainder** at the destination. Doc formula: `(A % B) % CORESIZE`.
- The modifier decides which data is used. **`.i` has the same effect as `.f`.**
- Default modifier for each: `.ab` per `(opcodes)` (but see 7.3).
- **Division by zero is an illegal instruction**: the executing process is removed from the process
  queue (terminated). As with `dat`, termination happens after operand addressing modes are evaluated.

Per-modifier semantics, where `op(d, s)` is `floor(d / s)` for `div` and `d % s` for `mod`, on
normalised non-negative values (Derived):

| Modifier | Divisor(s) | Effect |
| --- | --- | --- |
| `.a` | `S.a` | `D.a ← op(D.a, S.a)` |
| `.b` | `S.b` | `D.b ← op(D.b, S.b)` |
| `.ab` | `S.a` | `D.b ← op(D.b, S.a)` |
| `.ba` | `S.b` | `D.a ← op(D.a, S.b)` |
| `.f`, `.i` | `S.a`, `S.b` | `D.a ← op(D.a, S.a)`; `D.b ← op(D.b, S.b)` |
| `.x` | `S.b`, `S.a` | `D.a ← op(D.a, S.b)`; `D.b ← op(D.b, S.a)` |

> AMBIGUITY: Operand order in the formulas. The prose says B is divided by A, but the formulas read
> `floor(A / B)` and `(A % B)`. Recommendation (ICWS'94): destination ÷ source, as in the table above.

> AMBIGUITY: Rounding. `div` says "rounded down", while parse-time expression division "rounds towards
> zero" (section 9.2). Recommendation: at runtime, operands are normalised non-negative values, so
> floor and truncation agree. Use integer truncation (`Math.trunc`) on normalised values.

> AMBIGUITY: Division by zero in a two-field modifier (`.f`, `.x`, `.i`) when only one divisor is zero.
> The docs only say the process terminates. Recommendation (ICWS'94): perform and write each division
> whose divisor is non-zero, skip the one whose divisor is zero, and then terminate the process
> (queue nothing). Example: `div.f` with `S.a = 0, S.b = 2` still writes `D.b ← floor(D.b / 2)`
> before the process dies.

### 4.8 `jmp`: Jump

- Changes the address of the next instruction the executing process will run. Typical uses: loops,
  skipping code.
- Jumps to the address given by the **A operand** (the A pointer).
- The B operand has no purpose, **but it is still evaluated**, so its increments and decrements
  happen.
- **Modifiers have no effect**: the A operand is always the jump address.
- Default modifier: `.b`.
- Only one operand is needed. With one operand, **B defaults to 0**: `jmp 5` parses as
  `JMP.B $5, $0`.

### 4.9 `jmz`: Jump if Zero; `jmn`: Jump if Not Zero

- `jmz` works like `jmp`, except the jump happens only if the number(s) at the address referenced by
  the **B operand** are zero (like an `if` statement). Otherwise execution continues at `PC+1`.
- `jmn` works like `jmz`, except the jump happens if the referenced number(s) are **not** zero.
- The jump target is always the A pointer.
- Default modifier for both: `.b`.

Fields of the destination (B-referenced) instruction that are tested, by modifier (verbatim table):

| Modifier | Destination |
| --- | --- |
| .a | A operand |
| .b | B operand |
| .ab | B operand |
| .ba | A operand |
| .f | A and B operands |
| .x | A and B operands |
| .i | A and B operands |

So `.a` ≡ `.ba`, `.b` ≡ `.ab`, and `.f` ≡ `.x` ≡ `.i`.

`jmz` with two fields: "the jump will not be taken if either operand is non-zero". It jumps only when
**both** are zero:

```
dat 0, 1 ; <- won't jump if compared with jmz.f
dat 1, 0 ; <- won't jump if compared with jmz.f
dat 1, 1 ; <- won't jump if compared with jmz.f
dat 0, 0 ; <- will jump if compared with jmz.f
```

`jmn` with two fields, as the docs state it: "the jump will not be taken if either operand is zero":

```
dat 0, 1 ; <- won't jump if compared with jmn.f
dat 1, 0 ; <- won't jump if compared with jmn.f
dat 1, 1 ; <- will jump if compared with jmn.f
dat 0, 0 ; <- won't jump if compared with jmn.f
```

> AMBIGUITY: `jmn.f` / `.x` / `.i` truth condition. The docs say `jmn.f` jumps only when **both**
> fields are non-zero, so it is not the negation of `jmz.f`. ICWS'94 (and pMARS) define `JMN.F` to
> jump when **either** field is non-zero, i.e. exactly `!jmz.f`. Under ICWS'94, `dat 0, 1` and
> `dat 1, 0` *would* jump. The docs' own `djn` section ("Unlike the `jmn` instruction, ...") confirms
> they meant to differ from the standard here. Recommendation: implement ICWS'94 (`jmn` with two
> fields jumps if either field is non-zero) for compatibility with the existing warrior corpus. Record
> this as a deliberate deviation from the docs' table. The checklist follows ICWS'94 and lists the doc
> behaviour as rejected.

### 4.10 `djn`: Decrement and Jump if Not Zero

- Like `jmn`, with one addition: **before** the comparison against zero, the number(s) at the
  destination instruction are **decremented**. Typical use: a simple `for` loop.
- The decrement happens **after** the addressing modes are evaluated and **before** the comparison.
- The fields decremented and tested follow the `jmz` table above (`.a`/`.ba`: A field; `.b`/`.ab`: B
  field; `.f`/`.x`/`.i`: both fields).
- Default modifier: `.b`.
- Docs text: "Unlike the `jmn` instruction, the `djn` instruction will perform the jump if either
  operand is zero when using the .f, .x and .i modifiers." Docs example:

  ```
  dat 0, 1 ; <- will jump if compared with djn.f
  dat 1, 0 ; <- will jump if compared with djn.f
  dat 1, 1 ; <- will jump if compared with djn.f
  dat 0, 0 ; <- won't jump if compared with jmn.f
  ```

> AMBIGUITY: `djn.f` truth condition. The prose ("jump if either operand is **zero**") cannot be right:
> with that reading `dat 1, 1` (both non-zero) would not jump, yet the example says it does. The
> example is consistent if its values are read as the values **after** decrementing, with the rule
> "jump if **either** field is non-zero". The last line's comment also says `jmn.f` where `djn.f` is
> meant. Recommendation (ICWS'94): decrement each selected field in core (mod CORESIZE). Jump to the A
> pointer if **any** selected field, after decrementing, is non-zero. Otherwise continue at `PC+1`.
> Under this rule, a destination of `dat 1, 1` before execution becomes `0, 0` and does **not** jump,
> while `dat 0, 0` becomes `-1, -1` (`CORESIZE-1`) and jumps.

> AMBIGUITY: Where the decrement is applied. Recommendation (ICWS'94): decrement **both** the
> instruction in core at the B pointer and the Destination Register copy, then test the decremented
> values.

### 4.11 `seq` (alias `cmp`): Skip if Equal; `sne`: Skip if Not Equal

- `seq` compares the number(s) at the source and destination addresses. If they are equal, it adds
  **one** to the next address to execute, skipping the next instruction (next PC = `PC+2`). Otherwise
  the next PC is `PC+1`. Typical use: scanners.
- The modifier decides what is compared. With `.i`, the **entire** source and destination
  instructions are compared, so if they differ even only by opcode, modifier or addressing mode, the
  next instruction is **not** skipped.
- `sne` is the same, except it skips when source and destination are **not** equal.
- Default modifier for both, per `(opcodes)`: `.i` (but see 7.3).

Per-modifier comparisons (Derived from the modifiers table; ICWS'94):

| Modifier | `seq` skips when | `sne` skips when |
| --- | --- | --- |
| `.a` | `S.a == D.a` | `S.a != D.a` |
| `.b` | `S.b == D.b` | `S.b != D.b` |
| `.ab` | `S.a == D.b` | `S.a != D.b` |
| `.ba` | `S.b == D.a` | `S.b != D.a` |
| `.f` | `S.a == D.a` **and** `S.b == D.b` | `S.a != D.a` **or** `S.b != D.b` |
| `.x` | `S.a == D.b` **and** `S.b == D.a` | `S.a != D.b` **or** `S.b != D.a` |
| `.i` | opcode, modifier, A mode, A number, B mode and B number all equal | any of those differ |

`sne` is always the exact negation of `seq` with the same modifier.

### 4.12 `slt`: Skip if Less Than

- Compares the number(s) at the source and destination addresses. If the **source** number(s) are
  less than the **destination** number(s), the next PC is `PC+2` (skip). Otherwise it is `PC+1`.
- Fields compared, by modifier (verbatim table):

| Modifier | Source | Destination |
| --- | --- | --- |
| .a | A operand | A operand |
| .b | B operand | B operand |
| .ab | A operand | B operand |
| .ba | B operand | A operand |
| .f | A and B operands | A and B operands |
| .x | A and B operands | B and A operands |
| .i | A and B operands | A and B operands |

- `.f` and `.i` are equivalent.
- When both fields are compared (`.f`, `.x`, `.i`), the skip does **not** happen if **either** source
  number is greater than or equal to its corresponding destination number. Skip only if every pair
  satisfies `source < destination`.
- Default modifier: `.b` per `(opcodes)` (but see 7.3).

Per-modifier skip conditions (Derived): `.a`: `S.a < D.a`. `.b`: `S.b < D.b`. `.ab`: `S.a < D.b`.
`.ba`: `S.b < D.a`. `.f`/`.i`: `S.a < D.a && S.b < D.b`. `.x`: `S.a < D.b && S.b < D.a`. Comparisons
use normalised unsigned values in `[0, CORESIZE-1]`.

### 4.13 `spl`: Split

- Spawns a **new process** for the current warrior at the address given by the **A operand** (the A
  pointer).
- The new process is added to the process queue **after the currently executing process**.
- Example:

  ```
  a: spl c
  b: jmp 0
  c: jmp 0
  ```

  The first instruction runs and creates a second process at `c`. The next instruction to run is `b`
  (the original process). Then the new process runs at `c`.
- **Modifiers have no effect**: the A operand is always the split address.
- Default modifier: `.b`.
- Only one operand is needed. With one operand, **B defaults to 0**: `spl 3` parses as
  `SPL.B $3, $0`.

> AMBIGUITY: Queue order and the process limit. Recommendation (ICWS'94): after `spl`, first queue the
> current process's next instruction (`PC+1`) at the tail of the warrior's queue, then queue the new
> process (A pointer). This gives the documented order `a`, `b`, `c`. If the warrior already has
> `MAXPROCESSES` processes, do not create the new process; the current process still continues at
> `PC+1`. The process limit is defined on the out-of-scope "Processes" page.

### 4.14 `nop`: No Operation

- Performs no operation. It takes one cycle as normal, and **its addressing modes are evaluated as
  normal** (increments and decrements happen). Typical use: a delay in a multi-process warrior.
- **Modifiers have no effect**.
- Default modifier: `.f` per `(opcodes)`.
- Only one operand is needed. With one operand, **B defaults to 0**: `nop 8` parses as
  `NOP.F $8, $0`.

> AMBIGUITY: `nop` default modifier. `(opcodes)` says `.f` (with the worked example
> `nop 8` → `NOP.F $8, $0`), while the `(parser)` defaulting table puts `nop` with
> `jmp jmz jmn djn spl` → `.b`. The modifier has no effect on execution. It is only visible in parsed
> output and in `seq.i`/`sne.i` whole-instruction comparisons. Recommendation: follow the explicit
> worked example and default `nop` to `.f`, treating the table row as an error. Either choice is
> execution-neutral apart from `.i` comparisons.

---

## 5. Modifiers `(modifiers)`

- A modifier is appended to the end of an opcode (for example `mov.i`) to change its behaviour. Each
  opcode can have up to 7 behaviours without separate opcode variants.
- Modifiers were introduced in ICWS'94. Earlier standards implied the modifier from the opcode. For
  backwards compatibility, every opcode has a **default modifier**, which the parser inserts when none
  is given (section 7.3).
- Valid modifiers: `.a`, `.b`, `.ab`, `.ba`, `.f`, `.x`, `.i`.

Values used from the source and destination instruction, by modifier (verbatim table):

| Modifier | Source | Destination |
| --- | --- | --- |
| .a | A operand | A operand |
| .b | B operand | B operand |
| .ab | A operand | B operand |
| .ba | B operand | A operand |
| .f | A and B operands | A and B operands |
| .x | A and B operands | B and A operands |
| .i | Whole instruction | Whole instruction |

- **A**: the source's A operand and the destination's A operand are used.
- **B**: the source's B operand and the destination's B operand are used.
- **AB**: the source's A operand and the destination's B operand are used.
- **BA**: the source's B operand and the destination's A operand are used.
- **F**: the source's A and B operands and the destination's A and B operands are used, respectively
  (A with A, B with B).
- **X**: the source's A and B operands and the destination's **B and A** operands are used,
  respectively (A with B, B with A).
- **I**: the opcode applies to the entire source and destination instructions. `.i` only has its own
  meaning for `mov`, `seq` and `sne` (and `cmp`, its alias). For most other opcodes `.i` behaves like
  `.f`.
- Opcodes whose modifier has no effect: `jmp`, `spl`, `nop` (and `dat`, Derived). For `jmz`, `jmn` and
  `djn` the modifier only selects destination fields (section 4.9).

> AMBIGUITY: Modifier syntax. The docs only show the modifier written directly after the opcode with
> a dot (`mov.i`, `add.ab`). Recommendation: `opcode '.' modifier` with **no whitespace** around the
> dot, case-insensitive. Any other modifier text (for example `.z` or `.abx`) is a parse error.

---

## 6. Addressing modes `(addressing_modes)`

Each operand has an addressing mode. The modes of the A and B operands are evaluated when the
instruction executes, to find the source and destination instructions. Some modes also increment or
decrement a number during evaluation.

Valid modes:

| Symbol | Name |
| --- | --- |
| `#` | Immediate |
| `$` | Direct |
| `*` | A Indirect |
| `@` | B Indirect |
| `{` | A Pre-decrement Indirect |
| `}` | A Post-increment Indirect |
| `<` | B Pre-decrement Indirect |
| `>` | B Post-increment Indirect |

Evaluation rules for one operand with number `n` in the executing instruction at `PC`. All addresses
are mod CORESIZE. `core[x].a` / `core[x].b` are the A/B numbers of the instruction at `x`.

| Mode | Pointer computation | Side effect |
| --- | --- | --- |
| `#` | `PC` (an address offset of **0**) | none |
| `$` | `PC + n` | none |
| `*` | `I = PC + n`; pointer = `I + core[I].a` | none |
| `@` | `I = PC + n`; pointer = `I + core[I].b` | none |
| `{` | `I = PC + n`; `core[I].a -= 1` **first**; pointer = `I + core[I].a` (decremented value) | A number of `I` decremented before use |
| `}` | `I = PC + n`; pointer = `I + core[I].a` (old value); **then** `core[I].a += 1` | A number of `I` incremented after use |
| `<` | `I = PC + n`; `core[I].b -= 1` **first**; pointer = `I + core[I].b` | B number of `I` decremented before use |
| `>` | `I = PC + n`; pointer = `I + core[I].b` (old value); **then** `core[I].b += 1` | B number of `I` incremented after use |

### 6.1 Immediate `#`

Always evaluates to an **address of 0**, i.e. the executing instruction itself. This stores data in
the operand without changing which address the operand references. The example below behaves exactly
like the classic imp even though its A number is non-zero, and it keeps working even if the A number
is modified:

```
mov.i #123, $1
```

### 6.2 Direct `$`

A relative address from the executing instruction to another instruction in the core. The classic
imp:

```
mov.i $0, $1
```

The A operand has a direct address of 0 (the current instruction) and the B operand a direct address
of 1 (the next instruction). **Direct is the default addressing mode** (but see 7.2 for `dat`).

### 6.3 A Indirect `*`

Uses the executing instruction's operand as a pointer to an **intermediate** instruction. That
instruction's **A field** is then used as a direct reference to the instruction of interest. The
intermediate instruction's field is resolved **relative to the intermediate instruction**, not the
executing instruction.

```
mov.i *1, $2
dat    2, 0  ; <- 2 is used as a pointer
dat    0, 0  ; <- this instruction will be overwritten
jmp    0     ; <- with this instruction
```

The B operand (direct) refers to the third instruction (`dat 0, 0`). The A operand's number `1`
selects the second instruction (`dat 2, 0`) as the intermediate. Its A number `2`, counted from the
second instruction, gives the fourth instruction (`jmp 0`) as the source. Result: the third
instruction is overwritten with `jmp 0`.

### 6.4 B Indirect `@`

Same as `*`, but uses the intermediate instruction's **B field** as the pointer. The classic dwarf
uses it to aim its bombs:

```
add #4,  3
mov  2, @2
jmp -2
dat #0, #0
```

The `dat` is both the bomb and the pointer to the target. On each pass of the infinite loop, `4` (the
step size) is added to the `dat`'s B number. Then `mov 2, @2` copies the `dat` bomb to the address
given by the `dat`'s B number.

### 6.5 A Pre-decrement Indirect `{`

Same as `*`, but the intermediate instruction's **A number is decremented first**, then used as the
pointer.

```
mov.i {1, $1
dat   $0, $0
```

The `dat`'s A number is decremented before use:

```
mov.i  {1, $1
dat   $-1, $0
```

After the decrement the `dat`'s A number is `-1`, which points at the `mov` instruction, so the `mov`
is the source instruction.

### 6.6 A Post-increment Indirect `}`

Same as `*`, but the intermediate instruction's **A number is incremented after** it is used as the
pointer.

```
mov.i }1, $1
dat   $0, $0
```

The `dat`'s A number (`0`) is used first. It points at the `dat` itself, so the `dat` becomes the
source instruction. Then the `dat`'s A number is incremented to `1`:

```
mov.i  }1, $1
dat   $1, $0
```

Finally the move runs, using the copy of the `dat` held in the **Source Register**:

```
mov.i }1, $1
dat   $0, $0
```

The final core is exactly the same as the starting core: the move overwrote the post-increment. This
shows that the source copy is taken **before** the post-increment, and the increment is applied to
core before the opcode executes.

### 6.7 B Pre-decrement Indirect `<`

Same as `{`, but decrements and uses the intermediate instruction's **B number**.

### 6.8 B Post-increment Indirect `>`

Same as `}`, but increments and uses the intermediate instruction's **B number**.

> AMBIGUITY: Which copy of the executing instruction's operand number is used, and interactions
> between operands. If the A operand's pre-decrement or post-increment modifies the executing
> instruction itself, or the cell the B operand will use, does B see the change? Recommendation
> (ICWS'94): the operand numbers `n` come from the instruction register (IR), the copy fetched before
> evaluation, so changes to the executing instruction in core do not alter `n`. The intermediate
> instruction's fields are always read from **core at the time of that operand's evaluation**, so B's
> evaluation sees changes made by A's evaluation. All increment and decrement results are normalised
> mod CORESIZE.

> AMBIGUITY: Mode for a DAT operand during evaluation. `dat` still evaluates its operands (4.4).
> Recommendation: evaluate `dat` operands exactly like any other instruction's, so `#` does nothing
> and `<`/`>`/`{`/`}` modify core.

---

## 7. Parser `(parser)`

Redcode is turned into a **load format** by a parser before it is loaded into the simulator. The
parser:

- Checks for syntax errors.
- Inserts default modifiers and addressing modes.
- Replaces labels with addresses.
- Executes preprocessor commands.
- Removes white space and comments.

### 7.1 Defaults: general rule

Every loaded instruction needs a modifier and two operands, and each operand needs an addressing mode
and a number. Modifiers and addressing modes may be left out of the source; the parser then inserts
the defaults in the load-file output. Example: `mov 0, 1` parses as `MOV.I $0, $1`.

### 7.2 Default addressing modes

`(parser)` says: the default addressing mode is direct (`$`) for all opcodes **except `dat`**.
Instructions with the `dat` opcode default to the immediate (`#`) addressing mode.

> AMBIGUITY: Default mode for `dat` operands. Pages disagree:
>
> - `(operands)` and `(addressing_modes)`: the default is always `$`.
> - `(opcodes)`: `dat 7` → `DAT.F $0, $7` (direct).
> - `(parser)`: `dat` defaults to `#`.
> - `(labels)`: `bmb dat 5, 5` → `DAT.F #5, #5`.
> - `(preprocessor)`: also `#`.
>
> Recommendation (ICWS'94 / pMARS): the default mode is `$` for **every** opcode, `dat` included, so
> `dat 5, 5` → `DAT.F $5, $5` and `dat 7` → `DAT.F #0, $7` (the inserted A operand is `#0`, see
> section 3). This only affects execution through
> `seq.i`/`sne.i`/`cmp.i` whole-instruction comparisons and `mov.i` copies. Make the `dat` default a
> single constant so it can be switched if the project decides to match the corewar.io output
> (`#`) instead. The checklist uses the recommendation and marks the conflicting examples.

### 7.3 Single-operand rules

- Only `dat`, `jmp`, `spl` and `nop` may be written with a single operand.
- Leaving out the second operand for **any other opcode is a syntax error**.
- The inserted operand is the number 0 with the default mode (section 3: for `dat` the A operand is
  inserted, for the others the B operand).

> AMBIGUITY: Zero operands. The docs never say whether an instruction with no operands at all (for
> example a bare `dat` or `nop`) is valid. Recommendation: a parse error for every opcode.

### 7.4 Default modifier table

The default modifier depends on the opcode and on the A and B addressing modes (verbatim table; empty
Opcode cells continue the row above):

| Opcode | A-mode | B-mode | Default Modifier |
| --- | --- | --- | --- |
| `dat` | any | any | `.f` |
| `mov` `cmp` | # | any | `.ab` |
|  | $@<>{} | # | `.b` |
|  | $@<>{} | $@<>{} | `.i` |
| `add` `sub` `mul` `div` `mod` | # | any | `.ab` |
|  | $@<>{} | # | `.b` |
|  | $@<>{} | $@<>{} | `.f` |
| `slt` | # | any | `.ab` |
|  | $@<>{} | any | `.b` |
| `jmp` `jmz` `jmn` `djn` `spl` `nop` | any | any | `.b` |

(The set `$@<>{}` does not include `*` or `}`; see the AMBIGUITY note below.)

The defaulting is applied **after** the addressing-mode defaults have been inserted. Implementation
as a function:

```
defaultModifier(op, aMode, bMode):
  dat                         -> F
  mov, cmp, seq, sne          -> aMode == '#' ? AB : bMode == '#' ? B : I
  add, sub, mul, div, mod     -> aMode == '#' ? AB : bMode == '#' ? B : F
  slt                         -> aMode == '#' ? AB : B
  jmp, jmz, jmn, djn, spl     -> B
  nop                         -> F   (see AMBIGUITY in 4.14)
```

Worked examples from the docs that this table must reproduce:

- `mov 0, 1` → `MOV.I $0, $1`.
- `add.ab` explicit → kept.
- `jmp top` → `JMP.B $-2, $0`.
- `add 3, 4` → `add.ab $3, $4` (from `(comments)`).
- `add (4/2-1)*5, 1` → `ADD.AB $5, $1` (from `(preprocessor)`).
- `mov bmb, @bmb` → `MOV.I $-2, @-2`.
- `dat 7` → `DAT.F $0, $7` (docs; this implementation gives `DAT.F #0, $7`, see the note in section 3).

> AMBIGUITY: `add 3, 4` → `.ab`? With the table, A mode `$` and B mode `$` give `add` the default
> `.f`, not `.ab`. Yet `(comments)` shows `add 3, 4` → `add.ab $3, $4` and `(preprocessor)` shows
> `add (4/2-1)*5, 1` → `ADD.AB $5, $1`. These examples follow the `(opcodes)` statement "the default
> modifier for add is .ab" and ignore the table. Recommendation (ICWS'94 / pMARS): **use the table**,
> so `add 3, 4` → `ADD.F $3, $4` and `add (4/2-1)*5, 1` → `ADD.F $5, $1`. The checklist follows the
> table and notes the conflicting examples. The same applies to `sub mul div mod`.

> AMBIGUITY: `seq` and `sne` are missing from the table. `(opcodes)` says their default is `.i`
> unconditionally, but `cmp` (the alias of `seq`) has the mode-dependent row. Recommendation
> (ICWS'94): give `seq` and `sne` the same mode-dependent row as `mov`/`cmp` (`#`-A → `.ab`; `#`-B →
> `.b`; otherwise `.i`).

> AMBIGUITY: `slt` default. `(opcodes)` says `.b`; the table says `.ab` when the A mode is `#`.
> Recommendation: use the table.

> AMBIGUITY: Modes `*` and `}` are missing from the table's "$@<>{}" set. Both were added in ICWS'94
> alongside `{`, and the row is meant to cover "every mode except `#`". Recommendation: read
> `$@<>{}` as "any mode other than `#`", which includes `*` and `}`.

### 7.5 Parsed output (load file) format

From the examples:

- One instruction per line: `OPCODE.MODIFIER <amode><anumber>, <bmode><bnumber>` (for example
  `MOV.I $-2, @-2`).
- Labels are replaced by relative numbers. EQU constants and expressions are replaced by their values.
  Comments and preprocessor directives are removed. FOR blocks are expanded.
- Numbers are written as signed integers relative to the instruction (for example `$-1`), not
  normalised.
- A start address other than the default may appear as an `ORG n` line (`(preprocessor)` dwarf
  example: `ORG 1` before the instructions).
- Metadata comments are kept in the output (section 12).

> AMBIGUITY: Output casing. Most examples use upper case (`MOV.I $0, $1`), but `(comments)` shows
> `mov.i $0, $1` and `(preprocessor)` FOR examples show `dat.f $1, $2`. Recommendation: emit upper-case
> opcodes and modifiers, one space after the comma, and compare case-insensitively in tests.

> AMBIGUITY: When `ORG` is emitted. `(preprocessor)` shows `ORG 1` in the output, while `(labels)`
> output has no `ORG` line (start 0). Recommendation: always emit an `ORG n` line (with `n = 0` by
> default) so the load file is self-describing. Emit it after the metadata comments and before the
> first instruction. Tests should ignore a missing `ORG 0`.

> AMBIGUITY: Output number range. Recommendation: keep the signed relative numbers as the parser
> computed them (matching the examples), and leave normalisation to the loader (section 2).

### 7.6 Errors and warnings

Stated by the docs:

- **Error**: syntax errors in general (`(parser)`).
- **Error**: a missing second operand for any opcode other than `dat jmp spl nop` (`(parser)`).
- **Error** (preprocessor `assert`): a failed assertion stops the warrior from being parsed or loaded
  (`(preprocessor)`).
- **Warning**: both `ORG` and `END` are given (`(org)`).
- **Warning**: several `ORG` and/or `END` directives are given (`(org)`).

> AMBIGUITY: Error conditions the docs never mention. Recommendation (pMARS-compatible), with every
> item a **parse error** unless marked as a warning:
>
> - Unknown opcode.
> - Unknown modifier.
> - Invalid addressing-mode character.
> - Operand missing a number (for example `mov $, 1`).
> - More than two operands.
> - Reference to an undefined label or constant.
> - Duplicate label or constant definition.
> - A label or constant named like an opcode or directive (`mov`, `org`, `equ`, `for`, `rof`, `end`),
>   checked case-insensitively.
> - Division or modulo by zero in an expression.
> - Unbalanced parentheses.
> - `ROF` without a `FOR`; `FOR` without a `ROF`.
> - `EQU` without a name.
> - A warrior longer than `MAXLENGTH` instructions.
> - A warrior with zero instructions.
> - `ORG`/`END` operand outside `[0, length-1]`: a **warning**; the start is kept as written (see the
>   "Start address out of range" note in section 10).
> - Lines after `END`: ignored (pMARS stops parsing at `END`), with no diagnostic.
>
> Each diagnostic carries severity (`error` | `warning`), the 1-based source line number, and a
> message. A parse succeeds if and only if there are no errors; warnings do not block loading.

---

## 8. Labels `(labels)`

### 8.1 Motivation

Literal addresses are hard to read and maintain:

```
dat #1, #2
mov -1, 10
```

The `mov` copies the `dat` to a new location. Adding a line between them:

```
dat #1, #2
spl 5       ; <- a new instruction
mov -1, 10
```

means the `mov` now copies the `spl` instead. Labels solve this by naming addresses.

### 8.2 Declaration syntax

- A label is declared by writing its name **in front of the instruction's opcode**.
- Name rules: the **first character** is an alphabetic character (a-z) or an underscore `_`. The
  **remaining characters** are alphanumeric or underscores. Regex (recommended):
  `^[A-Za-z_][A-Za-z0-9_]*$`.
- A colon `:` may optionally follow the name (it is not part of the name).
- Legal declarations (verbatim):

  ```
  lbl
  _Label
  a123:
  my_label:
  b_13_
  ```

### 8.3 Use and resolution

- Once declared, a label may be used anywhere in place of an operand's number.

  ```
  bmb: dat     #4, #0
  top: add.ab bmb, bmb
       mov.i  bmb, @bmb
       jmp top
  ```

- The parser replaces every reference with the label's address **relative to the instruction where
  it is used**: `value = labelAddress − currentInstructionAddress`. Parsed:

  ```
  DAT.F #4, #0
  ADD.AB $-1, $-1   ; <- here bmb was replaced with -1
  MOV.I $-2, @-2    ; <- here bmb was replaced with -2
  JMP.B $-2, $0     ; <- here top was replaced with -2
  ```

  On the `add`, `bmb` → `-1` because the `dat` is one line above. On the `mov`, `bmb` → `-2`.
- **Forward references** must work (Derived: `ORG top` in `(preprocessor)` refers to a label declared
  later, and `mybmb EQU bmb` precedes `bmb:`). Resolution therefore needs two passes: first assign an
  address to every instruction and label, then evaluate operands.

### 8.4 Multiple labels per address

Several labels can name the same address, either on the same line or on separate lines before the
instruction:

```
label:
another:
mov 0, 1
```

Both `label` and `another` refer to the `mov`.

> AMBIGUITY: Case sensitivity of labels. The docs are silent; the rule text says "a-z" but the legal
> example `_Label` contains upper case. Recommendation (pMARS): upper-case letters are allowed, and
> label names are **case-sensitive** (`Top` and `top` are different labels). Opcodes, modifiers and
> directives remain case-insensitive.

> AMBIGUITY: Several labels on one line. The prose allows it but gives only a multi-line example.
> Recommendation: accept any sequence of label tokens before the opcode, each with or without a colon
> (`a b: c: mov 0, 1`). Parse a line by reading tokens left to right: any identifier that is not an
> opcode or directive keyword is a label declaration, until an opcode or directive is found.

> AMBIGUITY: Label-only lines and trailing labels. A line holding only labels binds them to the
> **next** instruction emitted. The docs say nothing about a directive in between. Decision (pMARS,
> checked against pMARS 0.9.5): a label-only line's names join the labels of the next statement, so
> `a` / `b EQU 5` makes both `a` and `b` the constant 5, and before `ORG`/`END` they still name the
> next instruction. Exception: before `FOR`, label-only names stay address labels (see 9.5; the docs'
> FOR example needs this, while pMARS would make the last one the loop counter). Labels at the end of
> the file, with no following instruction, resolve to the address one past the last instruction
> (equal to the warrior length). pMARS rejects these as undefined; accepting them is a deliberate
> superset that changes no program pMARS accepts.

> AMBIGUITY: Labels on directive lines. Recommendation: a label before `EQU` is the constant's name,
> not an address label. A label before `FOR` follows the FOR rules in 9.5. Labels before `ORG`/`END`
> bind to the next instruction (pMARS).

> AMBIGUITY: Label length. No limit is stated. Recommendation: no limit.

---

## 9. Preprocessor `(preprocessor)`

Preprocessor directives change how the parser turns source into the load file. They run at **parse
time** and are **not** emitted directly into the parsed output.

### 9.1 `EQU`: constants

- Syntax:

  ```
  name EQU value
  ```

- Constant names follow the **same naming rules as labels**.
- The value may be a number, a label, a special constant, or a mathematical expression combining
  these.
- Unlike a label, whose value comes from where it is declared, a constant's value is given
  explicitly.

**Literal number constant** (classic dwarf):

```
step EQU 3044
ORG  top
bmb: dat    #step #step
top: add.ab bmb, bmb
     mov    bmb, @bmb
     jmp    top
```

Parsed output:

```
ORG 1
DAT.F #3044, #3044
ADD.AB $-1, $-1
MOV.I $-2, @-2
JMP.B $-2, $0
```

Every reference to `step` becomes `3044`.

**Label constant**: when a constant is set to a label, the parser first replaces every reference to
the constant with the **label**. Only after that substitution are labels replaced by relative
addresses, in the usual way:

```
mybmb EQU bmb
ORG  top
bmb: dat    #step #step
top: add.ab mybmb, mybmb
     mov    mybmb, @mybmb
     jmp    top
```

`mybmb` and `bmb` are equivalent.

> AMBIGUITY: Missing comma in `dat    #step #step`. Both EQU examples write the two operands without
> a comma, yet the output is `DAT.F #3044, #3044`. Every other example uses a comma. Recommendation
> (pMARS): a comma **is required** between operands. Treat these examples as typos and write the test
> fixtures with `dat #step, #step`. Optionally, an implementation may accept whitespace-separated
> operands with a warning, but that is not required.

> AMBIGUITY: The label-constant example uses `step` without defining it (an incomplete copy of the
> previous example). Recommendation: fixtures for this example should add `step EQU 3044`. Without it,
> the parse must fail with an undefined-symbol error.

> AMBIGUITY: Text substitution versus value. "Replaces all references to the constant ... with the
> label" describes **textual** substitution, which matters when the value contains labels: the label
> is resolved relative to each *use site*, not the EQU line. Recommendation (ICWS'94 / pMARS): EQU is
> text substitution. Store the value's token list and substitute it wherever the name appears in an
> operand, `ORG`/`END`, `FOR` count, another `EQU` value, or an `assert`. Substitute recursively, and
> report a cyclic definition as an error. pMARS substitutes the raw text without adding parentheses,
> so `x EQU 1+2` then `x*2` evaluates to `5`. The docs do not mention parentheses.
> Decision (lead's divergence rule, checked against pMARS 0.9.5): plain text substitution with **no**
> added parentheses, as in ICWS'94 / pMARS, so `x*2` is `1+2*2` = `5`. Write `x EQU (1+2)` to get
> `6`.

> AMBIGUITY: Redefinition of a constant, or a name used as both a label and a constant.
> Recommendation: a parse error.

### 9.2 Mathematical expressions

- Evaluated at parse time and replaced by the numeric result.
- Allowed in **any operand** and as the value of an `EQU`. Recommended also: `ORG`/`END` operands and
  `FOR` counts.
- Operators: `+` addition, `-` subtraction, `*` multiplication, `/` division, `%` modulo.
- Multiplication and division take **precedence** over addition and subtraction.

  ```
  5+2*3
  ```

  is evaluated as `2*3 = 6`, then `5 + 6 = 11`.
- Brackets `(` and `)` control evaluation order:

  ```
  add (4/2-1)*5, 1
  ```

  The A operand evaluates to `5`. Docs output:

  ```
  ADD.AB $5, $1
  ```

  (With the table defaulting from 7.4, this is `ADD.F $5, $1`; see the AMBIGUITY in 7.4.)
- EQU with an expression:

  ```
  myconst EQU (1+2)/2
  ```

  evaluates to:

  ```
  myconst EQU 1
  ```

- Division in expressions **rounds towards zero** (truncation, `Math.trunc`).
- Labels may appear in expressions:

  ```
  bmb dat 5, 5
      dat 0, 0
      mov bmb, bmb+1
  ```

  parses to:

  ```
  DAT.F #5, #5
  DAT.F #0, #0
  MOV.I $-2, $-1
  ```

  `bmb` is `-2` (the `dat` is two addresses below the `mov`), so `bmb+1` is `-2+1 = -1`. (Under the
  `$`-default recommendation in 7.2, the first two lines are `DAT.F $5, $5` and `DAT.F $0, $0`.)

> AMBIGUITY: Unary operators. Not listed, but required by the examples (`jmp -2`, `$-1`, `dat $-1`).
> Recommendation: support unary `-` and unary `+` (and `!` for logical not, see below), binding
> tighter than every binary operator.

> AMBIGUITY: Precedence of `%`. Only `*` and `/` are said to bind tighter than `+`/`-`.
> Recommendation (C-like): `%` has the same precedence as `*` and `/`. All binary operators are
> left-associative: `8-2-1 = 5`, `8/2/2 = 2`.

> AMBIGUITY: Sign of `%` in expressions. Recommendation: the C/JavaScript remainder (the result has
> the sign of the dividend), consistent with truncating division: `-7 % 3 = -1`, `-7 / 3 = -2`.
> Division or modulo by zero at parse time is a parse error.

> AMBIGUITY: Comparison and logical operators in ordinary expressions. They are listed only for
> `assert` (9.4). Recommendation (pMARS): one expression grammar for every context, supporting the
> full assert operator set. Precedence from highest to lowest:
>
> 1. Unary `-`, `+`, `!`.
> 2. `*`, `/`, `%`.
> 3. `+`, `-`.
> 4. `<`, `<=`, `>`, `>=`.
> 5. `==`, `!=`.
> 6. `&&`.
> 7. `||`.
>
> Comparisons and logical operators yield `1` or `0`.

> AMBIGUITY: Collisions between mode characters and operators. `*`, `<`, `>` are both addressing modes
> and operators. Recommendation: an addressing mode is recognised **only** as the first non-blank
> character of an operand. Everything after it is the expression. So `*1` is mode `*` with value `1`,
> and `$1*2` is mode `$` with value `2`. An operand that begins with `(`, a digit, a sign or an
> identifier has no explicit mode and gets the default.

> AMBIGUITY: Numeric literals. Only decimal integers appear. Recommendation: decimal integers only;
> arbitrary-precision is not needed. Evaluate in JavaScript numbers and check that intermediate
> results stay safe integers (overflow is an error).

### 9.3 Special constants

> Note from the docs: "this feature is not yet implemented within corewar.io".

These constants are resolved during parsing and replaced with their numeric value (verbatim table):

| Constant | Description |
| --- | --- |
| CORESIZE | The size of the core |
| MAXCYCLES | The number of cycles which will be executed before a draw is declared |
| MAXPROCESSES | The maxmimum number of processes each warrior can have (see Processes) |
| WARRIORS | The number of warriors which have been loaded into the Core |
| MAXLENGTH | The maximum length (number of instructions) a warrior can have |
| CURLINE | The absolute position (beginning at zero) of this line within the warrior's source code |
| MINDISTANCE | The closest that two warriors can be placed when loaded into core |
| VERSION | The version of the simulator used |
| PSPACESIZE | The size of P-space - see P-Space (`spec/pspace.md`) |

Implementation consequence (Derived): the parser must receive the simulator settings (CORESIZE,
MAXCYCLES, MAXPROCESSES, WARRIORS, MAXLENGTH, MINDISTANCE, PSPACESIZE) as input. VERSION is a constant
of the implementation.

> AMBIGUITY: `CURLINE` meaning. "Absolute position of this line within the source code" could mean a
> source text line number or an instruction offset. Recommendation (pMARS): the 0-based **instruction
> offset** of the instruction being assembled (the number of instructions emitted before it, after
> FOR expansion). In non-instruction contexts (EQU value at definition time, `assert`), use the number
> of instructions emitted so far.

> AMBIGUITY: `VERSION` value. Recommendation: an integer of the form `major*100 + minor*10 + patch`
> (pMARS style, e.g. `100` for 1.0.0), stated in the implementation's docs.

> AMBIGUITY: Name clashes and case. Recommendation: special constant names are reserved, upper case
> and case-sensitive. A label or EQU with the same name is a parse error.

### 9.4 `assert`

> Note from the docs: "this feature is not yet implemented within corewar.io".

- Lets a warrior state the environment it expects. It is written as a **comment directive**:

  ```
  ;assert CORESIZE==8000
  ```

  This stops the warrior from being parsed and loaded into a core of any size other than 8000.
- Operators allowed in the condition (verbatim table):

| Operator | Meaning |
| --- | --- |
| + | Addition |
| - | Subtraction |
| * | Multiplication |
| / | Division |
| % | Modulo |
| == | Equal |
| != | Not equal |
| < | Less than |
| <= | Less than or equal |
| > | Greater than |
| >= | Greater than or equal |
| && | Boolean and |
| \|\| | Boolean or |
| ! | Boolean not |

- Failure (the condition evaluates to 0) → the warrior is not parsed or loaded: a parse error.

> AMBIGUITY: `assert` syntax details. Recommendation: recognise a comment whose text, after the `;`,
> starts with `assert` (case-insensitive) followed by whitespace. The rest of the comment is the
> condition. It may reference special constants and EQU constants (evaluated after all EQUs are
> known). Every `;assert` line in the file must pass. An `;assert` with an empty or unparsable
> condition is a parse error. A plain comment that merely contains the word "assert" later in its text
> is not an assert.

### 9.5 `FOR` / `ROF`

> Note from the docs: "this feature is only partially implemented within corewar.io - FOR loops can
> be used but nested FOR loops and label references are not yet supported". This implementation
> should support everything described below, including nesting and label references.

- A `FOR` block makes the parser output the redcode inside it several times. It saves manual
  duplication and helps with padding.
- Syntax: `FOR <count>` starts the block, `ROF` ends it, and the contents are repeated `<count>`
  times.

  ```
  FOR 10
  dat.f $1, $2
  ROF
  ```

  produces ten copies:

  ```
  dat.f $1, $2
  dat.f $1, $2
  dat.f $1, $2
  dat.f $1, $2
  dat.f $1, $2
  dat.f $1, $2
  dat.f $1, $2
  dat.f $1, $2
  dat.f $1, $2
  dat.f $1, $2
  ```

- **A label in front of FOR, referenced inside the block** (docs example): each repetition emits a
  different number, because each emitted instruction is further from the label.

  ```
  label FOR 4
  dat.f $1+label, $1-label
  ROF
  ```

  Docs output:

  ```
  dat.f $1, $1
  dat.f $0, $2
  dat.f $-1, $3
  dat.f $-2, $4
  ```

  (Here `label` is the address of the first emitted instruction: relative value 0, -1, -2, -3.)

- **Nesting** is allowed:

  ```
  FOR 2
  FOR 3
  dat.f $1, $2
  ROF
  ROF
  ```

  becomes six copies:

  ```
  dat.f $1, $2
  dat.f $1, $2
  dat.f $1, $2
  dat.f $1, $2
  dat.f $1, $2
  dat.f $1, $2
  ```

- **`&` concatenation**: inside a FOR block, `&` appends the loop counter to a label declaration:

  ```
  i FOR 3
  loop&i dat.f $1, $1
  ROF
  ```

  becomes:

  ```
  loop01 dat.f $1, $1
  loop02 dat.f $1, $1
  loop03 dat.f $1, $1
  ```

  The counter runs from **1** to the count and is written as **two digits, zero-padded** (`01`, `02`,
  ...).

- A `FOR` with count **0** removes its whole block. This is used for multi-line comments
  (`(comments)`).

> AMBIGUITY: Meaning of a name in front of `FOR`. The docs use it two incompatible ways. In
> `label FOR 4` it is an **address label** (value = the first emitted instruction's address). In
> `i FOR 3` it is the **loop counter variable** used by `&i`. Under the counter reading, the first
> example's output would be `$2, $0` / `$3, $-1` / `$4, $-2` / `$5, $-3`, not the documented values.
> Recommendation (pMARS, which defined FOR/ROF): the **last** name before `FOR` is the loop counter
> variable. It is in scope only inside the block, where it evaluates to the current iteration
> (1-based) and can be concatenated with `&`. Any earlier names on the line are ordinary address
> labels for the first emitted instruction. Write the fixture for the `label FOR 4` example with
> `label` on its own line before `FOR 4`. That reproduces the documented output under either reading.
> (pMARS 0.9.5 differs here: it joins a label-only line to the `FOR` line, so `label` becomes the
> counter and the output is `$2, $0` / `$3, $-1` / ... . We keep the documented output, since 8.4
> explicitly binds label-only lines to the next instruction.) Test the counter reading with the `loop&i`
> example and with `i FOR 3` / `dat i, 0` → `DAT.F $1, $0`, `DAT.F $2, $0`, `DAT.F $3, $0`.

> AMBIGUITY: Counter formatting for `&` past 99. Recommendation: pad to at least two digits (`01` ..
> `99`, `100`, ...).

> AMBIGUITY: Labels declared inside a FOR block without `&`. Each repetition would redeclare the same
> label. Recommendation: a duplicate-label parse error (pMARS-compatible), unless `&` makes the names
> unique.

> AMBIGUITY: FOR count. Recommendation: any expression that can be evaluated at the point of the `FOR`
> (numbers, EQU constants, special constants, and labels already defined *before* the FOR). A
> negative count is treated as 0. A count that refers to a forward label is a parse error. Lines
> inside a `FOR 0` block are not tokenised or validated (they may contain arbitrary prose). `FOR`
> and `ROF` match case-insensitively.

> AMBIGUITY: Nested-loop counters. Recommendation: each nesting level may have its own counter name.
> An inner counter with the same name as an outer one shadows it inside the inner block.

---

## 10. `ORG` and `END` `(org)`

- By default, a warrior starts at its **first instruction** (start offset 0).
- `ORG <address>` sets a different starting address. It should be written **on its own line**,
  followed by an address giving the start **relative to the first address in the warrior**.
- By convention, `ORG` is placed at the top of the warrior.

  ```
  ORG 1
  dat #4, #0
  add.ab -1, -1
  ```

  This starts the warrior at the `add` instead of the `dat`.
- `ORG` was introduced in ICWS'94. Earlier standards used `END <address>`, which works the same way
  but is placed at the **end** of the warrior:

  ```
  dat #4, #0
  add.ab -1, -1
  END 1
  ```

- `END` and `ORG` are **semantically equivalent**; either can be used.
- The address may be a label (`ORG top` → `ORG 1` in the `(preprocessor)` dwarf example). A label used
  in `ORG`/`END` resolves to its **absolute offset from the warrior's first instruction**, not to an
  offset relative to the directive's line (Derived from that example).

### 10.1 Parser warnings

- If **both** `ORG` and `END` give a start address, `ORG` determines it.
- If **several** `ORG` or `END` directives are present, the **last** one is used, with `ORG` taking
  precedence over `END`.
- Both cases produce a **parser warning**.

Resolution algorithm (Derived):

```
if any ORG has an address: start = address of the last ORG; else
if any END has an address: start = address of the last END; else
start = 0
warn if (count(ORG) + count(END with address)) > 1
```

> AMBIGUITY: `END` with no operand. Recommendation (ICWS'94): a bare `END` marks the end of the source
> and sets no start address. It does not count toward the "both"/"multiple" warnings.

> AMBIGUITY: Text after `END`. Recommendation (ICWS'94 / pMARS): the parser stops at the first `END`.
> Later lines are ignored (not parsed, so they cannot cause errors). A later `ORG` after `END` is
> therefore ignored too.

> AMBIGUITY: Start address out of range. The docs are silent.
> Decision (lead's divergence rule, checked against pMARS 0.9.5): follow pMARS. Issue a warning and
> keep the start as written; the load file's `ORG` may then lie outside `[0, length)` (a negative one
> folds into the core), and the first process starts at load address + start, outside the warrior's
> code. (An earlier version reduced it modulo the length; pMARS does not.)

---

## 11. Comments `(comments)`

- A `;` starts a single-line comment. The parser ignores everything from the `;` to the end of the
  line and leaves it out of the parsed output.
- A `;` at the start of a line comments out the whole line. This is handy for disabling code while
  debugging.

  ```
  mov 0, 1
  ; this is a comment
  add 3, 4   ; this is also a comment
  ;jmp -1 this line of code has been commented out and will not be included in the parsed output
  ```

  Docs output (comments removed completely):

  ```
  mov.i $0, $1
  add.ab $3, $4
  ```

  (Under the table defaulting of 7.4, the second line is `ADD.F $3, $4`.)
- **Multi-line comments**: use a `FOR` block with a count of zero. The whole block is removed during
  parsing:

  ```
  FOR 0
  This is a multi-line comment
  It is a good place to explain a complex strategy
  or subtle nuance of the warrior's code
  ROF
  ```

- Exceptions: metadata comments (section 12) and `;assert` (9.4) are comments that the parser
  interprets.

> AMBIGUITY: A `ROF` keyword inside a `FOR 0` comment block. Recommendation: the block ends at the
> first line whose first token is `ROF` at the same nesting depth (counting nested `FOR`s), so prose
> lines must not start with `FOR` or `ROF`.

---

## 12. Metadata `(metadata)`

Certain comments carry information about the warrior. The parser recognises them and **keeps them in
the parsed output**, but they are **not loaded into core**.

### 12.1 `;redcode-94`

- Says the warrior is written in ICWS'94-compliant redcode.
- Earlier standards had no standard way to declare the redcode version. The parser also supports
  `;redcode-88` and `;redcode-86`.
- When it outputs a parsed warrior, the parser emits a standards comment matching the standard the
  redcode was built to.

### 12.2 `;name`

- Gives the warrior a name, e.g. `;name imp`.
- If no name comment is present, the parser inserts the default `;name Nameless`.

### 12.3 `;author`

- Names the warrior's author.
- Default: `;author Blameless`. (Future versions may fill in the user's name; out of scope.)

### 12.4 `;strategy`

- A publicly visible, high-level description, e.g. `;strategy A stone imp`.
- Several `;strategy` lines together form a multi-line strategy:

  ```
  ;strategy This is a longer strategy which is 
  ;strategy broken down into three successive
  ;strategy lines
  ```

> AMBIGUITY: Recognition syntax. Recommendation: a metadata comment is a line whose first non-blank
> character is `;`, immediately followed (no space) by the keyword (`redcode`, `name`, `author`,
> `strategy`, `assert`), matched case-insensitively. For `name`/`author`/`strategy`/`assert` the
> keyword must be followed by whitespace or the end of the line. The value is the rest of the line
> with leading and trailing whitespace trimmed. `; name x` (with a space) is an ordinary comment.

> AMBIGUITY: `;redcode` variants and their effect. Recommendation:
>
> - Recognise `;redcode`, `;redcode-94`, `;redcode-88`, `;redcode-86`, with any trailing text allowed
>   (pMARS accepts e.g. `;redcode-94 verbose`).
> - With no `;redcode` line, the standard is 94.
> - Because ICWS'94 is a superset, parse every input with the '94 grammar whatever the declared
>   standard, and only use the declared standard to choose the emitted comment.
> - Bare `;redcode` means 94.
> - If several appear, the first wins.
> - Do not implement pMARS's "ignore everything before `;redcode`" rule unless a later spec asks for
>   it.

> AMBIGUITY: Repeated `;name`/`;author`. Recommendation: the last one wins.

> AMBIGUITY: Multi-line strategy. Recommendation: join the `;strategy` values in source order with
> `\n`, and emit one `;strategy` line per source line.

> AMBIGUITY: Output order. Recommendation: in the parsed output, emit `;redcode-<std>`, then
> `;name <name>`, then `;author <author>`, then each `;strategy` line, then `ORG n`, then the
> instructions.

---

## 13. Recommended parse pipeline (Derived)

This is not a doc requirement. It is one order of operations that satisfies every rule above.

1. Split the input into lines and record 1-based line numbers.
2. Extract metadata and `;assert` comments, then strip all other comments (`;` to end of line).
3. If an `END` line is found, drop every later line.
4. Expand `FOR`/`ROF` blocks recursively: substitute counters, apply `&` concatenation, and drop
   count-0 blocks without validating them.
5. Collect `EQU` definitions as token lists, and reject duplicates and cycles.
6. Tokenise each remaining line into labels, opcode[.modifier], and operands (mode + expression
   tokens). Validate opcodes, modifiers, modes and operand count. Assign instruction addresses, and
   bind labels to addresses.
7. Insert default operands and modes (sections 3 and 7.2).
8. Evaluate each operand expression: EQU substitution, then labels → `labelAddr − instrAddr`, special
   constants, then arithmetic.
9. Insert the default modifier (7.4), using the final modes.
10. Resolve the start address from `ORG`/`END` (section 10) with label values as absolute offsets.
11. Evaluate `;assert` conditions.
12. Enforce `MAXLENGTH`.
13. Emit warnings and errors with line numbers.
14. Produce the load file: metadata, `ORG`, then instructions.

---

## Definition of Done checklist

Where a doc example conflicts with an AMBIGUITY recommendation, the item states the recommended
behaviour and says which doc example it overrides.

### Overview and operands

- [ ] `mov 0, 1` parses to `MOV.I $0, $1` (index)
- [ ] Every parsed instruction has opcode, modifier, A mode, A number, B mode and B number (parser)
- [ ] Modifiers and addressing modes are optional in source; defaults are inserted (index)
- [ ] `mov.i $1, #2` parses with A mode `$`, A number 1, B mode `#`, B number 2 (operands)
- [ ] An operand with no mode gets `$` (operands)
- [ ] `dat 7` → `DAT.F #0, $7` (A operand `#0` inserted for `dat`) (opcodes, per AMBIGUITY)
- [ ] `jmp 5` → `JMP.B $5, $0` (opcodes)
- [ ] `spl 3` → `SPL.B $3, $0` (opcodes)
- [ ] `nop 8` → `NOP.F $8, $0` (opcodes)
- [ ] A single operand is accepted only for `dat`, `jmp`, `spl`, `nop`; any other single-operand opcode is a syntax error (parser)
- [ ] An ICWS'88-style warrior (no modifiers, `$#@<` modes, `END n`) parses and runs correctly (index)

### Opcodes: parsing

- [ ] All 17 opcodes are accepted: `dat mov add sub mul div mod jmp jmz jmn djn cmp seq sne slt spl nop` (opcodes)
- [ ] Opcodes are matched case-insensitively (`mov` and `MOV`) (opcodes, per AMBIGUITY)
- [ ] An unknown opcode is a parse error (parser, per AMBIGUITY)
- [ ] `cmp` executes identically to `seq` for every modifier (opcodes)

### Opcodes: execution

- [ ] `dat` removes the executing process from the queue (opcodes)
- [ ] `dat` evaluates its operands before terminating: executing `DAT.F 1, <1` changes the next `DAT.F 1, 1` to `DAT.F 1, 0` (opcodes)
- [ ] `mov` copies per modifier: `.a`, `.b`, `.ab`, `.ba`, `.f`, `.x`, and `.i` (whole instruction) as in 4.5 (opcodes, modifiers)
- [ ] `add` computes `(D + S) mod CORESIZE` per modifier as in the 4.6 table (opcodes)
- [ ] `sub` computes `(D − S) mod CORESIZE`, normalised non-negative, per modifier (opcodes, per AMBIGUITY)
- [ ] `mul` computes `(D * S) mod CORESIZE` per modifier (opcodes)
- [ ] `add/sub/mul/div/mod` with `.i` behave exactly like `.f` (opcodes, modifiers)
- [ ] `.x` on arithmetic pairs `S.a` with `D.b` and `S.b` with `D.a` (modifiers)
- [ ] `div` stores `floor(D / S)` (destination divided by source) per modifier (opcodes)
- [ ] `mod` stores `D % S` per modifier (opcodes)
- [ ] `div`/`mod` with a zero divisor terminate the process after operand evaluation (opcodes)
- [ ] `div.f`/`.x`/`.i` with one zero divisor still write the non-zero-divisor result, then terminate (opcodes, per AMBIGUITY)
- [ ] `jmp` jumps to the A pointer whatever the modifier (opcodes)
- [ ] `jmp` still evaluates its B operand (e.g. `jmp 0, <1` decrements the next instruction's B number) (opcodes)
- [ ] `jmz` tests fields per the table: `.a`/`.ba` → A, `.b`/`.ab` → B, `.f`/`.x`/`.i` → both (opcodes)
- [ ] `jmz.f` jumps only for `dat 0, 0` among the four documented cases (opcodes)
- [ ] `jmn` with one field jumps if that field is non-zero (opcodes)
- [ ] `jmn.f`/`.x`/`.i` jump if **either** field is non-zero (overrides the doc example in which `dat 0, 1` and `dat 1, 0` do not jump) (opcodes, per AMBIGUITY)
- [ ] `djn` decrements the selected field(s) in core after operand evaluation and before the test (opcodes)
- [ ] `djn.f` with a destination of `dat 1, 1` → becomes `0, 0`, no jump; `dat 0, 0` → becomes `-1, -1`, jumps (opcodes, per AMBIGUITY)
- [ ] `djn.b` on a destination B number of 1 → 0, no jump; 2 → 1, jumps (opcodes)
- [ ] `seq` skips (PC+2) when the selected values are equal, per the 4.11 table (opcodes)
- [ ] `seq.i` does not skip when the instructions differ only by opcode, modifier, or an addressing mode (opcodes)
- [ ] `sne` is the exact negation of `seq` for every modifier (opcodes)
- [ ] `slt` skips when source < destination per the slt table; `.x` compares `S.a<D.b` and `S.b<D.a` (opcodes)
- [ ] `slt.f`/`.i` do not skip if either source number is ≥ its destination number (opcodes)
- [ ] `slt` compares normalised unsigned values (`-1` compares as `CORESIZE-1`) (opcodes, per AMBIGUITY)
- [ ] `spl` creates a new process at the A pointer, queued after the current process; the documented `a: spl c / b: jmp 0 / c: jmp 0` example executes `a`, `b`, `c` in that order (opcodes)
- [ ] `spl` ignores its modifier (opcodes)
- [ ] `nop` does nothing but still evaluates its operands and takes one cycle (opcodes)
- [ ] `jmp`, `spl` and `nop` behave identically under all seven modifiers (opcodes, modifiers)

### Modifiers

- [ ] All seven modifiers `.a .b .ab .ba .f .x .i` are accepted, case-insensitively (modifiers)
- [ ] An unknown modifier is a parse error (modifiers, per AMBIGUITY)
- [ ] An explicit modifier in source is never replaced by a default (parser)

### Default modifiers

- [ ] `dat` with any modes → `.f` (parser)
- [ ] `mov`/`cmp`/`seq`/`sne` with A `#` → `.ab`; A non-`#` and B `#` → `.b`; otherwise `.i` (parser, per AMBIGUITY for seq/sne)
- [ ] `add/sub/mul/div/mod` with A `#` → `.ab`; A non-`#` and B `#` → `.b`; otherwise `.f` (`add 3, 4` → `ADD.F $3, $4`, overriding the `(comments)` example) (parser, per AMBIGUITY)
- [ ] `slt` with A `#` → `.ab`; otherwise `.b` (parser)
- [ ] `jmp jmz jmn djn spl` → `.b` with any modes (parser)
- [ ] `nop` → `.f` (opcodes, per AMBIGUITY)
- [ ] Modes `*` and `}` count as "non-`#`" in the defaulting table (parser, per AMBIGUITY)
- [ ] The default modifier is computed from the modes after the default modes are inserted (parser)

### Addressing modes

- [ ] All eight modes `# $ * @ { } < >` parse (addressing_modes)
- [ ] `#` resolves to the executing instruction (offset 0); `mov.i #123, $1` behaves like an imp (addressing_modes)
- [ ] `$` resolves to `PC + n`; `mov.i $0, $1` is an imp (addressing_modes)
- [ ] `*` uses the intermediate instruction's A number, relative to the intermediate; the documented `mov.i *1, $2` example overwrites the third instruction with `jmp 0` (addressing_modes)
- [ ] `@` uses the intermediate's B number; the documented dwarf drops bombs every 4 addresses (addressing_modes)
- [ ] `{` decrements the intermediate's A number before use; `mov.i {1, $1` over `dat $0, $0` leaves `dat $-1, $0` and uses the `mov` as the source (addressing_modes)
- [ ] `}` increments the intermediate's A number after use; the documented `mov.i }1, $1` example leaves the core unchanged (addressing_modes)
- [ ] The Source Register copy is taken before the post-increment is applied (addressing_modes)
- [ ] `<` decrements and uses the intermediate's B number before use (addressing_modes)
- [ ] `>` uses and then increments the intermediate's B number (addressing_modes)
- [ ] The A operand (including its post-increment) is evaluated before the B operand (addressing_modes, per AMBIGUITY)
- [ ] Increment and decrement results are normalised mod CORESIZE (addressing_modes, per AMBIGUITY)

### Parser defaults and output

- [ ] The parser removes whitespace and comments from the output (parser)
- [ ] The default mode is `$` for every opcode including `dat` (`bmb dat 5, 5` → `DAT.F $5, $5`, overriding the `(parser)`, `(labels)` and `(preprocessor)` `#` examples) (parser, per AMBIGUITY)
- [ ] Output format is `OPCODE.MOD <m><n>, <m><n>`, upper case, with signed relative numbers (parser, per AMBIGUITY)
- [ ] A missing B operand for `mov`, `add`, `sub`, `mul`, `div`, `mod`, `jmz`, `jmn`, `djn`, `cmp`, `seq`, `sne`, `slt` is a syntax error (parser)
- [ ] Diagnostics carry severity, line number and message; warnings do not block a successful parse (parser, per AMBIGUITY)

### Labels

- [ ] Labels matching `[A-Za-z_][A-Za-z0-9_]*` are accepted; `lbl`, `_Label`, `a123:`, `my_label:`, `b_13_` all declare labels (labels)
- [ ] A label starting with a digit is not accepted as a label (labels)
- [ ] An optional trailing `:` is not part of the label name (labels)
- [ ] Label references resolve to `labelAddress − currentAddress`; the `bmb`/`top` example yields `ADD.AB $-1, $-1`, `MOV.I $-2, @-2`, `JMP.B $-2, $0` (labels)
- [ ] Forward references resolve (labels, preprocessor)
- [ ] Several labels may name one address, on separate lines (`label:` / `another:` / `mov 0, 1`) or on one line (labels)
- [ ] Label names are case-sensitive (labels, per AMBIGUITY)
- [ ] An undefined label is an error; a duplicate label is an error (labels, per AMBIGUITY)
- [ ] Inserting an instruction between a labelled `dat` and a `mov` that references it keeps the `mov` pointing at the `dat` (labels)

### EQU

- [ ] `name EQU value` defines a constant; names follow the label rules (preprocessor)
- [ ] The `step EQU 3044` dwarf (with `dat #step, #step`) parses to `ORG 1`, `DAT.F #3044, #3044`, `ADD.AB $-1, $-1`, `MOV.I $-2, @-2`, `JMP.B $-2, $0` (preprocessor)
- [ ] `mybmb EQU bmb` makes `mybmb` resolve exactly like `bmb` at each use site (preprocessor)
- [ ] EQU values may be numbers, labels, special constants or expressions (preprocessor)
- [ ] EQU uses plain text substitution: `x EQU 1+2` then `x*2` → 5 (preprocessor, per AMBIGUITY)
- [ ] A constant redefinition or a cyclic EQU is an error (preprocessor, per AMBIGUITY)
- [ ] EQU lines produce no output instruction (preprocessor)

### Expressions

- [ ] `+ - * / %` are supported in operands and EQU values (preprocessor)
- [ ] `5+2*3` evaluates to 11 (preprocessor)
- [ ] Parentheses control order: `add (4/2-1)*5, 1` has A number 5 (preprocessor)
- [ ] `myconst EQU (1+2)/2` gives 1 (preprocessor)
- [ ] Expression division truncates toward zero (`-7/2` → `-3`) (preprocessor)
- [ ] Labels in expressions: `mov bmb, bmb+1` two lines after `bmb` → `MOV.I $-2, $-1` (preprocessor)
- [ ] Unary minus works (`jmp -2`, `$-1`) (preprocessor, per AMBIGUITY)
- [ ] `%` has the same precedence as `*` and `/`; binary operators are left-associative (preprocessor, per AMBIGUITY)
- [ ] Division or modulo by zero in an expression is a parse error (preprocessor, per AMBIGUITY)
- [ ] A mode character is recognised only at the start of an operand (`$1*2` → mode `$`, value 2; `*1` → mode `*`) (preprocessor, per AMBIGUITY)

### Special constants and assert

- [ ] `CORESIZE`, `MAXCYCLES`, `MAXPROCESSES`, `WARRIORS`, `MAXLENGTH`, `CURLINE`, `MINDISTANCE`, `VERSION`, `PSPACESIZE` resolve to their values from the parser's settings input (preprocessor)
- [ ] `CURLINE` gives the 0-based instruction offset (preprocessor, per AMBIGUITY)
- [ ] `;assert CORESIZE==8000` passes with CORESIZE 8000 and fails parsing with any other value (preprocessor)
- [ ] Assert supports `+ - * / % == != < <= > >= && || !` with C semantics (preprocessor)

### FOR / ROF

- [ ] `FOR 10` / `dat.f $1, $2` / `ROF` emits ten identical instructions (preprocessor)
- [ ] Nested `FOR 2` / `FOR 3` emits six instructions (preprocessor)
- [ ] `i FOR 3` / `loop&i dat.f $1, $1` / `ROF` declares labels `loop01`, `loop02`, `loop03` (preprocessor)
- [ ] The loop counter is usable in expressions inside the block (`i FOR 3` / `dat i, 0` / `ROF` → A numbers 1, 2, 3) (preprocessor, per AMBIGUITY)
- [ ] A label on its own line before `FOR 4` / `dat.f $1+label, $1-label` / `ROF` gives `$1,$1`, `$0,$2`, `$-1,$3`, `$-2,$4` (preprocessor)
- [ ] `FOR 0 ... ROF` removes its contents without validating them (comments, preprocessor)
- [ ] `ROF` without `FOR`, and `FOR` without `ROF`, are errors (preprocessor, per AMBIGUITY)
- [ ] FOR/ROF lines produce no output themselves (preprocessor)

### ORG / END

- [ ] With no ORG/END the start offset is 0 (org)
- [ ] `ORG 1` before `dat #4, #0` / `add.ab -1, -1` starts at the `add` (org)
- [ ] `END 1` after the same two instructions also starts at the `add` (org)
- [ ] `ORG top` resolves the label as an absolute offset from the warrior's start (`ORG 1` in the dwarf) (org, preprocessor)
- [ ] When both ORG and END are present, ORG wins and a warning is issued (org)
- [ ] With several ORG/END directives, the last is used (ORG over END) and a warning is issued (org)
- [ ] Lines after `END` are ignored (org, per AMBIGUITY)
- [ ] An out-of-range start is warned about and kept, so execution starts outside the code (org, per AMBIGUITY)

### Comments

- [ ] Everything from `;` to end of line is removed (comments)
- [ ] The documented comment example produces exactly two instructions: `MOV.I $0, $1` and `ADD.F $3, $4` (the docs show `add.ab`; overridden per the 7.4 AMBIGUITY) (comments)
- [ ] A commented-out instruction (`;jmp -1 ...`) is not emitted (comments)
- [ ] A multi-line comment via `FOR 0 ... ROF` is removed entirely (comments)

### Metadata

- [ ] `;redcode-94`, `;redcode-88`, `;redcode-86` are recognised, and the output carries a `;redcode-<std>` comment matching the standard (metadata)
- [ ] `;name imp` sets the name; with no `;name` the output contains `;name Nameless` (metadata)
- [ ] `;author X` sets the author; with no `;author` the output contains `;author Blameless` (metadata)
- [ ] Several `;strategy` lines form a multi-line strategy in source order (metadata)
- [ ] Metadata appears in the parsed output but is not loaded into core (metadata)
- [ ] `; name x` (space after `;`) is an ordinary comment (metadata, per AMBIGUITY)
