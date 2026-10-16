import { describe, expect, test } from 'bun:test';
import {
    AccessType,
    MessageTopic,
    MessageType,
    Opcode,
    Standard,
    type IParseResult,
} from '../types.ts';
import { toPublicInstruction } from '../instruction.ts';
import { DEFAULT_INITIAL_INSTRUCTION } from '../options.ts';
import {
    createSimulator,
    getCoreView,
    getDefaultSimulator,
    getProcessView,
    getWithInfoAt,
    initialiseSimulator,
    republish,
    run,
    step,
} from './index.ts';
import { Simulator } from './simulator.ts';
import { cell, ins, recorder, warrior } from './testing.ts';

const IMP = ['MOV.I $0, $1'];
const DIE = ['DAT.F $0, $0'];
const LOOP = ['JMP.B $0, $0'];

function sim(parseResults: IParseResult[], options = {}, provider?: ReturnType<typeof recorder>) {
    const s = new Simulator();
    s.initialise({ seed: 7, ...options }, parseResults, provider);
    return s;
}

describe('initialiseSimulator', () => {
    test('options default field by field (developer.md 3.1.1)', () => {
        const o = sim([warrior(LOOP)], { coresize: 800, seed: 3 }).getState().options;
        expect(o).toMatchObject({
            coresize: 800,
            maximumCycles: 80000,
            instructionLimit: 100,
            maxTasks: 8000,
            minSeparation: 100,
            standard: Standard.ICWS94draft,
            readDistance: 800,
            writeDistance: 800,
            seed: 3,
        });
        expect(o.initialInstruction).toEqual(DEFAULT_INITIAL_INSTRUCTION);
        expect(sim([warrior(LOOP)], {}).getState().core.getSize()).toBe(8000);
    });

    test('every cell starts as DAT.F $0, $0, or as initialInstruction with its own address', () => {
        const s = sim([warrior(LOOP)]);
        expect(cell(s, 1)).toBe('DAT.F $0, $0');
        expect(cell(s, 7999)).toBe('DAT.F $0, $0');
        const custom = sim([warrior(LOOP)], { initialInstruction: toPublicInstruction(ins('NOP.A #1, <-1'), 123) });
        expect(custom.getWithInfoAt(500).instruction).toEqual(toPublicInstruction(ins('NOP.A #1, <7999'), 500));
    });

    test('a new core is initialised every round; nothing carries over', () => {
        const s = sim([warrior(IMP)]);
        s.step(5);
        expect(cell(s, 5)).toBe('MOV.I $0, $1');
        s.initialise({ seed: 7 }, [warrior(IMP)]);
        expect(cell(s, 5)).toBe('DAT.F $0, $0');
        expect(s.getCoreView().executions).toBe(0);
    });

    test('warriors load sequentially; warrior 0 at address 0; the process starts at the ORG offset', () => {
        const s = sim([warrior(['DAT.F #1, #1', 'JMP.B $0, $0', 'DAT.F #3, #3'], { start: 1 }), warrior(LOOP)]);
        expect([cell(s, 0), cell(s, 1), cell(s, 2)]).toEqual(['DAT.F #1, #1', 'JMP.B $0, $0', 'DAT.F #3, #3']);
        const [w0, w1] = s.getProcessView();
        expect(w0).toEqual({ warriorId: 0, alive: true, taskCount: 1, instructionPointers: [1], loadAddress: 0, length: 3 });
        expect(w1!.taskCount).toBe(1);
        expect(w1!.instructionPointers).toEqual([w1!.loadAddress]);
        expect(s.getState().warriors.map((w) => w.startAddress)).toEqual([0, w1!.loadAddress]);
    });

    test('placement is random, at least minSeparation apart, and reproducible from the seed', () => {
        const at = (seed: number) => sim([warrior(LOOP), warrior(LOOP)], { seed }).getProcessView()[1]!.loadAddress;
        const placements = Array.from({ length: 50 }, (_, seed) => at(seed));
        for (const p of placements) expect(p >= 100 && p <= 7900).toBe(true);
        expect(new Set(placements).size).toBeGreaterThan(40);
        expect(at(12345)).toBe(at(12345));
    });

    test('loadAddresses fixes placement, folded into the core, ignoring minSeparation', () => {
        const at = (loadAddresses: number[], options = {}) =>
            sim([warrior(LOOP), warrior(['DAT.F $0, $0', 'JMP.B $-1, $0'])], { loadAddresses, ...options }).getProcessView().map((w) => w.loadAddress);
        expect(at([0, 40])).toEqual([0, 40]);
        expect(at([5, -3], { coresize: 80 })).toEqual([5, 77]);
        expect(at([0, 1], { coresize: 80, minSeparation: 40 })).toEqual([0, 1]);
        expect(at([10, 4000], { seed: 1 })).toEqual(at([10, 4000], { seed: 2 }));
    });

    test('loadAddresses must give one non-overlapping integer address per warrior', () => {
        const two = [warrior(LOOP), warrior(['DAT.F $0, $0', 'JMP.B $-1, $0'])];
        expect(() => sim(two, { loadAddresses: [0] })).toThrow('1 addresses for 2 warriors');
        expect(() => sim(two, { loadAddresses: [1, 0] })).toThrow('overlaps');
        expect(() => sim(two, { loadAddresses: [0, 1.5] })).toThrow('array of integers');
    });

    test('rejects bad input with a descriptive error', () => {
        const error: IParseResult = { ...warrior(LOOP), messages: [{ type: MessageType.Error, position: { line: 1, char: 1 }, text: 'x' }] };
        expect(() => sim([])).toThrow('At least one');
        expect(() => sim([warrior(LOOP), error])).toThrow('Warrior 1 has parse errors');
        expect(() => sim([{ ...warrior(LOOP), tokens: [] }])).toThrow('Warrior 0 has an invalid load format');
        expect(() => sim([warrior(Array(6).fill('DAT.F $0, $0'))], { instructionLimit: 5 })).toThrow('instructionLimit');
        expect(() => sim([warrior(LOOP), warrior(LOOP)], { coresize: 100, minSeparation: 60 })).toThrow('Cannot place warrior 1');
        expect(() => sim([warrior(LOOP)], { firstWarrior: 1 })).toThrow('firstWarrior');
        expect(() => sim([warrior(LOOP)], { maxTasks: 0 })).toThrow('maxTasks');
        const badInitial = { ...DEFAULT_INITIAL_INSTRUCTION, opcode: 99 as Opcode };
        expect(() => sim([warrior(LOOP)], { initialInstruction: badInitial })).toThrow('initialInstruction');
    });

    test('a failed initialise leaves the previous round intact', () => {
        const s = sim([warrior(IMP)]);
        s.step(3);
        expect(() => s.initialise({}, [])).toThrow();
        expect(s.getCoreView().executions).toBe(3);
    });

    test('readDistance and writeDistance are accepted', () => {
        expect(() => sim([warrior(LOOP)], { readDistance: 4000, writeDistance: 8000 })).not.toThrow();
    });
});

