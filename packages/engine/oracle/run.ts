/**
 * `bun run oracle`: regenerate the pMARS fixtures from ./pmars and diff this
 * engine against them. Skips (exit 0) when ./pmars is absent. Exits 1 when
 * any unexplained divergence remains.
 *
 *   bun run oracle [--pairs N]   N fuzz pairs per FUZZ_SETTINGS entry (default 1000)
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRng } from '../rng.ts';
import { SAMPLES } from '../samples.ts';
import { FUZZ_MIX, FUZZ_SETTINGS, PSWITCHERS, STANDARD_SETTINGS, assemblyCorpus, fuzzWarrior, type ICorpusEntry } from './corpus.ts';
import { ASSEMBLY_EXCEPTIONS, BATTLE_CHECKPOINTS, FIXTURES, FUZZ_LIMIT, FUZZ_ROUNDS, NAMED_ROUNDS, compareAssembly, compareBattle, type IAssemblyFixture, type IBattleFixture, type IBattleRecord, type IFuzzFixture } from './fixtures.ts';
import { checkpoints, ourMatch, traceHash, type IOracleSettings, type IRoundStartRecord } from './ours.ts';
import { Workspace, pmarsAssembly, pmarsAvailable, pmarsMatch, pmarsRound, pmarsRoundStart, pmarsTrace } from './pmars.ts';

/** Copies of the user warriors, so editing the live `warriors/` and `examples/` folders doesn't change the corpus. */
const USER_WARRIORS = join(import.meta.dir, '../parser/fixtures');

function userWarriors(): ICorpusEntry[] {
    return ['examples', 'warriors'].flatMap((dir) =>
        readdirSync(join(USER_WARRIORS, dir))
            .filter((f) => f.endsWith('.red'))
            .sort()
            .map((f) => `${dir}/${f}`)
            .map((name) => ({ name, source: readFileSync(join(USER_WARRIORS, name), 'utf8') })),
    );
}

const write = (name: string, data: unknown): void => writeFileSync(join(FIXTURES, name), `${JSON.stringify(data)}\n`);

async function battle(ws: Workspace, sources: readonly string[], s: typeof STANDARD_SETTINGS, position: number, rounds: number, ks: readonly number[]): Promise<IBattleRecord> {
    const files = sources.map((source) => ws.file(source));
    const [round, match, trace, starts] = await Promise.all([
        pmarsRound(files, s, position),
        pmarsMatch(files, s, position, rounds),
        pmarsTrace(ws, files, s, position, ks),
        roundStarts(ws, sources, files, s, position, rounds),
    ]);
    return { winner: round.winner ?? -1, end: round.end, match, starts, trace: [trace.length, traceHash(trace)] };
}

/**
 * Where pMARS starts rounds 2..rounds. Each round ends after the number of
 * executions our engine needs for it, so a start that is not found means
 * our previous round diverged.
 */
async function roundStarts(ws: Workspace, sources: readonly string[], files: readonly string[], s: IOracleSettings, position: number, rounds: number): Promise<IRoundStartRecord[]> {
    const starts: IRoundStartRecord[] = [];
    for (let r = 1; r < rounds; r++) {
        const executions = ourMatch(sources, s, position, starts).rounds.map((round) => round.executions);
        const start = await pmarsRoundStart(ws, files, s, position, rounds, executions);
        if (!start) break;
        starts.push({ first: start.first, heads: start.heads, pspace: start.pspace });
    }
    return starts;
}

