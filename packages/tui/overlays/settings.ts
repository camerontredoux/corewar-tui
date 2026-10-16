/**
 * Match settings (modal): preset, the main numeric options, rounds and the
 * cycle unit. Type digits to edit a number; ←/→ cycle presets and the unit.
 * Apply validates with the engine's resolveOptions and restarts the match.
 */

import type { BoxRenderable, CliRenderer, KeyEvent } from '@opentui/core';
import { resolveOptions, type CycleUnit, type PresetName } from '../../engine/index.ts';
import { APP_PRESETS as PRESETS, type MatchSettings } from '../controller.ts';
import { HEX } from '../theme.ts';
import { SegmentText, button, panel, type Line } from '../ui.ts';
import type { Overlay } from './manager.ts';

type NumericKey = 'coresize' | 'maximumCycles' | 'maxTasks' | 'instructionLimit' | 'minSeparation';

interface Field {
    label: string;
    kind: 'preset' | 'unit' | 'rounds' | NumericKey;
    help: string;
}

const FIELDS: readonly Field[] = [
    { label: 'Preset', kind: 'preset', help: '←/→ to choose; sets the fields below' },
    { label: 'Core size', kind: 'coresize', help: 'addresses in the core' },
    { label: 'Max cycles', kind: 'maximumCycles', help: 'the round is a draw after this many' },
    { label: 'Max processes', kind: 'maxTasks', help: 'per warrior' },
    { label: 'Max length', kind: 'instructionLimit', help: 'instructions per warrior' },
    { label: 'Min separation', kind: 'minSeparation', help: 'between warriors at load' },
    { label: 'Rounds', kind: 'rounds', help: 'rounds in the match' },
    { label: 'Cycle unit', kind: 'unit', help: 'execution: 1 instruction = 1 cycle · pmars: 1 pass over all warriors' },
];

const PRESET_NAMES = Object.keys(PRESETS) as PresetName[];
const UNITS: CycleUnit[] = ['execution', 'pmars'];

export interface SettingsDeps {
    current(): MatchSettings;
    onApply(settings: MatchSettings): void;
    onCancel(): void;
}

export class SettingsOverlay implements Overlay {
    readonly id = 'settings';
    readonly modal = true;
    readonly root: BoxRenderable;
    private readonly body: SegmentText;
    draft!: MatchSettings;
    cursor = 0;
    error = '';
    /** True after the first digit typed into the current field (typing replaces the value). */
    private typing = false;

    constructor(
        renderer: CliRenderer,
        private readonly deps: SettingsDeps,
    ) {
        this.root = panel(renderer, 'settings', 'SETTINGS', 60, FIELDS.length + 8);
        this.body = new SegmentText(renderer, { flexGrow: 1 });
        this.root.add(this.body);
    }

    /** Take a fresh copy of the current settings; call before opening. */
    load(): void {
        const s = this.deps.current();
        this.draft = { preset: s.preset, options: { ...s.options }, rounds: s.rounds };
        this.cursor = 0;
        this.error = '';
        this.typing = false;
    }

    size(width: number) {
        return { width: Math.min(64, width - 2), height: FIELDS.length + 8 };
    }

    apply(): void {
        try {
            resolveOptions(this.draft.options);
            if (!Number.isInteger(this.draft.rounds) || this.draft.rounds < 1) throw new Error('Rounds must be at least 1');
        } catch (e) {
            this.error = e instanceof Error ? e.message : String(e);
            this.refresh();
            return;
        }
        this.deps.onApply(this.draft);
    }

    private value(kind: Field['kind']): string {
        const o = this.draft.options;
        if (kind === 'preset') return this.draft.preset;
        if (kind === 'unit') return o.cycleUnit ?? 'execution';
        if (kind === 'rounds') return String(this.draft.rounds);
        return String(o[kind] ?? '');
    }

    private setNumber(kind: Field['kind'], n: number): void {
        if (kind === 'rounds') this.draft.rounds = n;
        else if (kind !== 'preset' && kind !== 'unit') {
            this.draft.options[kind] = n;
            // The P-space size follows the core size (spec/pspace.md default) once the preset is left.
            if (kind === 'coresize') delete this.draft.options.pSpaceSize;
            this.draft.preset = 'custom';
        }
    }

    private cycle(delta: number): void {
        const kind = FIELDS[this.cursor]!.kind;
        if (kind === 'preset') {
            const i = PRESET_NAMES.indexOf(this.draft.preset as PresetName);
            const name = PRESET_NAMES[(i + delta + PRESET_NAMES.length) % PRESET_NAMES.length]!;
            this.draft.preset = name;
            this.draft.options = { ...PRESETS[name], cycleUnit: this.draft.options.cycleUnit };
        } else if (kind === 'unit') {
            const i = UNITS.indexOf(this.draft.options.cycleUnit ?? 'execution');
            this.draft.options.cycleUnit = UNITS[(i + 1) % UNITS.length];
        }
    }

    handleKey(key: KeyEvent): boolean {
        const kind = FIELDS[this.cursor]!.kind;
        if (key.name === 'up' || key.name === 'down') {
            this.cursor = (this.cursor + (key.name === 'up' ? -1 : 1) + FIELDS.length) % FIELDS.length;
            this.typing = false;
        } else if (key.name === 'left' || key.name === 'right') {
            this.cycle(key.name === 'left' ? -1 : 1);
        } else if (key.name === 'return' || key.name === 'enter') {
            this.apply();
            return true;
        } else if (/^[0-9]$/.test(key.sequence) && kind !== 'preset' && kind !== 'unit') {
            const before = this.typing ? this.value(kind) : '';
            this.setNumber(kind, Number(`${before}${key.sequence}`.slice(0, 9)));
            this.typing = true;
        } else if (key.name === 'backspace' && kind !== 'preset' && kind !== 'unit') {
            this.setNumber(kind, Number(this.value(kind).slice(0, -1) || '0'));
            this.typing = true;
        } else {
            return false;
        }
        this.error = '';
        this.refresh();
        return true;
    }

    refresh(): void {
        if (!this.draft) this.load();
        const lines: Line[] = [[{ text: '↑↓ field · type digits · ←→ choose · enter apply · esc cancel', fg: HEX.muted }], []];
        FIELDS.forEach((f, i) => {
            const on = i === this.cursor;
            const v = this.value(f.kind);
            const choice = f.kind === 'preset' || f.kind === 'unit';
            const select = () => {
                if (this.cursor === i && choice) this.cycle(1);
                this.cursor = i;
                this.typing = false;
                this.refresh();
            };
            lines.push(
                [
                    { text: on ? '▸ ' : '  ', fg: HEX.accent },
                    { text: f.label.padEnd(16), fg: on ? HEX.text : HEX.muted },
                    { text: choice ? `‹ ${v} ›` : v + (on ? '▏' : ''), fg: on ? HEX.white : HEX.text, bold: on },
                ].map((s) => ({ ...s, onClick: select })),
            );
        });
        lines.push([]);
        lines.push(this.error ? [{ text: this.error, fg: HEX.bad }] : [{ text: FIELDS[this.cursor]!.help, fg: HEX.faint }]);
        lines.push([button('Apply', () => this.apply(), true), { text: ' ' }, button('Cancel', () => this.deps.onCancel())]);
        this.body.setLines(lines);
    }
}