describe('before initialise', () => {
    test('every call throws "Simulator not initialised"', () => {
        const s = createSimulator();
        for (const call of [
            () => s.step(),
            () => s.run(),
            () => s.runRound(),
            () => s.getWithInfoAt(0),
            () => s.republish(),
            () => s.getState(),
            () => s.getCoreView(),
            () => s.getProcessView(),
        ]) {
            expect(call).toThrow('Simulator not initialised');
        }
        expect(s.isRunning).toBe(false);
        expect(s.result).toBeUndefined();
    });
});

describe('step and run', () => {
    test('step() advances one cycle; step(n) advances n; step(0) none', () => {
        const s = sim([warrior(IMP)]);
        expect(s.step()).toBe(true);
        expect(s.getCoreView().executions).toBe(1);
        expect(s.step(10)).toBe(true);
        expect(s.getCoreView().executions).toBe(11);
        expect(s.step(0)).toBe(true);
        expect(s.getCoreView().executions).toBe(11);
    });

    test('step throws on negative or non-integer counts', () => {
        const s = sim([warrior(IMP)]);
        expect(() => s.step(-1)).toThrow();
        expect(() => s.step(1.5)).toThrow();
    });

    test('step stops at the round end, returns false, and then does nothing', () => {
        const p = recorder();
        const s = sim([warrior(['NOP.F $0, $0', 'DAT.F $0, $0'])], {}, p);
        expect(s.step(10)).toBe(false);
        expect(s.getCoreView().executions).toBe(2);
        p.clear();
        expect(s.step()).toBe(false);
        s.run();
        expect(p.log).toEqual([]);
        expect(s.getCoreView().executions).toBe(2);
    });

    test('run() runs to the round end with exactly one ROUND_END; runRound returns it', () => {
        const p = recorder();
        const s = sim([warrior(IMP)], { maximumCycles: 500 }, p);
        expect(s.runRound()).toEqual({ winnerId: null, outcome: 'NONE' });
        expect(s.getCoreView().cycle).toBe(500);
        expect(p.payloads(MessageTopic.ROUND_END)).toHaveLength(1);
        expect(s.isRunning).toBe(false);
    });
});

