/**
 * Warrior picker (modal): every warrior in the library with its parse status.
 * Toggle one or more and start a match (one warrior plays solo, for testing). Warriors that fail to parse show their
 * errors and cannot be selected. Delete (`d`) asks `y/n` in the panel first and
 * moves the file to `.trash/` (library.ts); built-in samples can't be deleted.
 */

import type { BoxRenderable, CliRenderer, KeyEvent } from '@opentui/core';
import type { CompiledWarrior, WarriorEntry } from '../library.ts';
import { HEX, warriorHex } from '../theme.ts';
import { SegmentText, button, panel, type Line } from '../ui.ts';
import type { Overlay } from './manager.ts';

export interface PickerDeps {
    /** Load and parse every library warrior (called on open). */
    compileAll(): CompiledWarrior[];
    /** Ids in the current match, preselected. */
    currentIds(): string[];
    onStart(warriors: CompiledWarrior[]): void;
    onNew(): void;
    onEdit(entry: WarriorEntry): void;
    /** Delete a confirmed file entry; returns the status message. */
    onDelete(entry: WarriorEntry): string;
}

const ORIGIN_LABEL: Record<WarriorEntry['origin'], string> = { warriors: 'warriors/', examples: 'examples/', builtin: 'built-in' };

export class PickerOverlay implements Overlay {
    readonly id = 'warriors';
    readonly modal = true;
    readonly root: BoxRenderable;
    private readonly body: SegmentText;
    entries: CompiledWarrior[] = [];
    readonly chosen = new Set<string>();
    cursor = 0;
    private scroll = 0;
    private notice = '';
    private listRows = 10;
    /** The entry waiting for a y/n delete confirmation. */
    private confirming: WarriorEntry | undefined;

    constructor(
        renderer: CliRenderer,
        private readonly deps: PickerDeps,
    ) {
        this.root = panel(renderer, 'warriors', 'WARRIORS', 72, 24);
        this.body = new SegmentText(renderer, { flexGrow: 1 });
        this.root.add(this.body);
    }

    /** Reload the library; call before opening. */
    load(): void {
        this.entries = this.deps.compileAll();
        this.chosen.clear();
        for (const id of this.deps.currentIds()) if (this.entries.some((e) => e.entry.id === id && e.result)) this.chosen.add(id);
        this.cursor = 0;
        this.scroll = 0;
        this.notice = '';
        this.confirming = undefined;
    }

    /** Re-read the library while open (after an editor save), keeping the picks and the highlighted warrior. */
    reload(): void {
        const at = this.entries[this.cursor]?.entry.id;
        this.entries = this.deps.compileAll();
        for (const id of [...this.chosen]) if (!this.entries.some((e) => e.entry.id === id && e.result)) this.chosen.delete(id);
        const index = this.entries.findIndex((e) => e.entry.id === at);
        this.cursor = index >= 0 ? index : Math.min(this.cursor, Math.max(0, this.entries.length - 1));
    }

    size(width: number, height: number) {
        return { width: Math.min(76, width - 2), height: Math.min(this.entries.length + 12, height - 2) };
    }

    toggle(index: number): void {
        const e = this.entries[index];
        if (!e) return;
        this.cursor = index;
        this.confirming = undefined;
        if (!e.result) {
            this.notice = `${e.entry.name} has parse errors and can't join a match.`;
        } else if (this.chosen.has(e.entry.id)) {
            this.chosen.delete(e.entry.id);
            this.notice = '';
        } else {
            this.chosen.add(e.entry.id);
            this.notice = '';
        }
        this.refresh();
    }

    start(): void {
        const picked = this.entries.filter((e) => e.result && this.chosen.has(e.entry.id));
        if (picked.length === 0) {
            this.notice = 'Pick at least one warrior.';
            this.refresh();
            return;
        }
        this.deps.onStart(picked);
    }

    /** Ask to delete the highlighted warrior. */
    askDelete(): void {
        const e = this.entries[this.cursor]?.entry;
        if (!e) return;
        if (e.origin === 'builtin') this.notice = "Built-in samples can't be deleted.";
        else this.confirming = e;
        this.refresh();
    }

    private answerDelete(yes: boolean): void {
        const e = this.confirming;
        this.confirming = undefined;
        if (yes && e) {
            this.notice = this.deps.onDelete(e);
            this.entries = this.deps.compileAll();
            this.chosen.delete(e.id);
            this.cursor = Math.max(0, Math.min(this.cursor, this.entries.length - 1));
        }
        this.refresh();
    }

    /** Escape cancels a pending delete instead of closing the picker. */
    canClose(): boolean {
        if (!this.confirming) return true;
        this.answerDelete(false);
        return false;
    }

