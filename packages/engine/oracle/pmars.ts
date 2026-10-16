/**
 * pMARS as a black-box oracle: run ./pmars and read its output into the
 * normalised forms of ours.ts. Only run.ts uses this file; the tests read the
 * recorded fixtures instead, so `bun test` never needs pMARS.
 *
 * Conventions found by experiment (pMARS 0.9.5):
 * - `-A` prints the load file; numbers are signed, folded into the core.
 * - `-F pos` loads warrior 2 at `pos` (warrior 1 is always at 0).
 *   Warrior 1 moves first in round 1, warrior 2 in round 2, and so on.
 * - `-c n`: the round is a tie unless it ends within n passes over the
 *   warriors, so the smallest n that gives the win is the pass of the last
 *   execution.
 * - The `-e` debugger reads commands from stdin. `write <file>` logs its
 *   output as plain text, `skip n` executes n + 1 instructions and `s` one,
 *   `list a,b` prints core cells (blank for DAT.F $0, $0) and `registers`
 *   prints the remaining cycles, the warrior to move next and each warrior's
 *   task count and queue, with the next pointer in brackets (the rest of the
 *   queue is shown only partially).
 * - Listings longer than a screen stop at a pager prompt; `a` shows the rest.
 * - In `-r n -F pos`, only round 1 uses `pos`; later rounds place warrior 2
 *   at random (the same sequence on every run). The debugger keeps stepping
 *   across rounds, so `registers` after a round's last execution shows the
 *   next round's placement and first mover.
 * - `registers` also prints each warrior's P-space as `P-space[k]: <c0> c1
 *   ... c9 ..` (cell 0 in brackets, values folded into the core). It always
 *   shows 10 cells; past a smaller P-space they are not P-space cells.
 * - `-A` prints a `PIN n` line before END when the warrior has a PIN.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pspaceSize, pspaceText, queueText, stateText, type IAssembly, type IMatchTotals, type IOracleSettings, type IRoundOutcome } from './ours.ts';

export const PMARS = join(import.meta.dir, '../../../pmars');

export const pmarsAvailable = (): boolean => existsSync(PMARS);

const settingArgs = (s: IOracleSettings, cycles = s.cycles): string[] => [
    ...['-s', `${s.coresize}`, '-c', `${cycles}`, '-p', `${s.processes}`, '-l', `${s.length}`, '-d', `${s.distance}`],
    ...(s.pspace === undefined ? [] : ['-S', `${s.pspace}`]),
];

/** Concurrency limit for pMARS processes. */
let slots = Math.max(1, navigator.hardwareConcurrency - 2);
const waiting: (() => void)[] = [];

async function run(argv: string[], stdin?: string): Promise<{ code: number; stdout: string }> {
    while (slots === 0) await new Promise<void>((resolve) => waiting.push(resolve));
    slots--;
    try {
        const proc = Bun.spawn([PMARS, ...argv], {
            stdin: stdin === undefined ? 'ignore' : new TextEncoder().encode(stdin),
            stdout: 'pipe',
            stderr: 'ignore',
            env: { ...process.env, TERM: 'dumb' },
        });
        const stdout = await new Response(proc.stdout).text();
        const code = await proc.exited;
        return { code, stdout };
    } finally {
        slots++;
        waiting.shift()?.();
    }
}

/** A scratch directory for warrior files; remove it with `dispose()`. */
export class Workspace {
    readonly dir = mkdtempSync(join(tmpdir(), 'corewar-oracle-'));
    private next = 0;

    file(source: string): string {
        const path = join(this.dir, `w${this.next++}.red`);
        writeFileSync(path, source);
        return path;
    }

    dispose(): void {
        rmSync(this.dir, { recursive: true, force: true });
    }
}

const fold = (n: number, size: number): number => ((n % size) + size) % size;

const INSTRUCTION_RE = /^\s*(?:\d{5}\s+)?([A-Z]{3})\.([A-Z]{1,2})\s+(\S)\s*(-?\d+),\s*(\S)\s*(-?\d+)/;

