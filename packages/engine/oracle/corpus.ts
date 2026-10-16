/**
 * Deterministic inputs for the pMARS differential tests: the assembly corpus
 * (every opcode x modifier x mode, default modifiers, expressions, EQU,
 * FOR/ROF, labels, ORG/END, PIN and PSPACESIZE), hand-written P-space
 * switchers, and the random warriors for the battle fuzzer.
 * run.ts sends them to pMARS and records the answers in fixtures/.
 */

import { MODE_SYMBOLS, MODIFIER_NAMES, OPCODE_NAMES } from '../instruction.ts';
import { createRng, type IRng } from '../rng.ts';
import { DWARF_UNLABELED, SAMPLES } from '../samples.ts';
import type { IOracleSettings } from './ours.ts';

export interface ICorpusEntry {
    name: string;
    source: string;
}

/** pMARS defaults: -s 8000 -c 80000 -p 8000 -l 100 -d 100. */
export const STANDARD_SETTINGS: IOracleSettings = { coresize: 8000, cycles: 80000, processes: 8000, length: 100, distance: 100 };

const pick = <T>(rng: IRng, items: readonly T[]): T => items[rng.nextInt(items.length)]!;
const between = (rng: IRng, lo: number, hi: number): number => lo + rng.nextInt(hi - lo + 1);

/** A random constant expression over small numbers; divisors are never zero. */
function expression(rng: IRng, depth: number): string {
    if (depth === 0 || rng.next() < 0.3) return String(between(rng, 0, 40));
    const choice = rng.nextInt(7);
    if (choice === 0) return `-${expression(rng, depth - 1)}`;
    if (choice === 1) return `(${expression(rng, depth - 1)})`;
    const op = pick(rng, ['+', '-', '*', '/', '%']);
    const right = op === '/' || op === '%' ? String(between(rng, 1, 9)) : expression(rng, depth - 1);
    return `${expression(rng, depth - 1)}${op}${right}`;
}

