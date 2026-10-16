# OpenTUI developer brief (for the Corewar TUI)

Verified on 2026-10-14 against **`@opentui/core@0.6.6`** (plus `@opentui/react@0.6.6`, `@opentui/solid@0.6.6`) under **Bun 1.4.0** on linux-x64. Every snippet marked "verified" was run in a `bun test` probe using the library's headless test renderer, and one live run went through a pseudo-TTY.

Sources: https://opentui.com/docs (renderer, interaction, keyboard, lifecycle, testing, console, frame-buffer, code, tree-sitter, troubleshooting pages), the repo https://github.com/anomalyco/opentui (the old `sst/opentui` URL points here now), and the `.d.ts` files in the npm packages. Where the docs and the type definitions disagree, the type definitions for 0.6.6 win.

## 1. Packages, binding and runtime

**Recommendation: use `@opentui/core` with the imperative API only. Pin it to `0.6.6`.**

```bash
bun add @opentui/core@0.6.6
```

- `@opentui/core` contains the renderer, Yoga layout, every widget, and the test renderer (`@opentui/core/testing`). It is a TypeScript API over a native Zig library. The prebuilt binary comes in an optional per-platform package (`@opentui/core-linux-x64`, which ships `libopentui.so`, about 5 MB), so you do **not** need a Zig toolchain.
- Runtime: **Bun >= 1.3.14** (we have 1.4.0, which works), or **Node >= 26.4.0** with ESM and `--experimental-ffi`. **Node 24 is not supported for rendering.** The import succeeds, but native FFI does not. Run the app and its tests with Bun.
- Do not `bun install --omit=optional`. That drops the native platform package, and the app then fails late.
- The bindings, `@opentui/react` (React 19) and `@opentui/solid`, are thin reconcilers over the same core renderables.

Why core over React or Solid:
- The main view is a single custom renderable that repaints about 8,000 cells many times a second. A framework adds nothing there. With React you would register the grid with `extend()` anyway and drive it through a ref, so it is core code wrapped in reconciler overhead. The docs also say `FrameBufferRenderable` is **not available in the React or Solid bindings** (you can still `extend()` it in yourself).
- The overlays (editor, warrior list, status bar, buttons) are a handful of renderables whose state changes on discrete events. Mutating properties imperatively (`status.content = ...`, `modal.visible = true`) is simple and costs nothing.
- One mental model, and one test API (`createTestRenderer`).
- If the team strongly prefers JSX for the chrome, React works. A verified probe: `testRender(<App/>, {width, height})` from `@opentui/react/test-utils`, with `useKeyboard` catching ctrl+s. In that case keep the grid as a core renderable registered with `extend({ coreGrid: CoreGrid })`, and push simulation state to it through a ref, never through React state. React tests print `act(...)` warnings when state changes from mock input.

## 2. Drawing the core grid at high frame rates

### Option A (recommended): a custom `Renderable` with `renderSelf`

The grid draws itself straight into the frame buffer each time a frame is painted. **Coordinates are screen cells**, so offset by `this.x` and `this.y`. Verified:

```ts
import { Renderable, RGBA, type OptimizedBuffer, type RenderContext,
         type RenderableOptions, type MouseEvent } from "@opentui/core"

const W = 128, H = 64                        // 8192 cells
const PALETTE = [RGBA.fromInts(20,20,20), RGBA.fromInts(200,40,40),
                 RGBA.fromInts(40,200,40), RGBA.fromHex("#4060ff")]  // preallocate, never per cell
const WHITE = RGBA.fromInts(255,255,255)

export class CoreGrid extends Renderable {
  owner = new Uint8Array(W * H)              // fed by the simulator
  constructor(ctx: RenderContext, opts: RenderableOptions<CoreGrid> = {}) {
    super(ctx, { ...opts, width: W, height: H })
    this.onMouseDown = (e: MouseEvent) => {
      const cx = e.x - this.x, cy = e.y - this.y   // local cell coordinates
      // address = cy * W + cx  -> open inspector
    }
  }
  protected renderSelf(buf: OptimizedBuffer) {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const o = this.owner[y * W + x]
        buf.setCell(this.x + x, this.y + y, o ? "#" : ".", WHITE, PALETTE[o])
      }
  }
}
// after each simulator batch: grid.requestRender()
```