function instructionText(m: RegExpExecArray, size: number, cmpAsSeq: boolean): string {
    const opcode = cmpAsSeq && m[1] === 'CMP' ? 'SEQ' : m[1];
    return `${opcode}.${m[2]} ${m[3]}${fold(Number(m[4]), size)}, ${m[5]}${fold(Number(m[6]), size)}`;
}

export async function pmarsAssembly(ws: Workspace, source: string, s: IOracleSettings): Promise<IAssembly> {
    const { code, stdout } = await run(['-A', ...settingArgs(s), ws.file(source)]);
    const org = /^\s*ORG\s+(-?\d+)\s*$/m.exec(stdout);
    if (code !== 0 || !org) return { ok: false, start: 0, instructions: [] };
    const instructions: string[] = [];
    for (const line of stdout.split('\n')) {
        const m = INSTRUCTION_RE.exec(line);
        if (m) instructions.push(instructionText(m, s.coresize, false));
    }
    const out: IAssembly = { ok: true, start: fold(Number(org[1]), s.coresize), instructions };
    const pin = /^\s*PIN\s+(-?\d+)\s*$/m.exec(stdout);
    if (pin) out.pin = Number(pin[1]);
    return out;
}

function totals(stdout: string): IMatchTotals {
    const m = /Results:\s+(\d+)\s+(\d+)\s+(\d+)/.exec(stdout);
    if (!m) throw new Error(`pMARS printed no results:\n${stdout.slice(-500)}`);
    return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export async function pmarsMatch(files: readonly string[], s: IOracleSettings, position: number, rounds: number, cycles = s.cycles): Promise<IMatchTotals> {
    const { stdout } = await run(['-b', '-r', `${rounds}`, '-F', `${position}`, ...settingArgs(s, cycles), ...files]);
    return totals(stdout);
}

/** Round 1 (warrior 1 moves first): the winner and, by bisecting -c, the pass in which it ended. */
export async function pmarsRound(files: readonly string[], s: IOracleSettings, position: number): Promise<IRoundOutcome> {
    const winnerAt = async (cycles: number): Promise<number | null> => {
        const [w1, w2] = await pmarsMatch(files, s, position, 1, cycles);
        return w1 > 0 ? 0 : w2 > 0 ? 1 : null;
    };
    const winner = await winnerAt(s.cycles);
    if (winner === null) return { winner, end: s.cycles };
    let lo = 1;
    let hi = s.cycles;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if ((await winnerAt(mid)) === winner) hi = mid;
        else lo = mid + 1;
    }
    return { winner, end: lo };
}

/** The debugger's view of a round that has not started yet. */
export interface IRoundStart {
    round: number;
    /** The warrior to move first (0-based). */
    first: number;
    /** Each warrior's single task pointer, in warrior order. */
    heads: [number, number];
    /** Each warrior's P-space (ours.ts pspaceText), in warrior order. */
    pspace: [string, string];
}

/**
 * The state at the start of the round after the rounds that took
 * `executions[i]` instructions each, in an `-r rounds -F position` match.
 * pMARS places warrior 2 at `position` only in round 1; later rounds use
 * its own random placement, which this reads back. Null when the state there
 * is not the start of the next round (our execution counts were wrong).
 */
