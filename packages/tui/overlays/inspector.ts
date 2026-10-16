/**
 * Cell inspector (non-modal): address, disassembly, last access, the P-space
 * of the warrior that last touched the cell, and the neighbouring cells of
 * the clicked address. Arrow keys move the selection;
 * game keys keep working while it is open.
 */

import { BoxRenderable, type CliRenderer, type KeyEvent } from '@opentui/core';
import { AccessType, formatInstruction } from '../../engine/index.ts';
import type { GameController } from '../controller.ts';
import { HEX, warriorHex } from '../theme.ts';
import { SegmentText, type Line } from '../ui.ts';
import type { Overlay } from './manager.ts';

const WIDTH = 42;
const NEIGHBOURS = 4;
const ACCESS_VERB: Record<AccessType, string> = {
    [AccessType.read]: 'read',
    [AccessType.write]: 'written',
    [AccessType.execute]: 'executed',
};

export interface InspectorDeps {
    controller: GameController;
    /** Address-row width on the board, for up/down. */
    columns(): number;
    /** Called when the selection moves (the board highlights it). */
    onSelect(address: number | null): void;
}

export class InspectorOverlay implements Overlay {
    readonly id = 'inspector';
    readonly modal = false;
    readonly root: BoxRenderable;
    private readonly body: SegmentText;
    address = 0;

    constructor(
        renderer: CliRenderer,
        private readonly deps: InspectorDeps,
    ) {
        this.root = new BoxRenderable(renderer, {
            id: 'inspector',
            position: 'absolute',
            border: true,
            borderStyle: 'single',
            borderColor: HEX.border,
            titleColor: HEX.accent,
            backgroundColor: HEX.panel,
            shouldFill: true,
            paddingLeft: 1,
            zIndex: 100,
        });
        this.body = new SegmentText(renderer, { flexGrow: 1 });
        this.root.add(this.body);
    }

    select(address: number): void {
        const size = this.deps.controller.coresize;
        this.address = ((address % size) + size) % size;
        this.deps.onSelect(this.address);
        this.refresh();
    }

    place(width: number, height: number): void {
        const w = Math.min(WIDTH, width);
        this.root.width = w;
        this.root.height = Math.min(NEIGHBOURS * 2 + 10, height - 2);
        this.root.left = Math.max(0, width - w - 2);
        this.root.top = 2;
    }

    handleKey(key: KeyEvent): boolean {
        const cols = this.deps.columns();
        const delta = { left: -1, right: 1, up: -cols, down: cols }[key.name];
        if (delta === undefined) return false;
        this.select(this.address + delta);
        return true;
    }

    onClose(): void {
        this.deps.onSelect(null);
    }

    refresh(): void {
        const c = this.deps.controller;
        const size = c.coresize;
        const a = this.address;
        this.root.title = `CELL ${a}`;
        const loc = c.inspect(a);
        const lines: Line[] = [];
        const label = (text: string) => ({ text: text.padEnd(12), fg: HEX.muted });

        if (!loc) {
            lines.push([{ text: 'No round is loaded.', fg: HEX.muted }]);
        } else {
            lines.push([label('instruction'), { text: formatInstruction(loc.instruction, { signedFor: size }), bold: true }]);
            const access = loc.access;
            if (access) {
                const view = c.view;
                const age = view ? view.executions - view.accessStamp[a]! : 0;
                lines.push([
                    label('last access'),
                    { text: `${ACCESS_VERB[access.accessType]} by ` },
                    { text: c.warriors[access.warriorId]?.name ?? `#${access.warriorId}`, fg: warriorHex(access.warriorId) },
                ]);
                lines.push([label(''), { text: age === 0 ? 'this cycle' : `${age.toLocaleString('en-US')} executions ago`, fg: HEX.muted }]);
            } else {
                lines.push([label('last access'), { text: 'none this round', fg: HEX.muted }]);
                lines.push([]);
            }
            const here = c.processes.filter((p) => p.alive && p.instructionPointers.includes(a));
            lines.push(
                here.length
                    ? [
                          label('processes'),
                          ...here.flatMap((p) => [
                              { text: c.warriors[p.warriorId]?.name ?? `#${p.warriorId}`, fg: warriorHex(p.warriorId) },
                              { text: p.instructionPointers[0] === a ? ' (next) ' : ' ', fg: HEX.muted },
                          ]),
                      ]
                    : [label('processes'), { text: 'none', fg: HEX.muted }],
            );
            lines.push(pspaceLine(c, access?.warriorId, size, label('p-space')));
            lines.push([]);
            for (let d = -NEIGHBOURS; d <= NEIGHBOURS; d++) {
                const n = (((a + d) % size) + size) % size;
                const nl = d === 0 ? loc : c.inspect(n);
                const owner = nl?.access?.warriorId;
                lines.push([
                    { text: d === 0 ? '▸' : ' ', fg: HEX.accent },
                    { text: String(n).padStart(6), fg: d === 0 ? HEX.text : HEX.muted },
                    { text: ' ' },
                    { text: owner === undefined ? '·' : '■', fg: owner === undefined ? HEX.faint : warriorHex(owner) },
                    { text: ' ' },
                    { text: nl ? formatInstruction(nl.instruction, { signedFor: size }) : '?', fg: d === 0 ? HEX.white : HEX.text, bold: d === 0 },
                ]);
            }
        }
        lines.push([{ text: '←↑↓→ move  esc close', fg: HEX.faint }]);
        this.body.setLines(lines);
    }
}

/** Room for P-space cells after the label, inside the border and padding. */
const PSPACE_TEXT_WIDTH = WIDTH - 4 - 12;

/**
 * The non-zero P-space cells of `warriorId` as `index:value` (signed), cell 0
 * (the last round's result) always first. Truncated to fit the panel.
 */
export function pspaceText(cells: readonly number[], size: number, width = PSPACE_TEXT_WIDTH): string {
    const signed = (v: number): number => (v > size / 2 ? v - size : v);
    const parts = cells.flatMap((v, i) => (i === 0 || v !== 0 ? [`${i}:${signed(v)}`] : []));
    let text = parts.join(' ');
    if (text.length > width) text = `${text.slice(0, width - 1)}…`;
    return text;
}

function pspaceLine(c: GameController, warriorId: number | undefined, size: number, label: Line[number]): Line {
    const view = warriorId === undefined ? undefined : c.pspace(warriorId);
    if (!view) return [label, { text: 'none', fg: HEX.muted }];
    return [label, { text: pspaceText(view.cells, size), fg: warriorHex(warriorId!) }];
}
