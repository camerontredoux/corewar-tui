import { afterEach, describe, expect, test } from 'bun:test';
import { createTestRenderer, type TestRendererSetup } from '@opentui/core/testing';
import { CoreBoard, addressAt, cellOf, computeLayout } from './board.ts';
import { HEX, boardPalette, warriorHex } from './theme.ts';
import { cellAt, fakeView, hex } from './test-fakes.ts';

describe('computeLayout', () => {
    test('picks wide, glyph or half-block cells by what fits', () => {
        expect(computeLayout(80, 100, 30).mode).toBe('wide');
        const glyph = computeLayout(8000, 198, 50);
        expect(glyph.mode).toBe('glyph');
        expect(Math.ceil(8000 / glyph.cols)).toBeLessThanOrEqual(50);
        const half = computeLayout(8000, 100, 30);
        expect(half.mode).toBe('half');
        expect(half.lines).toBeGreaterThan(half.visibleLines); // 6000 cells of room: must scroll
        const fits = computeLayout(8000, 118, 40);
        expect([fits.mode, fits.lines <= fits.visibleLines]).toEqual(['half', true]);
    });

    test("detail never packs two addresses per cell; it scrolls a core that only 'half' fits", () => {
        expect(computeLayout(8000, 158, 46).mode).toBe('half'); // a 160x50 terminal
        const glyph = computeLayout(8000, 158, 46, 'detail');
        expect([glyph.mode, glyph.cols, glyph.visibleLines]).toEqual(['glyph', 158, 46]);
        expect(glyph.lines).toBe(Math.ceil(8000 / 158));
        expect(computeLayout(80, 100, 30, 'detail').mode).toBe('wide'); // already full detail
        expect(computeLayout(8000, 198, 50, 'detail').mode).toBe('glyph');
    });

    test('hit-testing inverts cell placement in every mode and scroll offset, and misses outside the grid', () => {
        for (const [size, w, h, override] of [
            [80, 100, 30, 'fit'],
            [8000, 198, 50, 'fit'],
            [8000, 100, 30, 'fit'],
            [8000, 158, 46, 'detail'],
        ] as const) {
            const l = computeLayout(size, w, h, override);
            for (const a of [0, 1, l.cols - 1, l.cols, Math.floor(size / 3), 3 * l.cols + 2, size - 1]) {
                const scroll = Math.min(3, l.lines - l.visibleLines);
                const cell = cellOf(l, scroll, a);
                if (!cell) continue;
                const hit = addressAt(l, scroll, cell.x, cell.y);
                expect(hit).toBe(cell.half ? a - l.cols : a);
            }
            expect(addressAt(l, 0, -1, 0)).toBeNull();
            expect(addressAt(l, 0, l.offsetX + l.cols * l.cellW, l.offsetY)).toBeNull();
        }
    });
});

