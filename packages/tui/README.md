# Corewar TUI

The terminal front end for the engine. Start it with `bun run start` from the project root.

To keep `warriors/` somewhere else (for example a temporary directory while you try the editor), set `COREWAR_WARRIORS_DIR`:

```
COREWAR_WARRIORS_DIR=/path/to/dir bun run start
```

## Layout

```
 COREWAR  ● Dwarf 1p 0w  ● Imp 1p 0w        cycle 7,300/80,000 · round 2/10 · speed 100/f  ▶ RUNNING
┌─CORE 4000──────────────────────────────────────────────────────────────────────────────────────┐
│ the core, row-major: address 0 at the top left                                                 │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
 space run/pause  . step  - slower  + faster  r restart  w warriors  n New        ? help  q quit
```

- **Header.** Each warrior shows its colour, name, process count (`p`) and rounds won (`w`); `▶` replaces the dot of the warrior that moves on the next step. When the names do not fit, they are left out; the picker (`w`) shows which colour is which. If the warriors still do not fit, click `‹` and `›` to page through them. The header also shows the cycle, the round, the speed in cycles per frame, and the state. Click the state to run or pause.
- **Board.** The board shows one core address per cell. Untouched cells are grey `·`. An executed cell is a solid block `█` in the warrior's colour. A written cell is `×`, and a read cell is a dim `·`. The cell executed last is a white block. The instruction that runs on the next step is a white `■` on the warrior's colour, and the header shows `▶` before that warrior's name. Each other warrior's next instruction is a white `▪` on a dim tint of its colour. The board picks a mode from the core size and the terminal size:
  - `wide`: one address uses two columns, a one-column cell and a blank gap. The board uses this mode for small cores.
  - `glyph`: one address uses one cell and the glyphs above.
  - `half`: two addresses share one cell (`▀`, top and bottom). This mode shows colour and brightness only; the instruction that runs next is a pale tint of the warrior's colour. If the core still does not fit, the board scrolls with the mouse wheel, ↑/↓ or PgUp/PgDn.

  Press `z` to switch between two views. **Fit** (the default) picks one of the modes above. **Detail** never uses `half`: when fit would pack two addresses per cell, detail shows one per cell with the glyphs and scrolls instead. The bottom border shows `zoom: detail` and the visible rows, for example `rows 4-49/51`. When the core already fits in `wide` or `glyph`, both views look the same.
- **Footer.** The footer shows key hints. Each hint is also a button. When the terminal is narrow, the less important hints are hidden first.

Click a cell, or press `Enter`, to open the inspector. The inspector shows the address, the instruction, the last access, the processes at that address, and the nearby cells. When a warrior has touched the cell, the inspector also shows that warrior's P-space as `index:value` pairs: cell 0 (the previous round's result, -1 before round 1) and the cells that are not zero. The arrow keys move the selection. Escape closes the inspector.

