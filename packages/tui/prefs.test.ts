/** Where the editor preferences live, and reading and writing them. */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PREFS, defaultConfigPath, loadPrefs, savePrefs } from './prefs.ts';

describe('prefs', () => {
    test('the file is under $XDG_CONFIG_HOME, else ~/.config (a relative XDG path is ignored, per the spec)', () => {
        expect(defaultConfigPath({ XDG_CONFIG_HOME: '/x/conf' })).toBe('/x/conf/corewar-tui/config.json');
        expect(defaultConfigPath({})).toBe(join(homedir(), '.config', 'corewar-tui', 'config.json'));
        expect(defaultConfigPath({ XDG_CONFIG_HOME: 'conf' })).toBe(join(homedir(), '.config', 'corewar-tui', 'config.json'));
    });

    test('a missing file gives the defaults: vim keys off, relative numbers, format on save and autocomplete on', () => {
        const dir = mkdtempSync(join(tmpdir(), 'corewar-prefs-'));
        expect(loadPrefs(join(dir, 'none.json'))).toEqual({ vimKeys: false, relativeNumbers: true, formatOnSave: true, autocomplete: true });
        expect(DEFAULT_PREFS).toEqual({ vimKeys: false, relativeNumbers: true, formatOnSave: true, autocomplete: true });
    });

    test('save creates the directory, round-trips, and leaves no temp file behind', () => {
        const dir = mkdtempSync(join(tmpdir(), 'corewar-prefs-'));
        const path = join(dir, 'corewar-tui', 'config.json');
        savePrefs(path, { vimKeys: true, relativeNumbers: false, formatOnSave: true, autocomplete: true });
        expect(loadPrefs(path)).toEqual({ vimKeys: true, relativeNumbers: false, formatOnSave: true, autocomplete: true });
        savePrefs(path, { vimKeys: false, relativeNumbers: false, formatOnSave: false, autocomplete: true });
        expect(loadPrefs(path)).toEqual({ vimKeys: false, relativeNumbers: false, formatOnSave: false, autocomplete: true });
        expect(readdirSync(join(dir, 'corewar-tui'))).toEqual(['config.json']);
    });

    test('a corrupt file or wrong types fall back per key', () => {
        const dir = mkdtempSync(join(tmpdir(), 'corewar-prefs-'));
        const path = join(dir, 'config.json');
        writeFileSync(path, '{"vimKeys": tru');
        expect(loadPrefs(path)).toEqual(DEFAULT_PREFS);
        writeFileSync(path, 'null');
        expect(loadPrefs(path)).toEqual(DEFAULT_PREFS);
        writeFileSync(path, '{"vimKeys": true, "relativeNumbers": "no", "formatOnSave": 1}');
        expect(loadPrefs(path)).toEqual({ vimKeys: true, relativeNumbers: true, formatOnSave: true, autocomplete: true });
        writeFileSync(path, '{"formatOnSave": false}');
        expect(loadPrefs(path)).toEqual({ vimKeys: false, relativeNumbers: true, formatOnSave: false, autocomplete: true });
        writeFileSync(path, '{"autocomplete": false}');
        expect(loadPrefs(path)).toEqual({ ...DEFAULT_PREFS, autocomplete: false });
    });
});
