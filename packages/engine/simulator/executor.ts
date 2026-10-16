/**
 * Fetch/decode/execute for one instruction of the warrior whose turn it is.
 * ICWS'94 semantics: operand numbers come from the instruction-register copy;
 * intermediate pointer fields are read from core at evaluation time.
 * Hot path: no allocation per execution; dispatch on opcode then modifier.
 * OWNER: simulator engineer.
 *
 * Each operand yields a read pointer (R, folded with readDistance) and a
 * write pointer (W, folded with writeDistance), as in the ICWS'94 reference
 * evaluator. Without limits both are the same address. Opcodes read the
 * Source Register (A) and Destination Register (B) copies and write core at
 * the B write pointer; jumps and splits go to the A read pointer.
 */

import { AccessType, Mode, Modifier, Opcode } from '../types.ts';
import { AMODE_SHIFT, MODE_MASK, MODIFIER_MASK, MODIFIER_SHIFT, OPCODE_SHIFT } from '../instruction.ts';
import type { EventPublisher } from './events.ts';
import type { IRoundState } from './state.ts';

const IMMEDIATE: number = Mode.Immediate;
const DIRECT: number = Mode.Direct;

const READ: AccessType = AccessType.read;
const WRITE: AccessType = AccessType.write;
const EXECUTE: AccessType = AccessType.execute;

// Which register copies an opcode actually uses, for read reporting only.
const READS_SOURCE = 1;
const READS_DESTINATION = 2;
const OPCODE_READS = new Uint8Array(Opcode.STP + 1);
for (const o of [Opcode.MOV, Opcode.ADD, Opcode.SUB, Opcode.MUL, Opcode.DIV, Opcode.MOD, Opcode.LDP]) OPCODE_READS[o] = READS_SOURCE;
for (const o of [Opcode.ADD, Opcode.SUB, Opcode.MUL, Opcode.DIV, Opcode.MOD]) OPCODE_READS[o]! |= READS_DESTINATION;
for (const o of [Opcode.JMZ, Opcode.JMN, Opcode.DJN]) OPCODE_READS[o] = READS_DESTINATION;
for (const o of [Opcode.CMP, Opcode.SEQ, Opcode.SNE, Opcode.SLT, Opcode.STP]) OPCODE_READS[o] = READS_SOURCE | READS_DESTINATION;

/** ICWS'94 Fold: confine a relative offset in [0, 2 * size) to a mini-core of `limit` cells. */
function foldLimit(offset: number, limit: number, size: number): number {
    const t = offset % limit;
    return t > limit / 2 ? t + size - limit : t;
}

/** ADD, SUB or MUL of two values in [0, size). */
function arith(opcode: number, d: number, v: number, size: number): number {
    if (opcode === Opcode.ADD) {
        const r = d + v;
        return r >= size ? r - size : r;
    }
    if (opcode === Opcode.SUB) {
        const r = d - v;
        return r < 0 ? r + size : r;
    }
    return (d * v) % size;
}

/** Record one access in the access arrays and/or the CORE_ACCESS buffer. */
function record(s: IRoundState, ev: EventPublisher, warriorId: number, kind: AccessType, address: number): void {
    if (s.trackAccess) {
        const core = s.core;
        const stamp = s.executions;
        const strength = kind + 1;
        if (core.accessStamp[address] !== stamp) {
            core.accessStamp[address] = stamp;
            core.accessKind[address] = strength;
            core.accessWarrior[address] = warriorId;
        } else if (strength > core.accessKind[address]!) {
            core.accessKind[address] = strength;
            core.accessWarrior[address] = warriorId;
        }
    }
    if (ev.enabled) ev.access(warriorId, kind, address);
}

// Results of evalOperand (module scratch, so evaluation allocates nothing).
let evalRead = 0;
let evalWrite = 0;
/** Cell whose field is post-incremented after the register copy, or -1. */
let evalPost = -1;
let evalPostField: Int32Array | null = null;