Measured cost in the headless renderer, including the full native frame: **about 2.5 ms per frame** for 8,192 `setCell` calls through `renderSelf`.

### Option B: `FrameBufferRenderable` (an offscreen buffer you own)

```ts
import { FrameBufferRenderable } from "@opentui/core"
const fb = new FrameBufferRenderable(renderer, { id: "core", width: W, height: H })
parent.add(fb)
// whenever state changes; coordinates are buffer-local (0,0 = top-left of fb):
fb.frameBuffer.setCell(x, y, "#", fg, bg)
fb.frameBuffer.drawChar(0x2588, x, y, fg, bg)   // codepoint variant, skips string handling
fb.requestRender()
```

Measured cost: **about 1.7 ms per frame** for 8,192 `setCell` calls, and about 1.9 ms with `drawChar`. Use this option when you want to repaint only the cells that changed between frames, because the buffer keeps its contents. Caveats: a layout resize **clears** the buffer, so redraw everything in `onResize` or on the next tick. The renderable destroys only its own buffer.

### `OptimizedBuffer` API (0.6.6)

- `setCell(x, y, char: string, fg: RGBA, bg: RGBA, attributes?)` uses only the first code point. Use `drawText` for wide graphemes.
- `drawChar(codepoint, x, y, fg, bg, attrs?)`
- `drawText(text, x, y, fg, bg?, attrs?)`
- `fillRect(x, y, w, h, bg)`
- `clear(bg?)`
- `setCellWithAlphaBlending(...)`
- `drawBox({x, y, width, height, border, borderStyle, borderColor, backgroundColor, title, ...})`
- `pushScissorRect` / `popScissorRect`
- `pushOpacity` / `popOpacity`
- `drawFrameBuffer(dx, dy, otherBuffer, ...)`
- `withBuffers(cb)` gives synchronous raw access to the planes: `char: Uint32Array(w*h)`, `fg` and `bg: Uint16Array(w*h*4)`, `attributes: Uint32Array`. The docs discourage it ("prefer drawing methods"). The drawing methods are already fast enough at our size.

### Colours: `RGBA`

- Construct with `RGBA.fromInts(r, g, b, a = 255)`, `RGBA.fromHex("#rrggbb")`, `RGBA.fromValues(r, g, b, a)` (floats from 0 to 1), `RGBA.fromIndex(n)` (ANSI 256), or `RGBA.defaultForeground()` / `RGBA.defaultBackground()`.
- Widget options also accept CSS-style strings (`"#ff8800"`, `"red"`) through `ColorInput`. **`setCell` and the other buffer methods require `RGBA` objects.** Preallocate them per warrior or palette entry.
- Text attributes come from `TextAttributes` (bit flags: BOLD, DIM, ITALIC, UNDERLINE, ...). Inspect the export if you need them.

### Render loop and FPS

The renderer is **on-demand by default**: any mutation, or a call to `x.requestRender()`, schedules one frame. Two patterns:

1. Run the simulation on its own timer, or with `setImmediate` batching (N cycles per tick), then call `grid.requestRender()`. Frames are coalesced. This is the simplest pattern and works well when the simulation runs faster than the display.
2. Continuous mode: `renderer.start()`, plus `renderer.targetFps = 30..60`, an optional `renderer.maxFps`, and `renderer.setFrameCallback(async (dt) => { stepSimulation(); })`, which runs before every frame. Call `renderer.pause()` while the game is paused to save CPU. Another option is the balanced pair `requestLive()` / `dropLive()`.

A verified live run in a pseudo-TTY: `createCliRenderer({ targetFps: 60, gatherStats: true })`, `start()`, and a `setFrameCallback` that rewrote 1,280 cells measured **64 fps and about 0.8 ms average frame time**. Target 30 to 60 fps for display. Run the simulation independently of the display rate.

