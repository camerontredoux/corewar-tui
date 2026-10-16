/**
 * Overlay stack. Overlays are absolutely positioned boxes added to the
 * renderer root while open. The top overlay gets keys first; Escape closes it.
 * A modal overlay swallows every key it does not handle, so game bindings stay
 * quiet while it is open (and a focused widget inside it, such as the editor's
 * Textarea, still receives the keys).
 */

import type { BoxRenderable, CliRenderer, KeyEvent } from '@opentui/core';

export interface Overlay {
    readonly id: string;
    readonly root: BoxRenderable;
    readonly modal: boolean;
    /** Return true when the key was handled. Escape never reaches this. */
    handleKey?(key: KeyEvent): boolean;
    /** Rebuild content. Called on open, every app refresh while open, and on resize. */
    refresh?(): void;
    /** Size and position for a terminal size. Default: `size()` centred. */
    place?(width: number, height: number): void;
    /** Preferred size, used by the default placement. */
    size?(width: number, height: number): { width: number; height: number };
    /** Escape asks this first; return false to stay open (e.g. to confirm discarding edits). */
    canClose?(): boolean;
    onClose?(): void;
}

export class OverlayManager {
    readonly stack: Overlay[] = [];

    constructor(private readonly renderer: CliRenderer) {}

    get top(): Overlay | undefined {
        return this.stack[this.stack.length - 1];
    }

    isOpen(id: string): boolean {
        return this.stack.some((o) => o.id === id);
    }

    get(id: string): Overlay | undefined {
        return this.stack.find((o) => o.id === id);
    }

    /** Open an overlay on top (re-opening one already open moves it to the top). */
    open(overlay: Overlay): void {
        if (this.isOpen(overlay.id)) this.close(overlay.id);
        overlay.root.zIndex = 100 + this.stack.length;
        this.stack.push(overlay);
        this.renderer.root.add(overlay.root);
        this.placeOne(overlay);
        overlay.refresh?.();
        this.renderer.requestRender();
    }

    /** Close the overlay with this id, or the top one. */
    close(id?: string): void {
        const index = id === undefined ? this.stack.length - 1 : this.stack.findIndex((o) => o.id === id);
        if (index < 0) return;
        const [overlay] = this.stack.splice(index, 1);
        this.renderer.root.remove(overlay!.root);
        overlay!.onClose?.();
        this.renderer.requestRender();
    }

    closeAll(): void {
        while (this.stack.length) this.close();
    }

    /**
     * Route a key to the top overlay. Returns true when the game must not see it.
     * A key the overlay handles is consumed (preventDefault), so a text area it
     * focuses on the way (the picker's `e` opening the editor) never types it.
     */
    handleKey(key: KeyEvent): boolean {
        const top = this.top;
        if (!top) return false;
        if (key.name === 'escape') {
            key.preventDefault();
            if (top.canClose?.() !== false) this.close();
            return true;
        }
        if (top.handleKey?.(key)) {
            key.preventDefault();
            return true;
        }
        return top.modal;
    }

    refreshAll(): void {
        for (const o of this.stack) o.refresh?.();
    }

    placeAll(): void {
        for (const o of this.stack) {
            this.placeOne(o);
            o.refresh?.();
        }
    }

    private placeOne(o: Overlay): void {
        const W = this.renderer.width;
        const H = this.renderer.height;
        if (o.place) return o.place(W, H);
        const s = o.size?.(W, H) ?? { width: Math.min(60, W - 4), height: Math.min(20, H - 2) };
        const width = Math.max(10, Math.min(s.width, W));
        const height = Math.max(5, Math.min(s.height, H));
        o.root.width = width;
        o.root.height = height;
        o.root.left = Math.max(0, Math.floor((W - width) / 2));
        o.root.top = Math.max(0, Math.floor((H - height) / 2));
    }
}