describe('processes and turn order', () => {
    test('warriors alternate; a warrior\'s processes run round robin (imp A, paper A, imp A, paper B, ...)', () => {
        const p = recorder();
        const s = sim([warrior(IMP), warrior(['SPL.B $2, $0', 'JMP.B $0, $0', 'JMP.B $0, $0'])], {}, p);
        const paper = s.getProcessView()[1]!.loadAddress;
        s.step(2); // imp, then paper's SPL creates process B at paper + 2
        const order: string[] = [];
        for (let i = 0; i < 6; i++) {
            const view = s.getCoreView();
            s.step();
            const at = view.lastExecuted;
            order.push(at < paper ? 'imp' : at === paper + 1 ? 'paper A' : 'paper B');
        }
        expect(order).toEqual(['imp', 'paper A', 'imp', 'paper B', 'imp', 'paper A']);
    });

    test('firstWarrior picks who moves first', () => {
        const s = sim([warrior(LOOP), warrior(LOOP)], { firstWarrior: 1 });
        expect(s.getState().warriorIndex).toBe(1);
        s.step();
        expect(s.getCoreView().lastExecuted).toBe(s.getProcessView()[1]!.loadAddress);
    });

    test('a dead warrior gets no more turns while the others continue', () => {
        const s = sim([warrior(LOOP), warrior(DIE), warrior(LOOP)], { coresize: 8000 });
        s.step(2);
        expect(s.getProcessView()[1]!.alive).toBe(false);
        s.step(4);
        expect(s.getCoreView().executions).toBe(6);
        expect(s.getState().warriors[1]!.tasks).toEqual([]);
        expect(s.isRunning).toBe(true);
    });
});

describe('round end', () => {
    test('WIN when exactly one of two or more warriors is left', () => {
        const s = sim([warrior(LOOP), warrior(DIE, { data: 'loser' })]);
        expect(s.runRound()).toEqual({ winnerId: 0, outcome: 'WIN' });
        const t = sim([warrior(DIE), warrior(LOOP, { data: { n: 1 } })]);
        expect(t.runRound()).toEqual({ winnerId: 1, winnerData: { n: 1 }, outcome: 'WIN' });
    });

    test('DRAW at maximumCycles with two or more alive; three-warrior survivors all draw', () => {
        expect(sim([warrior(LOOP), warrior(LOOP)], { maximumCycles: 100 }).runRound()).toEqual({ winnerId: null, outcome: 'DRAW' });
        const three = sim([warrior(LOOP), warrior(DIE), warrior(LOOP)], { maximumCycles: 100 });
        expect(three.runRound().outcome).toBe('DRAW');
    });

    test('with three warriors the round continues until one survives', () => {
        const s = sim([warrior(DIE), warrior(LOOP), warrior(['NOP.F $0, $0', 'DAT.F $0, $0'])]);
        expect(s.step(3)).toBe(true);
        expect(s.runRound()).toEqual({ winnerId: 1, outcome: 'WIN' });
        expect(s.getCoreView().executions).toBe(5);
    });

    test('NONE for a single warrior that dies, or reaches the cycle limit', () => {
        expect(sim([warrior(DIE)]).runRound()).toEqual({ winnerId: null, outcome: 'NONE' });
        const imp = sim([warrior(IMP)], { maximumCycles: 300 });
        expect(imp.runRound()).toEqual({ winnerId: null, outcome: 'NONE' });
        expect(imp.getProcessView()[0]!.alive).toBe(true);
    });

    test('cycleUnit execution counts single executions; pmars counts passes over the live warriors', () => {
        const execution = sim([warrior(LOOP), warrior(LOOP)], { maximumCycles: 10 });
        execution.run();
        expect([execution.getCoreView().executions, execution.getCoreView().cycle]).toEqual([10, 10]);
        const pmars = sim([warrior(LOOP), warrior(LOOP)], { maximumCycles: 10, cycleUnit: 'pmars', firstWarrior: 1 });
        pmars.step(3);
        expect(pmars.getCoreView().cycle).toBe(1);
        pmars.run();
        expect([pmars.getCoreView().executions, pmars.getCoreView().cycle]).toEqual([20, 10]);
    });

    test('pmars cycles skip dead warriors', () => {
        const s = sim([warrior(LOOP), warrior(DIE), warrior(LOOP)], { maximumCycles: 10, cycleUnit: 'pmars' });
        s.run();
        // First pass has 3 executions, then 9 passes of 2.
        expect(s.getCoreView().executions).toBe(21);
    });
});