/** Evaluate one operand: apply its pre-decrement and set evalRead/evalWrite/evalPost. */
function evalOperand(s: IRoundState, ev: EventPublisher, warriorId: number, mode: number, n: number, pc: number): void {
    evalPost = -1;
    if (mode === IMMEDIATE) {
        evalRead = evalWrite = pc;
        return;
    }
    const core = s.core;
    const size = core.size;
    const limited = s.limited;
    const readLimit = s.options.readDistance;
    const writeLimit = s.options.writeDistance;
    let ro = limited ? foldLimit(n, readLimit, size) : n;
    let wo = limited ? foldLimit(n, writeLimit, size) : n;
    if (mode !== DIRECT) {
        let ri = pc + ro;
        if (ri >= size) ri -= size;
        let wi = pc + wo;
        if (wi >= size) wi -= size;
        // * { } use the A field (even modes); @ < > the B field (odd modes).
        const field = (mode & 1) === 0 ? core.a : core.b;
        if (mode === Mode.APreDecrement || mode === Mode.BPreDecrement) {
            const v = field[wi]!;
            field[wi] = v === 0 ? size - 1 : v - 1;
            if (s.tracing) record(s, ev, warriorId, WRITE, wi);
        } else if (mode >= Mode.APostIncrement) {
            evalPost = wi;
            evalPostField = field;
        }
        if (s.tracing) record(s, ev, warriorId, READ, ri);
        ro += field[ri]!;
        wo += field[wi]!;
        if (limited) {
            ro = foldLimit(ro, readLimit, size);
            wo = foldLimit(wo, writeLimit, size);
        } else {
            if (ro >= size) ro -= size;
            wo = ro;
        }
    }
    evalRead = pc + ro;
    if (evalRead >= size) evalRead -= size;
    evalWrite = pc + wo;
    if (evalWrite >= size) evalWrite -= size;
}

/** Apply the pending post-increment, if any (after the register copy). */
function postIncrement(s: IRoundState, ev: EventPublisher, warriorId: number): void {
    if (evalPost < 0) return;
    const field = evalPostField!;
    const v = field[evalPost]! + 1;
    field[evalPost] = v === s.core.size ? 0 : v;
    if (s.tracing) record(s, ev, warriorId, WRITE, evalPost);
}