Do not call `requestRender()` from inside `renderSelf` or `onResize`, because a request made during a render pass is dropped. Use `process.nextTick` if you must.

## 3. Layout

Layout is Yoga flexbox. Every renderable takes `LayoutOptions` in its constructor, and each option is also a settable property:

- `flexDirection`, `flexGrow`, `flexShrink`, `flexBasis`, `flexWrap`
- `alignItems`, `justifyContent`, `alignSelf`
- `width` / `height` as a number, `"auto"` or `"50%"`
- `min*` and `max*` sizes
- `margin*` and `padding*` (including the `X` and `Y` variants)
- `position: "relative" | "absolute"` with `top`, `left`, `right` and `bottom`
- `overflow`, `zIndex`, `visible`, `opacity`
- `BoxRenderable` adds `gap`, `rowGap` and `columnGap`

`BoxRenderable` options:

- Border: `border` (`true` or an array of sides), `borderStyle` (`"single" | "double" | "rounded" | "heavy"`), `borderColor`, `focusedBorderColor`, `customBorderChars`
- Titles: `title`, `titleColor`, `titleAlignment`, `bottomTitle`, `bottomTitleAlignment`
- Fill: `backgroundColor`, `shouldFill`
- Focus: `focusable`

Verified skeleton with an absolute modal:

```ts
import { createCliRenderer, BoxRenderable, TextRenderable, t, bold, fg } from "@opentui/core"

const renderer = await createCliRenderer({ exitOnCtrlC: false })
const app   = new BoxRenderable(renderer, { flexDirection: "column", width: "100%", height: "100%" })
const main  = new BoxRenderable(renderer, { flexDirection: "row", flexGrow: 1 })
const core  = new BoxRenderable(renderer, { border: true, borderStyle: "rounded", title: " Core ", flexGrow: 1 })
const side  = new BoxRenderable(renderer, { border: true, title: " Warriors ", width: 30 })
const status = new TextRenderable(renderer, { height: 1, content: t`${bold("cycle")} ${fg("#ff0")("0")}` })
core.add(new CoreGrid(renderer))
main.add(core); main.add(side); app.add(main); app.add(status)
renderer.root.add(app)

const modal = new BoxRenderable(renderer, {
  position: "absolute", left: "10%", top: "10%", width: "80%", height: "80%",
  zIndex: 100, border: true, title: " Edit warrior ", backgroundColor: "#101030", visible: false,
})
renderer.root.add(modal)            // add it to root so it overlays everything
modal.visible = true                // show it; set to false to hide
```

- **Resize:** handled automatically when attached to `process.stdout` (via SIGWINCH, debounced by `debounceDelay`, 100 ms by default). Percentage sizes reflow; verified that a 50% modal became 50x20 after a resize to 100x40. Listen with `renderer.on("resize", (w, h) => ...)`; the event was verified. `renderer.width` and `renderer.height` hold the current size. If the terminal is smaller than the 128x64 core, wrap the grid in an `overflow: "hidden"` box or a `ScrollBoxRenderable`, or pick the grid's column count from `renderer.width`.
- `zIndex` controls both paint order and mouse hit priority among siblings. Children paint after their parents.

## 4. Input

### Keyboard

```ts
renderer.keyInput.on("keypress", (key) => {
  if (key.ctrl && key.name === "s") { save(); key.preventDefault() }   // preventDefault: focused widget won't see it
  if (key.name === "escape") closeModal()
})
```