describe('getWithInfoAt', () => {
    test('returns a folded copy of the cell and its last access, without side effects', () => {
        const p = recorder();
        const s = sim([warrior(IMP, { data: 'd' })], {}, p);
        expect(s.getWithInfoAt(1)).toEqual({ instruction: toPublicInstruction(ins('DAT.F $0, $0'), 1) });
        s.step();
        p.clear();
        const loc = s.getWithInfoAt(-7999);
        expect(loc).toEqual({
            instruction: toPublicInstruction(ins('MOV.I $0, $1'), 1),
            access: { warriorId: 0, warriorData: 'd', accessType: AccessType.write, address: 1 },
        });
        loc.instruction.opcode = Opcode.DAT;
        expect(cell(s, 1)).toBe('MOV.I $0, $1');
        expect(s.getWithInfoAt(0).access!.accessType).toBe(AccessType.execute);
        expect(p.log).toEqual([]);
    });
});

describe('visualiser hooks', () => {
    test('getCoreView reports the warrior that runs next, live', () => {
        const s = sim([warrior(LOOP), warrior(LOOP)]);
        const view = s.getCoreView();
        const order: number[] = [];
        for (let i = 0; i < 4; i++) {
            order.push(view.nextWarrior);
            s.step();
        }
        expect(order).toEqual([0, 1, 0, 1]);
    });

    test('getCoreView exposes live access arrays, executions, cycle and lastExecuted', () => {
        const s = sim([warrior(['MOV.I $1, $2', 'DAT.F $0, $0'])]);
        const view = s.getCoreView();
        expect([view.size, view.executions, view.cycle, view.lastExecuted]).toEqual([8000, 0, 0, -1]);
        expect(view.accessKind[0]).toBe(0);
        s.step();
        expect([view.executions, view.cycle, view.lastExecuted]).toEqual([1, 1, 0]);
        expect([view.accessKind[0], view.accessKind[1], view.accessKind[2]]).toEqual([3, 1, 2]);
        expect(Array.from(view.accessStamp.slice(0, 4))).toEqual([1, 1, 1, 0]);
        s.initialise({ seed: 1 }, [warrior(LOOP)]);
        expect(s.getCoreView()).not.toBe(view);
        expect(s.getCoreView().accessKind[0]).toBe(0);
    });

    test('within one execution the strongest access wins; across executions the latest wins', () => {
        // The B pre-decrement writes cell 1, then the A pointer read of cell 1 happens in the same step.
        const s = sim([warrior(['MOV.I <1, $0', 'DAT.F $0, $2'], { start: 0 }), warrior(LOOP)]);
        s.step();
        const view = s.getCoreView();
        expect(view.accessKind[1]).toBe(AccessType.write + 1);
        expect(view.accessWarrior[1]).toBe(0);
    });

    test('trackAccess: false leaves the arrays untouched', () => {
        const s = sim([warrior(IMP)], { trackAccess: false });
        s.step(10);
        expect(s.getCoreView().accessKind.some((k) => k !== 0)).toBe(false);
        expect(s.getWithInfoAt(1).access).toBeUndefined();
    });

    test('getProcessView lists every warrior with its queue, next-to-run first', () => {
        const s = sim([warrior(['SPL.B $2, $0', 'JMP.B $0, $0', 'JMP.B $0, $0']), warrior(DIE)]);
        s.step();
        expect(s.getProcessView()[0]).toEqual({
            warriorId: 0,
            alive: true,
            taskCount: 2,
            instructionPointers: [1, 2],
            loadAddress: 0,
            length: 3,
        });
    });
});