export async function pmarsRoundStart(ws: Workspace, files: readonly string[], s: IOracleSettings, position: number, rounds: number, executions: readonly number[]): Promise<IRoundStart | null> {
    const log = join(ws.dir, `start${Math.random().toString(36).slice(2)}.log`);
    const commands = [`write ${log}`, ...executions.map((e) => (e === 1 ? 'step' : `skip ${e - 1}`)), 'registers', 'write', 'quit', ''];
    await run(['-e', '-b', '-r', `${rounds}`, '-F', `${position}`, ...settingArgs(s), ...files], commands.join('\n'));
    const text = existsSync(log) ? readFileSync(log, 'utf8') : '';
    rmSync(log, { force: true });
    const block = text.split('(cdb) ').find((b) => b.startsWith('registers'));
    if (!block) return null;
    const lines = block.split('\n');
    const round = /Round\s+(\d+)/.exec(block);
    const cycle = /Cycle\s+(\d+)/.exec(block);
    const current = /Currently executing warrior (\d+)/.exec(block);
    const counts = [...block.matchAll(/Processes active (\d+)/g)].map((m) => Number(m[1]));
    const heads = lines.filter((_, i) => i > 0 && /Process queue:/.test(lines[i - 1]!)).map(queueHead);
    const pspaces = pspaceLines(block, s);
    if (!round || !cycle || !current || heads.length !== 2 || heads.some((h) => h === undefined) || pspaces.length !== 2) return null;
    // A fresh round: the expected round number, the full cycle budget and one task each.
    if (Number(round[1]) !== executions.length + 1 || Number(cycle[1]) !== s.cycles || counts.some((c) => c !== 1)) return null;
    const first = Number(current[1]);
    const inOrder = <T>(pair: T[]): [T, T] => (first === 0 ? [pair[0]!, pair[1]!] : [pair[1]!, pair[0]!]);
    return { round: Number(round[1]), first, heads: inOrder(heads as number[]), pspace: inOrder(pspaces) };
}

/** The P-space lines of a `registers` block, current warrior first, as pspaceText. */
function pspaceLines(block: string, s: IOracleSettings): string[] {
    return [...block.matchAll(/^P-space\[\d+\]:(.*)$/gm)].map((m) => {
        const cells = (m[1]!.match(/\d+/g) ?? []).map(Number);
        return pspaceText(cells, pspaceSize(s));
    });
}

/** Next pointer of a debugger queue line such as `4 5 [4]-> 4` (the head is in brackets). */
const queueHead = (line: string): number | undefined => {
    const m = /\[(\d+)\]/.exec(line);
    return m ? Number(m[1]) : undefined;
};

/** The ours.ts trace states, read from the debugger at each checkpoint execution count. */
export async function pmarsTrace(ws: Workspace, files: readonly string[], s: IOracleSettings, position: number, ks: readonly number[]): Promise<string[]> {
    const log = join(ws.dir, `trace${Math.random().toString(36).slice(2)}.log`);
    const commands = [`write ${log}`];
    let done = 0;
    for (const k of ks) {
        commands.push(k - done === 1 ? 'step' : `skip ${k - done - 1}`, `list 0,${s.coresize - 1}`, 'a', 'registers');
        done = k;
    }
    commands.push('write', 'quit', '');
    await run(['-e', '-b', '-r', '1', '-F', `${position}`, ...settingArgs(s), ...files], commands.join('\n'));
    const text = existsSync(log) ? readFileSync(log, 'utf8') : '';
    rmSync(log, { force: true });

    const states: string[] = [];
    let cells: string[] = [];
    const blocks = text.split('(cdb) ').slice(1);
    for (const block of blocks) {
        const lines = block.split('\n');
        const command = lines[0]!.trim();
        if (command.startsWith('list')) {
            cells = [];
            for (const line of lines.slice(1)) {
                const m = INSTRUCTION_RE.exec(line);
                const address = /^(\d{5})/.exec(line);
                if (m && address) cells.push(`${Number(address[1])} ${instructionText(m, s.coresize, true)}`);
            }
        } else if (command === 'registers') {
            const cycle = /Cycle\s+(\d+)/.exec(block);
            const current = /Currently executing warrior (\d+)/.exec(block);
            const counts = [...block.matchAll(/Processes active (\d+)/g)].map((m) => Number(m[1]));
            const heads = lines.filter((_, i) => i > 0 && /Process queue:/.test(lines[i - 1]!)).map(queueHead);
            const pspaces = pspaceLines(block, s);
            if (!cycle || !current || counts.length !== 2 || heads.length !== 2 || pspaces.length !== 2) break;
            const next = Number(current[1]);
            const order = next === 0 ? [0, 1] : [1, 0];
            const queues = order.map((at, id) => queueText(id, counts[at]!, heads[at]));
            states.push(stateText(cells, next + 1, s.cycles - Number(cycle[1]), queues, order.map((at) => pspaces[at]!)));
        }
    }
    return states;
}