const HANDWRITTEN: readonly ICorpusEntry[] = [
    { name: 'single-operand forms', source: 'dat 7\ndat #7\ndat <3\njmp 5\njmp @2\nspl 1\nspl }4\nnop 4\nnop >2\ndat -1' },
    { name: 'default modes', source: 'dat 5, 5\nmov 0, 1\nadd 1, 2\njmz 2, 0\nslt 1, 2\ncmp 1, 2' },
    { name: 'numbers are folded', source: 'dat 9000, -9000\ndat 8000, -8000\ndat 4000, 4001\ndat -4000, -4001\nmov 123456, -98765' },
    { name: 'case insensitive', source: 'MOV.AB #1, $2\nMov.Ab #1, $2\nmov.ab #1, $2\nDaT 0, 0' },
    { name: 'labels', source: 'top add #4, bomb\n mov bomb, @bomb\n jmp top\nbomb dat #0, #0' },
    { name: 'label colons and several labels', source: 'a: b c: mov a, b\nd:\n jmp c, d\n dat a, d' },
    { name: 'label arithmetic', source: 'first dat first+1, last-first\n mov last*2, first-last\nlast dat last, first' },
    { name: 'forward and backward references', source: ' jmp fwd\nback dat 0, 0\nfwd jmp back\n djn back, fwd' },
    { name: 'org label', source: ' org start\n dat 0, 0\nstart mov 0, 1\n jmp start' },
    { name: 'end label', source: ' dat 0, 0\nstart mov 0, 1\n jmp start\n end start' },
    { name: 'org beats end', source: ' org 1\n dat 0, 0\n mov 0, 1\n end 0' },
    { name: 'start outside the warrior', source: ' org 7\n mov 0, 1\n dat 1' },
    { name: 'negative start', source: ' org -1\n mov 0, 1\n dat 1' },
    { name: 'lines after end are ignored', source: ' mov 0, 1\n end\n this is not redcode' },
    { name: 'equ plain substitution', source: 'x equ 1+2\ny equ x*x\n dat x*2, -y\n dat y, x' },
    { name: 'equ parenthesised value', source: 'x equ (1+2)\n dat x*2, x-1' },
    { name: 'equ of a label', source: 'p equ tgt+1\n dat p, p\n dat p, 0\ntgt dat 0, 0' },
    { name: 'equ chain', source: 'a equ 3\nb equ a*a\nc equ b-a\n mov a, b\n dat c, -c' },
    { name: 'equ in org', source: 's equ 1\n org s\n dat 0, 0\n jmp 0' },
    { name: 'equ in for count', source: 'n equ 3\n for n\n dat n, 0\n rof' },
    { name: 'equ with step', source: 'step equ 3044\ntop add.ab #step, bmb\n mov.i bmb, @bmb\n jmp top\nbmb dat #step, #step' },
    { name: 'for counter', source: 'i for 3\n dat i, 0\n rof' },
    { name: 'for counter expressions', source: 'n for 4\n dat n*n, -n\n mov n, n+1\n rof' },
    { name: 'nested for', source: 'i for 2\nj for 3\n dat i, j\n rof\n rof' },
    { name: 'for concatenation', source: 'i for 3\nloop&i dat i, 0\n rof\n jmp loop02\n jmp loop03' },
    { name: 'for zero comments out', source: ' for 0\n this is not code\n rof\n dat 1, 1' },
    { name: 'label on its own line before for', source: 'label\n for 4\n dat.f $1+label, $1-label\n rof' },
    { name: 'label on its own line before equ', source: 'a\nb equ 5\n dat a, b' },
    { name: 'label on its own line before org', source: 'a\n org 1\n dat a, 0\n dat a, 0' },
    { name: 'trailing label', source: ' jmp done\n dat 0, 0\ndone' },
    { name: 'labels before the for counter', source: 'start i for 2\n dat i, start\n rof' },
    { name: 'curline', source: ' dat CURLINE, 0\n for 3\n dat CURLINE, 0\n rof\n dat CURLINE, 0' },
    { name: 'predefined constants', source: ' dat CORESIZE, MAXLENGTH\n dat MAXPROCESSES, MAXCYCLES\n dat MINDISTANCE, WARRIORS' },
    { name: 'for count from constants', source: ' for MAXLENGTH/25\n dat 0, 0\n rof' },
    { name: 'icws88 style', source: ';redcode\n mov #0, -1\n add #5, -2\n cmp -3, <4\n jmp -3\n spl 2\n djn -1, @3\n end 1' },
    { name: 'assert', source: ';assert CORESIZE == 8000\n;assert MAXLENGTH >= 50\n mov 0, 1' },
    { name: 'comments everywhere', source: '; leading\n mov 0, 1 ; trailing\n;name x\n jmp -1 ;another' },
    // P-space (spec/pspace.md).
    { name: 'pspace constant', source: ' dat PSPACESIZE, PSPACESIZE/2\n for PSPACESIZE/100\n dat 0, 0\n rof' },
    { name: 'pspace ldp and stp', source: 'res ldp #0, res\n ldp.ab #1, }res\n stp.b res, #2\n stp.ba res+1, @res\n stp.i -1, <1\n ldp.x {1, *2' },
    { name: 'pin', source: ' PIN 42\n dat 0, 0' },
    { name: 'pin expression', source: 'k equ 6\n dat 0, 0\n pin k*7-CORESIZE\n dat 0, 0' },
    { name: 'pin label', source: ' dat 0, 0\n dat 0, 0\nx dat 0, 0\n PIN x' },
    { name: 'pin labelled', source: 'lab PIN 7\n dat lab, lab' },
    { name: 'pin negative and large', source: ' PIN -3\n dat 0, 0\n PIN 4000000000' },
    { name: 'pin bare', source: ' dat 0, 0\n PIN' },
    { name: 'pin after end', source: ' PIN 3\n dat 0, 0\n end\n PIN 4' },
    { name: 'pin undefined', source: ' PIN foo\n dat 0, 0' },
    { name: 'pin two operands', source: ' PIN 1, 2\n dat 0, 0' },
    { name: 'pin with a mode', source: ' PIN #3\n dat 0, 0' },
    { name: 'pin division by zero', source: ' PIN 7/0\n dat 0, 0' },
    { name: 'ldp one operand', source: ' ldp 3\n dat 0, 0' },
    { name: 'stp one operand', source: ' stp #4\n dat 0, 0' },
];

/**
 * Hand-written P-space warriors for the named battles: each changes what it
 * does between rounds from the result cell (0) and its own state cells.
 */
