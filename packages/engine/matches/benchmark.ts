/**
 * Benchmarks (guide.md 11). OWNER: simulator engineer.
 */

import type { IBenchmark, IBenchmarkOpponentResult, IBenchmarkResult, IParseResult, ISimulatorOptions } from '../types.ts';
import { DEFAULT_ROUNDS, PRESETS, parseOptionsFor, timeSeed } from '../options.ts';
import { createRng } from '../rng.ts';
import { DEFAULT_BENCHMARK_SOURCES } from '../samples.ts';
import { parse } from '../parser/index.ts';
import { runMatch } from './match.ts';

/**
 * The default benchmark: samples.ts DEFAULT_BENCHMARK_SOURCES parsed with the
 * given options (standard preset when omitted).
 */
export function defaultBenchmark(options?: ISimulatorOptions, rounds?: number, seed?: number): IBenchmark {
    const settings = { ...(options ?? PRESETS.standard) };
    const benchmark: IBenchmark = {
        name: 'default',
        warriors: DEFAULT_BENCHMARK_SOURCES.map((source) => parse(source, parseOptionsFor(settings))),
        options: settings,
        rounds: rounds ?? DEFAULT_ROUNDS,
    };
    if (seed !== undefined) benchmark.seed = seed;
    return benchmark;
}

/** Play `warrior` against each benchmark warrior; score per opponent and the average. */
export function runBenchmark(warrior: IParseResult, benchmark: IBenchmark): IBenchmarkResult {
    const rng = createRng(benchmark.seed ?? timeSeed());
    const opponents = benchmark.warriors.map((opponent): IBenchmarkOpponentResult => {
        const result = runMatch({
            rounds: benchmark.rounds,
            options: benchmark.options,
            warriors: [{ source: warrior }, { source: opponent }],
            seed: rng.nextUint32(),
        });
        const { won, drawn, lost, given } = result.warriors[0]!;
        return { opponent, won, drawn, lost, score: given };
    });
    const score = opponents.length > 0 ? opponents.reduce((sum, o) => sum + o.score, 0) / opponents.length : 0;
    return { warrior, opponents, score };
}