describe('getState (IState snapshot)', () => {
    test('has the developer.md shape', () => {
        const s = sim([warrior(LOOP, { name: 'looper', data: 42 }), warrior(LOOP)]);
        const state = s.getState();
        expect(state.cycle).toBe(0);
        expect(state.warriorIndex).toBe(0);
        expect(state.core.getSize()).toBe(8000);
        const [w0, w1] = state.warriors;
        expect(w0).toMatchObject({ id: 0, data: 42, name: 'looper', author: '', strategy: '', startAddress: 0, taskIndex: 0 });
        expect(w0!.tasks).toEqual([{ instructionPointer: 0, warrior: w0! }]);
        expect('data' in w1!).toBe(false);
        state.options.coresize = 1;
        expect(s.getState().options.coresize).toBe(8000);
    });
});

describe('messages', () => {
    const topics = (p: ReturnType<typeof recorder>) => p.topics();

    test('initialise publishes CORE_INITIALISE, TASK_COUNT (all, 1), RUN_PROGRESS (0), NEXT_EXECUTION', () => {
        const p = recorder();
        const s = sim([warrior(LOOP, { data: 'a' }), warrior(LOOP)], { maximumCycles: 1000 }, p);
        expect(topics(p)).toEqual(['CORE_INITIALISE', 'TASK_COUNT', 'RUN_PROGRESS', 'NEXT_EXECUTION']);
        const [[, init], [, tasks], [, progress], [, next]] = p.log as [string, any][];
        expect(init.state.warriors).toHaveLength(2);
        expect(tasks).toEqual([
            { warriorId: 0, warriorData: 'a', taskCount: 1 },
            { warriorId: 1, taskCount: 1 },
        ]);
        expect(progress).toEqual({ runProgress: 0, cycle: 0, maximumCycles: 1000 });
        expect(next).toEqual({ warriorId: 0, warriorData: 'a', address: 0 });
        expect(s.isRunning).toBe(true);
    });

    test('CORE_ACCESS lists the execute first, then reads and writes in order', () => {
        const p = recorder();
        // A: <2 pre-decrements cell 2 (write), reads the pointer (read), reads the source at 2 + 2 = 4.
        // B: $1 is written.
        sim([warrior(['MOV.I <2, $1', 'DAT.F $0, $0', 'DAT.F $0, $3', 'DAT.F $0, $0', 'DAT.F $0, $0'], { data: 'x' })], {}, p);
        p.clear();
        getDefaultSimulator(); // unrelated singleton is untouched
        const s = sim([warrior(['MOV.I <2, $1', 'DAT.F $0, $0', 'DAT.F $0, $3', 'DAT.F $0, $0', 'DAT.F $0, $0'], { data: 'x' })], {}, p);
        p.clear();
        s.step();
        const access = p.payloads(MessageTopic.CORE_ACCESS)[0];
        const a = (accessType: AccessType, address: number) => ({ warriorId: 0, warriorData: 'x', accessType, address });
        expect(access).toEqual([
            a(AccessType.execute, 0),
            a(AccessType.write, 2),
            a(AccessType.read, 2),
            a(AccessType.read, 4),
            a(AccessType.write, 1),
        ]);
    });

    test('CORE_ACCESS reports the destination read for compares and post-increments as writes', () => {
        const p = recorder();
        const s = sim([warrior(['SEQ.I $1, >2', 'DAT.F $0, $0', 'DAT.F $0, $0'])], {}, p);
        p.clear();
        s.step();
        expect(p.payloads(MessageTopic.CORE_ACCESS)[0].map((x: any) => [x.accessType, x.address])).toEqual([
            [AccessType.execute, 0],
            [AccessType.read, 1],
            [AccessType.read, 2],
            [AccessType.read, 2],
            [AccessType.write, 2],
        ]);
        expect(p.payloads(MessageTopic.CORE_ACCESS)[0][0]).not.toHaveProperty('warriorData');
    });

    test('per step: CORE_ACCESS, TASK_COUNT only when a count changed, then RUN_PROGRESS when the percent changes, NEXT_EXECUTION', () => {
        const p = recorder();
        const s = sim([warrior(['SPL.B $0, $0', 'JMP.B $-1, $0'])], { maximumCycles: 100 }, p);
        p.clear();
        s.step();
        expect(topics(p)).toEqual(['CORE_ACCESS', 'TASK_COUNT', 'RUN_PROGRESS', 'NEXT_EXECUTION']);
        expect(p.payloads(MessageTopic.TASK_COUNT)[0]).toEqual([{ warriorId: 0, taskCount: 2 }]);
        expect(p.payloads(MessageTopic.RUN_PROGRESS)[0]).toEqual({ runProgress: 1, cycle: 1, maximumCycles: 100 });
        expect(p.payloads(MessageTopic.NEXT_EXECUTION)[0]).toEqual({ warriorId: 0, address: 1 });
        p.clear();
        s.step(); // JMP: no count change
        expect(topics(p)).toEqual(['CORE_ACCESS', 'RUN_PROGRESS', 'NEXT_EXECUTION']);
    });

    test('a refused SPL at maxTasks publishes no TASK_COUNT; a death does', () => {
        const p = recorder();
        const s = sim([warrior(['SPL.B $0, $0', 'DAT.F $0, $0'])], { maxTasks: 1 }, p);
        p.clear();
        s.step();
        expect(p.payloads(MessageTopic.TASK_COUNT)).toEqual([]);
        s.step();
        expect(p.payloads(MessageTopic.TASK_COUNT)).toEqual([[{ warriorId: 0, taskCount: 0 }]]);
    });

    test('RUN_PROGRESS is throttled to integer-percent changes', () => {
        const p = recorder();
        const s = sim([warrior(LOOP)], { maximumCycles: 1000 }, p);
        p.clear();
        for (let i = 0; i < 25; i++) s.step();
        expect(p.payloads(MessageTopic.RUN_PROGRESS).map((x) => x.cycle)).toEqual([10, 20]);
        expect(p.payloads(MessageTopic.NEXT_EXECUTION)).toHaveLength(25);
    });

    test('the round end publishes ROUND_END after that execution\'s messages, then RUN_PROGRESS, and no NEXT_EXECUTION', () => {
        const p = recorder();
        const s = sim([warrior(LOOP, { data: 'w' }), warrior(DIE)], {}, p);
        p.clear();
        s.step(5);
        expect(topics(p)).toEqual(['CORE_ACCESS', 'CORE_ACCESS', 'TASK_COUNT', 'ROUND_END', 'RUN_PROGRESS']);
        expect(p.payloads(MessageTopic.ROUND_END)[0]).toEqual({ winnerId: 0, winnerData: 'w', outcome: 'WIN' });
        expect(p.payloads(MessageTopic.TASK_COUNT)[0]).toEqual([{ warriorId: 1, taskCount: 0 }]);
    });

    test('run() publishes per-execution messages and one RUN_PROGRESS at the end, no NEXT_EXECUTION', () => {
        const p = recorder();
        const s = sim([warrior(LOOP)], { maximumCycles: 50 }, p);
        p.clear();
        s.run();
        const t = topics(p);
        expect(t.filter((x) => x === 'CORE_ACCESS')).toHaveLength(50);
        expect(t.slice(-2)).toEqual(['ROUND_END', 'RUN_PROGRESS']);
        expect(t).not.toContain('NEXT_EXECUTION');
        expect(p.payloads(MessageTopic.RUN_PROGRESS)).toEqual([{ runProgress: 100, cycle: 50, maximumCycles: 50 }]);
    });

    test('warriorData is echoed when the parse result has a data property, even undefined', () => {
        const p = recorder();
        sim([warrior(LOOP, { data: undefined }), warrior(LOOP)], {}, p);
        const [first, second] = p.payloads(MessageTopic.TASK_COUNT)[0];
        expect('warriorData' in first).toBe(true);
        expect('warriorData' in second).toBe(false);
    });

    test('republish sends a snapshot: CORE_INITIALISE, CORE_ACCESS, TASK_COUNT, RUN_PROGRESS, NEXT_EXECUTION or ROUND_END', () => {
        const p = recorder();
        const s = sim([warrior(IMP), warrior(DIE)], {}, p);
        s.step();
        p.clear();
        s.republish();
        expect(topics(p)).toEqual(['CORE_INITIALISE', 'CORE_ACCESS', 'TASK_COUNT', 'RUN_PROGRESS', 'NEXT_EXECUTION']);
        expect(p.payloads(MessageTopic.CORE_ACCESS)[0]).toEqual([
            { warriorId: 0, accessType: AccessType.execute, address: 0 },
            { warriorId: 0, accessType: AccessType.write, address: 1 },
        ]);
        expect(p.payloads(MessageTopic.CORE_INITIALISE)[0].state.cycle).toBe(1);
        expect(s.getCoreView().executions).toBe(1);
        s.run();
        p.clear();
        s.republish();
        expect(topics(p)).toEqual(['CORE_INITIALISE', 'CORE_ACCESS', 'TASK_COUNT', 'RUN_PROGRESS', 'ROUND_END']);
        expect(p.payloads(MessageTopic.ROUND_END)[0]).toEqual({ winnerId: 0, outcome: 'WIN' });
    });

    test('a null provider publishes nothing and runs normally', () => {
        const s = sim([warrior(IMP)], { maximumCycles: 100 }, undefined);
        expect(() => s.republish()).not.toThrow();
        expect(s.runRound().outcome).toBe('NONE');
    });
});

