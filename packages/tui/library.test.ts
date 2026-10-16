import { beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IParseOptions } from '../engine/index.ts';
import { WarriorLibrary, compileWarrior, slugify, uniqueFileName } from './library.ts';
import { fakeParseResult } from './test-fakes.ts';

let root: string;
beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'corewar-lib-'));
    mkdirSync(join(root, 'warriors'));
    writeFileSync(join(root, 'warriors', 'zeta.red'), ';name Zeta\nmov 0, 1\n');
    writeFileSync(join(root, 'warriors', 'alpha.red'), 'BROKEN\n');
    writeFileSync(join(root, 'warriors', 'notes.txt'), 'not a warrior');
    // no examples/ directory: it is simply empty
});

describe('WarriorLibrary', () => {
    test('lists user .red files sorted per directory, then the built-in samples', () => {
        const ids = new WarriorLibrary(root).list().map((e) => e.id);
        expect(ids.slice(0, 2)).toEqual(['warriors/alpha.red', 'warriors/zeta.red']);
        expect(ids).toContain('builtin/dwarf.red');
        expect(ids.some((id) => id.endsWith('.txt'))).toBe(false);
    });

    test('loads file and built-in sources; unknown ids throw', () => {
        const lib = new WarriorLibrary(root);
        expect(lib.load('warriors/zeta.red').source).toContain(';name Zeta');
        expect(lib.load('builtin/imp.red').source).toContain('mov 0, 1');
        expect(() => lib.load('warriors/nope.red')).toThrow('Unknown warrior');
    });
});

describe('compileWarrior', () => {
    const lib = () => new WarriorLibrary(root);

    test('passes parser settings for the match and reports parse errors with line numbers', () => {
        const seen: (IParseOptions | undefined)[] = [];
        const parse = (src: string, o?: IParseOptions) => {
            seen.push(o);
            return src.includes('BROKEN') ? fakeParseResult('', ['unknown opcode']) : fakeParseResult('Zeta');
        };
        const ok = compileWarrior(lib(), 'warriors/zeta.red', parse, { coresize: 80 }, 3, 5);
        expect(ok.result).toBeDefined();
        expect(ok.name).toBe('Zeta');
        expect(seen[0]).toMatchObject({ coresize: 80, warriors: 3, rounds: 5 });
        const bad = compileWarrior(lib(), 'warriors/alpha.red', parse, {}, 2, 1);
        expect(bad.result).toBeUndefined();
        expect(bad.errors).toEqual(['line 1: unknown opcode']);
    });

    test('a parser that throws is reported, not propagated', () => {
        const parse = () => {
            throw new Error('not implemented: parse');
        };
        const r = compileWarrior(lib(), 'builtin/dwarf.red', parse, {}, 2, 1);
        expect(r.errors).toEqual(['parser failed: not implemented: parse']);
    });
});

describe('naming', () => {
    test('slugify makes a file-name slug from ;name, with a fallback', () => {
        expect(slugify('My Imp')).toBe('my-imp');
        expect(slugify('  Ünïcode / Dwarf!! v2 ')).toBe('unicode-dwarf-v2');
        expect(slugify('***')).toBe('untitled');
        expect(slugify('')).toBe('untitled');
    });

    test('uniqueFileName counts up past taken names', () => {
        const taken = new Set(['my-imp.red', 'my-imp-2.red']);
        expect(uniqueFileName('my-imp', (f) => taken.has(f))).toBe('my-imp-3.red');
        expect(uniqueFileName('other', (f) => taken.has(f))).toBe('other.red');
    });
});

describe('WarriorLibrary.save', () => {
    /** A fresh library with one user file in warriors/ and one in examples/. */
    function fresh() {
        const dir = mkdtempSync(join(tmpdir(), 'corewar-save-'));
        mkdirSync(join(dir, 'warriors'));
        mkdirSync(join(dir, 'examples'));
        writeFileSync(join(dir, 'warriors', 'my-imp.red'), ';name My Imp\nmov 0, 1\n');
        writeFileSync(join(dir, 'examples', 'ex.red'), ';name Ex\noriginal\n');
        const lib = new WarriorLibrary(dir);
        const entry = (id: string) => lib.list().find((e) => e.id === id)!;
        const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');
        return { dir, lib, entry, read };
    }

    test('a new warrior is named from ;name and never replaces an existing file', () => {
        const { lib, read } = fresh();
        const saved = lib.save(';name My Imp\nmov 0, 2\n');
        expect(saved.entry.id).toBe('warriors/my-imp-2.red');
        expect(read('warriors/my-imp.red')).toContain('mov 0, 1'); // untouched
        expect(read('warriors/my-imp-2.red')).toContain('mov 0, 2');
        expect(lib.save('mov 0, 1\n').entry.id).toBe('warriors/untitled.red');
        expect(lib.list().map((e) => e.id)).toContain('warriors/my-imp-2.red');
    });

    test('editing a user file saves in place, keeping a .bak of the original once', () => {
        const { dir, lib, entry, read } = fresh();
        const first = lib.save(';name Ex\nfirst edit\n', entry('examples/ex.red'));
        expect(first.entry.id).toBe('examples/ex.red');
        expect(first.backup).toBe(join(dir, 'examples', 'ex.red.bak'));
        lib.save(';name Ex\nsecond edit\n', entry('examples/ex.red'));
        expect(read('examples/ex.red')).toContain('second edit');
        expect(read('examples/ex.red.bak')).toContain('original'); // not replaced by the first edit
        expect(lib.list().some((e) => e.id.endsWith('.bak'))).toBe(false);
    });

    test('an existing .bak is never replaced', () => {
        const { dir, lib, entry, read } = fresh();
        writeFileSync(join(dir, 'warriors', 'my-imp.red.bak'), 'older backup');
        expect(lib.save('new', entry('warriors/my-imp.red')).backup).toBeUndefined();
        expect(read('warriors/my-imp.red.bak')).toBe('older backup');
    });

    test('a built-in sample is saved as a new file in warriors/', () => {
        const { lib, read } = fresh();
        const sample = lib.list().find((e) => e.id === 'builtin/dwarf.red')!;
        const saved = lib.save(lib.load(sample.id).source + '; tweaked\n', sample);
        expect(saved.entry.origin).toBe('warriors');
        expect(read(saved.entry.id)).toContain('; tweaked');
    });

    test('a file the editor created is overwritten without a backup and follows a ;name change', () => {
        const { dir, lib, read } = fresh();
        const a = lib.save(';name Untitled\n').entry;
        expect(lib.save(';name Untitled\nmov 0, 1\n', a)).toEqual({ entry: a });
        const renamed = lib.save(';name Paper Plane\n', a).entry;
        expect(renamed.id).toBe('warriors/paper-plane.red');
        expect(existsSync(a.path!)).toBe(false);
        expect(read('warriors/paper-plane.red')).toBe(';name Paper Plane\n');
        expect(readdirSync(join(dir, 'warriors')).some((f) => f.endsWith('.bak'))).toBe(false);
    });

    test('writes go through a temp file and rename, leaving no temp files behind', () => {
        const { dir, lib, entry } = fresh();
        lib.save(';name One\n');
        lib.save('x', entry('warriors/my-imp.red'));
        expect(readdirSync(join(dir, 'warriors')).sort()).toEqual(['my-imp.red', 'my-imp.red.bak', 'one.red']);
    });

    test('warriors/ can live elsewhere (COREWAR_WARRIORS_DIR)', () => {
        const { dir } = fresh();
        const elsewhere = join(dir, 'elsewhere');
        const lib = new WarriorLibrary(dir, { warriorsDir: elsewhere });
        expect(lib.save(';name Far\n').entry.path).toBe(join(elsewhere, 'far.red'));
        expect(lib.list().filter((e) => e.origin === 'warriors').map((e) => e.id)).toEqual(['warriors/far.red']);
    });
});

