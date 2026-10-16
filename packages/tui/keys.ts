/**
 * Global key bindings. The footer hint bar and the help overlay are generated
 * from this table, so a binding added here shows up in both.
 */

export type Action =
    | 'quit'
    | 'toggleRun'
    | 'step'
    | 'speedUp'
    | 'speedDown'
    | 'restart'
    | 'nextRound'
    | 'warriors'
    | 'settings'
    | 'newWarrior'
    | 'editWarrior'
    | 'help'
    | 'fade'
    | 'zoom'
    | 'inspect'
    | 'scrollUp'
    | 'scrollDown';

export interface Binding {
    action: Action;
    /** KeyEvent names ("space", "q", "pagedown", ...). Matched with ctrl unset unless `ctrl`. */
    keys: string[];
    /** Keys shown in hints. */
    hint: string;
    label: string;
    /** Footer order of importance: lower stays visible longer on narrow terminals; absent = help only. */
    footer?: number;
    ctrl?: boolean;
}

export const BINDINGS: readonly Binding[] = [
    { action: 'toggleRun', keys: ['space'], hint: 'space', label: 'run/pause', footer: 0 },
    { action: 'step', keys: ['.'], hint: '.', label: 'step', footer: 1 },
    { action: 'speedDown', keys: ['-', '_'], hint: '-', label: 'slower', footer: 3 },
    { action: 'speedUp', keys: ['+', '='], hint: '+', label: 'faster', footer: 3 },
    { action: 'restart', keys: ['r'], hint: 'r', label: 'restart', footer: 4 },
    { action: 'nextRound', keys: [']'], hint: ']', label: 'next round', footer: 6 },
    { action: 'warriors', keys: ['w'], hint: 'w', label: 'warriors', footer: 2 },
    { action: 'settings', keys: ['s'], hint: 's', label: 'settings', footer: 5 },
    { action: 'newWarrior', keys: ['n'], hint: 'n', label: 'new', footer: 2 },
    { action: 'editWarrior', keys: ['e'], hint: 'e', label: 'edit', footer: 7 },
    { action: 'fade', keys: ['f'], hint: 'f', label: 'fade old marks' },
    { action: 'zoom', keys: ['z'], hint: 'z', label: 'zoom', footer: 8 },
    { action: 'inspect', keys: ['return', 'enter'], hint: 'enter', label: 'inspect a cell (arrows move, enter closes)' },
    { action: 'scrollUp', keys: ['up', 'pageup'], hint: '↑/PgUp', label: 'scroll board up' },
    { action: 'scrollDown', keys: ['down', 'pagedown'], hint: '↓/PgDn', label: 'scroll board down' },
    { action: 'help', keys: ['?'], hint: '?', label: 'help', footer: 1 },
    { action: 'quit', keys: ['q'], hint: 'q', label: 'quit', footer: 0 },
    { action: 'quit', keys: ['c'], hint: 'ctrl+c', label: 'quit', ctrl: true },
];

export interface KeyLike {
    name: string;
    sequence?: string;
    ctrl?: boolean;
    meta?: boolean;
}

export function actionForKey(key: KeyLike): Action | undefined {
    if (key.meta) return undefined;
    for (const b of BINDINGS) {
        if (!!b.ctrl !== !!key.ctrl) continue;
        if (b.keys.includes(key.name) || (key.sequence !== undefined && key.sequence.length === 1 && b.keys.includes(key.sequence))) {
            return b.action;
        }
    }
    return undefined;
}
