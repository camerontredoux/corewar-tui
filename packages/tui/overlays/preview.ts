/**
 * Editor preview (F6, see overlays/editor.ts): the warrior's last saved text,
 * alone in a core with the match's settings, run one instruction a second so
 * each step can be followed.
 *
 * The run is the real one (the match's core size, limits and standard), so
 * every offset is the one the battle sees. The board shows only the cells
 * around the warrior, COLS to a row, the first row starting `loadAt()` cells
 * before its first instruction; accesses beyond it still show in the step
 * log. Offsets count from the warrior's first instruction, as the editor's
 * relative gutter does.
 *
 * Saving goes back to the start, paused (`load`): nothing runs until F7.
 * F7 plays or pauses (or restarts after the end), F8 runs one step and
 * pauses, F9 goes back to the start, paused; the header buttons do the same. Clicking a cell shows what it holds now.
 */

import { BoxRenderable, type CliRenderer } from '@opentui/core';
import {
    AccessType,
    DEFAULT_OPTIONS,
    MessageTopic,
    MessageType,
    createSimulator,
    fold,
    formatInstruction,
    type ICoreAccessEventArgs,
    type ICoreView,
    type IParseResult,
    type ISimulatorOptions,
    type Simulator,
} from '../../engine/index.ts';
import { CoreBoard } from '../board.ts';
import { GLYPH, HEX, shadeHex, warriorHex } from '../theme.ts';
import { SegmentText, button, fitLine, spread, type Line } from '../ui.ts';

export const PREVIEW_STEP_MS = 1000;
/** Columns the preview takes beside the text, its left border included. */
export const PREVIEW_WIDTH = 34;
/** Cells per board row (each two columns wide). */
const COLS = 10;
const LABEL_WIDTH = 5;
const MIN_ROWS = 3;
const MAX_ROWS = 10;
/** Steps kept for the log. */
const LOG_STEPS = 50;
/** Text width inside the left border and padding. */
const WIDTH = PREVIEW_WIDTH - 2;
const COLOR = warriorHex(0);
/** Background of the source line that runs next (editor.ts) and of the run's swatches. */
export const NEXT_LINE_BG = shadeHex(COLOR, 4);
/** Background of the source lines the other processes (from SPL) run later (editor.ts). */
export const QUEUED_LINE_BG = shadeHex(HEX.accent, 4);

export interface PreviewStep {
    /** 1 for the first instruction run. */
    step: number;
    /** The address that ran (absolute). */
    address: number;
    /** It as it was before it ran (a step may overwrite its own cell). */
    text: string;
    /** Addresses read and written, in order, without repeats. */
    reads: number[];
    writes: number[];
    /** Processes after the step minus before: +1 for SPL, -1 when one dies. */
    processes: number;
}

export class Preview {
    readonly root: BoxRenderable;
    private readonly header: SegmentText;
    private readonly grid: BoxRenderable;
    private readonly labels: SegmentText;
    private readonly board: CoreBoard;
    private readonly legend: SegmentText;
    private readonly info: SegmentText;
    private readonly coresize: number;
    /** The text being run, or null before the first load. */
    source: string | null = null;
    /** Set by the editor when its text is not `source`. */
    stale = false;
    private result: IParseResult | null = null;
    private sim: Simulator | null = null;
    /** Why there is nothing to run. */
    private failure: string | null = null;
    /** How the run ended, or null while it can go on. */
    private ended: string | null = null;
    readonly steps: PreviewStep[] = [];
    private accesses: { type: AccessType; address: number }[] = [];
    private timer: ReturnType<typeof setInterval> | undefined;
    private rows = MIN_ROWS;

