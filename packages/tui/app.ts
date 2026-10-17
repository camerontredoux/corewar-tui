/**
 * Builds the TUI on a renderer and wires the controller, board, header,
 * footer, overlays and keys. Shared by main.ts and the tests.
 *
 * Layout: one-line header (warriors, cycle, round, speed, state), the CORE
 * board filling the rest, one-line footer of clickable key hints.
 */

import { BoxRenderable, type CliRenderer, type KeyEvent } from '@opentui/core';
import { DEFAULT_OPTIONS, createSimulator, parse as engineParse, parseOptionsFor } from '../engine/index.ts';
import { CoreBoard, computeLayout } from './board.ts';
import { GameController, speedLabel, type MatchSettings, type MatchWarrior, type Phase, type SimulatorLike } from './controller.ts';
import { BINDINGS, actionForKey, type Action } from './keys.ts';
import { WarriorLibrary, compileWarrior, type CompiledWarrior, type LoadedWarrior, type WarriorEntry } from './library.ts';
import { EditorOverlay, type EditorRequest } from './overlays/editor.ts';
import { HelpOverlay } from './overlays/help.ts';
import { InspectorOverlay } from './overlays/inspector.ts';
import { OverlayManager } from './overlays/manager.ts';
import { PickerOverlay } from './overlays/picker.ts';
import { ResultsOverlay } from './overlays/results.ts';
import { SettingsOverlay } from './overlays/settings.ts';
import { DEFAULT_PREFS, loadPrefs, savePrefs, type EditorPrefs } from './prefs.ts';
import { HEX, warriorHex } from './theme.ts';
import { SegmentText, lineWidth, spread, type Line, type Segment } from './ui.ts';

export interface AppOptions {
    /** Project root holding warriors/ and examples/. */
    root?: string;
    library?: WarriorLibrary;
    simulator?: SimulatorLike;
    parse?: typeof engineParse;
    /** Run the frame loop on a timer (default true). Tests drive `tick()` by hand. */
    autoTick?: boolean;
    /** Frame interval in ms (default 1000 / 60). */
    frameMs?: number;
    now?: () => number;
    /** Library ids for the first match. Default: the first two that parse (user warriors first). */
    initialWarriors?: string[];
    /** Match seed for the first match (tests). */
    seed?: number;
    /** Editor preferences file (prefs.ts; main.ts passes the XDG path). Without one they start at the defaults and are not saved. */
    configPath?: string;
    onQuit?: () => void;
}

export interface App {
    readonly renderer: CliRenderer;
    readonly controller: GameController;
    readonly board: CoreBoard;
    readonly header: SegmentText;
    readonly footer: SegmentText;
    readonly overlays: OverlayManager;
    readonly library: WarriorLibrary;
    dispatch(action: Action): void;
    /** Open (or move) the cell inspector. */
    inspect(address: number): void;
    /** Open the warrior editor (overlays/editor.ts) for a new warrior or an existing library entry. */
    openEditor(request: EditorRequest): void;
    /** Run one frame: advance the simulation and repaint. */
    tick(): void;
    /** Repaint header, footer, board and overlays from the controller. */
    refresh(): void;
    destroy(): void;
}