- `KeyEvent` fields: `name`, `ctrl`, `meta` (also covers Alt), `shift`, `option`, `super?`, `hyper?`, `sequence`, `raw`, `eventType` (`"press" | "repeat" | "release"`), `repeated`, `source` (`"raw" | "kitty"`).
- Names seen in the verified probe: `s` and other letters, `space`, `return`, `escape`, `tab` (with `shift` for Shift+Tab), `up`, `down`, `left`, `right`, `f5`, `backspace`, `delete`, `home`, `end`. In bindings, `enter` is an alias of `return` and `esc` of `escape`.
- Order: global `keyInput` listeners run first, in registration order. Then the focused renderable's `onKeyDown`, then its built-in `handleKeyPress`. `stopPropagation()` stops everything after it. `preventDefault()` lets the other global listeners run but blocks the focused renderable.
- **Legacy-terminal gotchas** (verified without the kitty protocol):
  - `ctrl+-` arrives as `ctrl` + `_`.
  - A bare Escape followed quickly by another key merges into `meta+<key>` (in the probe, ESC then Shift+Up became `M-S-up`).
  - With the kitty keyboard protocol (`useKittyKeyboard` defaults to on and is used when the terminal supports it) these come through correctly.
  - Choose shortcuts that survive legacy encoding: `ctrl+s`, `ctrl+n`, `ctrl+o`, `ctrl+q`, `ctrl+z`, `F1`-`F12`.
  - `ctrl+s` and `ctrl+q` reached the app in the test renderer. Raw mode should disable XON/XOFF flow control in real terminals, but confirm this in your target terminal.
- `exitOnCtrlC: true` calls `renderer.destroy()` on ctrl+c. Set it to `false` if you want to confirm before quitting.

### Focus

- Only the focused renderable receives keys and paste.
- `Input`, `Textarea`, `Select`, `TabSelect`, `ScrollBox` and `ScrollBar` are focusable by default. A `Box` needs `focusable: true`.
- Call `widget.focus()` / `widget.blur()`. Read `renderer.currentFocusedRenderable`, and listen for the `RenderableEvents.FOCUSED` / `BLURRED` events.
- A left mouse-down auto-focuses the nearest focusable ancestor. `autoFocus: false` disables this.
- **There is no automatic Tab traversal.** Implement your own focus ring on `tab` / shift+`tab`.
- For a modal: on open, `editor.focus()`; on close, `grid.focus()` or the previous focus. Make your global key handler check `modal.visible`, so that grid shortcuts don't fire while the user is typing.

### Mouse

- Mouse support is on by default (`useMouse: true`). Movement tracking is controlled by `enableMouseMovement`.
- Handlers are renderable options or properties: `onMouseDown`, `onMouseUp`, `onMouseMove`, `onMouseDrag`, `onMouseDragEnd`, `onMouseDrop`, `onMouseOver`, `onMouseOut`, `onMouseScroll`, and the catch-all `onMouse`.
- `MouseEvent` fields: `type`, `button` (0 = left, 1 = middle, 2 = right), `x`, `y` (**global** zero-based cells), `modifiers {shift, alt, ctrl}`, `scroll {direction, delta}`, `target`, `currentTarget`, `isDragging`. It also has `stopPropagation()` and `preventDefault()`.
- **There is no `click` event.** Use `onMouseUp`, or a down/up pair.
- Local coordinates: `e.x - this.x`, `e.y - this.y`. Verified: a click at the grid's local position (10, 5) reported exactly that.
- Hover uses `onMouseOver` / `onMouseOut` on the topmost hit target, and these bubble. For a per-cell hover readout on the grid, use `onMouseMove` and compute the local cell.
- Scroll: read `e.scroll.direction` (`"up" | "down" | ...`). `ScrollBoxRenderable` handles the wheel itself (verified).
- Events bubble from the hit target up through its parents. The higher `zIndex` wins hit-testing, and clipping by `overflow: "hidden"` is respected.

Button (verified that `onMouseUp` fired once for a click):

```ts
function button(label: string, onPress: () => void) {
  const b = new BoxRenderable(renderer, {
    border: true, height: 3, width: label.length + 4, focusable: true,
    onMouseUp: (e) => { if (e.button === 0) onPress() },
    onMouseOver() { this.borderColor = "#ffff00" },
    onMouseOut()  { this.borderColor = "#888888" },
  })
  b.add(new TextRenderable(renderer, { content: label }))
  return b
}
toolbar.add(button("New", newWarrior)); toolbar.add(button("Save", save))
```