    constructor(
        renderer: CliRenderer,
        private readonly options: ISimulatorOptions,
        /** Called after each step or restart (the editor redraws the next-line highlight). */
        private readonly onUpdate: () => void,
    ) {
        this.coresize = options.coresize ?? DEFAULT_OPTIONS.coresize;
        this.root = new BoxRenderable(renderer, {
            id: 'editor-preview',
            width: PREVIEW_WIDTH,
            flexShrink: 0,
            flexDirection: 'column',
            border: ['left'],
            borderColor: HEX.border,
            paddingLeft: 1,
        });
        this.header = new SegmentText(renderer, { id: 'editor-preview-header', height: 2, flexShrink: 0 });
        this.grid = new BoxRenderable(renderer, { id: 'editor-preview-grid', flexDirection: 'row', height: this.rows, flexShrink: 0 });
        this.labels = new SegmentText(renderer, { id: 'editor-preview-labels', width: LABEL_WIDTH, flexShrink: 0 });
        this.board = new CoreBoard(renderer, { id: 'editor-preview-board', width: COLS * 2, height: this.rows, flexGrow: 0 });
        this.board.warriorCount = 1;
        this.board.onCellClick = (address) => {
            this.board.selected = this.board.selected === address ? null : address;
            this.draw();
        };
        this.legend = new SegmentText(renderer, { id: 'editor-preview-legend', height: 1, flexShrink: 0 });
        this.info = new SegmentText(renderer, { id: 'editor-preview-info', flexGrow: 1 });
        this.grid.add(this.labels);
        this.grid.add(this.board);
        this.root.add(this.header);
        this.root.add(this.grid);
        this.root.add(this.legend);
        this.root.add(this.info);
    }

    get playing(): boolean {
        return this.timer !== undefined;
    }

    /** Address of the warrior's first instruction: one row in, so cells just before it show too. */
    private get loadAt(): number {
        return this.coresize > 4 * COLS ? COLS : 0;
    }

    /** Set up `source` (`result` is its parse) at the start, paused. */
    load(source: string, result: IParseResult): void {
        this.source = source;
        this.result = result;
        this.restart();
    }

    /** Nothing to run: `why` says so in place of the run. */
    fail(source: string, why: string): void {
        this.source = source;
        this.result = null;
        this.reset();
        this.failure = why;
        this.draw();
    }

    /** F9: back to the start, paused (or `play`ing). */
    restart(play = false): void {
        const result = this.result;
        if (!result) return;
        this.reset();
        const errors = result.messages.filter((m) => m.type === MessageType.Error).length;
        if (errors) {
            this.failure = `✗ ${errors} error${errors === 1 ? '' : 's'}: fix and save to run`;
            return this.draw();
        }
        try {
            const sim = createSimulator();
            const record = (type: string, payload: ICoreAccessEventArgs[]) => {
                if (type !== MessageTopic.CORE_ACCESS) return;
                for (const a of payload) if (a.accessType !== AccessType.execute) this.accesses.push({ type: a.accessType, address: a.address });
            };
            sim.initialise({ ...this.options, loadAddresses: [this.loadAt], seed: 1, trackAccess: true }, [result], { publishSync: record });
            this.sim = sim;
        } catch (e) {
            this.failure = `✗ ${e instanceof Error ? e.message : String(e)}`;
            return this.draw();
        }
        if (play) this.play();
        else this.draw();
    }

    /** F7: pause, play, or after the end start again. */
    toggle(): void {
        if (this.playing) this.pause();
        else if (this.ended) this.restart(true);
        else this.play();
    }

    /** F8: one step, paused. */
    stepOnce(): void {
        this.pause();
        this.step();
    }

    play(): void {
        if (this.sim && !this.ended && !this.playing) this.timer = setInterval(() => this.step(), PREVIEW_STEP_MS);
        this.draw();
    }

    pause(): void {
        if (this.timer !== undefined) clearInterval(this.timer);
        this.timer = undefined;
        this.draw();
    }

    /** The next instruction's cell counted from the warrior's first one, or null when it runs outside its code. */
    nextCell(): number | null {
        return this.processCells()[0] ?? null;
    }

    /** The cells the other processes run later, in queue order, without repeats or the next cell. */
    queuedCells(): number[] {
        const [next, ...rest] = this.processCells();
        return [...new Set(rest.filter((c): c is number => c !== null && c !== next))];
    }