describe('free functions over the default simulator', () => {
    test('delegate to the module-level instance', () => {
        const p = recorder();
        initialiseSimulator({ seed: 1, maximumCycles: 20 }, [warrior(IMP)], p);
        expect(step(2)).toBe(true);
        expect(getCoreView()).toBe(getDefaultSimulator().getCoreView());
        expect(getProcessView()[0]!.instructionPointers).toEqual([2]);
        expect(getWithInfoAt(2).instruction.opcode).toBe(Opcode.MOV);
        p.clear();
        republish();
        expect(p.topics()[0]).toBe('CORE_INITIALISE');
        run();
        expect(step()).toBe(false);
        expect(createSimulator()).not.toBe(getDefaultSimulator());
    });
});

describe('known behaviour', () => {
    const DWARF = ['ADD.AB #4, $3', 'MOV.I $2, @2', 'JMP.B $-2, $0', 'DAT.F #0, #0'];

    test('an imp alone survives to the cycle limit; two imps draw', () => {
        const alone = sim([warrior(IMP)]);
        expect(alone.runRound().outcome).toBe('NONE');
        expect(alone.getProcessView()[0]!.alive).toBe(true);
        expect(alone.getCoreView().cycle).toBe(80000);
        expect(sim([warrior(IMP), warrior(IMP)]).runRound().outcome).toBe('DRAW');
    });

    test('dwarf bombs every fourth address', () => {
        const s = sim([warrior(DWARF)]);
        s.step(3 * 10);
        for (let k = 1; k <= 10; k++) {
            expect(cell(s, 3 + 4 * k)).toBe(`DAT.F #0, #${4 * k}`);
            expect(cell(s, 3 + 4 * k + 1)).toBe('DAT.F $0, $0');
        }
        expect(cell(s, 3)).toBe('DAT.F #0, #40');
    });

    test('imp vs dwarf: the imp never wins and most rounds draw', () => {
        let dwarfWins = 0;
        let draws = 0;
        for (let seed = 0; seed < 40; seed++) {
            const r = sim([warrior(DWARF), warrior(IMP)], { seed, firstWarrior: seed % 2, trackAccess: false }).runRound();
            expect(r.winnerId).not.toBe(1);
            if (r.outcome === 'WIN') dwarfWins++;
            else draws++;
        }
        expect(draws).toBeGreaterThan(dwarfWins);
    });

    test('silk boot creates 6 processes, all at paper, with a TASK_COUNT per change', () => {
        const p = recorder();
        const silk = ['SPL.B $1, $0', 'MOV.I $-1, $0', 'SPL.B $1, $0', 'SPL.B @0, $2364', 'DAT.F $0, $0'];
        const s = sim([warrior(silk)], {}, p);
        s.step(6);
        expect(s.getProcessView()[0]!.instructionPointers).toEqual([3, 3, 3, 3, 3, 3]);
        expect(p.payloads(MessageTopic.TASK_COUNT).slice(1).map((x) => x[0].taskCount)).toEqual([2, 3, 4, 5, 6]);
    });

    test('behaviour is independent of the load address', () => {
        const outcome = (first: number) => {
            const s = sim([warrior(LOOP), warrior(DWARF)], { seed: first, maximumCycles: 3000 });
            s.run();
            const at = s.getProcessView()[1]!.loadAddress;
            return [1, 2, 3, 7, 11].map((k) => cell(s, at + k));
        };
        expect(outcome(1)).toEqual(outcome(2));
    });
});
