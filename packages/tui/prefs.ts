/**
 * Editor preferences, kept across runs in `$XDG_CONFIG_HOME/corewar-tui/config.json`
 * (`~/.config/corewar-tui/config.json` without it). A missing, unreadable or
 * corrupt file gives the defaults; a value of the wrong type falls back on its own.
 * Toggled in the editor (F2 to F6, or the footer buttons) and saved at once.
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { writeAtomic } from './library.ts';

export interface EditorPrefs {
    vimKeys: boolean;
    relativeNumbers: boolean;
    /** Lay the source out in the canonical style on save (parser/format.ts). */
    formatOnSave: boolean;
    /** Suggest opcodes and directives while typing one (overlays/editor.ts `completionAt`). */
    autocomplete: boolean;
    /** Run the saved warrior beside the text, a step a second (overlays/preview.ts). */
    preview: boolean;
}

export const DEFAULT_PREFS: Readonly<EditorPrefs> = { vimKeys: false, relativeNumbers: true, formatOnSave: true, autocomplete: true, preview: false };

export function defaultConfigPath(env: Record<string, string | undefined> = process.env): string {
    const xdg = env.XDG_CONFIG_HOME;
    return join(xdg && isAbsolute(xdg) ? xdg : join(homedir(), '.config'), 'corewar-tui', 'config.json');
}

export function loadPrefs(path: string): EditorPrefs {
    let data: unknown;
    try {
        data = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        return { ...DEFAULT_PREFS };
    }
    const saved = (typeof data === 'object' && data !== null ? data : {}) as Partial<Record<keyof EditorPrefs, unknown>>;
    const pick = (key: keyof EditorPrefs) => (typeof saved[key] === 'boolean' ? saved[key] : DEFAULT_PREFS[key]);
    return {
        vimKeys: pick('vimKeys'),
        relativeNumbers: pick('relativeNumbers'),
        formatOnSave: pick('formatOnSave'),
        autocomplete: pick('autocomplete'),
        preview: pick('preview'),
    };
}

/** Write atomically (temp file and rename). Throws on I/O errors. */
export function savePrefs(path: string, prefs: EditorPrefs): void {
    mkdirSync(dirname(path), { recursive: true });
    writeAtomic(path, `${JSON.stringify(prefs, null, 2)}\n`);
}