## 5. Text editing: `TextareaRenderable`

There is a built-in multi-line editor: **`TextareaRenderable`** (`<textarea>` in React/Solid). It is backed by a native `EditBuffer`/`EditorView` and supports cursor movement, keyboard and mouse selection, wrap modes, scrolling within its own height, undo/redo, and paste. `InputRenderable` is the single-line subclass.

Verified:

```ts
import { TextareaRenderable, SyntaxStyle, RGBA } from "@opentui/core"

const style = SyntaxStyle.fromStyles({
  opcode:   { fg: RGBA.fromHex("#ff8800"), bold: true },
  modifier: { fg: "#88ccff" },
  number:   { fg: "#c0ff80" },
  comment:  { fg: "#888888", italic: true },
  label:    { fg: "#ffd700" },
}, renderer.nativeScene)                       // owner = renderer.nativeScene

const editor = new TextareaRenderable(renderer, {
  flexGrow: 1, initialValue: source, wrapMode: "none", syntaxStyle: style,
  showCursor: true, selectionBg: "#334",
  keyBindings: [                                 // merged over the defaults (same key = override)
    { name: "s", ctrl: true, action: "submit" },
    { name: "z", ctrl: true, action: "undo" },
    { name: "y", ctrl: true, action: "redo" },
  ],
  onSubmit: () => saveWarrior(editor.plainText),
  onContentChange: () => rehighlight(),
  onCursorChange: ({ line, visualColumn }) => updateStatus(line, visualColumn),
})
modal.add(editor); editor.focus()
```

- **Content:**
  - Get it with `editor.plainText`.
  - `editor.setText(s)` resets the text **and clears undo history**.
  - `editor.replaceText(s)` replaces the text with an undo point (verified that undo restores it).
  - Also available: `insertText(s)`, `clear()`, `getTextRange(a, b)`, `deleteRange(...)`.
- **Cursor and navigation:** `logicalCursor {row, col, offset}`, `cursorOffset` (read/write), `setCursor(row, col)`, `gotoLine(n)`, `gotoBufferEnd()`, `moveCursor*({select})`, `lineCount`, `scrollY`.
- **Selection:** `getSelection()`, `setSelection(a, b)`, `getSelectedText()`, `selectAll()`, `deleteSelection()`.
- **Undo:** `undo()` / `redo()` return a boolean. Granularity is **per keystroke**: one undo removed one typed character (verified).
- **Default keys** (from the `defaultTextareaKeyBindings` export):
  - Arrows move; with shift, they select.
  - `home` / `end` go to buffer start/end.
  - `ctrl+a` / `ctrl+e` go to line start/end. `ctrl+k` and `ctrl+u` kill to line end and line start. `ctrl+w` deletes the previous word.
  - `ctrl+-` is undo and `ctrl+.` is redo. **`ctrl+-` doesn't work in legacy terminals, so bind ctrl+z and ctrl+y yourself as above.** `super+z` is also bound.
  - `meta+return` submits.
  - `meta`/`ctrl` + arrow moves by word.
- **Syntax highlighting:** tree-sitter is used for `CodeRenderable`, `Markdown` and `Diff`; it is not documented for Textarea. For a small language like Redcode, **compute highlights yourself** with a regex tokenizer and push them into the textarea. This works today (verified):

  ```ts
  function rehighlight() {
    editor.clearAllHighlights()
    const ids = { opcode: style.getStyleId("opcode")!, comment: style.getStyleId("comment")! }
    editor.plainText.split("\n").forEach((line, i) => {
      const c = line.indexOf(";")
      if (c >= 0) editor.addHighlight(i, { start: c, end: line.length, styleId: ids.comment })
      const m = /^\s*(?:\w+\s+)?([A-Za-z]{3})\b/.exec(line)   // crude opcode match
      if (m) { const s = m.index + m[0].length - 3; editor.addHighlight(i, { start: s, end: s + 3, styleId: ids.opcode }) }
    })
  }
  ```

  - `addHighlight(line, {start, end, styleId, priority?, hlRef?})` takes per-line columns. `addHighlightByCharRange({start, end, styleId})` takes whole-buffer offsets. You can also use `removeHighlightsByRef(ref)` and `getLineHighlights(i)`.
  - **Highlights are not cleared by `setText`.** They stayed on the same character range in the probe, so call `clearAllHighlights()` and re-run the tokenizer after each `onContentChange`. It is cheap for warrior-sized files.
  - Alternatively, write a real tree-sitter grammar (WASM plus `highlights.scm`) and register it with `addDefaultParsers` / `addFiletypeParser`, then use it for read-only `CodeRenderable` listings. That is overkill for Redcode.