export const PSWITCHERS: readonly ICorpusEntry[] = [
    {
        // Lost last round (cell 0 is 0): move to the next of three strategies.
        name: 'pspace/switch-on-loss',
        source: `;redcode-94
;name switch on loss
;assert CORESIZE == 8000
STATE equ 11
      ldp.ab #0, res
      ldp.ab #STATE, st
      jmn.b keep, res
      add.ab #1, st
      mod.ab #3, st
      stp.b st, #STATE
keep  jmz.b dwarf, st
      djn.b paper, st
      jmp imp
res   dat 0, 0
st    dat 0, 0
dwarf add.ab #2667, bomb
      mov.i bomb, @bomb
      jmp dwarf
bomb  dat #0, #0
paper spl 1
      mov.i -1, 0
      spl 1
pp    spl @0, 1600
      mov.i }-1, >-1
      mov.i {-2, <1
      jmz.a @0, #0
imp   mov.i #0, 1
`,
    },
    {
        // Counts rounds in cell 1 and its wins in cell 2; plays stone in even rounds, imp in odd ones.
        name: 'pspace/round-counter',
        source: `;redcode-94
;name round counter
;assert 1
      ldp.ab #1, cnt
      ldp.ab #0, res
      ldp.ab #2, won
      slt.ab #1, res
      jmp count
      add.ab #1, won
      stp.b won, #2
count add.ab #1, cnt
      stp.b cnt, #1
      mod.ab #2, cnt
      jmz.b stone, cnt
imp   mov.i #0, 1
res   dat 0, 0
cnt   dat 0, 0
won   dat 0, 0
stone mov.i bomb, @ptr
      add.ab #3359, ptr
      jmp stone
ptr   dat 0, 100
bomb  dat #0, #0
`,
    },
    {
        // A shared P-space (PIN): whichever copy runs first claims cell 3, the other copy reads it.
        name: 'pspace/pin-pair',
        source: `;redcode-94
;name pin pair
;assert 1
      PIN 1994
      ldp.ab #3, flag
      jmn.b second, flag
      stp.ab #1, #3
      stp.ab #77, #-5
first add.ab #7, ptr1
      mov.i bomb, @ptr1
      jmp first
second ldp.a #-5, bomb
      stp.ab #0, #3
s2    mov.i bomb, }ptr1
      jmp s2
flag  dat 0, 0
ptr1  dat 0, 50
bomb  dat #0, #0
`,
    },
    {
        // Every LDP/STP modifier stores to and loads from its own cells, then it waits (the trace shows both).
        name: 'pspace/modifier-tour',
        source: `;redcode-94
;name modifier tour
;assert 1
      stp.a  s1, i1
      stp.b  s1, i1
      stp.ab s2, i2
      stp.ba s2, i2
      stp.f  s3, i3
      stp.x  s4, i4
      stp.i  s5, i5
      stp.ab #21, #-7992
      stp.ab }s6, <i6
      ldp.a  i1, t1
      ldp.b  i1, t1
      ldp.ab i2, t2
      ldp.ba i2, t2
      ldp.f  i3, t3
      ldp.x  i4, t4
      ldp.i  i5, t5
      ldp.ab #-7992, }t6
      ldp.ba @i6, <t6
wait  jmp wait
s1    dat 11, 12
s2    dat 13, 14
s3    dat 15, 16
s4    dat 17, 18
s5    dat 19, 20
s6    dat 1, 22
i1    dat 1, 2
i2    dat 4, 3
i3    dat 0, 5
i4    dat 0, 6
i5    dat 0, 7
i6    dat 0, 10
t1    dat 0, 0
t2    dat 0, 0
t3    dat 0, 0
t4    dat 0, 0
t5    dat 0, 0
t6    dat 1, 1
`,
    },
    {
        // Stores into cell 0 in the round: the store is read back, then the round's result replaces it.
        name: 'pspace/cell-zero',
        source: `;redcode-94
;name cell zero
;assert 1
      ldp.ab #0, old
      stp.ab #123, #0
      ldp.ab #0, now
      seq.ab #123, now
      dat 0, 0
      jmn.b go, old
      dat 0, 0
go    spl 0
      mov.i #0, @ptr
      add.ab #13, ptr
      jmp -2
old   dat 0, 0
now   dat 0, 0
ptr   dat 0, 20
`,
    },
];

/** Every opcode x modifier x A mode x B mode, one warrior per opcode and modifier. */
function matrix(rng: IRng): ICorpusEntry[] {
    const out: ICorpusEntry[] = [];
    for (const opcode of OPCODE_NAMES) {
        for (const modifier of MODIFIER_NAMES) {
            const lines: string[] = [];
            for (const a of MODE_SYMBOLS) for (const b of MODE_SYMBOLS) lines.push(`${opcode}.${modifier} ${a}${between(rng, -9000, 9000)}, ${b}${between(rng, -9000, 9000)}`);
            out.push({ name: `matrix ${opcode}.${modifier}`, source: lines.join('\n') });
        }
    }
    return out;
}

