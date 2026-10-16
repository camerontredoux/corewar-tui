/** Match results (modal): wins, draws, losses and score per warrior, best first. */

import type { BoxRenderable, CliRenderer, KeyEvent } from '@opentui/core';
import type { GameController } from '../controller.ts';
import { HEX, warriorHex } from '../theme.ts';
import { SegmentText, button, panel, type Line } from '../ui.ts';
import type { Overlay } from './manager.ts';

export interface ResultsDeps {
    controller: GameController;
    onRematch(): void;
    onWarriors(): void;
    onClose(): void;
}

export class ResultsOverlay implements Overlay {
    readonly id = 'results';
    readonly modal = true;
    readonly root: BoxRenderable;
    private readonly body: SegmentText;

    constructor(
        renderer: CliRenderer,
        private readonly deps: ResultsDeps,
    ) {
        this.root = panel(renderer, 'results', 'MATCH OVER', 60, 12);
        this.body = new SegmentText(renderer, { flexGrow: 1 });
        this.root.add(this.body);
    }

    size(width: number) {
        return { width: Math.min(62, width - 2), height: this.deps.controller.warriors.length + 9 };
    }

    handleKey(key: KeyEvent): boolean {
        if (key.name === 'r') this.deps.onRematch();
        else if (key.name === 'w') this.deps.onWarriors();
        else if (key.name === 'return' || key.name === 'enter' || key.name === 'q') this.deps.onClose();
        else return false;
        return true;
    }

    refresh(): void {
        const c = this.deps.controller;
        const rows = c.status().sort((a, b) => b.score - a.score || b.won - a.won);
        const num = (n: number, w = 5) => String(n).padStart(w);
        const lines: Line[] = [
            [{ text: `${c.roundsPlayed} round${c.roundsPlayed === 1 ? '' : 's'} played`, fg: HEX.muted }],
            [],
            [{ text: `     ${'warrior'.padEnd(20)}    W    D    L  score`, fg: HEX.muted }],
        ];
        rows.forEach((r, i) => {
            lines.push([
                { text: i === 0 && r.score > 0 ? '★  ' : '   ', fg: HEX.warn },
                { text: '● ', fg: warriorHex(r.id) },
                { text: r.name.padEnd(20).slice(0, 20), fg: warriorHex(r.id), bold: i === 0 },
                { text: num(r.won) + num(r.drawn) + num(r.lost) },
                { text: r.score.toFixed(1).padStart(7), bold: true },
            ]);
        });
        lines.push([]);
        lines.push([
            button('r Rematch', () => this.deps.onRematch(), true),
            { text: ' ' },
            button('w Warriors', () => this.deps.onWarriors()),
            { text: ' ' },
            button('esc Close', () => this.deps.onClose()),
        ]);
        this.body.setLines(lines);
    }
}
