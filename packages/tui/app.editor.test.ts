/** The warrior editor in the app, with the real parser and a temp library. */

import { afterEach, describe, expect, jest, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { KeyEvent } from '@opentui/core';
import { KeyCodes, createTestRenderer, type TestRendererSetup } from '@opentui/core/testing';
import { createApp, type App } from './app.ts';
import { formatRedcode } from '../engine/parser/index.ts';
import { CHECK_DELAY_MS, EditorOverlay, NEW_WARRIOR_TEMPLATE, autoIndent, backspaceWidth, completionAt, snapWidth, tokenizeLine } from './overlays/editor.ts';
import type { PickerOverlay } from './overlays/picker.ts';
import { NEXT_LINE_BG, PREVIEW_STEP_MS } from './overlays/preview.ts';
import { HEX } from './theme.ts';
import { cellAt } from './test-fakes.ts';

let s: TestRendererSetup;
let app: App;
let root: string;
let configPath: string;
let quits = 0;

afterEach(async () => {
    app?.destroy();
    await s?.dispose();
});

/**
 * Boots on a fresh temp root holding warriors/alpha.red (a working imp), with
 * the preferences file at <root>/config/corewar-tui/config.json (`config`: its text).
 */
async function boot(initialWarriors = ['warriors/alpha.red', 'builtin/dwarf.red'], size = { width: 120, height: 36 }, config?: string) {
    root = mkdtempSync(join(tmpdir(), 'corewar-editor-'));
    mkdirSync(join(root, 'warriors'));
    writeFileSync(join(root, 'warriors', 'alpha.red'), ';name Alpha\nmov 0, 1\n');
    configPath = join(root, 'config', 'corewar-tui', 'config.json');
    if (config !== undefined) {
        mkdirSync(join(root, 'config', 'corewar-tui'), { recursive: true });
        writeFileSync(configPath, config);
    }
    s = await createTestRenderer({ ...size, kittyKeyboard: true, exitOnCtrlC: false }); // as in main.ts
    quits = 0;
    app = createApp(s.renderer, { root, configPath, autoTick: false, seed: 1, initialWarriors, onQuit: () => quits++ });
    await s.renderOnce();
}

async function press(key: string, mods?: { ctrl?: boolean }) {
    s.mockInput.pressKey(key, mods);
    await s.flush();
    await s.renderOnce();
}

async function type(text: string) {
    await s.mockInput.typeText(text);
    await s.flush();
    await Bun.sleep(CHECK_DELAY_MS + 50); // let the diagnostics debounce fire
    await s.renderOnce();
}

async function escape() {
    s.mockInput.pressEscape();
    await s.flush();
    await s.renderOnce();
}

const editor = () => app.overlays.get('editor') as EditorOverlay;
const picker = () => app.overlays.get('warriors') as PickerOverlay;

/** Click `text` on the main-screen footer (the last row). */
async function clickFooter(text: string) {
    const rows = s.captureCharFrame().split('\n');
    const y = rows.findLastIndex((r) => r.trim() !== '');
    const x = rows[y]!.indexOf(text);
    if (x < 0) throw new Error(`"${text}" not in the footer`);
    await s.mockMouse.click(x, y);
    await s.renderOnce();
}
const screen = () => s.captureCharFrame();
const files = () => readdirSync(join(root, 'warriors')).sort();

describe('editor', () => {
    test('New opens the editor with the template, and it parses', async () => {
        await boot();
        await press('n');
        expect(app.overlays.top?.id).toBe('editor');
        expect(editor().text).toBe(NEW_WARRIOR_TEMPLATE); // the opening `n` is not typed in
        expect(screen()).toContain('NEW WARRIOR');
        expect(screen()).toContain('✓ 4 instructions');
        expect(screen()).toMatch(/1 ;redcode-94/); // line-number gutter
        // syntax highlighting: opcode and comment colours
        const rows = screen().split('\n');
        const y = rows.findIndex((r) => r.includes('add.ab'));
        const frame = s.captureSpans();
        expect(cellAt(frame, rows[y]!.indexOf('add.ab'), y).fg).toBe('#7dd3fc');
        expect(cellAt(frame, rows[y]!.indexOf('; move'), y).fg).toBe(HEX.muted);
    });

    test('syntax colours line up on tab-indented lines', async () => {
        await boot();
        writeFileSync(join(root, 'warriors', 'tabs.red'), ';name Tabs\nloop\tmov bomb, >bomb\n\t\t\tdjn loop, #4\nbomb\tdat #0, #1\n');
        app.openEditor({ mode: 'edit', warrior: app.library.list().find((e) => e.id === 'warriors/tabs.red')! });
        await s.renderOnce();
        const rows = screen().split('\n');
        const frame = s.captureSpans();
        const fgOf = (text: string, offset = 0) => {
            const y = rows.findIndex((r) => r.includes(text));
            return cellAt(frame, rows[y]!.indexOf(text) + offset, y).fg;
        };
        for (const op of ['mov', 'djn', 'dat']) {
            expect(fgOf(op)).toBe('#7dd3fc');
            expect(fgOf(op, 2)).toBe('#7dd3fc');
            expect(fgOf(op, 3)).not.toBe('#7dd3fc');
        }
        expect(fgOf('#4', 1)).toBe('#bef264');
        expect(fgOf('#1', 1)).toBe('#bef264');
    });

    test('the key that opens the editor is never typed into it', async () => {
        await boot();
        const alphaSource = ';name Alpha\nmov 0, 1\n';
        await press('e'); // main screen: edits the first match warrior
        expect(editor().text).toBe(alphaSource);
        await escape();
        await press('w'); // picker: alpha is the first entry
        await press('e');
        expect(editor().text).toBe(alphaSource);
        await escape();
        await escape();
        await press('w');
        await press('n');
        expect(editor().text).toBe(NEW_WARRIOR_TEMPLATE);
    });

    test('the picker starts a solo match with one warrior, and the round ends when it dies', async () => {
        await boot();
        writeFileSync(join(root, 'warriors', 'bomb.red'), ';name Bomb\ndat 0, 0\n');
        await press('w');
        expect(picker().entries[0]!.entry.id).toBe('warriors/alpha.red');
        expect(picker().entries[1]!.entry.id).toBe('warriors/bomb.red');
        await press(' '); // deselect alpha
        await press(KeyCodes.ARROW_DOWN);
        await press(' '); // select bomb
        picker().chosen.delete('builtin/dwarf.red');
        await press(KeyCodes.RETURN);
        expect(app.controller.warriors.map((w) => w.id)).toEqual(['warriors/bomb.red']);
        await press('.'); // pauses, then bomb runs its DAT and dies
        expect(app.controller.phase).toBe('round-over');
        expect(screen()).toContain('■ DIED');
    });

    test('the picker asks for at least one warrior', async () => {
        await boot();
        await press('w');
        picker().chosen.clear();
        await press(KeyCodes.RETURN);
        expect(screen()).toContain('Pick at least one warrior.');
        expect(app.controller.warriors.length).toBe(2);
    });

    test('typing goes to the text area, not to the game keys', async () => {
        await boot();
        await press('n');
        await type(' qrw.+-?s');
        await press(' ');
        expect(editor().text.startsWith(' qrw.+-?s ;redcode-94')).toBe(true);
        expect(quits).toBe(0);
        expect(app.controller.phase).toBe('paused');
        expect(app.controller.speed).toBe(100);
        expect(app.overlays.stack.map((o) => o.id)).toEqual(['editor']);
    });

    test('diagnostics follow the code: first error with position and count, then the instruction count', async () => {
        await boot();
        await press('n');
        editor().textarea.setText(';name Bad\nmvo 0, 1\nmov 0, 1, 2\n');
        await Bun.sleep(CHECK_DELAY_MS + 50);
        await s.renderOnce();
        expect(screen()).toMatch(/✗ line 2:\d+ .*\(\+1 more error\)/);
        editor().textarea.setText(';name Good\nmov 0, 1\n');
        editor().flushCheck();
        await s.renderOnce();
        expect(screen()).toContain('✓ 1 instruction');
    });

    test('ctrl+z / ctrl+y undo and redo', async () => {
        await boot();
        await press('n');
        await type('x');
        await press('z', { ctrl: true });
        expect(editor().text).toBe(NEW_WARRIOR_TEMPLATE);
        await press('y', { ctrl: true });
        expect(editor().text.startsWith('x;')).toBe(true);
    });

    test('ctrl+s saves a new warrior under its slugified ;name; later saves go to the same file', async () => {
        await boot();
        await press('n');
        editor().textarea.setText(';name My Imp\nmov 0, 1\n');
        await press('s', { ctrl: true });
        expect(files()).toEqual(['alpha.red', 'my-imp.red']);
        expect(readFileSync(join(root, 'warriors', 'my-imp.red'), 'utf8')).toBe(';name My Imp\n        mov     0, 1\n'); // formatted on save
        expect(screen()).toContain('✓ saved warriors/my-imp.red');
        expect(screen()).toContain('EDIT warriors/my-imp.red');
        editor().textarea.gotoBufferEnd();
        await type('; more');
        await press('s', { ctrl: true });
        expect(files()).toEqual(['alpha.red', 'my-imp.red']);
        expect(app.library.list().some((e) => e.id === 'warriors/my-imp.red')).toBe(true);
    });

    test('clicking Save saves, even with parse errors, and says so', async () => {
        await boot();
        await press('n');
        editor().textarea.setText(';name Draft\nmvo 0, 1\n');
        const rows = screen().split('\n');
        const y = rows.findIndex((r) => r.includes(' Save '));
        await s.mockMouse.click(rows[y]!.indexOf(' Save ') + 2, y);
        await s.renderOnce();
        expect(files()).toContain('draft.red');
        expect(screen()).toContain('✓ saved warriors/draft.red with 1 error');
    });

    test('editing a match warrior saves in place with a one-time backup, and restart reloads it', async () => {
        await boot();
        const alpha = app.library.list().find((e) => e.id === 'warriors/alpha.red')!;
        app.openEditor({ mode: 'edit', warrior: alpha });
        await s.renderOnce();
        editor().textarea.setText(';name Alpha Two\nmov 0, 1\n');
        await press('s', { ctrl: true });
        expect(files()).toEqual(['alpha.red', 'alpha.red.bak']);
        expect(screen()).toContain('backup alpha.red.bak');
        expect(screen()).toContain('r restarts with it');
        await escape();
        expect(app.controller.warriors[0]!.name).toBe('Alpha');
        await press('r');
        expect(app.controller.warriors[0]!.name).toBe('Alpha Two');
    });

    test('editing a built-in sample saves a copy in warriors/', async () => {
        await boot();
        const dwarf = app.library.list().find((e) => e.id === 'builtin/dwarf.red')!;
        app.openEditor({ mode: 'edit', warrior: dwarf });
        await s.renderOnce();
        expect(screen()).toContain('saves a copy');
        await press('s', { ctrl: true });
        expect(files().filter((f) => f !== 'alpha.red')).toHaveLength(1);
        expect(screen()).toMatch(/✓ saved warriors\/\S+\.red/);
    });

    test('escape closes a clean editor at once, and asks once before discarding changes', async () => {
        await boot();
        await press('n');
        await escape();
        expect(app.overlays.stack).toHaveLength(0);
        await press('n');
        await type('x');
        await escape();
        expect(app.overlays.top?.id).toBe('editor');
        expect(screen()).toContain('unsaved changes · esc again to discard');
        await escape();
        expect(app.overlays.stack).toHaveLength(0);
        await press('n');
        await type('x');
        await press('c', { ctrl: true }); // ctrl+c is guarded the same way
        expect(quits).toBe(0);
        expect(screen()).toContain('ctrl+c again to discard');
        await press('c', { ctrl: true });
        expect(quits).toBe(1);
        expect(files()).toEqual(['alpha.red']);
    });
});

/** The screen row holding `code`. */
const row = (code: string) => screen().split('\n').find((r) => r.includes(code)) ?? '';
const prefs = () => JSON.parse(readFileSync(configPath, 'utf8'));

describe('relative numbers', () => {
    test('the gutter shows signed cell offsets from the cursor line, and follows the cursor', async () => {
        await boot();
        await press('n');
        // cursor on line 1, a comment: offsets count from the first instruction below
        expect(row(';redcode-94')).toContain('▸  1 ;redcode-94');
        expect(row('add.ab')).toMatch(/│ {4}0 loop {4}add\.ab/);
        expect(row('step    equ')).toMatch(/│ {6}step/); // no cell, no number
        for (let i = 0; i < 7; i++) await press(KeyCodes.ARROW_DOWN);
        expect(row('add.ab')).toContain('-  1 loop    add.ab');
        expect(row('mov.i')).toContain('▸  8         mov.i'); // the cursor line keeps its line number
        expect(row('jmp     loop')).toContain('+  1         jmp');
        expect(row('dat     #0')).toContain('+  2 bomb');
        expect(row('end     loop')).toMatch(/│ {6} +end/);
        expect(row(';redcode-94')).toMatch(/│ {6};redcode-94/);
        await press(KeyCodes.ARROW_DOWN);
        expect(row('add.ab')).toContain('-  2 loop');
        expect(row('mov.i')).toContain('-  1         mov.i');
        expect(row('jmp     loop')).toContain('▸  9');
    });

    test('F3 switches to plain line numbers and back', async () => {
        await boot();
        await press('n');
        await press(KeyCodes.F3);
        expect(screen()).toContain('F3 relative numbers: off');
        expect(row(';redcode-94')).toMatch(/│ +1 ;redcode-94/);
        expect(row('add.ab')).toMatch(/│ +7 loop/);
        expect(row('step    equ')).toMatch(/│ +6 /);
        await press(KeyCodes.F3);
        expect(row('add.ab')).toMatch(/│ {4}0 loop/);
    });
});

describe('vim keys', () => {
    /** Opens alpha.red with vim keys on (from the config file). */
    async function openAlpha(config = '{"vimKeys": true}') {
        await boot(undefined, undefined, config);
        await reopen();
    }

    async function reopen() {
        app.openEditor({ mode: 'edit', warrior: app.library.list().find((e) => e.id === 'warriors/alpha.red')! });
        await s.renderOnce();
        expect(app.overlays.top?.id).toBe('editor');
    }

    async function keys(text: string) {
        for (const k of text) await press(k);
    }

    test('are off by default: j types a j, and esc closes', async () => {
        await boot();
        await press('n');
        await press('j');
        expect(editor().text.startsWith('j;redcode-94')).toBe(true);
        expect(screen()).toContain('F2 vim keys: off');
        expect(screen()).not.toContain('NORMAL');
    });

    test('F2 turns them on and saves the preference; j moves, i inserts, esc returns to normal, then closes', async () => {
        await boot();
        await press('n');
        await press(KeyCodes.F2);
        expect(prefs()).toEqual({ vimKeys: true, relativeNumbers: true, formatOnSave: true, autocomplete: true, preview: false });
        expect(screen()).toContain('NORMAL');
        expect(screen()).toContain(':w save · esc/:q close');
        await press('j');
        expect(editor().text).toBe(NEW_WARRIOR_TEMPLATE);
        expect(editor().textarea.logicalCursor.row).toBe(1);
        await press('i');
        expect(screen()).toContain('-- INSERT --');
        await keys('xy');
        await escape();
        expect(editor().text.split('\n')[1]).toBe('xy;name Untitled');
        expect(screen()).toContain('NORMAL');
        await keys('2d');
        await escape(); // cancels the pending 2d and keeps the editor open
        expect(app.overlays.top?.id).toBe('editor');
        expect(screen()).not.toContain('unsaved changes');
        expect(editor().text.split('\n')[1]).toBe('xy;name Untitled');
        await escape(); // plain normal mode: esc closes, asking first about the unsaved text
        expect(app.overlays.top?.id).toBe('editor');
        expect(screen()).toContain('unsaved changes · esc again to discard · :w to save');
        await escape();
        expect(app.overlays.top).toBeUndefined();
    });

    test('esc in normal mode closes a clean editor at once', async () => {
        await openAlpha();
        expect(screen()).toContain('NORMAL');
        await escape();
        expect(app.overlays.top).toBeUndefined();
    });

    test(':w saves; :q with unsaved changes asks first, then closes', async () => {
        await openAlpha();
        expect(screen()).toContain('NORMAL');
        await keys('jdd');
        expect(editor().text).toBe(';name Alpha\n');
        await keys(':w');
        expect(screen()).toContain(':w');
        await press(KeyCodes.RETURN);
        expect(readFileSync(join(root, 'warriors', 'alpha.red'), 'utf8')).toBe(';name Alpha\n');
        expect(screen()).toContain('✓ saved warriors/alpha.red');
        await keys('u');
        expect(editor().text).toBe(';name Alpha\nmov 0, 1\n');
        await keys(':q');
        await press(KeyCodes.RETURN);
        expect(app.overlays.top?.id).toBe('editor');
        expect(screen()).toContain('unsaved changes · :q again to discard');
        await keys(':q');
        await press(KeyCodes.RETURN);
        expect(app.overlays.stack).toHaveLength(0);
        expect(readFileSync(join(root, 'warriors', 'alpha.red'), 'utf8')).toBe(';name Alpha\n');
    });

    test(':q! discards, :wq saves and closes, and an unknown command says so', async () => {
        await openAlpha();
        await keys('x:foo');
        await press(KeyCodes.RETURN);
        expect(screen()).toContain('not an editor command: foo');
        await keys(':q!');
        await press(KeyCodes.RETURN);
        expect(app.overlays.stack).toHaveLength(0);
        expect(readFileSync(join(root, 'warriors', 'alpha.red'), 'utf8')).toBe(';name Alpha\nmov 0, 1\n');
        await reopen();
        await keys('x:wq');
        await press(KeyCodes.RETURN);
        expect(app.overlays.stack).toHaveLength(0);
        expect(readFileSync(join(root, 'warriors', 'alpha.red'), 'utf8')).toBe('name Alpha\n        mov     0, 1\n');
    });

    test('ctrl+s, the Close button and ctrl+c still work as before', async () => {
        await openAlpha();
        await keys('x');
        await press('s', { ctrl: true });
        expect(readFileSync(join(root, 'warriors', 'alpha.red'), 'utf8')).toBe('name Alpha\n        mov     0, 1\n');
        await keys('x');
        await press('c', { ctrl: true });
        expect(screen()).toContain('ctrl+c again to discard');
        expect(quits).toBe(0);
    });
});

describe('editor preferences file', () => {
    test('toggles persist and are read back by the next run', async () => {
        await boot();
        await press('n');
        await press(KeyCodes.F2);
        await press(KeyCodes.F3);
        await press(KeyCodes.F4);
        await press(KeyCodes.F5);
        expect(prefs()).toEqual({ vimKeys: true, relativeNumbers: false, formatOnSave: false, autocomplete: false, preview: false });
        app.destroy();
        await s.dispose();
        s = await createTestRenderer({ width: 120, height: 36, kittyKeyboard: true, exitOnCtrlC: false });
        app = createApp(s.renderer, { root, configPath, autoTick: false, seed: 1, initialWarriors: ['warriors/alpha.red', 'builtin/dwarf.red'] });
        await s.renderOnce();
        await press('n');
        expect(screen()).toContain('F2 vim keys: on');
        expect(screen()).toContain('F3 rel: off'); // shortened so the others fit beside NORMAL
        expect(screen()).toContain('F4 fmt: off');
        expect(screen()).toContain('F5 auto: off');
        await press('j'); // moves rather than typing
        expect(editor().text).toBe(NEW_WARRIOR_TEMPLATE);
    });

    test('a corrupt or wrongly typed file falls back to the defaults', async () => {
        for (const config of ['{not json', '[1, 2]', '{"vimKeys": "yes", "relativeNumbers": 0}']) {
            await boot(undefined, undefined, config);
            await press('n');
            expect(screen()).toContain('F2 vim keys: off');
            expect(screen()).toContain('F3 relative numbers: on');
            app.destroy();
            await s.dispose();
        }
        await boot(undefined, undefined, '{"relativeNumbers": false}'); // a missing key takes its default
        await press('n');
        expect(screen()).toContain('F2 vim keys: off');
        expect(screen()).toContain('F3 relative numbers: off');
    });

    test('clicking a footer toggle flips it', async () => {
        await boot();
        await press('n');
        const rows = screen().split('\n');
        const y = rows.findIndex((r) => r.includes('F2 vim keys: off'));
        await s.mockMouse.click(rows[y]!.indexOf('F2 vim keys'), y);
        await s.renderOnce();
        expect(screen()).toContain('F2 vim keys: on');
        expect(prefs().vimKeys).toBe(true);
    });
});

describe('format on save', () => {
    const alphaFile = () => readFileSync(join(root, 'warriors', 'alpha.red'), 'utf8');
    const MESSY = ';name Alpha\nloop   MOV.I 0 ,1\n jmp   loop ; back\n';
    const NEAT = ';name Alpha\nloop    mov.i   0, 1\n        jmp     loop  ; back\n';

    async function openAlpha(config?: string) {
        await boot(undefined, undefined, config);
        app.openEditor({ mode: 'edit', warrior: app.library.list().find((e) => e.id === 'warriors/alpha.red')! });
        await s.renderOnce();
    }

    async function keys(text: string) {
        for (const k of text) await press(k);
    }

    test('is on by default, shown as F4; the template is already formatted', async () => {
        await boot();
        await press('n');
        expect(screen()).toContain('F4 fmt: on');
        expect(formatRedcode(NEW_WARRIOR_TEMPLATE)).toBe(NEW_WARRIOR_TEMPLATE);
    });

    test('ctrl+s formats the buffer, then saves it; the cursor keeps its line; ctrl+z undoes the formatting in one step', async () => {
        await openAlpha();
        editor().textarea.setText(MESSY);
        editor().textarea.setCursor(2, 12);
        await press('s', { ctrl: true });
        expect(alphaFile()).toBe(NEAT);
        expect(editor().text).toBe(NEAT);
        expect(editor().dirty).toBe(false);
        expect(editor().textarea.logicalCursor.row).toBe(2);
        expect(editor().textarea.logicalCursor.col).toBe(12);
        expect(screen()).toContain('✓ saved warriors/alpha.red');
        editor().textarea.setCursor(1, 0);
        await press('s', { ctrl: true }); // already formatted: nothing to undo but the formatting
        await press('z', { ctrl: true });
        expect(editor().text).toBe(MESSY);
        expect(editor().dirty).toBe(true);
        await press('y', { ctrl: true });
        expect(editor().text).toBe(NEAT);
    });

    test('a column past the end of the formatted line is clamped', async () => {
        await openAlpha();
        editor().textarea.setText(';name Alpha\nmov     0,                 1\n');
        editor().textarea.setCursor(1, 27);
        await press('s', { ctrl: true });
        expect(editor().text).toBe(';name Alpha\n        mov     0, 1\n');
        expect(editor().textarea.logicalCursor).toMatchObject({ row: 1, col: 20 });
    });

    test('with vim keys, :w formats; u undoes the formatting, then the edit before it', async () => {
        await openAlpha('{"vimKeys": true}');
        await keys('jx'); // "ov 0, 1": a parse error, so saved as typed
        await keys(':w');
        await press(KeyCodes.RETURN);
        expect(alphaFile()).toBe(';name Alpha\nov 0, 1\n');
        await keys('im');
        await escape();
        await keys(':w');
        await press(KeyCodes.RETURN);
        expect(alphaFile()).toBe(';name Alpha\n        mov     0, 1\n');
        expect(editor().text).toBe(';name Alpha\n        mov     0, 1\n');
        expect(editor().textarea.logicalCursor.row).toBe(1);
        await keys('u');
        expect(editor().text).toBe(';name Alpha\nmov 0, 1\n');
        await keys('u');
        expect(editor().text).toBe(';name Alpha\nov 0, 1\n');
        await press('r', { ctrl: true });
        await press('r', { ctrl: true });
        expect(editor().text).toBe(';name Alpha\n        mov     0, 1\n');
    });

    test('source with parse errors is saved exactly as typed, buffer untouched', async () => {
        await openAlpha();
        editor().textarea.setText(';name Alpha\nMOV 0,1\nmvo   0, 1\n');
        await press('s', { ctrl: true });
        expect(alphaFile()).toBe(';name Alpha\nMOV 0,1\nmvo   0, 1\n');
        expect(editor().text).toBe(';name Alpha\nMOV 0,1\nmvo   0, 1\n');
        expect(screen()).toContain('with 1 error');
    });

    test('F4 turns it off: saved as typed, and the preference is kept', async () => {
        await openAlpha();
        await press(KeyCodes.F4);
        expect(screen()).toContain('F4 fmt: off');
        expect(prefs().formatOnSave).toBe(false);
        editor().textarea.setText(MESSY);
        await press('s', { ctrl: true });
        expect(alphaFile()).toBe(MESSY);
        expect(editor().text).toBe(MESSY);
    });
});

describe('deleting warriors in the picker', () => {
    const trash = () => readdirSync(join(root, 'warriors', '.trash')).sort();
    const picker = () => app.overlays.get('warriors') as PickerOverlay;
    const listed = () => picker().entries.map((e) => e.entry.id);

    /** Boot, add warriors/beta.red, open the picker and move to `id`. */
    async function pickerAt(id: string) {
        await boot();
        writeFileSync(join(root, 'warriors', 'beta.red'), ';name Beta\nmov 0, 1\n');
        await press('w');
        while (picker().entries[picker().cursor]!.entry.id !== id) await press('j');
    }

    async function clickText(text: string) {
        const rows = screen().split('\n');
        const y = rows.findIndex((r) => r.includes(text));
        if (y < 0) throw new Error(`"${text}" not on screen`);
        await s.mockMouse.click(rows[y]!.indexOf(text) + 1, y);
        await s.renderOnce();
    }

    test('d asks first; n and esc cancel; y moves the file to .trash and says so', async () => {
        await pickerAt('warriors/beta.red');
        await press('d');
        expect(screen()).toContain('Delete warriors/beta.red? y/n');
        await press('n');
        expect(screen()).not.toContain('y/n');
        await press('d');
        await escape();
        expect(app.overlays.top?.id).toBe('warriors'); // esc cancelled the question, not the picker
        expect(files()).toEqual(['alpha.red', 'beta.red']);
        await press('DELETE'); // the Delete key
        await press('y');
        expect(files()).toEqual(['.trash', 'alpha.red']);
        expect(trash()).toEqual(['beta.red']);
        expect(listed()).not.toContain('warriors/beta.red');
        expect(screen()).toContain('deleted warriors/beta.red (moved to warriors/.trash)');
        expect(app.footer.plain().join('')).toContain('deleted warriors/beta.red (moved to warriors/.trash)'); // hints make room
    });

    test('the Delete button asks, Cancel keeps the file, Yes deletes it; built-ins are read-only', async () => {
        await pickerAt('warriors/beta.red');
        await clickText(' Delete ');
        expect(screen()).toContain('Delete warriors/beta.red? y/n');
        await clickText(' Cancel ');
        expect(files()).toEqual(['alpha.red', 'beta.red']);
        await clickText(' Delete ');
        await clickText(' Yes, delete ');
        expect(trash()).toEqual(['beta.red']);
        while (picker().entries[picker().cursor]!.entry.origin !== 'builtin') await press('j');
        expect(screen()).toContain('built-in: read-only');
        await clickText(' Delete ');
        await press('d');
        expect(screen()).not.toContain('y/n');
        expect(screen()).toContain("Built-in samples can't be deleted.");
    });

    test('a deleted match warrior keeps playing in this match but is gone from the next selection', async () => {
        await pickerAt('warriors/alpha.red'); // the match is alpha vs dwarf
        await press('d');
        await press('\r'); // enter confirms
        expect(trash()).toEqual(['alpha.red']);
        expect(listed()).not.toContain('warriors/alpha.red');
        expect([...picker().chosen]).toEqual(['builtin/dwarf.red']);
        await escape();
        await press('r');
        expect(app.controller.warriors.map((w) => w.id)).toEqual(['warriors/alpha.red', 'builtin/dwarf.red']);
        expect(app.controller.phase).toBe('paused');
        await press('w');
        expect(listed()).not.toContain('warriors/alpha.red');
        expect([...picker().chosen]).toEqual(['builtin/dwarf.red']);
    });

    test('new settings recompile a deleted match warrior from its loaded copy', async () => {
        await pickerAt('warriors/alpha.red');
        await press('d');
        await press('y');
        await escape();
        await press('s');
        await press('\x1b[B'); // down to core size
        for (const d of '800') await press(d);
        await press('\r');
        expect(app.controller.coresize).toBe(800);
        expect(app.controller.warriors.map((w) => w.name)).toEqual(['Alpha', 'dwarf']);
        expect(screen()).not.toContain('Unknown warrior');
        expect(app.footer.plain().join('')).toContain('warriors/alpha.red deleted; playing the loaded copy');
    });

    test('settings a match warrior cannot load under are rejected and the current match is untouched', async () => {
        await boot(['builtin/silk.red', 'builtin/imp.red']);
        await press('s');
        for (let i = 0; i < 4; i++) await press('\x1b[B'); // down to max length
        await press('2');
        await press('\r');
        expect(app.footer.plain().join('')).toContain('settings not applied');
        expect(app.controller.settings.options.instructionLimit).toBe(100);
        expect(app.controller.coresize).toBe(4000);
        await press('r');
        expect(app.controller.phase).toBe('paused');
        expect(app.controller.error).toBe('');
    });
});

describe('tokenizeLine', () => {
    const kinds = (line: string) => tokenizeLine(line).map((t) => `${t.kind}:${line.slice(t.start, t.end)}`);

    test('labels, opcodes, modifiers, modes, numbers and comments', () => {
        expect(kinds('loop  ADD.ab #4, @bomb ; next')).toEqual([
            'label:loop',
            'opcode:ADD',
            'modifier:.ab',
            'mode:#',
            'number:4',
            'mode:@',
            'label:bomb',
            'comment:; next',
        ]);
        expect(kinds(';name Imp')).toEqual(['meta:;name Imp']);
        expect(kinds('  jmp -1, <x')).toEqual(['opcode:jmp', 'number:1', 'mode:<', 'label:x']);
        expect(kinds('a equ 2*b')).toEqual(['label:a', 'opcode:equ', 'number:2', 'label:b']);
    });
});

describe('completionAt', () => {
    /** `|` marks the cursor; the result is the typed word and the match names, or null. */
    const at = (marked: string) => {
        const col = marked.indexOf('|');
        const line = marked.replace('|', '');
        const c = completionAt(line, col);
        return c && { typed: line.slice(c.start, c.end), names: c.matches.map((m) => m.name), upper: c.upper };
    };

    test('the first word, or the word after a label, at any indent', () => {
        expect(at('j|')).toEqual({ typed: 'j', names: ['JMP', 'JMZ', 'JMN'], upper: false });
        expect(at('        jm|')).toEqual({ typed: 'jm', names: ['JMP', 'JMZ', 'JMN'], upper: false });
        expect(at('\t\tsp|')).toEqual({ typed: 'sp', names: ['SPL'], upper: false });
        expect(at('loop    d|')).toEqual({ typed: 'd', names: ['DAT', 'DIV', 'DJN'], upper: false });
        expect(at('loop\tjmz|')).toBeNull(); // complete and the only match
        expect(at('step e|')).toEqual({ typed: 'e', names: ['END', 'EQU'], upper: false });
        expect(at('p|')).toEqual({ typed: 'p', names: ['PIN'], upper: false });
        expect(at('n|')).toEqual({ typed: 'n', names: ['NOP'], upper: false });
        expect(at('ld|')!.names).toEqual(['LDP']);
    });

    test('upper case when the typed letters are all upper case', () => {
        expect(at('JM|')!.upper).toBe(true);
        expect(at('Jm|')!.upper).toBe(false);
        expect(at('MOV|')).toBeNull();
    });

    test('nothing in operands, comments, modifiers, mid-word, or for words that match nothing', () => {
        expect(at('        mov 0, d|')).toBeNull(); // after an opcode: an operand
        expect(at('loop mov d|')).toBeNull(); // third word
        expect(at('        jmp #s|')).toBeNull();
        expect(at('; j|')).toBeNull();
        expect(at('        mov 0, 1 ; j|')).toBeNull();
        expect(at('        mov.a|')).toBeNull();
        expect(at('        mov.|')).toBeNull();
        expect(at('        j|mp')).toBeNull();
        expect(at('        |')).toBeNull();
        expect(at('xyz|')).toBeNull();
        expect(at('loop    q|')).toBeNull();
    });
});

describe('autoIndent and backspaceWidth', () => {
    const end = (text: string) => autoIndent(text, text.length);

    test("a new line lines up with the nearest opcode above, skipping blank and comment lines", () => {
        expect(end('loop    mov 0, 1')).toBe(' '.repeat(8));
        expect(end('x  add #1, 2\n\n; note\n   ; more\n')).toBe('   ');
        expect(end('\t\tjmp 0')).toBe('  ');
        expect(autoIndent('\t\tjmp 0', 7, (s) => s.replaceAll('\t', '    ').length)).toBe(' '.repeat(8)); // display columns
        expect(autoIndent('    mov 0, 1\nnext', 12)).toBe('    '); // before a later line
    });

    test("without an opcode above, the formatter's opcode column for the file", () => {
        expect(end('')).toBe(' '.repeat(8));
        expect(end(';name x\n')).toBe(' '.repeat(8));
        expect(end('verylonglabel dat 0\nstart\n')).toBe(' '.repeat(15)); // label-only line; the column fits the longest label
    });

    test('backspace takes a whole line of blanks it ends, else one character', () => {
        expect(backspaceWidth('mov 0, 1\n        ', 17)).toBe(8);
        expect(backspaceWidth('  \t', 3)).toBe(3);
        expect(backspaceWidth('        x', 8)).toBe(1); // more on the line
        expect(backspaceWidth('        \nx', 4)).toBe(1); // not at the end of the blanks
        expect(backspaceWidth('mov', 3)).toBe(1);
    });
});

describe('snapWidth', () => {
    /** Spaces a space types at `|`. */
    const snap = (marked: string, width?: (s: string) => number) => snapWidth(marked.replace('|', ''), marked.indexOf('|'), width);
    const above = 'loop    add.ab  #4, bomb\n';

    test('after a label at column 0: to the opcode column, at least two past the label', () => {
        expect(snap(`${above}bomb|`)).toBe(4);
        expect(snap('x|')).toBe(7); // no code above: the formatter's column, 8
        expect(snap('   add 1, 2\nx|')).toBe(2); // the opcode above is at 3: still two spaces
        expect(snap(`${above}verylonglabel|`)).toBe(2);
        expect(snap(`${above}bomb|  \n`)).toBe(4); // blanks after the cursor are fine
    });

    test('after the opcode where an opcode goes: to the operand column, from where the opcode starts', () => {
        expect(snap(`${above}bomb    dat|`)).toBe(5);
        expect(snap(`${above}        mov.i|`)).toBe(3);
        expect(snap(`${above}mov|`)).toBe(5); // a first-word opcode at column 0
        expect(snap('bootstrap  mov.ab  #1, 2\n           jmp|')).toBe(5); // the file's wider opcode column
        expect(snap(`${above}\tdat|`, (t) => t.replaceAll('\t', '        ').length)).toBe(5); // display columns
    });

    test('a plain space everywhere else', () => {
        expect(snap(`${above}        mov 0,|`)).toBe(1); // operand
        expect(snap(`${above}bomb |`)).toBe(1); // after a snap or a space
        expect(snap(`${above} bomb|`)).toBe(1); // a label not at column 0 (an opcode would go there)
        expect(snap(`${above}bomb| dat`)).toBe(1); // text follows
        expect(snap(`${above}; bomb|`)).toBe(1);
        expect(snap(`${above}        mov.q|`)).toBe(1); // not a modifier
        expect(snap(`${above}loop mov bomb|`)).toBe(1);
        expect(snap(`${above}mov dat|`)).toBe(1); // dat after an opcode is an operand
    });
});

describe('space snaps to columns', () => {
    const formatted = ';name Snap\nloop    add.ab  #4, bomb\n        jmp     loop\n';
    /** Opens alpha.red holding `text` with the cursor at its end. */
    async function open(text: string, config?: string) {
        await boot(undefined, undefined, config);
        writeFileSync(join(root, 'warriors', 'alpha.red'), text);
        app.openEditor({ mode: 'edit', warrior: app.library.list().find((e) => e.id === 'warriors/alpha.red')! });
        await s.renderOnce();
        await press('\x1b[F'); // end of the buffer
    }

    test('typed lines come out as the formatter lays them out, so saving changes nothing', async () => {
        await open(formatted);
        await type('bomb dat #0, #1');
        await press(KeyCodes.RETURN);
        await type('mov bomb, >bomb');
        const typed = `${formatted}bomb    dat     #0, #1\n        mov     bomb, >bomb`;
        expect(editor().text).toBe(typed);
        expect(formatRedcode(typed)).toBe(`${typed}\n`);
        await press('s', { ctrl: true });
        expect(readFileSync(join(root, 'warriors', 'alpha.red'), 'utf8')).toBe(`${typed}\n`);
        expect(editor().text).toBe(`${typed}\n`); // only the final newline was added
    });

    test('backspace right after a snap deletes the gap; a second space is plain; ctrl+z undoes a snap', async () => {
        await open(formatted);
        await type('bomb ');
        expect(editor().text).toBe(`${formatted}bomb    `);
        await press(KeyCodes.BACKSPACE);
        expect(editor().text).toBe(`${formatted}bomb`);
        await type('  ');
        expect(editor().text).toBe(`${formatted}bomb     `);
        await press(KeyCodes.BACKSPACE);
        expect(editor().text).toBe(`${formatted}bomb    `); // not right after the snap: one character
        await press('z', { ctrl: true });
        await press('z', { ctrl: true });
        await press('z', { ctrl: true });
        expect(editor().text).toBe(`${formatted}bomb`);
    });

    test('off with format on save: a plain space', async () => {
        await open(formatted, '{"formatOnSave": false}');
        await type('bomb dat');
        expect(editor().text).toBe(`${formatted}bomb dat`);
    });

    test('space with the completion box open closes it and still snaps a label that prefixes an opcode', async () => {
        await open(formatted);
        await type('st'); // a label, though it begins stp
        expect(screen()).toContain('stp A, B');
        await type(' ');
        expect(screen()).not.toContain('stp A, B');
        expect(editor().text).toBe(`${formatted}st      `);
        await type('d');
        expect(screen()).toContain('dat A, B');
        await type(' ');
        expect(screen()).not.toContain('dat A, B');
        expect(editor().text).toBe(`${formatted}st      d `); // d is not an opcode: a plain space
        await type('\t');
        await press(KeyCodes.RETURN);
        await press(KeyCodes.BACKSPACE);
        await type('j');
        await press(KeyCodes.TAB); // tab accepts, and its space snaps to the operand column too
        expect(editor().text.split('\n').at(-1)).toBe('jmp     ');
    });

    test('with vim keys: space with the box open closes it and snaps the label', async () => {
        await open(`${formatted}\n`, '{"vimKeys": true}');
        await type('Gkist');
        expect(screen()).toContain('stp A, B');
        await type(' ');
        expect(screen()).not.toContain('stp A, B');
        expect(screen()).toContain('-- INSERT --');
        await type('dat 0');
        await escape();
        expect(editor().text).toBe(`${formatted}st      dat     0\n`);
    });

    test('with vim keys: snaps in insert mode, backspace takes the gap, and . repeats', async () => {
        await open(`${formatted}\n`, '{"vimKeys": true}');
        await type('Gkibomb ');
        expect(editor().text).toBe(`${formatted}bomb    \n`);
        await press(KeyCodes.BACKSPACE);
        expect(editor().text).toBe(`${formatted}bomb\n`);
        await type(' dat 0');
        await escape();
        expect(editor().text).toBe(`${formatted}bomb    dat     0\n`);
        await type('j.');
        expect(editor().text).toBe(`${formatted}bomb    dat     0\nbomb    dat     0`);
        await type('u');
        expect(editor().text).toBe(`${formatted}bomb    dat     0\n`);
    });
});

describe('auto-indent', () => {
    async function open(text: string, config?: string) {
        await boot(undefined, undefined, config);
        await press('n');
        editor().textarea.setText(text);
        await s.renderOnce();
    }

    test('enter indents to the opcode above in one undo step; backspace removes the indent at once', async () => {
        await open('loop    mov 0, 1');
        await press('\x1b[F'); // end
        await press(KeyCodes.RETURN);
        expect(editor().text).toBe('loop    mov 0, 1\n        ');
        await press(KeyCodes.BACKSPACE);
        expect(editor().text).toBe('loop    mov 0, 1\n');
        await press(KeyCodes.BACKSPACE);
        expect(editor().text).toBe('loop    mov 0, 1');
        await press(KeyCodes.RETURN);
        await type('jmp loop');
        await press(KeyCodes.RETURN);
        expect(editor().text).toBe('loop    mov 0, 1\n        jmp     loop\n        '); // the space after jmp snaps
        await press('z', { ctrl: true });
        expect(editor().text).toBe('loop    mov 0, 1\n        jmp     loop');
    });

    test('enter before an indented line moves it down indented once, in one undo step', async () => {
        await open('loop    mov 0, 1\n        jmp loop');
        await press('\x1b[B'); // down to the jmp line, column 0
        await press(KeyCodes.RETURN);
        expect(editor().text).toBe('loop    mov 0, 1\n\n        jmp loop');
        expect(editor().textarea.logicalCursor).toMatchObject({ row: 2, col: 8 }); // on the j of jmp
        await press('z', { ctrl: true });
        expect(editor().text).toBe('loop    mov 0, 1\n        jmp loop');
    });

    test('off with format on save: enter and backspace work as before', async () => {
        await open('loop    mov 0, 1\n        ', '{"formatOnSave": false}');
        await press('\x1b[F');
        await press(KeyCodes.BACKSPACE);
        expect(editor().text).toBe('loop    mov 0, 1\n       ');
        await press(KeyCodes.RETURN);
        expect(editor().text).toBe('loop    mov 0, 1\n       \n');
    });

    test('with vim keys: o, O and enter in insert mode indent, backspace removes it, and . repeats', async () => {
        await open('   add 1, 2', '{"vimKeys": true}');
        await press('o');
        expect(editor().text).toBe('   add 1, 2\n   ');
        await press(KeyCodes.BACKSPACE);
        expect(editor().text).toBe('   add 1, 2\n');
        await press(KeyCodes.RETURN);
        expect(editor().text).toBe('   add 1, 2\n\n   ');
        await escape();
        await press('O');
        expect(editor().text).toBe('   add 1, 2\n\n   \n   ');
        await escape();
        await press('u');
        await press('u');
        expect(editor().text).toBe('   add 1, 2');
        await press('A');
        await press(KeyCodes.RETURN);
        await type('nop');
        await escape();
        await press('.');
        expect(editor().text).toBe('   add 1, 2\n   nop\n   nop');
    });
});

describe('autocomplete', () => {
    /** Opens a new warrior with an empty buffer, or with `text` and the cursor at the start. */
    async function blank(config?: string, text = '') {
        await boot(undefined, undefined, config);
        await press('n');
        editor().textarea.setText(text);
        await s.renderOnce();
    }
    const rowOf = (text: string) => screen().split('\n').findIndex((r) => r.includes(text));

    test('typing j lists jmp, jmz and jmn with their meanings, right of the cursor on its row', async () => {
        await blank(undefined, ';x\n');
        await press(KeyCodes.ARROW_DOWN);
        await press('j');
        expect(screen()).toContain('jmp A      jump to A');
        expect(screen()).toContain('jmz A, B   jump to A if B is zero');
        expect(screen()).toContain('jmn A, B   jump to A if B is not zero');
        const rows = screen().split('\n');
        const y = rowOf('jmp A');
        expect(rows[y]).toMatch(/▸ +2 j /);
        expect(rows[y]!.indexOf('jmp A')).toBeGreaterThan(rows[y]!.indexOf('1 j') + 2);
        expect(rowOf('jmz A, B')).toBe(y + 1);
        await press('m');
        await press('z');
        expect(screen()).not.toContain('jump to A'); // jmz is complete and the only match
    });

    test('↓ then tab inserts the second match and snaps to the operand column; one ctrl+z undoes it', async () => {
        await blank();
        await press('j');
        const frame = () => s.captureSpans();
        const x = screen().split('\n')[rowOf('jmz A, B')]!.indexOf('jmz A, B');
        expect(cellAt(frame(), x, rowOf('jmp A')).bg).toBe(HEX.selection);
        await press(KeyCodes.ARROW_DOWN);
        expect(cellAt(frame(), x, rowOf('jmz A, B')).bg).toBe(HEX.selection);
        expect(cellAt(frame(), x, rowOf('jmp A')).bg).not.toBe(HEX.selection);
        await press(KeyCodes.TAB); // the space after it snaps to the operand column
        expect(editor().text).toBe('jmz     ');
        expect(screen()).not.toContain('jump to A');
        await press('z', { ctrl: true });
        expect(editor().text).toBe('j');
    });

    test('backspace after a tab completion takes its snapped gap at once', async () => {
        await blank();
        await press('j');
        await press(KeyCodes.TAB);
        expect(editor().text).toBe('jmp     ');
        await press(KeyCodes.BACKSPACE);
        expect(editor().text).toBe('jmp');
    });

    test('the completion keeps the typed case, and adds no space when one follows', async () => {
        await blank(undefined, 'loop  \n');
        await press(KeyCodes.ARROW_RIGHT);
        await press(KeyCodes.ARROW_RIGHT);
        await press(KeyCodes.ARROW_RIGHT);
        await press(KeyCodes.ARROW_RIGHT);
        await press(KeyCodes.ARROW_RIGHT);
        await press('S');
        await press('P');
        expect(screen()).toContain('SPL A');
        await press(KeyCodes.TAB);
        expect(editor().text).toBe('loop SPL \n');
    });

    test('enter inserts a newline and closes the box; esc closes it and keeps the editor open', async () => {
        await blank();
        await press('j');
        await press(KeyCodes.RETURN);
        expect(editor().text).toBe('j\n        '); // auto-indented: j is no opcode, so the formatter's column
        expect(screen()).not.toContain('jump to A');
        await press('m');
        expect(screen()).toContain('mov A, B');
        await escape();
        expect(screen()).not.toContain('mov A, B');
        expect(app.overlays.top?.id).toBe('editor');
        await press(KeyCodes.ARROW_UP); // closed: the arrows move the cursor again
        expect(editor().textarea.logicalCursor.row).toBe(0);
    });

    test('moving the cursor or deleting the typed word closes it', async () => {
        await blank();
        await press('j');
        await press(KeyCodes.ARROW_LEFT);
        expect(screen()).not.toContain('jump to A');
        await press(KeyCodes.ARROW_RIGHT);
        await press('m');
        expect(screen()).toContain('jump to A');
        await press(KeyCodes.BACKSPACE);
        expect(screen()).toContain('jump to A'); // still j
        await press(KeyCodes.BACKSPACE);
        expect(screen()).not.toContain('jump to A');
    });

    test('with vim keys: nothing in normal mode; in insert mode tab completes, esc leaves insert, and . repeats it', async () => {
        await blank('{"vimKeys": true}');
        await press('j');
        expect(screen()).not.toContain('jump to A');
        await press('i');
        await press('s');
        expect(screen()).toContain('spl A');
        await press(KeyCodes.ARROW_DOWN);
        await press(KeyCodes.TAB);
        expect(editor().text).toBe('seq     ');
        await press('j');
        expect(screen()).not.toContain('jump to A'); // an operand
        await escape();
        expect(screen()).toContain('NORMAL');
        await press('o');
        await press('s');
        expect(screen()).toContain('slt A, B');
        await escape(); // one press closes the box and leaves insert mode
        expect(screen()).not.toContain('slt A, B');
        expect(screen()).toContain('NORMAL');
        await press('u');
        await press('u');
        expect(editor().text).toBe('');
        await press('A');
        await press('j');
        await press(KeyCodes.TAB);
        await escape();
        await press('.');
        expect(editor().text).toBe('jmp     jmp ');
    });

    test('the box has no border: exactly its rows, one space each side of the text, on the popup colour', async () => {
        await blank(undefined, ';x\n;y\n');
        await press(KeyCodes.ARROW_DOWN);
        await press(KeyCodes.ARROW_DOWN);
        await press('j');
        const rows = screen().split('\n');
        const y = rowOf('jmp A');
        expect(rows[y]).toMatch(/▸ +3 j  jmp A      jump to A {20}/); // cursor cell, then the box's leading space
        expect(rowOf('jmn A, B')).toBe(y + 2);
        expect(rows[y - 1]).toMatch(/│ +;y +│/); // nothing drawn above the first row
        expect(rows[y + 3]).not.toMatch(/[─└┘]/);
        const x = rows[y]!.indexOf('jmp A') - 1;
        const frame = s.captureSpans();
        expect(cellAt(frame, x, y).bg).toBe(HEX.selection);
        expect(cellAt(frame, x, y + 1).bg).toBe(HEX.popup);
        const right = x + ' jmn A, B   jump to A if B is not zero '.length;
        expect(cellAt(frame, right - 1, y + 2).bg).toBe(HEX.popup);
        expect(cellAt(frame, right, y + 2).bg).not.toBe(HEX.popup);
    });

    test('F5 turns it off and the preference is saved', async () => {
        await blank();
        expect(screen()).toContain('F5 auto: on');
        await press(KeyCodes.F5);
        expect(prefs().autocomplete).toBe(false);
        expect(screen()).toContain('F5 auto: off');
        await press('j');
        expect(screen()).not.toContain('jump to A');
        await press(KeyCodes.TAB);
        expect(editor().text).toBe('j'); // tab does what it did before: nothing
    });
});

describe('preview', () => {
    async function openPreview() {
        await boot();
        await press('n');
        await press(KeyCodes.F6);
    }

    /** The background of the editor text at the start of `text`'s row. */
    function lineBg(text: string): string {
        const rows = screen().split('\n');
        const y = rows.findIndex((r) => r.includes(text));
        return cellAt(s.captureSpans(), rows[y]!.indexOf(text), y).bg;
    }

    test('F6 sets up the saved text beside it, paused; F7 runs it a step a second; the preference is kept', async () => {
        await boot();
        await press('n');
        expect(screen()).not.toContain('PREVIEW');
        // The keys go to the editor directly: the test renderer's key input waits on real timers.
        jest.useFakeTimers();
        try {
            editor().handleKey({ name: 'f6' } as KeyEvent);
            jest.advanceTimersByTime(PREVIEW_STEP_MS * 3);
            expect(editor().preview.playing).toBe(false);
            editor().handleKey({ name: 'f7' } as KeyEvent);
            jest.advanceTimersByTime(PREVIEW_STEP_MS * 3); // add, mov, jmp: back at the add
        } finally {
            jest.useRealTimers();
        }
        await s.renderOnce();
        expect(prefs().preview).toBe(true);
        expect(screen()).toContain('PREVIEW');
        expect(screen()).toContain('▶ running');
        expect(screen()).toContain('step 3');
        expect(screen()).toContain('next   +0  ADD.AB #4, $3');
        await press(KeyCodes.F6);
        expect(prefs().preview).toBe(false);
        expect(screen()).not.toContain('PREVIEW');
    });

    test('F8 runs one step: the log shows what ran and the cells it read and wrote, and the line that runs next is lit', async () => {
        await openPreview();
        await press(KeyCodes.F8);
        expect(screen()).toContain('❚❚ paused');
        expect(screen()).toContain('   1   +0  ADD.AB #4, $3');
        expect(screen()).toContain('r +3 w +3');
        expect(screen()).toContain('next   +1  MOV.I $2, @2');
        expect(lineBg('mov.i   bomb, @bomb')).toBe(NEXT_LINE_BG);
        await press(KeyCodes.F8);
        expect(screen()).toContain('   2   +1  MOV.I $2, @2');
        expect(screen()).toContain('r +3 w +7'); // the bomb lands 4 past itself
        expect(lineBg('jmp     loop')).toBe(NEXT_LINE_BG);
    });

    test('saving resets it to the new text, paused; until then it says it runs the last save and lights no line', async () => {
        await openPreview();
        await press(KeyCodes.F8);
        await press(KeyCodes.F7);
        editor().textarea.setText(`${NEW_WARRIOR_TEMPLATE}; a note\n`);
        await s.renderOnce();
        await s.renderOnce(); // the change event comes during the first frame
        expect(screen()).toContain('unsaved: runs the last save');
        expect(screen()).toContain('   1   +0  ADD.AB #4, $3');
        expect(lineBg('mov.i   bomb, @bomb')).not.toBe(NEXT_LINE_BG);
        editor().textarea.setText(';name Imp\nmov 0, 1\n');
        await press('s', { ctrl: true });
        expect(screen()).not.toContain('runs the last save');
        expect(screen()).toContain('❚❚ paused');
        expect(screen()).toContain('step 0');
        expect(screen()).toContain('next   +0  MOV.I $0, $1');
    });

    test('a warrior whose last process runs DAT dies and the run stops; one with errors does not run', async () => {
        await openPreview();
        editor().textarea.setText(';name Dies\ndat 0, 0\n');
        await press('s', { ctrl: true });
        await press(KeyCodes.F8);
        expect(screen()).toContain('✗ died at step 1');
        expect(screen()).toContain('-1 process');
        expect(screen()).toContain('F7 again');
        editor().textarea.setText(';name Broken\nfoo 0, 1\n');
        await press('s', { ctrl: true });
        expect(screen()).toContain('✗ 1 error: fix and save to run');
    });

    test('F9 goes back to the start, paused; F7 plays', async () => {
        await openPreview();
        await press(KeyCodes.F8);
        await press(KeyCodes.F7);
        expect(screen()).toContain('▶ running');
        await press(KeyCodes.F9);
        expect(screen()).toContain('❚❚ paused');
        expect(screen()).toContain('step 0');
        expect(screen()).toContain('next   +0  ADD.AB #4, $3');
        expect(editor().preview.playing).toBe(false);
        await press(KeyCodes.F7);
        expect(editor().preview.playing).toBe(true);
    });

    test('closing the editor stops the run', async () => {
        await openPreview();
        const preview = editor().preview;
        await press(KeyCodes.F7);
        expect(preview.playing).toBe(true);
        await escape();
        expect(app.overlays.isOpen('editor')).toBe(false);
        expect(preview.playing).toBe(false);
    });
});

describe('modal panels', () => {
    test('footer buttons behind the editor do nothing, so unsaved text survives', async () => {
        await boot();
        await press('n');
        await type(';LOST');
        await clickFooter(' warriors');
        expect(app.overlays.top?.id).toBe('editor');
        expect(editor().text).toContain(';LOST');
        expect(app.overlays.isOpen('warriors')).toBe(false);
    });

    test('a warrior saved from the picker is listed on return to it', async () => {
        await boot();
        await press('w');
        await press('n');
        await press('s', { ctrl: true });
        await escape();
        expect(app.overlays.top?.id).toBe('warriors');
        expect(picker().entries.map((e) => e.entry.id)).toContain('warriors/untitled.red');
        expect(screen()).toContain('untitled');
    });

    test('help scrolls to the end of the legend on a short terminal', async () => {
        await boot(undefined, { width: 100, height: 24 });
        await press('?');
        expect(screen()).toContain('↑/↓ scroll');
        expect(screen()).not.toContain('brighter = executed');
        for (let i = 0; i < 5; i++) await press('[6~'); // PgDn
        expect(screen()).toContain('the pale cell runs on the next step.');
        expect(screen()).toContain("warrior's next instruction");
        expect(app.overlays.top?.id).toBe('help');
    });

    test('help → shows the Redcode reference, ← goes back, and switching resets the scroll', async () => {
        await boot(undefined, { width: 100, height: 30 });
        await press('?');
        expect(screen()).toContain('1/2 Keys');
        await press('\x1b[6~'); // PgDn on page 1
        expect(screen()).not.toMatch(/scroll · 1-/);
        await press('\x1b[C'); // →
        expect(screen()).toContain('2/2 Redcode');
        expect(screen()).toContain('DJN');
        expect(screen()).toMatch(/↑\/↓ scroll · 1-\d+ of \d+/);
        await press('\x1b[6~');
        expect(screen()).toContain('SPL');
        await press('\x1b[D'); // ←
        expect(screen()).toContain('1/2 Keys');
        expect(screen()).toContain('run/pause');
        expect(screen()).toMatch(/↑\/↓ scroll · 1-\d+ of \d+/);
        expect(app.overlays.top?.id).toBe('help');
    });

    test('help page 2 scrolls to its last line and fits the panel at 100×30', async () => {
        await boot(undefined, { width: 100, height: 30 });
        await press('?');
        await press('l');
        const panel = app.overlays.top!.root;
        const inner = (panel.width as number) - 4; // border and padding
        const seen: string[] = [];
        for (let i = 0; i < 10; i++) {
            const rows = screen().split('\n').slice(panel.y + 1, panel.y + (panel.height as number) - 1);
            for (const r of rows) {
                const text = r.slice(panel.x + 2, panel.x + 2 + inner);
                // Lines are not wrapped, so a too-long one would fill the last column.
                expect(text[inner - 1]).toBe(' ');
                seen.push(text.trimEnd());
            }
            await press('\x1b[6~');
        }
        const hint = screen().match(/scroll · (\d+)-(\d+) of (\d+)/)!;
        expect(hint[2]).toBe(hint[3]); // reached the end
        expect(seen.join('\n')).toContain('repeat the lines between');
    });

    test('help page 1 lists the editor keys, fitting the panel at 100×30', async () => {
        await boot(undefined, { width: 100, height: 30 });
        await press('?');
        const panel = app.overlays.top!.root;
        const inner = (panel.width as number) - 4;
        const seen: string[] = [];
        for (let i = 0; i < 4; i++) {
            const rows = screen().split('\n').slice(panel.y + 1, panel.y + (panel.height as number) - 1);
            for (const r of rows) {
                const text = r.slice(panel.x + 2, panel.x + 2 + inner);
                expect(text[inner - 1]).toBe(' ');
                seen.push(text.trimEnd());
            }
            await press('\x1b[6~');
        }
        const all = seen.join('\n');
        expect(all).toContain('F2      vim keys on/off');
        expect(all).toContain('F3      relative numbers on/off');
        expect(all).toContain('F4      format on save, auto-indent, snap on/off');
        expect(all).toContain('F5      autocomplete on/off');
        expect(all).toContain('F6      preview on/off');
        expect(all).not.toContain('gg G, with counts');
        expect(all).toContain('the pale cell runs on the next step.');
    });
});
