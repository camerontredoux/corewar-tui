/**
 * Warrior library: the user's `.red` files in `warriors/` and `examples/`
 * (relative to the project root) plus the engine's built-in samples.
 *
 * The writers are `save()`, used by the warrior editor, and `delete()`, used by
 * the picker. Save writes atomically, never overwrites a file other than the one
 * being edited, and keeps a one-time `.bak` before it first overwrites a file
 * the app did not create. Delete never unlinks: it renames the file (and its
 * `.bak`) into a `.trash/` folder next to it, which `list()` does not scan.
 */

import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
    MessageType,
    parseOptionsFor,
    samples,
    type IParseResult,
    type ISimulatorOptions,
    type parse as engineParse,
} from '../engine/index.ts';

export type WarriorOrigin = 'warriors' | 'examples' | 'builtin';

export interface WarriorEntry {
    /** Stable id: "warriors/dwarf.red", "examples/x.red" or "builtin/dwarf.red". */
    id: string;
    /** File name without `.red`. */
    name: string;
    origin: WarriorOrigin;
    /** Absolute path for file-backed entries. */
    path?: string;
}

export interface LoadedWarrior {
    entry: WarriorEntry;
    source: string;
}

/** Directories scanned, in display order. */
export const LIBRARY_DIRS = ['warriors', 'examples'] as const;

export interface SaveResult {
    entry: WarriorEntry;
    /** Path of the backup made before this save overwrote the file, if one was made. */
    backup?: string;
}

export interface DeleteResult {
    /** The `.trash/` directory the file was moved into. */
    trashDir: string;
    /** New path of the file in the trash. */
    trashed: string;
}

export class WarriorLibrary {
    /** Where `warriors/` entries live: `<root>/warriors` unless overridden. */
    readonly warriorsDir: string;
    /** Files this library created (this session); they get no `.bak` and follow `;name` renames. */
    private readonly created = new Set<string>();

    constructor(
        readonly root: string,
        options: { warriorsDir?: string } = {},
    ) {
        this.warriorsDir = options.warriorsDir ?? join(root, 'warriors');
    }

    private dirPath(dir: (typeof LIBRARY_DIRS)[number]): string {
        return dir === 'warriors' ? this.warriorsDir : join(this.root, dir);
    }

    /** Every warrior, user files first (sorted by name within a directory), then built-ins. */
    list(): WarriorEntry[] {
        const out: WarriorEntry[] = [];
        for (const dir of LIBRARY_DIRS) {
            let files: string[];
            try {
                files = readdirSync(this.dirPath(dir));
            } catch {
                continue; // a missing directory is just empty
            }
            for (const file of files.filter((f) => f.toLowerCase().endsWith('.red')).sort()) {
                out.push({ id: `${dir}/${file}`, name: file.slice(0, -4), origin: dir, path: join(this.dirPath(dir), file) });
            }
        }
        for (const file of Object.keys(samples.SAMPLES)) {
            out.push({ id: `builtin/${file}`, name: file.slice(0, -4), origin: 'builtin' });
        }
        return out;
    }

    /** The source text of one warrior. Throws if the id is unknown or the file can't be read. */
    load(id: string): LoadedWarrior {
        const entry = this.list().find((e) => e.id === id);
        if (!entry) throw new Error(`Unknown warrior: ${id}`);
        const source = entry.path ? readFileSync(entry.path, 'utf8') : samples.SAMPLES[entry.id.slice('builtin/'.length)]!;
        return { entry, source };
    }

    /**
     * Save editor source and return the saved entry.
     * - No entry, or a built-in sample (read-only): a new file in `warriors/`
     *   named from `;name`, never replacing an existing file.
     * - A file in `warriors/` or `examples/`: written back in place. Before the
     *   first overwrite of a file this library did not create, a copy is kept as
     *   `<file>.bak` (unless one exists already).
     * - A file created by this library: renamed to follow a changed `;name`.
     * Writes are atomic (temp file in the same directory, then rename). Throws on I/O errors.
     */
    save(source: string, entry?: WarriorEntry): SaveResult {
        if (entry?.path && this.created.has(entry.path)) {
            const wanted = `${slugify(metaName(source))}.red`;
            if (basename(entry.path) === wanted || dirname(entry.path) !== this.warriorsDir) {
                writeAtomic(entry.path, source);
                return { entry };
            }
            const saved = this.saveNew(source);
            unlinkSync(entry.path);
            this.created.delete(entry.path);
            return saved;
        }
        if (entry?.path) {
            const backup = `${entry.path}.bak`;
            let made: string | undefined;
            if (existsSync(entry.path)) {
                try {
                    copyFileSync(entry.path, backup, constants.COPYFILE_EXCL);
                    made = backup;
                } catch (e) {
                    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
                }
            }
            writeAtomic(entry.path, source);
            return made ? { entry, backup: made } : { entry };
        }
        return this.saveNew(source);
    }