    handleKey(key: KeyEvent): boolean {
        if (this.confirming) {
            if (key.name === 'y' || key.name === 'return' || key.name === 'enter') this.answerDelete(true);
            else if (key.name === 'n') this.answerDelete(false);
            return true; // nothing else happens until the question is answered
        }
        switch (key.name) {
            case 'up':
            case 'k':
                this.move(-1);
                return true;
            case 'down':
            case 'j':
                this.move(1);
                return true;
            case 'space':
                this.toggle(this.cursor);
                return true;
            case 'return':
            case 'enter':
                this.start();
                return true;
            case 'n':
                this.deps.onNew();
                return true;
            case 'e': {
                const e = this.entries[this.cursor];
                if (e) this.deps.onEdit(e.entry);
                return true;
            }
            case 'd':
            case 'delete':
                this.askDelete();
                return true;
        }
        return false;
    }

    private move(delta: number): void {
        if (!this.entries.length) return;
        this.cursor = Math.max(0, Math.min(this.entries.length - 1, this.cursor + delta));
        this.refresh();
    }

    refresh(): void {
        const innerH = typeof this.root.height === 'number' ? this.root.height - 2 : 20;
        const innerW = (typeof this.root.width === 'number' ? this.root.width : 72) - 4;
        const current = this.entries[this.cursor];
        const detail: Line[] = [];
        if (current?.errors.length) {
            for (const err of current.errors.slice(0, 3)) detail.push([{ text: err.slice(0, innerW), fg: HEX.bad }]);
        } else if (current) {
            detail.push([{ text: `${current.name}`, bold: true }, { text: `  ${current.entry.id}`, fg: HEX.muted }]);
        }
        // header (2) + list + blank + detail (3) + blank + notice + buttons
        this.listRows = Math.max(1, innerH - 9);
        if (this.cursor < this.scroll) this.scroll = this.cursor;
        if (this.cursor >= this.scroll + this.listRows) this.scroll = this.cursor - this.listRows + 1;

        const lines: Line[] = [
            [{ text: 'space toggle · enter start (2+) · n new · e edit · d delete · esc close', fg: HEX.muted }],
            [],
        ];
        let colour = 0;
        const colourOf = new Map<string, number>();
        for (const e of this.entries) if (this.chosen.has(e.entry.id)) colourOf.set(e.entry.id, colour++);
        const nameW = Math.max(10, innerW - 30);
        for (let i = this.scroll; i < Math.min(this.entries.length, this.scroll + this.listRows); i++) {
            const e = this.entries[i]!;
            const on = this.chosen.has(e.entry.id);
            const isCursor = i === this.cursor;
            const row: Line = [
                { text: isCursor ? '▸ ' : '  ', fg: HEX.accent },
                { text: on ? '[■] ' : '[ ] ', fg: on ? warriorHex(colourOf.get(e.entry.id)!) : HEX.muted },
                { text: e.entry.name.padEnd(nameW).slice(0, nameW), fg: e.result ? HEX.text : HEX.muted, bold: isCursor },
                { text: ORIGIN_LABEL[e.entry.origin].padEnd(11), fg: HEX.faint },
                e.result
                    ? { text: 'ok', fg: HEX.good }
                    : { text: `✗ ${e.errors.length} error${e.errors.length === 1 ? '' : 's'}`, fg: HEX.bad },
            ];
            const index = i;
            for (const s of row) s.onClick = () => this.toggle(index);
            lines.push(row);
        }
        while (lines.length < this.listRows + 2) lines.push([]);
        lines.push([]);
        for (let i = 0; i < 3; i++) lines.push(detail[i] ?? []);
        if (this.confirming) {
            lines.push([{ text: `Delete ${this.confirming.id}? y/n`, fg: HEX.bad, bold: true }]);
            lines.push([button('Yes, delete', () => this.answerDelete(true), true), { text: ' ' }, button('Cancel', () => this.answerDelete(false))]);
            this.body.setLines(lines);
            return;
        }
        const deletable = current !== undefined && current.entry.origin !== 'builtin';
        lines.push([{ text: this.notice, fg: HEX.warn }]);
        lines.push([
            button(`Start match (${this.chosen.size})`, () => this.start(), true),
            { text: ' ' },
            button('+ New warrior', () => this.deps.onNew()),
            { text: ' ' },
            button('Edit', () => current && this.deps.onEdit(current.entry)),
            { text: ' ' },
            deletable ? button('Delete', () => this.askDelete()) : { text: ' Delete ', fg: HEX.faint },
            ...(current?.entry.origin === 'builtin' ? [{ text: ' built-in: read-only', fg: HEX.faint }] : []),
        ]);
        this.body.setLines(lines);
    }
}
