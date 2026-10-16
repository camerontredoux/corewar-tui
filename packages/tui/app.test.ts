import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestRenderer, type TestRendererSetup } from '@opentui/core/testing';
import { createApp, type App } from './app.ts';
import { SPEEDS } from './controller.ts';
import type { SegmentText } from './ui.ts';
import type { SettingsOverlay } from './overlays/settings.ts';
import { resolveOptions } from '../engine/index.ts';
import { FakeSimulator, cellAt, fakeParseResult } from './test-fakes.ts';

let root: string;
beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'corewar-app-'));
    mkdirSync(join(root, 'warriors'));
    mkdirSync(join(root, 'examples'));
    writeFileSync(join(root, 'warriors', 'alpha.red'), ';name Alpha\n');
    writeFileSync(join(root, 'warriors', 'beta.red'), ';name Beta\n');
    writeFileSync(join(root, 'examples', 'broken.red'), ';name Broken\nBROKEN\n');
});

const fakeParse = (src: string) => {
    const name = /;name (\w+)/.exec(src)?.[1] ?? 'anon';
    return src.includes('BROKEN') ? fakeParseResult(name, ['unknown opcode']) : fakeParseResult(name);
};

let s: TestRendererSetup;
let app: App;
let sim: FakeSimulator;
let quits = 0;

/** `coresize` replaces the standard preset's core size, for tests of a large board. */
async function boot(width = 120, height = 36, coresize?: number) {
    s = await createTestRenderer({ width, height, kittyKeyboard: true });
    sim = new FakeSimulator();
    quits = 0;
    app = createApp(s.renderer, { root, simulator: sim, parse: fakeParse, autoTick: false, seed: 7, onQuit: () => quits++ });
    if (coresize !== undefined) {
        const c = app.controller;
        c.startMatch(c.warriors, { ...c.settings, options: { ...c.settings.options, coresize } }, 7);
        app.refresh();
    }
    await s.renderOnce();
}

afterEach(async () => {
    app?.destroy();
    await s?.dispose();
});

async function press(key: string, mods?: { ctrl?: boolean }) {
    s.mockInput.pressKey(key, mods);
    await s.flush();
    await s.renderOnce();
}

/** Click the first occurrence of `text` on screen. */
async function clickText(text: string) {
    const rows = s.captureCharFrame().split('\n');
    const y = rows.findIndex((r) => r.includes(text));
    if (y < 0) throw new Error(`"${text}" not on screen`);
    await s.mockMouse.click(rows[y]!.indexOf(text), y);
    await s.renderOnce();
}

const screen = () => s.captureCharFrame();
const plain = (t: SegmentText) => t.plain().join('\n');