    /** Each process's next cell, next-to-run first; null where it runs outside the code. */
    private processCells(): (number | null)[] {
        const p = this.sim?.getProcessView()[0];
        if (!p?.alive) return [];
        return p.instructionPointers.map((pc) => {
            const cell = fold(pc - p.loadAddress, this.coresize);
            return cell < p.length ? cell : null;
        });
    }

    /** Board rows for the height the layout gave: about 40% of it. Run before each frame's layout. */
    fit(): void {
        const rows = Math.max(MIN_ROWS, Math.min(MAX_ROWS, Math.floor(this.root.height * 0.4), Math.ceil(this.coresize / COLS)));
        if (rows === this.rows) return;
        this.rows = rows;
        this.grid.height = rows;
        this.board.height = rows;
        this.draw();
    }

    private reset(): void {
        this.pause();
        this.sim = null;
        this.failure = null;
        this.ended = null;
        this.steps.length = 0;
        this.board.selected = null;
    }

    private step(): void {
        const sim = this.sim;
        const before = sim?.getProcessView()[0];
        const pc = before?.instructionPointers[0];
        if (!sim || this.ended || !before?.alive || pc === undefined) return;
        const text = formatInstruction(sim.getWithInfoAt(pc).instruction, { signedFor: this.coresize });
        this.accesses = [];
        const running = sim.step(1);
        const after = sim.getProcessView()[0]!;
        const of = (type: AccessType) => [...new Set(this.accesses.filter((a) => a.type === type).map((a) => a.address))];
        const step = this.steps.length ? this.steps[this.steps.length - 1]!.step + 1 : 1;
        this.steps.push({ step, address: pc, text, reads: of(AccessType.read), writes: of(AccessType.write), processes: after.taskCount - before.taskCount });
        if (this.steps.length > LOG_STEPS) this.steps.shift();
        if (!after.alive) this.ended = `✗ died at step ${step}`;
        else if (!running) this.ended = `⏱ cycle limit at step ${step}`;
        if (this.ended) this.pause();
        this.draw();
        this.onUpdate();
    }

    /** Signed offset from the warrior's first instruction, as text: `+3`, `-1`. */
    private offset(address: number): string {
        const d = fold(address - this.loadAt, this.coresize);
        const n = d > this.coresize / 2 ? d - this.coresize : d;
        return n < 0 ? String(n) : `+${n}`;
    }

    private cellText(address: number): string {
        return this.sim ? formatInstruction(this.sim.getWithInfoAt(address).instruction, { signedFor: this.coresize }) : '';
    }

