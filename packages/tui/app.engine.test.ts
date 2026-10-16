/** The app against the real parser and simulator (no fakes). */

import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestRenderer, type TestRendererSetup } from '@opentui/core/testing';
import { PRESETS } from '../engine/index.ts';
import { createApp, type App } from './app.ts';
import { SPEEDS } from './controller.ts';
import { pspaceText } from './overlays/inspector.ts';
import { hex } from './test-fakes.ts';

let s: TestRendererSetup;
let app: App;

afterEach(async () => {
    app?.destroy();
    await s?.dispose();
});

async function boot() {
    s = await createTestRenderer({ width: 160, height: 50 });
    const root = mkdtempSync(join(tmpdir(), 'corewar-engine-')); // no user warriors: built-ins only
    app = createApp(s.renderer, { root, autoTick: false, seed: 3, initialWarriors: ['builtin/dwarf.red', 'builtin/imp.red'] });
    await s.renderOnce();
}

test('a real match runs: the board shows the warriors, the inspector disassembles, and the results appear', async () => {
    await boot();
    const c = app.controller;
    expect(c.phase).toBe('paused');
    expect(c.warriors.map((w) => w.name)).toEqual(['dwarf', 'imp']);

    c.stepOnce();
    app.refresh();
    await s.renderOnce();
    const view = c.view!;
    expect(view.cycle).toBeGreaterThan(0);
    const first = view.lastExecuted;
    expect(view.accessKind[first]).not.toBe(0);

    // The cell executed last is drawn as the current instruction (white) and inspects as real code.
    app.inspect(first);
    await s.renderOnce();
    expect(s.captureCharFrame()).toContain(`CELL ${first}`);
    expect(s.captureCharFrame()).toMatch(/executed by (dwarf|imp)/);
    // The P-space of the warrior that touched the cell: before any round has ended, cell 0 is -1.
    expect(s.captureCharFrame()).toMatch(/p-space\s+0:-1/);

    // Short rounds at full speed until the match ends.
    c.startMatch(c.warriors, { preset: 'nano', options: { ...PRESETS.nano }, rounds: 3 }, 3, true);
    c.speedIndex = SPEEDS.length - 1;
    for (let i = 0; i < 200 && c.phase !== 'match-over'; i++) {
        app.tick();
        if (c.phase === 'round-over') c.nextRound();
    }
    await s.renderOnce();
    expect(c.phase).toBe('match-over');
    expect(app.overlays.top?.id).toBe('results');
    const tallies = c.status().map((w) => w.won + w.drawn + w.lost);
    expect(tallies).toEqual([3, 3]);
    expect(s.captureCharFrame()).toContain('MATCH OVER');
    // the board is not left blank: some cell carries a warrior colour
    const frame = s.captureSpans();
    const colours = new Set(frame.lines.flatMap((l) => l.spans.map((sp) => hex(sp.fg))));
    expect(colours.size).toBeGreaterThan(3);
});

test('pspaceText lists cell 0 and the non-zero cells, signed, cut to the width', () => {
    expect(pspaceText([7999, 0, 5, 0, 7990], 8000)).toBe('0:-1 2:5 4:-10');
    expect(pspaceText([2, 0, 0], 8000)).toBe('0:2');
    expect(pspaceText([1, 11, 12, 13, 14, 15], 8000, 12)).toBe('0:1 1:11 2:…');
});