export function createApp(renderer: CliRenderer, options: AppOptions = {}): App {
    const library = options.library ?? new WarriorLibrary(options.root ?? process.cwd());
    const parse = options.parse ?? engineParse;
    const controller = new GameController(options.simulator ?? createSimulator(), options.now);
    const frameMs = options.frameMs ?? 1000 / 60;
    const autoTick = options.autoTick ?? true;
    let prefs: EditorPrefs = options.configPath ? loadPrefs(options.configPath) : { ...DEFAULT_PREFS };
    let timer: ReturnType<typeof setInterval> | undefined;
    let fade = false;
    /** Match warriors whose file was saved since they were compiled; restart reloads them. */
    const stale = new Set<string>();
    /** Source each match warrior was compiled from; a warrior deleted from the library keeps playing from it. */
    const kept = new Map<string, LoadedWarrior>();

    // ---- Layout -----------------------------------------------------------
    const app = new BoxRenderable(renderer, {
        id: 'app',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: HEX.bg,
    });
    const header = new SegmentText(renderer, { id: 'header', height: 1, flexShrink: 0 });
    const boardBox = new BoxRenderable(renderer, {
        id: 'board-box',
        flexGrow: 1,
        border: true,
        borderStyle: 'single',
        borderColor: HEX.border,
        title: 'CORE',
        titleColor: HEX.muted,
        bottomTitleAlignment: 'right',
    });
    const board = new CoreBoard(renderer, { id: 'board' });
    const footer = new SegmentText(renderer, { id: 'footer', height: 1, flexShrink: 0 });
    boardBox.add(board);
    app.add(header);
    app.add(boardBox);
    app.add(footer);
    renderer.root.add(app);

    const overlays = new OverlayManager(renderer);

    // ---- Warriors ---------------------------------------------------------
    const compile = (id: string, count: number, settings: MatchSettings = controller.settings): CompiledWarrior =>
        compileWarrior(library, id, parse, settings.options, count, settings.rounds, kept.get(id));
    const toMatch = (c: CompiledWarrior): MatchWarrior => ({ id: c.entry.id, name: c.name, source: c.result! });

    /** Settings only take effect when every warrior compiles under them; otherwise the current match is left untouched. */
    function startMatch(ids: string[], settings: MatchSettings = controller.settings, play = false, seed?: number): string | undefined {
        const compiled = ids.map((id) => compile(id, ids.length, settings));
        const bad = compiled.find((c) => !c.result);
        if (bad) return `${bad.entry.id}: ${bad.errors[0] ?? 'failed to load'}`;
        controller.settings = settings;
        controller.startMatch(compiled.map(toMatch), settings, seed, play);
        stale.clear();
        kept.clear();
        for (const c of compiled) kept.set(c.entry.id, { entry: c.entry, source: c.source });
        return undefined;
    }

    function defaultMatch(): string | undefined {
        if (options.initialWarriors) return startMatch(options.initialWarriors, controller.settings, false, options.seed);
        const entries = library.list();
        const candidates = [
            ...entries.filter((e) => e.origin === 'warriors'),
            ...['builtin/dwarf.red', 'builtin/imp.red'].flatMap((id) => entries.filter((e) => e.id === id)),
        ];
        const good: string[] = [];
        let firstError = '';
        for (const e of candidates) {
            if (good.length === 2) break;
            const c = compile(e.id, 2);
            if (c.result) good.push(e.id);
            else firstError ||= `${e.id}: ${c.errors[0]}`;
        }
        return good.length === 2 ? startMatch(good, controller.settings, false, options.seed) : firstError || 'no warriors found';
    }

    // ---- Overlays -----------------------------------------------------------
    /** The last inspected address; Enter reopens it while it is on screen. */
    let lastCell: number | null = null;
    const inspector = new InspectorOverlay(renderer, {
        controller,
        columns: () => board.layout.cols,
        onSelect: (address) => {
            board.selected = address;
            if (address !== null) lastCell = address;
            if (address !== null) board.reveal(address);
            board.requestRender();
        },
    });

    const picker = new PickerOverlay(renderer, {
        compileAll: () => library.list().map((e) => compile(e.id, Math.max(2, controller.warriors.length))),
        currentIds: () => controller.warriors.map((w) => w.id),
        onStart: (picked) => {
            overlays.close('warriors');
            overlays.close('inspector');
            const error = startMatch(
                picked.map((p) => p.entry.id),
                controller.settings,
                true,
            );
            if (error) notice = error;
            afterAction();
        },
        onNew: () => openEditor({ mode: 'new' }),
        onEdit: (entry) => openEditor({ mode: 'edit', warrior: entry }),
        onDelete: (entry) => {
            // A match warrior stays loaded (its compiled code is in the controller) until the match changes.
            try {
                library.delete(entry);
            } catch (e) {
                return `✗ not deleted: ${e instanceof Error ? e.message : String(e)}`;
            }
            stale.delete(entry.id);
            notice = `deleted ${entry.id} (moved to ${entry.id.slice(0, entry.id.lastIndexOf('/'))}/.trash)`;
            refresh();
            return notice;
        },
    });

    const settings = new SettingsOverlay(renderer, {
        current: () => controller.settings,
        onApply: (next) => {
            overlays.close('settings');
            overlays.close('inspector');
            const ids = controller.warriors.map((w) => w.id);
            const play = controller.phase === 'running';
            if (ids.length === 0) controller.settings = next;
            else {
                const listed = new Set(library.list().map((e) => e.id));
                const deleted = ids.filter((id) => !listed.has(id));
                const error = startMatch(ids, next, play);
                if (error) notice = `settings not applied: ${error}`;
                else if (deleted.length) notice = `${deleted.join(', ')} deleted; playing the loaded copy`;
            }
            afterAction();
        },
        onCancel: () => overlays.close('settings'),
    });

    const results = new ResultsOverlay(renderer, {
        controller,
        onRematch: () => {
            overlays.close('results');
            controller.startMatch(controller.warriors, controller.settings, undefined, true);
            afterAction();
        },
        onWarriors: () => {
            overlays.close('results');
            dispatch('warriors');
        },
        onClose: () => overlays.close('results'),
    });

    const help = new HelpOverlay(renderer, () => overlays.close('help'));

    /** Restart the round, first recompiling match warriors saved in the editor. */
    function restart(): void {
        if (stale.size) {
            const n = controller.warriors.length;
            controller.warriors = controller.warriors.map((w) => {
                if (!stale.has(w.id)) return w;
                const c = compile(w.id, n);
                if (c.result) {
                    kept.set(w.id, { entry: c.entry, source: c.source });
                    return toMatch(c);
                }
                notice = `${w.id} has errors; restarted with the previous version`;
                return w;
            });
            stale.clear();
        }
        controller.restartRound();
    }

    function openEditor(request: EditorRequest): void {
        const open = overlays.get('editor') as EditorOverlay | undefined;
        if (open && !open.confirmDiscard()) return; // unsaved changes: it now asks to discard first
        let source = '';
        if (request.warrior) {
            try {
                source = library.load(request.warrior.id).source;
            } catch (e) {
                source = `; could not read ${request.warrior.id}: ${e instanceof Error ? e.message : String(e)}`;
            }
        }
        overlays.open(
            new EditorOverlay(renderer, request, {
                source,
                check: (text) =>
                    parse(text, parseOptionsFor(controller.settings.options, Math.max(2, controller.warriors.length), controller.settings.rounds)),
                save: (text, entry) => {
                    const saved = library.save(text, entry);
                    const inMatch = controller.warriors.some((w) => w.id === saved.entry.id);
                    if (inMatch) stale.add(saved.entry.id);
                    if (overlays.isOpen('warriors')) {
                        picker.reload();
                        overlays.placeAll();
                    }
                    const notes = [saved.backup ? `backup ${saved.backup.split('/').pop()}` : '', inMatch ? 'r restarts with it' : ''];
                    return { entry: saved.entry, note: notes.filter(Boolean).join(' · ') };
                },
                onClose: () => overlays.close('editor'),
                prefs,
                savePrefs: (next) => {
                    prefs = next;
                    if (options.configPath) savePrefs(options.configPath, next);
                },
                options: controller.settings.options,
            }),
        );
    }

    /** The library entry to edit from the main screen: the inspected cell's warrior, else the first. */
    function editTarget(): WarriorEntry | undefined {
        const at = board.selected !== null ? controller.inspect(board.selected)?.access?.warriorId : undefined;
        const id = controller.warriors[at ?? 0]?.id;
        return id ? library.list().find((e) => e.id === id) : undefined;
    }

    controller.onPhaseChange = (phase: Phase) => {
        if (phase === 'match-over') overlays.open(results);
    };

    // ---- Actions ------------------------------------------------------------
    let notice = '';

    function dispatch(action: Action): void {
        notice = '';
        switch (action) {
            case 'quit':
                options.onQuit?.();
                return;
            case 'toggleRun':
                controller.togglePause();
                break;
            case 'step':
                controller.stepOnce();
                break;
            case 'speedUp':
                controller.speedUp();
                break;
            case 'speedDown':
                controller.speedDown();
                break;
            case 'restart':
                restart();
                break;
            case 'nextRound':
                controller.nextRound();
                break;
            case 'warriors':
                picker.load();
                overlays.open(picker);
                break;
            case 'settings':
                settings.load();
                overlays.open(settings);
                break;
            case 'newWarrior':
                openEditor({ mode: 'new' });
                break;
            case 'editWarrior': {
                const warrior = editTarget();
                openEditor(warrior ? { mode: 'edit', warrior } : { mode: 'new' });
                break;
            }
            case 'help':
                overlays.open(help);
                break;
            case 'fade':
                fade = !fade;
                break;
            case 'zoom': {
                board.modeOverride = board.modeOverride === 'fit' ? 'detail' : 'fit';
                const fitMode = computeLayout(board.size, board.width, board.height, 'fit').mode;
                notice =
                    board.modeOverride === 'detail'
                        ? fitMode === 'half' ? 'zoom: detail (1 cell per address, scrolls)' : 'zoom: detail (the whole core already fits)'
                        : 'zoom: fit to screen';
                break;
            }
            case 'inspect': {
                // Toggle the inspector without the mouse: the last inspected cell if still on screen, else the first visible one.
                if (overlays.isOpen('inspector')) {
                    overlays.close('inspector');
                    break;
                }
                const l = board.layout;
                const first = board.scroll * l.rowsPerLine * l.cols;
                const last = Math.min(controller.coresize, first + l.visibleLines * l.rowsPerLine * l.cols) - 1;
                inspect(lastCell !== null && lastCell >= first && lastCell <= last ? lastCell : first);
                break;
            }
            case 'scrollUp':
                board.scrollBy(-Math.max(1, board.layout.visibleLines - 1));
                break;
            case 'scrollDown':
                board.scrollBy(Math.max(1, board.layout.visibleLines - 1));
                break;
        }
        afterAction();
    }

    /** Header, footer and board clicks only act when no modal panel is open (keys are already blocked). */
    const onMain = (act: () => void) => () => {
        if (!overlays.top?.modal) act();
    };

    function inspect(address: number): void {
        if (!overlays.isOpen('inspector')) overlays.open(inspector);
        inspector.select(address);
        refresh();
    }
    board.onCellClick = (address) => onMain(() => inspect(address))();
    // Layout-dependent text (scroll range) can only be computed once the board has its size.
    board.onResized = () => queueMicrotask(refresh);
    board.onScrolled = () => queueMicrotask(refresh); // the border shows the scrolled row range

    function afterAction(): void {
        refresh();
        ensureTicking();
    }

    // ---- Frame loop -----------------------------------------------------------
    function tick(): void {
        controller.advance(Math.max(4, frameMs * 0.7));
        refresh();
        if (!controller.wantsFrames) stopTicking();
    }

    function ensureTicking(): void {
        if (autoTick && !timer && controller.wantsFrames) timer = setInterval(tick, frameMs);
    }

    function stopTicking(): void {
        if (timer) clearInterval(timer);
        timer = undefined;
    }

    // ---- Painting -------------------------------------------------------------
    function stateSegment(): Segment {
        const c = controller;
        const toggle = onMain(() => dispatch('toggleRun'));
        switch (c.phase) {
            case 'running':
                return { text: ' ▶ RUNNING ', fg: HEX.good, bold: true, onClick: toggle };
            case 'paused':
                return { text: ' ❚❚ PAUSED ', fg: HEX.warn, bold: true, onClick: toggle };
            case 'round-over': {
                const r = c.lastResult;
                // A solo round has no winner: it ends when the warrior dies or the cycle limit is hit.
                const solo = r?.outcome === 'NONE' ? (c.processes[0]?.alive ? 'SURVIVED' : 'DIED') : 'DRAW';
                const who = r?.outcome === 'WIN' && r.winnerId !== null ? `${c.warriors[r.winnerId]?.name ?? '?'} WINS` : solo;
                return { text: ` ■ ${who.toUpperCase()} `, fg: HEX.accent, bold: true, onClick: toggle };
            }
            case 'match-over':
                return { text: ' ■ MATCH OVER ', fg: HEX.accent, bold: true, onClick: onMain(() => overlays.open(results)) };
            case 'error':
                return { text: ' ✗ ERROR ', fg: HEX.bad, bold: true };
            default:
                return { text: ' ○ IDLE ', fg: HEX.muted, bold: true };
        }
    }

    /** First warrior shown when the header has more warriors than fit (moved with its ‹ › buttons). */
    let headerFirst = 0;

    function headerLine(width: number): Line {
        const c = controller;
        const logo: Line = [{ text: ' COREWAR ', fg: HEX.accentInk, bg: HEX.accent, bold: true }, { text: ' ' }];
        const started = c.view !== null;
        // ▶ marks the warrior that moves on the next step.
        const next = started && c.phase !== 'round-over' ? c.view!.nextWarrior : -1;
        const status = c.status();
        // When the names don't fit, leave them out; the picker (w) shows which colour is which.
        // Every warrior's slot in the paged strip has the same width (room for the largest process count
        // and round tally), with its text centred, so its ‹ › buttons stay put while the counts change.
        const maxTasks = c.settings.options.maxTasks ?? DEFAULT_OPTIONS.maxTasks;
        const slot = `● ${maxTasks}p ${c.rounds}w`.length;
        const named: Line = [];
        const items: Line[] = [];
        const slots: Line[] = [];
        for (const s of status) {
            const dead = started && !s.alive;
            const colour = warriorHex(s.id);
            const mark = s.id === next && s.alive ? '▶' : '●';
            const stats = `${s.taskCount}p ${s.won}w`;
            named.push({ text: ` ${mark} `, fg: colour }, { text: s.name, fg: colour, bold: true, strike: dead, dim: dead }, { text: ` ${stats}`, fg: HEX.muted });
            items.push([{ text: ` ${mark} `, fg: colour }, { text: stats, fg: HEX.muted }]);
            const pad = slot - `${mark} ${stats}`.length;
            const before = ' '.repeat(Math.floor(pad / 2));
            slots.push([{ text: `${before}${mark}`, fg: colour }, { text: ` ${stats}${' '.repeat(pad - before.length)}`, fg: HEX.muted }]);
        }
        const sep = { text: ' · ', fg: HEX.faint };
        const unit = c.settings.options.cycleUnit === 'pmars' ? ' (pmars)' : '';
        const right: Line = [
            { text: 'cycle ', fg: HEX.muted },
            { text: `${c.cycle.toLocaleString('en-US')}/${c.maximumCycles.toLocaleString('en-US')}${unit}` },
            sep,
            { text: 'round ', fg: HEX.muted },
            { text: `${c.warriors.length ? c.round + 1 : 0}/${c.rounds}` },
            sep,
            { text: 'speed ', fg: HEX.muted },
            { text: speedLabel(c.speedIndex) },
            { text: ' ' },
            stateSegment(),
        ];
        const room = width - lineWidth(logo) - lineWidth(right) - 1;
        if (lineWidth(named) <= room) return spread([...logo, ...named], right, width);
        const compact = items.flat();
        if (lineWidth(compact) <= room) return spread([...logo, ...compact], right, width);

        // Still too many: show the warriors that fit between ‹ and › buttons, which page through the rest.
        // Layout: ' ‹ ' slot ' ' slot ... ' › '.
        const page = Math.max(1, Math.floor((room - 6 + 1) / (slot + 1)));
        headerFirst = Math.max(0, Math.min(headerFirst, slots.length - page));
        const end = Math.min(slots.length, headerFirst + page);
        const arrow = (text: string, enabled: boolean, by: number): Segment =>
            enabled
                ? { text, fg: HEX.accent, onClick: onMain(() => ((headerFirst += by), refresh())) }
                : { text, fg: HEX.faint };
        const shown = slots.slice(headerFirst, end).flatMap((s, i) => (i ? [{ text: ' ' }, ...s] : s));
        const strip: Line = [arrow(' ‹ ', headerFirst > 0, -page), ...shown, arrow(' › ', end < slots.length, page)];
        return spread([...logo, ...strip], right, width);
    }

    function footerLine(width: number): Line {
        // Show the most important hints that fit; the New button always gets an accent pill.
        const items = BINDINGS.filter((b) => b.footer !== undefined);
        const seg = (b: (typeof BINDINGS)[number]): Segment[] =>
            b.action === 'newWarrior'
                ? [{ text: ` ${b.hint} New `, fg: HEX.accentInk, bg: HEX.accent, bold: true, hoverBg: HEX.white, onClick: onMain(() => dispatch(b.action)) }, { text: ' ' }]
                : [
                      { text: ` ${b.hint}`, fg: HEX.accent, onClick: onMain(() => dispatch(b.action)) },
                      { text: ` ${b.label} `, fg: HEX.muted, onClick: onMain(() => dispatch(b.action)) },
                  ];
        const order = [...new Set(items.map((b) => b.footer!))].sort((a, b) => a - b);
        let shown = items;
        for (let i = order.length; i > 0; i--) {
            shown = items.filter((b) => b.footer! <= order[i - 1]!);
            const w = shown.reduce((n, b) => n + seg(b).reduce((m, s) => m + s.text.length, 0), 0);
            if (w + (notice ? notice.length + 2 : 0) <= width) break; // hints make room for the notice
        }
        const left = shown.filter((b) => b.action !== 'quit' && b.action !== 'help').flatMap(seg);
        const right = shown.filter((b) => b.action === 'quit' || b.action === 'help').flatMap(seg);
        if (notice) left.push({ text: `  ${notice}`, fg: HEX.warn });
        return spread(left, right, width);
    }

    function boardMessage(): string {
        const c = controller;
        if (c.phase === 'error') return `✗ ${c.error}\n\nw choose warriors · s settings`;
        if (c.phase === 'idle') return `${notice || 'No match loaded.'}\n\nw choose warriors · n new warrior`;
        return '';
    }

    function refresh(): void {
        if (renderer.isDestroyed) return;
        const c = controller;
        const width = renderer.width;
        board.size = c.coresize;
        board.view = c.view;
        board.processes = c.processes;
        board.warriorCount = Math.max(1, c.warriors.length);
        board.fade = fade;
        board.message = boardMessage();
        const l = board.layout;
        boardBox.title = `CORE ${c.coresize}`;
        const notes: string[] = [];
        if (fade) notes.push('fade');
        if (board.modeOverride === 'detail') notes.push('zoom: detail');
        if (l.mode === 'half') notes.push('2 cells/char');
        if (l.lines > l.visibleLines) notes.push(`rows ${board.scroll + 1}-${board.scroll + l.visibleLines}/${l.lines} · ↑/↓ scroll`);
        boardBox.bottomTitle = notes.length ? ` ${notes.join(' · ')} ` : undefined;
        header.setLines([headerLine(width)]);
        footer.setLines([footerLine(width)]);
        overlays.refreshAll();
        board.requestRender();
    }

    // ---- Input ----------------------------------------------------------------
    const onKey = (key: KeyEvent) => {
        if (key.ctrl && key.name === 'c') {
            // Unsaved editor changes: the first ctrl+c only warns.
            const editor = overlays.get('editor') as EditorOverlay | undefined;
            if (editor && !editor.confirmDiscard('ctrl+c')) {
                key.preventDefault();
                return;
            }
            return dispatch('quit');
        }
        if (overlays.handleKey(key)) {
            refresh();
            return;
        }
        const action = actionForKey(key);
        if (!action) return;
        key.preventDefault(); // e.g. the `n` that opens the editor must not be typed into it
        dispatch(action);
    };
    renderer.keyInput.on('keypress', onKey);
    const onResize = () => {
        overlays.placeAll();
        refresh();
    };
    renderer.on('resize', onResize);

    // ---- Start ------------------------------------------------------------------
    const startError = defaultMatch();
    if (startError) notice = startError;
    refresh();

    return {
        renderer,
        controller,
        board,
        header,
        footer,
        overlays,
        library,
        dispatch,
        inspect,
        openEditor,
        tick,
        refresh,
        destroy() {
            stopTicking();
            overlays.closeAll(); // the editor preview's step timer stops with it
            renderer.keyInput.off('keypress', onKey);
            renderer.off('resize', onResize);
        },
    };
}