async function main(): Promise<void> {
    if (!pmarsAvailable()) {
        console.log('oracle: ./pmars not found; nothing to do.');
        return;
    }
    const pairsArg = process.argv.indexOf('--pairs');
    const pairsPerSetting = pairsArg >= 0 ? Number(process.argv[pairsArg + 1]) : 1000;
    const ws = new Workspace();
    const problems: string[] = [];
    try {
        // ---- assembly ----
        const corpus = [...assemblyCorpus(), ...userWarriors(), ...PSWITCHERS];
        const assembly: IAssemblyFixture = {
            settings: STANDARD_SETTINGS,
            entries: await Promise.all(corpus.map(async (e) => ({ ...e, pmars: await pmarsAssembly(ws, e.source, STANDARD_SETTINGS) }))),
        };
        write('assembly.json', assembly);
        const asmProblems = compareAssembly(assembly);
        problems.push(...asmProblems);
        const instructions = assembly.entries.reduce((n, e) => n + e.pmars.instructions.length, 0);
        console.log(`assembly: ${assembly.entries.length} sources, ${instructions} instructions, ${asmProblems.length} divergences (${Object.keys(ASSEMBLY_EXCEPTIONS).length} documented exceptions)`);

        // ---- named warriors at the standard settings ----
        const named = [...Object.entries(SAMPLES).map(([name, source]) => ({ name: `samples/${name}`, source })), ...userWarriors(), ...PSWITCHERS];
        const namedPairs: [number, number, number][] = [];
        named.forEach((_, i) => named.forEach((_, j) => namedPairs.push([i, j, 100 + ((i * 2399 + j * 977) % 7801)])));
        const battles: IBattleFixture = {
            settings: STANDARD_SETTINGS,
            rounds: NAMED_ROUNDS,
            checkpoints: BATTLE_CHECKPOINTS,
            warriors: named,
            pairs: await Promise.all(
                namedPairs.map(async ([i, j, pos]) => ({ w: [i, j] as [number, number], pos, ...(await battle(ws, [named[i]!.source, named[j]!.source], STANDARD_SETTINGS, pos, NAMED_ROUNDS, BATTLE_CHECKPOINTS)) })),
            ),
        };
        write('battles.json', battles);
        const battleProblems = battles.pairs.flatMap((p) => compareBattle(battles.warriors.map((w) => w.source), battles.settings, battles.rounds, battles.checkpoints, p));
        problems.push(...battleProblems);
        console.log(`named battles: ${battles.pairs.length} pairs of ${named.length} warriors, ${battleProblems.length} divergences`);

        // ---- fuzz ----
        const rng = createRng(1994);
        const warriors: string[] = [];
        const pairs: IFuzzFixture['pairs'] = [];
        const jobs: Promise<void>[] = [];
        FUZZ_SETTINGS.forEach((s, si) => {
            for (let n = 0; n < pairsPerSetting; n++) {
                const w = [0, 1].map(() => {
                    warriors.push(fuzzWarrior(rng, FUZZ_MIX[rng.nextInt(FUZZ_MIX.length)]!, s.coresize, s.length));
                    return warriors.length - 1;
                }) as [number, number];
                const pos = s.distance + rng.nextInt(s.coresize - 2 * s.distance + 1);
                const at = pairs.length;
                pairs.push(undefined!);
                jobs.push(battle(ws, [warriors[w[0]]!, warriors[w[1]]!], s, pos, FUZZ_ROUNDS, checkpoints(FUZZ_LIMIT)).then((r) => void (pairs[at] = { s: si, w, pos, ...r })));
            }
        });
        await Promise.all(jobs);
        const fuzz: IFuzzFixture = { settings: FUZZ_SETTINGS, rounds: FUZZ_ROUNDS, limit: FUZZ_LIMIT, warriors, pairs };
        write('fuzz.json', fuzz);
        const fuzzProblems = pairs.flatMap((p) => compareBattle(warriors, FUZZ_SETTINGS[p.s]!, FUZZ_ROUNDS, checkpoints(FUZZ_LIMIT), p));
        problems.push(...fuzzProblems);
        console.log(`fuzz: ${pairs.length} pairs, ${fuzzProblems.length} divergences`);
    } finally {
        ws.dispose();
    }
    for (const p of problems.slice(0, Number(process.env.ORACLE_SHOW ?? 40))) console.log(`  ${p}`);
    if (problems.length > 40) console.log(`  ... and ${problems.length - 40} more`);
    if (problems.length > 0) process.exit(1);
}

await main();