- **Line numbers:** `LineNumberRenderable` wraps a `LineInfoProvider` (Textarea implements one) to add a gutter.
- **Error markers:** `editor.extmarks` (an `ExtmarksController`) exists for virtual marks. Simple coloured highlights with a "error" style are enough for us.

## 6. Built-in widgets (all in `@opentui/core`; JSX tag in parentheses)

- **`TextRenderable` (`<text>`)**: `content: string | StyledText`. Build styled spans with the `t` template tag and the helpers `fg(color)(s)`, `bg(color)(s)`, `bold`, `italic`, `underline`, `dim`, `reverse`, `red`, `green`, ... (verified). It is selectable by default; set `selectable: false` for HUD text. To update it, assign `text.content = t\`...\``.
- **`SelectRenderable` (`<select>`)** is the warrior list.
  - Options: `options: {name, description, value?}[]`, `selectedIndex`, `showDescription`, `wrapSelection`, `showScrollIndicator`, `itemSpacing`, and colour options.
  - Events: `SelectRenderableEvents.SELECTION_CHANGED` and `ITEM_SELECTED`, both with `(index, option)`. Verified that down then Enter gave `SELECTION_CHANGED 1` and `ITEM_SELECTED 1`.
  - Methods: `getSelectedOption()`, `setSelectedIndex()`, `moveUp()` / `moveDown()`.
  - Keys: up/down move and Enter selects.
- **`InputRenderable` (`<input>`)**:
  - Options: `value`, `placeholder`, `maxLength`.
  - Events: `"input"` (each change, gives the value), `"change"`, and `"enter"` (gives the value). Verified.
  - Read the current text with `.value`.
- **`TabSelectRenderable` (`<tab-select>`)**: `options`, `tabWidth`, `showUnderline`. Left/right arrows move between tabs. Emits `"selectionChanged"` and `"itemSelected"` (verified).
- **`ScrollBoxRenderable` (`<scrollbox>`)**:
  - Add children directly; they go to the inner `content`.
  - Properties: `scrollTop`, `scrollLeft`, `scrollHeight`.
  - Methods: `scrollBy(n)`, `scrollTo(n | {x,y})`, `scrollChildIntoView(id)`.
  - Options: `stickyScroll` + `stickyStart: "bottom"` (good for an event log), `viewportCulling`.
  - It handles the wheel itself (verified).
- Others: `CodeRenderable` (tree-sitter highlighted, read-only), `MarkdownRenderable`, `DiffRenderable`, `TextTableRenderable` (good for the cell inspector or a scoreboard), `SliderRenderable` (speed control), `ScrollBarRenderable`, `ASCIIFontRenderable` (big title banner), `LineNumberRenderable`, `ImageRenderable`.
- Elsewhere in the ecosystem: `@opentui/keymap` (command routing), `@opentui/split` (resizable panes), and `opentui-spinner`.

## 7. Testing (headless, under `bun test`)

`@opentui/core/testing` provides `createTestRenderer`. It is a real renderer writing to an in-memory sink, with mock keyboard and mouse that go through the real parser. Everything in this brief was verified with it:

```ts
import { test, expect } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"

test("core view", async () => {
  const s = await createTestRenderer({ width: 130, height: 68 })   // options object is required
  try {
    buildUi(s.renderer)                     // pass the renderer as the RenderContext
    await s.renderOnce()
    expect(s.captureCharFrame()).toMatchSnapshot()          // plain-text frame
    await s.mockMouse.click(11, 6)                          // also: moveTo, scroll(x,y,"down"), drag, doubleClick
    s.mockInput.pressKey("s", { ctrl: true })               // also: typeText, pressEnter, pressEscape, pressTab, pressArrow
    await s.flush()
    const spans = s.captureSpans()           // {cols, rows, cursor, lines:[{spans:[{text, fg, bg, attributes, width}]}]}
  } finally { await s.dispose() }            // or `await using s = ...`
})
```

- Other helpers on the setup object: `waitForFrame(pred)`, `waitFor(pred)`, `waitForVisualIdle()`, and `resize(w, h)` (verified to fire the `resize` event).
- `ManualClock` gives deterministic timers. `TestRecorder` records frames.
- Use `captureSpans()` to assert on colours, for example that a cell is a given warrior's colour.
- Build the UI from a function that takes the `CliRenderer`, so tests and `main` share the code.
- React/Solid: `testRender` from `@opentui/react/test-utils` or `@opentui/solid`.
- Gotcha: in legacy key mode, pressing Escape then another key back-to-back merges into a meta chord. Pass `kittyKeyboard: true` to `createTestRenderer`, or `flush()` between the two presses.

## 8. Gotchas: lifecycle, console and exit

- **Startup:** `const renderer = await createCliRenderer({...})`. Do not call `new CliRenderer`. Startup enters the alternate screen (default `screenMode: "alternate-screen"`), sets raw mode, and enables mouse, paste and kitty keyboard.
- **Shutdown:** `renderer.destroy()` is synchronous and idempotent. It restores the terminal: raw mode off, mouse and paste modes off, leaves the alternate screen, shows the cursor (verified in the captured bytes). After that, `await renderer.closed` before `process.exit()`. Wrap `main` in `try/finally { renderer.destroy() }`.
- **Calling `process.exit()` directly** skips your cleanup. OpenTUI still tries a best-effort synchronous restore, but pending writes can be lost. Prefer `destroy()`, then `await closed`, then `exit`.
- **Signals:** by default the renderer destroys itself on SIGINT, SIGTERM, SIGQUIT, SIGABRT, SIGHUP, SIGPIPE and SIGBUS. It does **not** exit the process for you. If you need to save a warrior on quit, use `exitOnCtrlC: false, exitSignals: []` and install your own handlers. `onDestroy` in the config and `renderer.on("destroy")` are also available.
- **Uncaught errors** do not destroy the renderer; they can open the console overlay (`openConsoleOnError`). Make sure your own error path calls `destroy()`, or the terminal is left in raw mode. To recover a broken terminal, run `reset`.
- **Console capture:** `consoleMode` defaults to `"console-overlay"`. `console.log`, `info`, `warn`, `error` and `debug` are captured into an in-app overlay and do **not** print. Toggle the overlay yourself with `renderer.console.toggle()`, for example on a backtick key. `OTUI_USE_CONSOLE=false` disables capture, `SHOW_CONSOLE=true` shows the overlay at start, and `renderer.consoleMode = "disabled"` restores the real console. For debugging, log to a file instead.
- **After `destroy()`** most methods throw. Check `renderer.isDestroyed`.
- `requestRender()` called during a render pass is dropped.
- **`FrameBufferRenderable`** is cleared whenever it is resized.
- **The 0.x API changes between minor versions.** For example, 0.6.0 changed `suspend()` and `resume()` to return promises and removed `FrameBufferRenderable.destroySelf`. Pin the exact version.
- **Node is not an option on this machine** (Node 24 is below 26.4). Use `bun run` and `bun test`.
- **`--omit=optional`** and musl mismatches break native loading. Set `OPENTUI_LIBC=musl` on Alpine.
- **Debug overlay:** `renderer.toggleDebugOverlay()` shows FPS and timing stats. `getStats()` works with `gatherStats: true`.
