/**
 * The engine against recorded pMARS 0.9.5 answers (fixtures/*.json, made by
 * `bun run oracle`). pMARS itself is not needed here.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    ASSEMBLY_EXCEPTIONS,
    FIXTURES,
    compareAssembly,
    compareBattle,
    type IAssemblyFixture,
    type IBattleFixture,
    type IFuzzFixture,
} from './fixtures.ts';
import { checkpoints, ourAssembly } from './ours.ts';

const load = <T>(name: string): T => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T;

const assembly = load<IAssemblyFixture>('assembly.json');
const battles = load<IBattleFixture>('battles.json');
const fuzz = load<IFuzzFixture>('fuzz.json');

describe('assembly matches pmars -A', () => {
    test.each(assembly.entries.map((entry) => [entry.name, entry] as const))('%s', (_, entry) => {
        expect(compareAssembly({ settings: assembly.settings, entries: [entry] })).toEqual([]);
    });

    test.each(Object.keys(ASSEMBLY_EXCEPTIONS))('documented exception still differs: %s', (name) => {
        const entry = assembly.entries.find((e) => e.name === name);
        expect(entry).toBeDefined();
        const ours = ourAssembly(entry!.source, assembly.settings);
        expect(ours).not.toEqual(entry!.pmars);
    });
});

describe('named warriors battle as in pmars', () => {
    const sources = battles.warriors.map((w) => w.source);
    test.each(battles.pairs.map((pair) => [battles.warriors[pair.w[0]]!.name, battles.warriors[pair.w[1]]!.name, pair] as const))(
        '%s vs %s',
        (_, __, pair) => {
            expect(compareBattle(sources, battles.settings, battles.rounds, battles.checkpoints, pair)).toEqual([]);
        },
    );
});

describe('fuzzed warriors battle as in pmars', () => {
    const ks = checkpoints(fuzz.limit);
    const CHUNK = 50;
    const chunks: [number, number][] = [];
    for (let i = 0; i < fuzz.pairs.length; i += CHUNK) chunks.push([i, Math.min(i + CHUNK, fuzz.pairs.length)]);

    test('the corpus has a few thousand pairs', () => {
        expect(fuzz.pairs.length).toBeGreaterThanOrEqual(3000);
    });

    test.each(chunks)('pairs %i to %i', (from, to) => {
        const problems = fuzz.pairs.slice(from, to).flatMap((pair) => compareBattle(fuzz.warriors, fuzz.settings[pair.s]!, fuzz.rounds, ks, pair));
        expect(problems).toEqual([]);
    });
});