    /**
     * Delete a `warriors/` or `examples/` file by moving it, and its `.bak` if
     * there is one, into `.trash/` in the same directory. A name already in the
     * trash gets a timestamp suffix (`my-imp-20261014T153012.red`). Built-in
     * samples are read-only. Throws on unknown entries and I/O errors.
     */
    delete(entry: WarriorEntry): DeleteResult {
        if (entry.origin === 'builtin') throw new Error("built-in samples can't be deleted");
        const path = this.list().find((e) => e.id === entry.id && e.path === entry.path)?.path;
        if (!path) throw new Error(`Unknown warrior: ${entry.id}`);
        const trashDir = join(dirname(path), '.trash');
        mkdirSync(trashDir, { recursive: true });
        const name = basename(path);
        const taken = (f: string) => existsSync(join(trashDir, f)) || existsSync(join(trashDir, `${f}.bak`));
        const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
        const file = taken(name) ? uniqueFileName(`${name.slice(0, -4)}-${stamp}`, taken) : name;
        const trashed = join(trashDir, file);
        renameSync(path, trashed);
        if (existsSync(`${path}.bak`)) renameSync(`${path}.bak`, `${trashed}.bak`);
        this.created.delete(path);
        return { trashDir, trashed };
    }

    private saveNew(source: string): SaveResult {
        mkdirSync(this.warriorsDir, { recursive: true });
        const file = uniqueFileName(slugify(metaName(source)), (f) => existsSync(join(this.warriorsDir, f)));
        const path = join(this.warriorsDir, file);
        writeAtomic(path, source, true);
        this.created.add(path);
        return { entry: { id: `warriors/${file}`, name: file.slice(0, -4), origin: 'warriors', path } };
    }
}

/** The `;name` metadata of a source, or ''. */
export function metaName(source: string): string {
    return /^[ \t]*;[ \t]*name\b[ \t]*(.*)$/im.exec(source)?.[1]?.trim() ?? '';
}

/** File-name slug: "My Imp!" -> "my-imp"; '' -> "untitled". */
export function slugify(name: string): string {
    const slug = name
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48)
        .replace(/-+$/, '');
    return slug || 'untitled';
}

/** `<slug>.red`, or `<slug>-2.red`, `<slug>-3.red`, ... when taken. */
export function uniqueFileName(slug: string, taken: (file: string) => boolean): string {
    let file = `${slug}.red`;
    for (let n = 2; taken(file); n++) file = `${slug}-${n}.red`;
    return file;
}

/**
 * Write via a temp file in the same directory and a rename, so a crash never
 * leaves a half-written warrior. `exclusive` refuses to replace an existing file.
 */
export function writeAtomic(path: string, text: string, exclusive = false): void {
    const temp = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now().toString(36)}.tmp`);
    writeFileSync(temp, text, { flag: 'wx' });
    try {
        if (exclusive && existsSync(path)) throw new Error(`${basename(path)} already exists`);
        renameSync(temp, path);
    } catch (e) {
        try {
            unlinkSync(temp);
        } catch {}
        throw e;
    }
}

export interface CompiledWarrior {
    entry: WarriorEntry;
    source: string;
    /** Set when the warrior parsed without errors. */
    result?: IParseResult;
    /** Display name: `;name` when present, else the file name. */
    name: string;
    /** Error lines ("line 3: ...") when loading or parsing failed. */
    errors: string[];
}

/**
 * Load and parse one warrior with parser settings matching the match options.
 * `kept` is the copy already loaded for the match: it is used when the warrior
 * is no longer in the library (deleted to `.trash/`).
 * Never throws: read and parse failures come back as `errors`.
 */
export function compileWarrior(
    library: WarriorLibrary,
    id: string,
    parse: typeof engineParse,
    options: ISimulatorOptions,
    warriorCount: number,
    rounds: number,
    kept?: LoadedWarrior,
): CompiledWarrior {
    let loaded: LoadedWarrior;
    try {
        loaded = library.load(id);
    } catch (e) {
        const entry = library.list().find((x) => x.id === id);
        if (!entry && kept) loaded = kept;
        else return { entry: entry ?? { id, name: id, origin: 'builtin' }, source: '', name: entry?.name ?? id, errors: [errorText(e)] };
    }
    const { entry, source } = loaded;
    try {
        const result = parse(source, parseOptionsFor(options, warriorCount, rounds));
        const errors = result.messages
            .filter((m) => m.type === MessageType.Error)
            .map((m) => `line ${m.position.line}: ${m.text}`);
        const name = result.metaData.name || entry.name;
        return errors.length ? { entry, source, name, errors } : { entry, source, name, errors, result };
    } catch (e) {
        return { entry, source, name: entry.name, errors: [`parser failed: ${errorText(e)}`] };
    }
}

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