/** Every opcode x A mode x B mode without a modifier, so the defaults are chosen. */
function defaults(rng: IRng): ICorpusEntry[] {
    return OPCODE_NAMES.map((opcode) => {
        const lines: string[] = [];
        for (const a of MODE_SYMBOLS) for (const b of MODE_SYMBOLS) lines.push(`${opcode.toLowerCase()} ${a}${between(rng, -20, 20)}, ${b}${between(rng, -20, 20)}`);
        return { name: `defaults ${opcode}`, source: lines.join('\n') };
    });
}

function expressions(rng: IRng): ICorpusEntry[] {
    const out: ICorpusEntry[] = [];
    for (let w = 0; w < 30; w++) {
        const lines: string[] = [];
        for (let i = 0; i < 25; i++) lines.push(`dat ${expression(rng, 4)}, ${expression(rng, 4)}`);
        out.push({ name: `expressions ${w}`, source: lines.join('\n') });
    }
    return out;
}

/** Random EQU constants whose values are expressions, used inside further expressions. */
function equExpressions(rng: IRng): ICorpusEntry[] {
    const out: ICorpusEntry[] = [];
    for (let w = 0; w < 20; w++) {
        const lines: string[] = [];
        for (let c = 0; c < 4; c++) lines.push(`k${c} equ ${expression(rng, 2)}${c > 0 ? `${pick(rng, ['+', '-', '*'])}k${c - 1}` : ''}`);
        for (let i = 0; i < 10; i++) lines.push(` dat k${rng.nextInt(4)}${pick(rng, ['+', '-', '*', '/', '%'])}${between(rng, 1, 9)}, ${between(rng, 1, 9)}${pick(rng, ['+', '-', '*'])}k${rng.nextInt(4)}`);
        out.push({ name: `equ expressions ${w}`, source: lines.join('\n') });
    }
    return out;
}

/** The assembly corpus, except the user's warrior files (run.ts adds those). */
export function assemblyCorpus(): ICorpusEntry[] {
    const rng = createRng(94);
    return [
        ...Object.entries(SAMPLES).map(([name, source]) => ({ name: `samples ${name}`, source })),
        { name: 'samples dwarf (unlabeled)', source: DWARF_UNLABELED },
        ...HANDWRITTEN,
        ...matrix(rng),
        ...defaults(rng),
        ...expressions(rng),
        ...equExpressions(rng),
    ];
}

/** Battle fuzzer configurations: small cores so the debugger can list the whole core. */
export const FUZZ_SETTINGS: readonly IOracleSettings[] = [
    { coresize: 80, cycles: 800, processes: 8, length: 8, distance: 8 },
    { coresize: 80, cycles: 800, processes: 80, length: 8, distance: 8 },
    { coresize: 200, cycles: 2000, processes: 32, length: 8, distance: 10 },
    { coresize: 800, cycles: 8000, processes: 64, length: 12, distance: 12 },
    // A P-space size that does not divide the core (index wraparound).
    { coresize: 200, cycles: 2000, processes: 32, length: 12, distance: 12, pspace: 7 },
];

export type FuzzKind = 'random' | 'loop' | 'spl' | 'divmod' | 'bomber' | 'pspace' | 'switcher';
export const FUZZ_KINDS: readonly FuzzKind[] = ['random', 'loop', 'spl', 'divmod', 'bomber', 'pspace', 'switcher'];
/** How often run.ts draws each kind: the ones that live longer more often. */
export const FUZZ_MIX: readonly FuzzKind[] = ['random', 'loop', 'loop', 'spl', 'spl', 'divmod', 'bomber', 'bomber', 'pspace', 'pspace', 'switcher', 'switcher'];
const JUMPS = new Set(['JMP', 'JMZ', 'JMN', 'DJN', 'SPL']);

const NOT_DAT = OPCODE_NAMES.filter((o) => o !== 'DAT');