    draw(): void {
        if (this.root.isDestroyed) return;
        const sim = this.sim;
        const playLabel = this.playing ? 'F7 pause' : this.ended ? 'F7 again' : 'F7 play';
        const buttons: Line = [
            button(playLabel, () => this.toggle(), true),
            { text: ' ' },
            button('F8 step', () => this.stepOnce()),
            { text: ' ' },
            button('F9 reset', () => this.restart()),
        ];
        const count = this.steps.length ? this.steps[this.steps.length - 1]!.step : 0;
        this.header.setLines([spread([{ text: 'PREVIEW', fg: HEX.accent, bold: true }], sim ? [{ text: `step ${count}`, fg: HEX.muted }] : [], WIDTH), buttons]);

        const size = Math.min(this.rows * COLS, this.coresize);
        this.labels.setLines(Array.from({ length: this.rows }, (_, r) => [{ text: (r * COLS < size ? this.offset(r * COLS) : '').padStart(LABEL_WIDTH - 1), fg: HEX.faint }]));
        this.board.size = size;
        const view = sim?.getCoreView();
        this.board.view = view ? windowOf(view, size) : null;
        this.board.processes = (sim?.getProcessView() ?? []).map((p) => ({ ...p, length: Math.max(0, Math.min(p.length, size - p.loadAddress)) }));
        this.board.requestRender();

        const swatch = (glyph: number, label: string, fg = COLOR, bg?: string): Line => [{ text: String.fromCharCode(glyph), fg, bg }, { text: ` ${label}  `, fg: HEX.muted }];
        this.legend.setLines([
            [...swatch(GLYPH.runsNext, 'next', HEX.white, COLOR), ...swatch(GLYPH.execute, 'ran'), ...swatch(GLYPH.write, 'wrote'), ...swatch(GLYPH.read, 'read', shadeHex(COLOR, 1))],
        ]);

        const lines: Line[] = [];
        const p = sim?.getProcessView()[0];
        if (this.failure) lines.push([{ text: this.failure, fg: HEX.bad }]);
        else if (!sim || !p) lines.push([{ text: 'save to run it', fg: HEX.muted }]);
        else {
            const state = this.ended ?? (this.playing ? '▶ running' : '❚❚ paused');
            const processes = `${p.taskCount} process${p.taskCount === 1 ? '' : 'es'}`;
            lines.push([{ text: state, fg: this.ended ? (this.ended.startsWith('✗') ? HEX.bad : HEX.warn) : HEX.good }, { text: ` · ${processes}`, fg: HEX.muted }]);
            const pc = p.alive ? p.instructionPointers[0] : undefined;
            if (pc !== undefined) lines.push([{ text: 'next ', fg: HEX.muted }, { text: `${this.offset(pc).padStart(4)}  ${this.cellText(pc)}`, fg: COLOR, bold: true }]);
            const selected = this.board.selected;
            if (selected !== null) lines.push([{ text: 'cell ', fg: HEX.muted }, { text: `${this.offset(selected).padStart(4)}  ${this.cellText(selected)}`, fg: HEX.text }]);
        }
        if (this.stale) lines.push([{ text: 'unsaved: runs the last save', fg: HEX.warn }]);
        lines.push([]);
        const room = Math.max(0, this.info.height - lines.length);
        const log: Line[][] = [];
        let used = 0;
        for (let i = this.steps.length - 1; i >= 0; i--) {
            const entry = this.stepLines(this.steps[i]!);
            if (used + entry.length > room) break;
            log.unshift(entry);
            used += entry.length;
        }
        this.info.setLines([...lines, ...log.flat()].map((l) => fitLine(l, WIDTH)));
    }

    /** A log entry: the step, where and what ran, then what it read and wrote and any process change. */
    private stepLines(s: PreviewStep): Line[] {
        const head: Line = [
            { text: `${String(s.step).padStart(4)} `, fg: HEX.muted },
            { text: `${this.offset(s.address).padStart(4)}  `, fg: COLOR },
            { text: s.text, fg: HEX.text },
        ];
        const detail: Line = [];
        const list = (label: string, addresses: number[], fg: string) => {
            if (addresses.length) detail.push({ text: ` ${label} ${addresses.map((a) => this.offset(a)).join(' ')}`, fg });
        };
        list('r', s.reads, HEX.muted);
        list('w', s.writes, HEX.warn);
        if (s.processes > 0) detail.push({ text: ` +${s.processes} process`, fg: HEX.good });
        if (s.processes < 0) detail.push({ text: ` ${s.processes} process`, fg: HEX.bad });
        return detail.length ? [head, [{ text: ' '.repeat(10) }, ...detail]] : [head];
    }
}

/** The first `size` cells of a core view, live (the arrays are shared, not copied). */
function windowOf(view: ICoreView, size: number): ICoreView {
    return {
        size,
        accessKind: view.accessKind.subarray(0, size),
        accessWarrior: view.accessWarrior.subarray(0, size),
        accessStamp: view.accessStamp.subarray(0, size),
        get executions() {
            return view.executions;
        },
        get cycle() {
            return view.cycle;
        },
        get lastExecuted() {
            return view.lastExecuted < size ? view.lastExecuted : -1;
        },
        get nextWarrior() {
            return view.nextWarrior;
        },
    };
}