P-space (`LDP`, `STP`, `PIN`, see `spec/pspace.md`) persists from one round of a match to the next. `]` and the automatic next round carry it over. `r` restarts the round with the P-space as it was when the round started. A new match starts with new P-space. The P-space size follows the core size (`PSPACESIZE`, the preset's value or the pMARS default for a custom core size).

## Keys

| Key | Action |
| --- | --- |
| `space` | Run or pause |
| `.` | Step one cycle (pauses) |
| `+` / `-` | Faster / slower: 1 to 5000 cycles per frame, then `max` (time-sliced, the UI stays responsive) |
| `r` | Restart the round |
| `]` | Go to the next round |
| `w` | Warrior picker: choose 1 or more warriors and start the match (see "Warrior picker") |
| `s` | Match settings: preset, core size, maximum cycles, processes and length, minimum separation, rounds, and the cycle unit. The app's `standard` preset has a 4000-cell core; the other values and presets are the engine's. |
| `n` / `e` | New warrior / edit warrior (see "Warrior editor") |
| `f` | Fade old access marks (off by default) |
| `z` | Board zoom: fit to screen, or full detail (scrolls) |
| `Enter` | Open the inspector without the mouse, on the last inspected cell if it is on screen, else the first visible cell. The arrows move it; `Enter` again closes it. |
| `↑` / `↓` (or `PgUp` / `PgDn`) | Scroll the board when it does not fit. With the inspector open, the arrows move the selected cell instead. |
| `?` | Help, two pages: keys and the board legend, then a Redcode reference (instructions, addressing modes, modifiers, directives). `←` / `→` (or `h` / `l`) switch pages. |
| `q`, `ctrl+c` | Quit |

Escape closes the top overlay. When a modal overlay is open, the game keys and the header, footer and board clicks do nothing. Help scrolls with `↑` / `↓` (or `j` / `k`) or PgUp/PgDn when the terminal is too short to show it all; switching pages goes back to the top. A key that an overlay acts on is consumed, so a key that opens the editor (`n` or `e`, on the main screen or in the picker) is never typed into it.

## Warrior picker

Press `w` to list every warrior: `warriors/`, `examples/` and the built-in samples, each with its parse status. Warriors in the current match are preselected.

Pick a single warrior to test it on its own. A solo round ends when the warrior dies or reaches the cycle limit, and the state shows `DIED` or `SURVIVED`.

| Key | Action |
| --- | --- |
| `↑` / `↓` (or `k` / `j`) | Move the highlight |
| `space` or click a row | Toggle the warrior |
| `enter` or **Start match** | Start a match with the chosen warriors (1 or more) |
| `n` or **+ New warrior** | New warrior in the editor |
| `e` or **Edit** | Edit the highlighted warrior |
| `d`, `Delete` or **Delete** | Delete the highlighted warrior |

Delete asks first, in the picker: `Delete warriors/my-imp.red? y/n`. `y`, `enter` or **Yes, delete** confirms; `n`, `esc` or **Cancel** cancels. Delete rules (`WarriorLibrary.delete` in `library.ts`):

- **Nothing is unlinked.** The file moves into a `.trash/` folder in its own directory: `warriors/my-imp.red` goes to `warriors/.trash/my-imp.red`, and its `.bak`, if there is one, goes with it. If the trash already has that name, the moved file gets a timestamp suffix (`my-imp-20261014T153012.red`). To restore a warrior, move it back out of `.trash/`.
- **Where.** Files in `warriors/` (or `COREWAR_WARRIORS_DIR`) and `examples/`. Built-in samples are read-only: the Delete button is greyed out and `d` says so.
- **Hidden files.** The picker lists only `.red` files, so `.trash/` and `.bak` files never show up.
- **The current match.** A deleted warrior in the current match keeps playing from its loaded copy until you pick a new match: `r`, rematch and new settings still work. After new settings the status says `warriors/my-imp.red deleted; playing the loaded copy`. The picker no longer lists it, so the next match you start doesn't include it.

The status line then says `deleted warriors/my-imp.red (moved to warriors/.trash)`.

## Warrior editor

Click **New** in the footer (or press `n`) to write a new warrior. Press `e`, or use Edit in the warrior picker, to change an existing one. The editor opens with a starter dwarf for a new warrior, or with the warrior's source.

- Type in the text area. All keys go to the editor, so the game keys do nothing.
- The status line under the text shows the parse result about 150 ms after you stop typing: `✓ 4 instructions`, or the first error with its line and column (`✗ line 3:5 ...`) and the number of other errors. Warnings show in yellow. Lines with errors have a red background.
- Redcode is highlighted: opcodes, modifiers, addressing modes, numbers, labels, comments and `;name`-style metadata.

| Key | Action |
| --- | --- |
| `ctrl+s` or the **Save** button | Save |
| `esc` or the **Close** button | Close. With unsaved changes, the first press asks and the second press discards them. |
| `ctrl+z` / `ctrl+y` (or `ctrl+shift+z`) | Undo / redo |
| `ctrl+c` | Quit. With unsaved changes, the first press asks. |
| `F2` or the **F2 vim keys** footer button | Vim keys on or off (see "Vim keys") |
| `F3` or the **F3 relative numbers** footer button | Relative numbers on or off (see "Line numbers") |
| `F4` or the **F4 format on save** footer button | Format on save, auto-indent and space snapping on or off (see "Format on save") |
| `F5` or the **F5 autocomplete** footer button | Autocomplete on or off (see "Autocomplete") |

When the panel is too narrow for the full toggle labels, the footer shortens them from the right (`F5 auto: on`, `F4 fmt: on`, `F3 rel: on`, `F2 vim: on`), then shows only the key and its state (`F5 on`).

### Line numbers

Relative numbers are on by default. The gutter then shows cell offsets, not line numbers:

- A line that assembles to one instruction shows its offset from the cursor line's instruction, with a sign: `-1`, `+2`. This is the number you type as an operand on the cursor line to refer to that line.
- The cursor line shows `▸` and its own source line number and the whole line is highlighted. Use it to find the lines that diagnostics refer to.
- Lines that do not make a cell have no number: comments, blank lines, labels on their own line, `;name`-style lines, `EQU`, `ORG`, `END`, and all lines after `END`.
- If the cursor line makes no cell, the offsets count from the next instruction below it (or from the last instruction, at the end of the file). That instruction shows `0`.
- `FOR … ROF`: a line in the block makes one cell for each repetition, so it has no number. Lines after the block count the full expansion (`FOR 3` around 2 lines adds 6 cells). If the cursor is in the block, the offsets count from its first repetition.
- When the source parses, the offsets come from the parser's instruction positions. When it has errors, the editor guesses: a line makes a cell if its first opcode (after any labels) is an instruction. `FOR` with a plain number is expanded. After a `FOR` the guess cannot expand (a count expression, or nested blocks), no lines have numbers.

With relative numbers off, the gutter shows the source line numbers. In both modes, lines with errors have a red background.

### Autocomplete

Autocomplete is on by default. While you type the opcode of a line, a box next to the cursor lists the opcodes and directives that start with what you typed, one per line, with their operands and meaning (the same text as the Redcode page of Help):

```
loop    j  jmp A      jump to A
           jmz A, B   jump to A if B is zero
           jmn A, B   jump to A if B is not zero
```

The box has no border: it is a block of a slightly lighter background, one row per match, with one space each side of the text. The highlighted match has a brighter background.

- The opcode is the first word of the line, or the second word when the first is a label (any word that is not an opcode). There is no box in operands, comments or modifiers (after the `.`), in the middle of a word, or when the word is already complete and the only match (`jmp`).
- The list holds every opcode, including `nop`, `ldp` and `stp`, and the directives `org`, `end`, `equ`, `for`, `rof` and `pin`. Matching ignores case. The completion is upper case if you typed upper case, and lower case otherwise.
- `↑` / `↓` move the highlight. `tab` replaces the typed letters with the highlighted match and adds a space, unless a space or tab follows already.
- `esc` closes the box. With vim keys, the same press also leaves insert mode. `enter` is not taken: it starts a new line, which closes the box.
- Typing more letters narrows the list. Moving the cursor, clicking elsewhere, or deleting the typed letters closes the box. While the box is closed, `↑`, `↓` and `tab` work as before.
- With vim keys, the box appears only in insert mode.
- The box opens just right of the cursor (after the cursor's cell), with its first entry on the cursor row, and stays inside the text area. When it would run past the right edge of the panel, it opens left of the word. When neither side has room, it opens below the cursor row (or above it). It floats over the text, so nothing moves.
- Undo: `ctrl+z` removes a completion in one step. With vim keys, the completion is part of the insert, so `u` undoes the whole insert and `.` repeats it, completion included.

### Format on save

Format on save is on by default. When you save (`ctrl+s`, **Save**, `:w`, `:wq` or `:x`), the editor first lays out the source in one standard style, puts the result in the text area, and then writes the file:

```
loop    mov     bomb, >bomb     ; trailing comment
        djn     loop, #4
bomb    dat     #0, #1
        end
```

- Three columns: labels, the opcode (or directive), and the operands. Each column is as wide as its longest entry plus two spaces, and at least 8 characters. The editor calculates the widths again for each file.
- Opcodes, modifiers and directives become lower case (`MOV.I` becomes `mov.i`). The formatter never adds a modifier, an addressing mode or an operand.
- The operands keep their text as written, with `, ` between the A and B operand. Label case and expressions do not change.
- `EQU`, `FOR`, `ROF`, `ORG`, `END` and `PIN` use the same columns as instructions.
- Full-line comments and `;name`-style lines do not change. A trailing comment starts two spaces after the code. Trailing comments on consecutive lines are aligned.
- Labels on their own line stay on their own line. Blank lines stay, but a run of three or more becomes two. Trailing spaces are removed, and the file ends with one newline.
- These parts do not change: all text after `END`, a `FOR` block whose count is not a plain positive number (`FOR 0` is a multi-line comment), and lines that the formatter does not understand, such as `&` concatenation.

Safety rules:

- The editor formats only source that parses with no errors. Source with errors is saved exactly as you typed it.
- The editor assembles the source and the formatted text with the default options. If the two warriors are different in any way (instructions, start address, `;name`, `;author` or `;strategy`, `PIN`, or the number of warnings), the editor discards the formatted text and saves the source as you typed it.
- If the formatted text is the same as the source, the text area does not change.

One undo step removes the formatting: `ctrl+z`, or `u` with vim keys. The cursor stays on the same line. If the line becomes shorter, the cursor moves to the end of the line. The formatter is `formatRedcode` in `packages/engine/parser/format.ts`, and the safe version is `formatRedcodeSafely`.

#### Auto-indent

While format on save is on, the editor also indents new lines to the opcode column:

- `enter` (also in vim insert mode) and vim's `o` and `O` start the new line with spaces. The nearest code line above sets the width: blank lines and comment-only lines are skipped. If that line has an opcode or directive, the new line lines up with it (a tab counts as its display width). Otherwise, or if there is no code line above, the new line uses the column that format on save puts opcodes in: 8, or the longest label plus two.
- `backspace` on a line that holds only spaces or tabs, with the cursor at its end, deletes all of them in one press, so you can start a label in column 0.
- `ctrl+z` removes a new line and its indent in one step. With vim keys, the indent is part of the insert, so `.` repeats it.
- With format on save off, `enter` and `backspace` work as before.

#### Space snapping

While format on save is on, `space` at the end of a line can type several spaces, so a line you type already has the layout that format on save gives it:

- After a label that starts the line (the first word, in column 0, is not an opcode or directive), `space` pads to the opcode column, the same column auto-indent uses. If the label is too long for that column, `space` types two spaces.
- This also works while the completion box is open, which happens when a label begins like an opcode (`st`, `j`, `d`): `space` closes the box and snaps. `tab` still accepts the highlighted match and adds one space.
- After the opcode or directive word, with any `.modifier`, `space` pads to the column that format on save puts operands in: 8 columns past the opcode column, or the longest opcode plus two.
- Typing `bomb dat #0, #1` gives `bomb    dat     #0, #1`, and saving does not change it.
- Everywhere else `space` types one space: in operands and comments, after a word in the opcode place that is not an opcode, a second space, and before text that follows the cursor.
- `backspace` right after a snap, with no edit in between, deletes the whole gap in one press.
- Snapped spaces are normal typing for `ctrl+z`. With vim keys they are part of the insert, so `.` repeats them.

### Vim keys

Vim keys are off by default. When they are on, the editor starts in normal mode and the status line shows the mode (`NORMAL`, `-- INSERT --`, `-- VISUAL --`, `-- VISUAL LINE --`), a pending count or operator, and the `:` command line. This is a subset of vim:

| Keys | Action |
| --- | --- |
| `i` `a` `I` `A` `o` `O` | Insert mode. `esc` goes back to normal mode. |
| `v`, `V` | Visual mode and visual line mode. Motions extend the selection. `d` or `x`, `c`, `y` act on it. `p` replaces it. |
| `h` `j` `k` `l`, `w` `b` `e`, `0` `^` `$`, `gg` `G` | Motions. A count repeats them (`5j`, `3w`). `10G` goes to line 10. |
| `x`, `dd`, `yy`, `p` / `P` | Delete a character, delete a line, copy a line, paste after / before. Lines paste as lines. |
| `r` + character | Replace the character under the cursor and stay in normal mode. `3rx` replaces 3 characters, or none if the line has fewer left. In visual mode, `r` replaces every selected character. `esc` after `r` cancels. |
| `d`, `c`, `y` + motion | Delete, change or copy (`dw`, `c$`, `y2j`, `d0`, `dG`, `2dd`) |
| `iw` `aw` `iW` `aW` | Word text objects after `d`, `c` or `y`, from anywhere in the word: `ciw` changes the word, `daw` deletes it with its trailing space (or leading space at the end of a line). `W` counts everything between blanks as one word, so `ciW` changes `>bomb` too. In visual mode, `viw` selects the word. |
| `u`, `ctrl+r`, `.` | Undo, redo, repeat the last change |
| `:w`, `:q`, `:wq` or `:x`, `:q!` | Save, close, save and close, close and discard changes. `enter` runs the command and `esc` cancels it. |

- There is one unnamed register. Macros, named registers, other text objects (quotes, brackets, sentences), search, marks and `:s` are not available.
- `esc` leaves insert, visual or command mode and cancels a pending count or operator. In normal mode with nothing pending, `esc` closes the editor, like `:q`. Both ask once if there are unsaved changes, as **Close** does.
- `:w` follows the same save rules as **Save**. `:wq` closes only if the save succeeds. `:x` saves only if there are changes.
- `ctrl+s`, the buttons, mouse clicks and `ctrl+c` work as before.

### Preferences file

The app keeps the four preferences in `$XDG_CONFIG_HOME/corewar-tui/config.json`. If `XDG_CONFIG_HOME` is not set (or is not an absolute path), it uses `~/.config/corewar-tui/config.json`:

```json
{ "vimKeys": false, "relativeNumbers": true, "formatOnSave": true, "autocomplete": true }
```

The app writes the file when you toggle a preference, with an atomic write (a temporary file, then a rename). If the file is missing or corrupt, the app uses the defaults. A missing or incorrect value takes its default.

Save rules (`WarriorLibrary.save` in `library.ts`):

- **New warrior.** The file goes in `warriors/`. The file name comes from `;name`: `My Imp` becomes `my-imp.red`, and no name gives `untitled.red`. If the file exists, the next free name is used (`my-imp-2.red`). A different file is never overwritten.
- **After the first save** the editor edits that file. If you change `;name` before the next save, the file is renamed to match. This applies only to files the app created in this session.
- **A file in `warriors/` or `examples/`.** Save writes back to the same file. Before the first overwrite, the app copies the original to `<name>.red.bak`, unless a `.bak` exists already. Files the app created get no `.bak`.
- **A built-in sample.** Built-ins are read-only, so Save writes a new file in `warriors/`.
- **Parse errors.** You can save a warrior with errors as a draft. The status says `saved ... with N errors`. The picker shows the warrior as unparseable until you fix it.
- **Atomic writes.** Save writes a temporary file in the same directory and renames it over the target.

The picker reads the library again each time it opens, so a saved warrior shows up there. If the saved warrior is in the current match, the status says `r restarts with it`: `r` reads the file again and restarts the round. If the file has errors, the round restarts with the previous version.

## Files

| File | Contents |
| --- | --- |
| `main.ts` | Entry point. Creates the renderer and restores the terminal on quit, on signals, and on uncaught errors. |
| `app.ts` | Builds the screen and connects the controller, the board, the overlays, and the library. Runs the frame loop. |
| `controller.ts` | Match state, rounds, speed, and scores. Pure: it does not use OpenTUI. |
| `board.ts` | `CoreBoard` renderable and the layout calculations. |
| `theme.ts` | UI colours, warrior palette (Okabe-Ito, safe for colour-blind users), and board glyphs. |
| `keys.ts` | Key bindings. The footer and the help overlay are made from this table. |
| `prefs.ts` | Editor preferences (vim keys, relative numbers, format on save, autocomplete) and the config file. |
| `redcode-ref.ts` | One-line descriptions of the opcodes and directives, used by the Help page and the editor's autocomplete. |
| `vim.ts` | The vim keys engine. It edits through a small buffer interface, so its tests need no renderer. |
| `library.ts` | `WarriorLibrary`: `.red` files in `warriors/` and `examples/`, plus the built-in samples. `save()`, `delete()` (move to `.trash/`) and the naming helpers. |
| `ui.ts` | `SegmentText` (styled, clickable text) and `panel()`. |
| `overlays/` | `manager.ts` (overlay stack, key routing), `inspector`, `picker`, `settings`, `results`, `help`, `editor` (text area, highlighting, diagnostics, relative-number gutter, autocomplete). |

## Tests

Run `bun test packages/tui`. The controller tests use `FakeSimulator` (`test-fakes.ts`). The board and app tests use `createTestRenderer`. `app.engine.test.ts` runs a short match with the real engine. `app.editor.test.ts` drives the editor (also with vim keys, format on save, autocomplete and the preferences file), tests `completionAt` and the picker's Delete with the real parser, in a temporary directory. `vim.test.ts` tests the vim engine on a string buffer, `editor.cells.test.ts` the line-to-cell mapping, and `prefs.test.ts` the preferences file.