/**
 * A random warrior of up to 8 instructions (`maxLength` for `switcher`).
 * - `random`: any instructions and start; most die within a few cycles.
 * - `loop`: random non-DAT instructions closed by two jumps back (a skip
 *   lands on the second); jumps in the body stay inside the code.
 * - `spl`: a loop that favours SPL (process limits, queue order).
 * - `divmod`: a loop that favours DIV/MOD with zero operands.
 * - `bomber`: a classic bomber with random step, modifiers and modes.
 * - `pspace`: a loop that favours LDP/STP with small indices, sometimes
 *   with a PIN (1 or 2, so two fuzzed warriors sometimes share P-space).
 * - `switcher`: after a loss (or a win) it stores a new state, then picks
 *   one of two random bodies from the state, so rounds differ.
 */
export function fuzzWarrior(rng: IRng, kind: FuzzKind, coresize: number, maxLength = 8): string {
    const number = (zeroBias: number): number =>
        rng.next() < zeroBias ? 0 : rng.next() < 0.6 ? between(rng, -10, 10) : rng.nextInt(coresize);
    const modifier = (): string => (rng.next() < 0.15 ? '' : `.${pick(rng, MODIFIER_NAMES)}`);
    const operand = (zeroBias: number): string => `${pick(rng, MODE_SYMBOLS)}${number(zeroBias)}`;
    const header = [`;name ${kind}`, ';assert 1'];
    // Never PIN 0: pMARS shares a PIN 0 P-space with later warriors that have no PIN (spec/pspace.md).
    if ((kind === 'pspace' || kind === 'switcher') && rng.next() < 0.5) header.push(`PIN ${between(rng, 1, 2)}`);
    const index = (): string => `${pick(rng, ['#', '#', '$', '@', '*', '}', '<'])}${between(rng, -3, 12)}`;

    if (kind === 'switcher') {
        // Cell 0 and the state cell are loaded into the LDP instructions' own B fields.
        const state = between(rng, 1, 9);
        const ops = (n: number): string[] =>
            Array.from({ length: n }, () => `${pick(rng, [...NOT_DAT.filter((o) => !JUMPS.has(o)), 'STP', 'LDP'])}${modifier()} ${operand(0.1)}, ${operand(0.1)}`);
        const room = maxLength - 6;
        const n1 = between(rng, 1, Math.max(1, room - 1));
        const n2 = between(rng, 1, Math.max(1, room - n1));
        const lines = [
            'ldp.ab #0, #0',
            `${pick(rng, ['jmn', 'jmz'])}.b 2, -1`,
            `stp.ab #${between(rng, 0, 3)}, #${state}`,
            `ldp.ab #${state}, #0`,
            `${pick(rng, ['jmz', 'jmn'])}.b b2, -1`,
            ...ops(n1).map((op, i) => `${i === 0 ? 'b1 ' : ''}${op}`),
            'jmp b1',
            ...ops(n2).map((op, i) => `${i === 0 ? 'b2 ' : ''}${op}`),
        ];
        return [...header, ...lines].join('\n') + '\n';
    }

    const length = between(rng, 1, kind === 'random' ? 8 : 6);
    const zeroBias = kind === 'divmod' ? 0.4 : 0.1;
    const lines: string[] = [];
    for (let i = 0; i < length; i++) {
        let opcode = kind === 'random' ? pick(rng, OPCODE_NAMES) : pick(rng, NOT_DAT);
        if (kind === 'spl' && rng.next() < 0.45) opcode = pick(rng, ['SPL', 'SPL', 'JMP']);
        if (kind === 'divmod' && rng.next() < 0.5) opcode = pick(rng, ['DIV', 'MOD']);
        if (kind === 'pspace' && rng.next() < 0.6) opcode = pick(rng, ['LDP', 'STP']);
        const target = kind !== 'random' && JUMPS.has(opcode) ? `$${between(rng, -i, length - i)}` : operand(zeroBias);
        if (opcode === 'LDP') lines.push(`${opcode}${modifier()} ${index()}, ${operand(zeroBias)}`);
        else if (opcode === 'STP') lines.push(`${opcode}${modifier()} ${operand(zeroBias)}, ${index()}`);
        else lines.push(`${opcode}${modifier()} ${target}, ${operand(zeroBias)}`);
    }
    if (kind === 'random') {
        const start = rng.next() < 0.6 ? 0 : rng.next() < 0.9 ? rng.nextInt(length) : between(rng, length, length + 5);
        return [...header, `ORG ${start}`, ...lines].join('\n') + '\n';
    }
    lines.push(rng.next() < 0.7 ? `JMP $${-length}, ${operand(0.3)}` : `DJN${modifier()} $${-length}, ${operand(0.3)}`);
    lines.push(`JMP $${-length - 1}`);
    return [...header, ...lines].join('\n') + '\n';
}