describe('CoreBoard rendering', () => {
    let s: TestRendererSetup;
    afterEach(async () => {
        await s?.dispose();
    });

    async function mount(size: number, width: number, height: number) {
        s = await createTestRenderer({ width, height });
        const board = new CoreBoard(s.renderer, { width: '100%', height: '100%' });
        board.size = size;
        board.warriorCount = 2;
        s.renderer.root.add(board);
        const view = fakeView(size);
        board.view = view;
        await s.renderOnce();
        return { board, view };
    }

    function screen(board: CoreBoard, a: number) {
        const c = cellOf(board.layout, board.scroll, a)!;
        return { x: board.x + c.x, y: board.y + c.y, half: c.half };
    }

    test('each access state gets the documented glyph in the warrior colour', async () => {
        const { board, view } = await mount(200, 30, 10);
        expect(board.layout.mode).toBe('glyph');
        const set = (a: number, kind: number, w: number) => {
            view.accessKind[a] = kind;
            view.accessWarrior[a] = w;
            view.accessStamp[a] = 1;
        };
        set(1, 3, 0); // execute
        set(2, 2, 1); // write
        set(3, 1, 0); // read
        set(4, 3, 1); // execute, but also the last executed cell
        view.executions = 1;
        view.lastExecuted = 4;
        view.nextWarrior = 1;
        board.processes = [
            { warriorId: 0, alive: true, taskCount: 1, instructionPointers: [150], loadAddress: 100, length: 3 },
            { warriorId: 1, alive: true, taskCount: 1, instructionPointers: [5], loadAddress: 0, length: 0 },
        ];
        await s.renderOnce();
        const frame = s.captureSpans();
        const at = (a: number) => {
            const p = screen(board, a);
            return cellAt(frame, p.x, p.y);
        };
        const pal = boardPalette(2);
        expect(at(0)).toEqual({ char: '·', fg: HEX.untouched, bg: HEX.bg });
        expect(at(1)).toMatchObject({ char: '█', fg: warriorHex(0) });
        expect(at(2)).toMatchObject({ char: '×', fg: warriorHex(1), bg: HEX.bg });
        expect(at(3)).toMatchObject({ char: '•', fg: hex(pal.shades[0]![1]!) }); // reads are dimmer
        expect(at(4)).toMatchObject({ char: '█', fg: HEX.white });
        expect(at(5)).toEqual({ char: '■', fg: HEX.white, bg: warriorHex(1) }); // runs on the next step
        expect(at(150)).toEqual({ char: '▪', fg: HEX.white, bg: hex(pal.shades[0]![2]!) }); // waits its turn
        expect(at(101)).toMatchObject({ char: '░', fg: hex(pal.shades[0]![2]!) }); // loaded code
    });

    test('wide mode draws every cell in one column and leaves the second column as a gap', async () => {
        const { board, view } = await mount(100, 80, 30);
        expect(board.layout.mode).toBe('wide');
        view.accessKind[1] = 3;
        view.accessWarrior[1] = 0;
        view.accessStamp[1] = 1;
        board.processes = [{ warriorId: 0, alive: true, taskCount: 1, instructionPointers: [50], loadAddress: 0, length: 4 }];
        await s.renderOnce();
        const frame = s.captureSpans();
        const at = (a: number, dx = 0) => {
            const p = screen(board, a);
            return cellAt(frame, p.x + dx, p.y);
        };
        expect(at(1).char).toBe('█'); // executed
        expect(at(2).char).toBe('░'); // loaded
        expect(at(50)).toMatchObject({ char: '■', bg: warriorHex(0) }); // runs next
        for (const a of [1, 2, 50]) expect(at(a, 1)).toEqual({ char: ' ', fg: HEX.bg, bg: HEX.bg });
    });

    test('half-block mode shows only the instruction that runs next as a pale tint', async () => {
        const { board, view } = await mount(500, 20, 10);
        expect(board.layout.mode).toBe('half');
        const cols = board.layout.cols;
        view.nextWarrior = 0;
        board.processes = [
            { warriorId: 0, alive: true, taskCount: 1, instructionPointers: [0], loadAddress: 0, length: 1 },
            { warriorId: 1, alive: true, taskCount: 1, instructionPointers: [2 * cols], loadAddress: 2 * cols, length: 1 },
        ];
        await s.renderOnce();
        const pal = boardPalette(2);
        const cell = (a: number) => {
            const p = screen(board, a);
            return cellAt(s.captureSpans(), p.x, p.y);
        };
        expect(cell(0).fg).toBe(hex(pal.tints[0]!));
        expect(cell(2 * cols).fg).toBe(warriorHex(1));
        view.nextWarrior = 1;
        await s.renderOnce();
        expect(cell(0).fg).toBe(warriorHex(0));
        expect(cell(2 * cols).fg).toBe(hex(pal.tints[1]!));
    });

    test('fading dims old accesses only when enabled', async () => {
        const { board, view } = await mount(200, 30, 10);
        view.accessKind[7] = 3;
        view.accessStamp[7] = 1;
        view.executions = 100_000;
        await s.renderOnce();
        const p = screen(board, 7);
        expect(cellAt(s.captureSpans(), p.x, p.y).fg).toBe(warriorHex(0));
        board.fade = true;
        await s.renderOnce();
        expect(cellAt(s.captureSpans(), p.x, p.y).fg).toBe(hex(boardPalette(2).shades[0]![3]!));
    });

    test('half-block mode packs two addresses per cell: top as foreground, bottom as background', async () => {
        const { board, view } = await mount(500, 20, 10);
        expect(board.layout.mode).toBe('half');
        const cols = board.layout.cols;
        view.accessKind[0] = 3; // execute by warrior 0 (top half)
        view.accessKind[cols] = 2; // write by warrior 1 (bottom half)
        view.accessWarrior[cols] = 1;
        await s.renderOnce();
        const p = screen(board, 0);
        expect(screen(board, cols)).toMatchObject({ x: p.x, y: p.y, half: 1 });
        const pal = boardPalette(2);
        expect(cellAt(s.captureSpans(), p.x, p.y)).toEqual({ char: '▀', fg: warriorHex(0), bg: hex(pal.shades[1]![1]!) });
    });

    test('clicking a cell reports its core address', async () => {
        const { board } = await mount(200, 30, 10);
        const clicked: number[] = [];
        board.onCellClick = (a) => clicked.push(a);
        const p = screen(board, 77);
        await s.mockMouse.click(p.x, p.y);
        expect(board.layout.offsetY).toBeGreaterThan(0);
        await s.mockMouse.click(0, 0); // above the centred grid
        expect(clicked).toEqual([77]);
    });
});