describe('WarriorLibrary.delete', () => {
    function fresh() {
        const dir = mkdtempSync(join(tmpdir(), 'corewar-delete-'));
        mkdirSync(join(dir, 'warriors'));
        mkdirSync(join(dir, 'examples'));
        writeFileSync(join(dir, 'warriors', 'my-imp.red'), ';name My Imp\nmov 0, 1\n');
        writeFileSync(join(dir, 'warriors', 'my-imp.red.bak'), 'backup');
        writeFileSync(join(dir, 'examples', 'ex.red'), ';name Ex\n');
        const lib = new WarriorLibrary(dir);
        const entry = (id: string) => lib.list().find((e) => e.id === id)!;
        const ls = (rel: string) => readdirSync(join(dir, rel)).sort();
        return { dir, lib, entry, ls };
    }

    test('moves the file and its .bak into .trash/ in the same directory, hidden from list()', () => {
        const { dir, lib, entry, ls } = fresh();
        const result = lib.delete(entry('warriors/my-imp.red'));
        expect(result.trashDir).toBe(join(dir, 'warriors', '.trash'));
        expect(ls('warriors')).toEqual(['.trash']);
        expect(ls('warriors/.trash')).toEqual(['my-imp.red', 'my-imp.red.bak']);
        expect(readFileSync(join(dir, 'warriors', '.trash', 'my-imp.red'), 'utf8')).toBe(';name My Imp\nmov 0, 1\n');
        expect(lib.list().filter((e) => e.origin !== 'builtin').map((e) => e.id)).toEqual(['examples/ex.red']);
        lib.delete(entry('examples/ex.red'));
        expect(ls('examples/.trash')).toEqual(['ex.red']);
    });

    test('a name already in .trash/ gets a timestamp suffix; nothing in the trash is replaced', () => {
        const { dir, lib, entry, ls } = fresh();
        lib.delete(entry('warriors/my-imp.red'));
        writeFileSync(join(dir, 'warriors', 'my-imp.red'), 'second');
        writeFileSync(join(dir, 'warriors', 'my-imp.red.bak'), 'second backup');
        lib.delete(entry('warriors/my-imp.red'));
        const trash = ls('warriors/.trash');
        expect(trash).toHaveLength(4);
        const moved = trash.find((f) => /^my-imp-\d{8}T\d{6}\.red$/.test(f))!;
        expect(readFileSync(join(dir, 'warriors', '.trash', moved), 'utf8')).toBe('second');
        expect(readFileSync(join(dir, 'warriors', '.trash', `${moved}.bak`), 'utf8')).toBe('second backup');
        expect(readFileSync(join(dir, 'warriors', '.trash', 'my-imp.red'), 'utf8')).toContain('My Imp');
    });

    test('refuses built-in samples and entries that are not library files', () => {
        const { dir, lib, entry } = fresh();
        expect(() => lib.delete(entry('builtin/dwarf.red'))).toThrow("built-in samples can't be deleted");
        expect(() => lib.delete({ id: 'warriors/x.red', name: 'x', origin: 'warriors', path: join(dir, 'outside.red') })).toThrow('Unknown warrior');
    });

    test('respects a moved warriors/ directory', () => {
        const { dir } = fresh();
        const elsewhere = join(dir, 'elsewhere');
        const lib = new WarriorLibrary(dir, { warriorsDir: elsewhere });
        const far = lib.save(';name Far\n').entry;
        expect(lib.delete(far).trashDir).toBe(join(elsewhere, '.trash'));
        expect(readdirSync(elsewhere)).toEqual(['.trash']);
    });
});