describe('app', () => {
    test('starts a paused default match from the user warriors with a status header and key-hint footer', async () => {
        await boot();
        expect(app.controller.warriors.map((w) => w.id)).toEqual(['warriors/alpha.red', 'warriors/beta.red']);
        const header = plain(app.header);
        expect(header).toContain('Alpha');
        expect(header).toContain('Beta');
        expect(header).toContain('cycle 0/80,000');
        expect(header).toContain('round 1/10');
        expect(header).toContain('PAUSED');
        expect(screen()).toContain('CORE 4000');
        expect(plain(app.footer)).toContain('n New');
        expect(plain(app.footer)).toContain('q quit');
    });

    test('the header marks the warrior that moves on the next step with ▶', async () => {
        await boot();
        const marked = () => ['Alpha', 'Beta'].filter((n) => plain(app.header).includes(`▶ ${n}`));
        const first = marked();
        expect(first).toHaveLength(1);
        await press('.');
        expect(marked()).toEqual(first[0] === 'Alpha' ? ['Beta'] : ['Alpha']);
    });

    test('the header leaves out warrior names when they do not fit', async () => {
        await boot(90, 30);
        const header = plain(app.header);
        expect(header).not.toContain('Alpha');
        expect(header).toMatch(/[▶●] 1p 0w [▶●] 1p 0w/);
        expect(header).toContain('PAUSED');
    });

    test('the header pages through warriors that do not fit with its ‹ › buttons', async () => {
        await boot(90, 30);
        const c = app.controller;
        c.startMatch(Array.from({ length: 12 }, () => c.warriors[0]!), c.settings, 7);
        app.refresh();
        await s.renderOnce();
        const strip = () => plain(app.header).split('›')[0]!;
        const shown = () => strip().match(/[▶●] 1p 0w/g)?.length ?? 0;
        expect(plain(app.header)).toContain('PAUSED');
        expect(shown()).toBeGreaterThan(0);
        expect(shown()).toBeLessThan(12);
        expect(strip()).toContain('▶'); // warrior 0 moves first and is on the first page
        const pages = Math.ceil(12 / shown());
        // Clicking › keeps its hover highlight although the header is rebuilt.
        const arrowX = plain(app.header).indexOf('›');
        await s.mockMouse.moveTo(arrowX, 0);
        await s.renderOnce();
        const hoverBg = cellAt(s.captureSpans(), arrowX, 0).bg;
        await clickText('›');
        expect(cellAt(s.captureSpans(), arrowX, 0).bg).toBe(hoverBg);
        expect(hoverBg).not.toBe(cellAt(s.captureSpans(), arrowX + 2, 0).bg);
        expect(strip()).not.toContain('▶');
        for (let i = 2; i < pages; i++) await clickText('›');
        await clickText('›'); // already at the end: nothing more to show
        expect(strip()).not.toContain('▶');
        for (let i = 0; i < pages; i++) await clickText('‹');
        expect(strip()).toContain('▶');
        // The › button stays in place when a process count grows.
        const column = plain(app.header).indexOf('›');
        c.processes[0]!.taskCount = 775;
        app.refresh();
        expect(plain(app.header)).toContain('▶ 775p 0w');
        expect(plain(app.header).indexOf('›')).toBe(column);
    });

    test('keys drive the controller', async () => {
        await boot();
        const c = app.controller;
        await press(' ');
        expect(c.phase).toBe('running');
        app.tick();
        expect(sim.view.executions).toBe(100);
        await press('+');
        expect(c.speed).toBe(SPEEDS[SPEEDS.indexOf(100) + 1]!);
        await press('-');
        await press('-');
        expect(c.speed).toBe(50);
        await press('.');
        expect(c.phase).toBe('paused');
        expect(sim.view.executions).toBe(101);
        await press('r');
        expect(sim.view.executions).toBe(0);
        expect(sim.initialised).toHaveLength(2);
        await press('f');
        expect(app.board.fade).toBe(true);
        await press('q');
        await press('c', { ctrl: true });
        expect(quits).toBe(2);
    });

    test('footer and header buttons are clickable', async () => {
        await boot();
        await clickText('run/pause');
        expect(app.controller.phase).toBe('running');
        await clickText('RUNNING');
        expect(app.controller.phase).toBe('paused');
        await clickText('n New');
        expect(app.overlays.top?.id).toBe('editor');
        expect(screen()).toContain('NEW WARRIOR');
    });

    test('clicking a core cell opens the inspector for that address; arrows move it; escape closes it', async () => {
        await boot();
        await press('.');
        const l = app.board.layout;
        // the first executed cell (address 0) and its neighbour
        await s.mockMouse.click(app.board.x + l.offsetX + l.cellW, app.board.y + l.offsetY);
        await s.renderOnce();
        expect(app.overlays.top?.id).toBe('inspector');
        expect(app.board.selected).toBe(1);
        expect(screen()).toContain('CELL 1');
        expect(screen()).toContain('MOV.I $0, $1');
        await press('\x1b[D'); // left arrow
        expect(app.board.selected).toBe(0);
        expect(screen()).toContain('executed by Alpha');
        s.mockInput.pressEscape();
        await s.flush();
        await s.renderOnce();
        expect(app.overlays.stack).toHaveLength(0);
        expect(app.board.selected).toBeNull();
    });

    test('the warrior picker shows parse errors, blocks game keys, and starts the chosen match', async () => {
        await boot();
        await press('w');
        expect(app.overlays.top?.id).toBe('warriors');
        expect(screen()).toContain('broken');
        expect(screen()).toContain('✗ 1 error');
        await press(' '); // toggles the first entry (alpha) off; the game must not start running
        expect(app.controller.phase).toBe('paused');
        await clickText('broken');
        expect(screen()).toContain("has parse errors and can't join a match");
        expect(screen()).toContain('line 1: unknown opcode');
        await clickText('dwarf'); // a built-in sample
        await press('\r');
        expect(app.overlays.stack).toHaveLength(0);
        expect(app.controller.warriors.map((w) => w.id)).toEqual(['warriors/beta.red', 'builtin/dwarf.red']);
        expect(app.controller.phase).toBe('running');
    });

    test('settings change the core size and restart the match; invalid values are rejected', async () => {
        await boot();
        await press('s');
        expect(app.overlays.top?.id).toBe('settings');
        await press('\x1b[B'); // down to core size
        for (const d of '800') await press(d);
        await press('\r');
        expect(app.overlays.stack).toHaveLength(0);
        expect(app.controller.coresize).toBe(800);
        expect(sim.view.size).toBe(800);
        expect(app.controller.settings.preset).toBe('custom');
        expect(screen()).toContain('CORE 800');

        await press('s');
        await press('\x1b[B');
        await press('0');
        await press('\r');
        expect(app.overlays.top?.id).toBe('settings');
        expect(screen()).toContain('coresize must be a positive integer');
    });

    test('the standard preset has a 4000-cell core, also when picked again in settings', async () => {
        await boot();
        expect(app.controller.settings.preset).toBe('standard');
        expect(app.controller.coresize).toBe(4000);
        await press('s');
        await press('\x1b[C'); // next preset
        expect((app.overlays.top as SettingsOverlay).draft.preset).not.toBe('standard');
        await press('\x1b[D'); // back to standard
        await press('\r');
        expect(app.controller.settings.preset).toBe('standard');
        expect(sim.view.size).toBe(4000);
        expect(resolveOptions(app.controller.settings.options).pSpaceSize).toBe(250); // follows the core size
    });

    test('the end of the match opens the results', async () => {
        await boot();
        sim.winAt = 3;
        app.controller.settings.rounds = 1;
        await press(' ');
        app.tick();
        await s.renderOnce();
        expect(app.controller.phase).toBe('match-over');
        expect(app.overlays.top?.id).toBe('results');
        expect(screen()).toContain('MATCH OVER');
        expect(screen()).toMatch(/Alpha\s+1\s+0\s+0\s+300\.0/);
    });

    test('resizing the terminal reflows the board and the bars', async () => {
        await boot(120, 36, 8000);
        const before = app.board.layout;
        s.resize(200, 60);
        await s.flush();
        await s.renderOnce();
        const after = app.board.layout;
        expect(after.mode).toBe('glyph');
        expect(before.mode).toBe('half');
        expect(plain(app.header)).toHaveLength(200);
        expect(plain(app.footer)).toHaveLength(200);
        expect(screen().split('\n')[59]).toContain('q quit');
    });

    test('z toggles fit and detail; a detail board scrolls and clicks map through the scroll', async () => {
        await boot(160, 50, 8000);
        const b = app.board;
        expect(b.layout.mode).toBe('half');
        await press('z');
        expect([b.modeOverride, b.layout.mode]).toEqual(['detail', 'glyph']);
        expect(plain(app.footer)).toContain('zoom: detail (1 cell per address, scrolls)');
        expect(screen()).toContain('zoom: detail');
        expect(screen()).toMatch(/rows 1-\d+\/\d+ · ↑\/↓ scroll/);
        await s.mockMouse.scroll(b.x + 5, b.y + 5, 'down');
        await s.renderOnce();
        expect(b.scroll).toBe(3);
        expect(screen()).toContain('rows 4-');
        const l = b.layout;
        await s.mockMouse.click(b.x + l.offsetX + 7, b.y + l.offsetY + 2);
        await s.renderOnce();
        expect(b.selected).toBe((2 + 3) * l.cols + 7);
        s.mockInput.pressEscape();
        await s.flush();
        await press('\x1b[6~'); // PgDn
        expect(b.scroll).toBe(Math.min(3 + l.visibleLines - 1, l.lines - l.visibleLines));
        await press('\x1b[A'); // ↑ scrolls too, for keyboards without PgUp/PgDn
        expect(b.scroll).toBe(0);
        await press('\x1b[B'); // ↓
        expect(b.scroll).toBeGreaterThan(0);
        await press('z');
        expect([b.modeOverride, b.layout.mode]).toEqual(['fit', 'half']);
        expect(plain(app.footer)).toContain('zoom: fit to screen');
        expect(screen()).not.toContain('zoom: detail');
    });

    test('enter opens the inspector on the first visible cell, arrows move it, enter closes it', async () => {
        await boot(160, 50, 8000);
        const b = app.board;
        await press('z'); // detail: scrolls
        await press('\x1b[B'); // scroll down a page
        const l = b.layout;
        const first = b.scroll * l.cols;
        expect(b.scroll).toBeGreaterThan(0);
        await press('\r');
        expect(app.overlays.isOpen('inspector')).toBe(true);
        expect(b.selected).toBe(first);
        expect(screen()).toContain(`CELL ${first}`);
        await press('\x1b[C'); // → moves the selection
        expect(b.selected).toBe(first + 1);
        await press('\r');
        expect(app.overlays.isOpen('inspector')).toBe(false);
        await press('\r'); // reopens on the same cell while it is still on screen
        expect(b.selected).toBe(first + 1);
    });

    test('help and the editor open as overlays and close with escape', async () => {
        await boot();
        await press('?');
        expect(screen()).toContain('fade old marks');
        await press('?');
        expect(app.overlays.stack).toHaveLength(0);
        app.openEditor({ mode: 'edit', warrior: app.library.list()[0] });
        await s.renderOnce();
        expect(screen()).toContain('EDIT warriors/alpha.red');
        expect(screen()).toContain(';name Alpha');
        s.mockInput.pressEscape();
        await s.flush();
        expect(app.overlays.stack).toHaveLength(0);
    });
});