/** Execute exactly one instruction and advance turn order; sets state.result if the round ends. */
export function executeOne(s: IRoundState, ev: EventPublisher): void {
    const core = s.core;
    const size = core.size;
    const cop = core.op;
    const ca = core.a;
    const cb = core.b;
    const warriors = s.warriors;
    const wid = s.nextWarrior;
    const warrior = warriors[wid]!;
    const queue = warrior.queue;
    const tracing = s.tracing;

    // Fetch.
    const pc = queue.shift();
    s.executions++;
    s.lastExecuted = pc;
    if (tracing) record(s, ev, wid, EXECUTE, pc);
    const ir = cop[pc]!;
    const irA = ca[pc]!;
    const irB = cb[pc]!;
    const opcode = ir >>> OPCODE_SHIFT;
    const modifier = (ir >>> MODIFIER_SHIFT) & MODIFIER_MASK;
    const aMode = (ir >>> AMODE_SHIFT) & MODE_MASK;
    const bMode = ir & MODE_MASK;
    const reads = OPCODE_READS[opcode]!;

    // A operand -> Source Register.
    evalOperand(s, ev, wid, aMode, irA, pc);
    const rpa = evalRead;
    const srcOp = cop[rpa]!;
    const srcA = ca[rpa]!;
    const srcB = cb[rpa]!;
    if (tracing && (reads & READS_SOURCE) !== 0 && aMode !== IMMEDIATE) record(s, ev, wid, READ, rpa);
    postIncrement(s, ev, wid);

    // B operand -> Destination Register.
    evalOperand(s, ev, wid, bMode, irB, pc);
    const rpb = evalRead;
    const wpb = evalWrite;
    const dstOp = cop[rpb]!;
    let dstA = ca[rpb]!;
    let dstB = cb[rpb]!;
    if (tracing && (reads & READS_DESTINATION) !== 0 && bMode !== IMMEDIATE) record(s, ev, wid, READ, rpb);
    postIncrement(s, ev, wid);

    // Execute.
    let next = pc + 1 === size ? 0 : pc + 1;
    let alive = true;
    let wrote = false;
    let taskCountChanged = false;

    switch (opcode) {
        case Opcode.DAT:
            alive = false;
            break;

        case Opcode.MOV:
            wrote = true;
            switch (modifier) {
                case Modifier.A: ca[wpb] = srcA; break;
                case Modifier.B: cb[wpb] = srcB; break;
                case Modifier.AB: cb[wpb] = srcA; break;
                case Modifier.BA: ca[wpb] = srcB; break;
                case Modifier.F: ca[wpb] = srcA; cb[wpb] = srcB; break;
                case Modifier.X: ca[wpb] = srcB; cb[wpb] = srcA; break;
                default: cop[wpb] = srcOp; ca[wpb] = srcA; cb[wpb] = srcB; break;
            }
            break;

        case Opcode.ADD:
        case Opcode.SUB:
        case Opcode.MUL: {
            wrote = true;
            switch (modifier) {
                case Modifier.A: ca[wpb] = arith(opcode, dstA, srcA, size); break;
                case Modifier.B: cb[wpb] = arith(opcode, dstB, srcB, size); break;
                case Modifier.AB: cb[wpb] = arith(opcode, dstB, srcA, size); break;
                case Modifier.BA: ca[wpb] = arith(opcode, dstA, srcB, size); break;
                case Modifier.X: ca[wpb] = arith(opcode, dstA, srcB, size); cb[wpb] = arith(opcode, dstB, srcA, size); break;
                default: ca[wpb] = arith(opcode, dstA, srcA, size); cb[wpb] = arith(opcode, dstB, srcB, size); break;
            }
            break;
        }

        case Opcode.DIV:
        case Opcode.MOD: {
            // Each field whose divisor is non-zero is written; any zero divisor kills the process.
            let divA = -1; // divisor for the A field, -1 = field not selected
            let divB = -1;
            switch (modifier) {
                case Modifier.A: divA = srcA; break;
                case Modifier.B: divB = srcB; break;
                case Modifier.AB: divB = srcA; break;
                case Modifier.BA: divA = srcB; break;
                case Modifier.X: divA = srcB; divB = srcA; break;
                default: divA = srcA; divB = srcB; break;
            }
            if (divA > 0) {
                ca[wpb] = opcode === Opcode.DIV ? Math.trunc(dstA / divA) : dstA % divA;
                wrote = true;
            }
            if (divB > 0) {
                cb[wpb] = opcode === Opcode.DIV ? Math.trunc(dstB / divB) : dstB % divB;
                wrote = true;
            }
            if (divA === 0 || divB === 0) alive = false;
            break;
        }

        case Opcode.JMP:
            next = rpa;
            break;

        case Opcode.JMZ:
        case Opcode.JMN: {
            let zero: boolean;
            switch (modifier) {
                case Modifier.A:
                case Modifier.BA: zero = dstA === 0; break;
                case Modifier.B:
                case Modifier.AB: zero = dstB === 0; break;
                default: zero = dstA === 0 && dstB === 0; break;
            }
            // JMN.F/.X/.I jump when either field is non-zero, exactly !JMZ (ICWS'94).
            if (zero === (opcode === Opcode.JMZ)) next = rpa;
            break;
        }

        case Opcode.DJN: {
            // Decrement core at the B write pointer and the Destination Register; test the register.
            const decA = modifier === Modifier.A || modifier === Modifier.BA || modifier >= Modifier.F;
            const decB = modifier === Modifier.B || modifier === Modifier.AB || modifier >= Modifier.F;
            wrote = true;
            if (decA) {
                const v = ca[wpb]!;
                ca[wpb] = v === 0 ? size - 1 : v - 1;
                dstA = dstA === 0 ? size - 1 : dstA - 1;
            }
            if (decB) {
                const v = cb[wpb]!;
                cb[wpb] = v === 0 ? size - 1 : v - 1;
                dstB = dstB === 0 ? size - 1 : dstB - 1;
            }
            if ((decA && dstA !== 0) || (decB && dstB !== 0)) next = rpa;
            break;
        }

        case Opcode.CMP:
        case Opcode.SEQ:
        case Opcode.SNE: {
            let equal: boolean;
            switch (modifier) {
                case Modifier.A: equal = srcA === dstA; break;
                case Modifier.B: equal = srcB === dstB; break;
                case Modifier.AB: equal = srcA === dstB; break;
                case Modifier.BA: equal = srcB === dstA; break;
                case Modifier.F: equal = srcA === dstA && srcB === dstB; break;
                case Modifier.X: equal = srcA === dstB && srcB === dstA; break;
                default: equal = srcOp === dstOp && srcA === dstA && srcB === dstB; break;
            }
            if (equal === (opcode !== Opcode.SNE)) next = next + 1 === size ? 0 : next + 1;
            break;
        }

        case Opcode.SLT: {
            let less: boolean;
            switch (modifier) {
                case Modifier.A: less = srcA < dstA; break;
                case Modifier.B: less = srcB < dstB; break;
                case Modifier.AB: less = srcA < dstB; break;
                case Modifier.BA: less = srcB < dstA; break;
                case Modifier.X: less = srcA < dstB && srcB < dstA; break;
                default: less = srcA < dstA && srcB < dstB; break;
            }
            if (less) next = next + 1 === size ? 0 : next + 1;
            break;
        }

        case Opcode.SPL:
            queue.push(next);
            if (queue.size < s.options.maxTasks) {
                queue.push(rpa);
                taskCountChanged = true;
            }
            break;

        case Opcode.LDP: {
            // The index comes from the Source Register, the value goes to core at the B write pointer.
            // .A: A -> A; .B, .F, .X, .I: B -> B; .AB: A -> B; .BA: B -> A (spec/pspace.md).
            wrote = true;
            const toA = modifier === Modifier.A || modifier === Modifier.BA;
            const index = modifier === Modifier.A || modifier === Modifier.AB ? srcA : srcB;
            const value = s.pspace.load(wid, index);
            if (toA) ca[wpb] = value;
            else cb[wpb] = value;
            break;
        }

        case Opcode.STP: {
            // The value comes from the Source Register, the index from the Destination Register.
            // .A: A at A; .B, .F, .X, .I: B at B; .AB: A at B; .BA: B at A (spec/pspace.md).
            const value = modifier === Modifier.A || modifier === Modifier.AB ? srcA : srcB;
            const index = modifier === Modifier.A || modifier === Modifier.BA ? dstA : dstB;
            s.pspace.store(wid, index, value);
            break;
        }

        default: // NOP
            break;
    }

    if (tracing && wrote) record(s, ev, wid, WRITE, wpb);

    if (opcode !== Opcode.SPL) {
        if (alive) queue.push(next);
        else {
            taskCountChanged = true;
            if (queue.size === 0) {
                warrior.alive = false;
                s.liveCount--;
            }
        }
    }
    if (taskCountChanged && ev.enabled) ev.taskCountChanged(wid, queue.size);

    // Pass the turn to the next live warrior in id order.
    const count = warriors.length;
    let following = wid;
    if (s.liveCount > 0) {
        do following = following + 1 === count ? 0 : following + 1;
        while (!warriors[following]!.alive);
    }
    s.nextWarrior = following;

    if (s.options.cycleUnit === 'execution') {
        s.cycle = s.executions;
    } else {
        // One cycle per pass over the live warriors, counted from firstWarrior.
        const first = s.options.firstWarrior;
        if ((following - first + count) % count <= (wid - first + count) % count) s.cycle++;
    }

    // Round end.
    if (count >= 2 ? s.liveCount === 1 : s.liveCount === 0) {
        const winner = warriors[following]!;
        s.result =
            count === 1
                ? { winnerId: null, outcome: 'NONE' }
                : winner.hasData
                  ? { winnerId: winner.id, winnerData: winner.data, outcome: 'WIN' }
                  : { winnerId: winner.id, outcome: 'WIN' };
    } else if (s.cycle >= s.options.maximumCycles) {
        s.result = { winnerId: null, outcome: count === 1 ? 'NONE' : 'DRAW' };
    }
    // Only reached while the round runs, so this records each round's result exactly once.
    if (s.result) s.pspace.recordRound(warriors.map((w) => w.alive));

    if (ev.enabled) {
        ev.endExecution();
        if (s.result) ev.roundEnd(s.result);
    }
}
