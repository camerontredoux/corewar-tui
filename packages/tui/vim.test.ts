/** The vim engine on a plain string buffer. `|` in a text marks the cursor. */

import { describe, expect, test } from 'bun:test';
import { Vim, type VimBuffer, type VimHost, type VimKey } from './vim.ts';

class Buffer implements VimBuffer {
    text: string;
    cursor: number;
    selection: { start: number; end: number } | null = null;
    constructor(marked: string) {
        this.cursor = marked.indexOf('|');
        this.text = marked.replace('|', '');
    }
    replace(start: number, end: number, insert: string) {
        this.text = this.text.slice(0, start) + insert + this.text.slice(end);
    }
    select(range: { start: number; end: number } | null) {
        this.selection = range;
    }
    get marked() {
        return `${this.text.slice(0, this.cursor)}|${this.text.slice(this.cursor)}`;
    }
    get selected() {
        return this.selection ? this.text.slice(this.selection.start, this.selection.end) : null;
    }
}

const SPECIAL: Record<string, VimKey> = {
    '<esc>': { name: 'escape' },
    '<cr>': { name: 'return' },
    '<bs>': { name: 'backspace' },
    '<c-r>': { name: 'r', ctrl: true },
    '<left>': { name: 'left' },
};

function setup(marked: string, host: VimHost = { dirty: false, save: () => true, close: (_force: boolean) => {} }) {
    const buf = new Buffer(marked);
    const vim = new Vim(buf, host);
    const press = (keys: string) => {
        for (const k of keys.match(/<[a-z-]+>|./gs)!) vim.handleKey(SPECIAL[k] ?? { name: k === ' ' ? 'space' : k.toLowerCase(), sequence: k });
        return buf.marked;
    };
    return { buf, vim, press };
}

/** Cursor position after `keys`, starting from `marked`. */
const after = (marked: string, keys: string) => setup(marked).press(keys);

describe('motions', () => {
    test('h j k l, with counts, stay inside the lines', () => {
        expect(after('ab|cdef', 'h')).toBe('a|bcdef');
        expect(after('ab|cdef', '5h')).toBe('|abcdef');
        expect(after('ab|cdef', 'l')).toBe('abc|def');
        expect(after('ab|cdef', '9l')).toBe('abcde|f'); // normal mode stops on the last character
        expect(after('a|b\ncd\nef\ngh', 'j')).toBe('ab\nc|d\nef\ngh');
        expect(after('a|b\ncd\nef\ngh', '2j')).toBe('ab\ncd\ne|f\ngh');
        expect(after('a|b\ncd\nef\ngh', '9j')).toBe('ab\ncd\nef\ng|h');
        expect(after('ab\ncd\nef\ng|h', '2k')).toBe('ab\nc|d\nef\ngh');
        expect(after('ab\ncd\nef\ng|h', 'k')).toBe('ab\ncd\ne|f\ngh');
    });

    test('j and k keep the column across short lines; arrows move like hjkl', () => {
        expect(after('abc|d\nx\nabcd', 'jj')).toBe('abcd\nx\nabc|d');
        expect(after('a|b\nabcd\nabcdef', '$jj')).toBe('ab\nabcd\nabcde|f');
        expect(after('a|b\ncd', '<left>')).toBe('|ab\ncd');
    });

    test('w b e, with counts and across lines; punctuation is its own word', () => {
        expect(after('|mov.i 0, 1', 'w')).toBe('mov|.i 0, 1');
        expect(after('|mov.i 0, 1', '3w')).toBe('mov.i |0, 1');
        expect(after('|add #4\njmp -1', '3w')).toBe('add #4\n|jmp -1');
        expect(after('mov.i 0, |1', 'b')).toBe('mov.i 0|, 1');
        expect(after('mov.i 0, |1', '3b')).toBe('mov.|i 0, 1');
        expect(after('add #4\n|jmp -1', 'b')).toBe('add #|4\njmp -1');
        expect(after('|loop add', 'e')).toBe('loo|p add');
        expect(after('|loop add', '2e')).toBe('loop ad|d');
        expect(after('|a\n\nb', 'w')).toBe('a\n|\nb'); // an empty line is a word
    });

    test('0 ^ $ (with a count, $ goes to a later line)', () => {
        expect(after('    mov |0, 1', '0')).toBe('|    mov 0, 1');
        expect(after('    mov |0, 1', '^')).toBe('    |mov 0, 1');
        expect(after('|mov 0, 1\njmp 0', '$')).toBe('mov 0, |1\njmp 0');
        expect(after('|mov 0, 1\njmp 0', '2$')).toBe('mov 0, 1\njmp |0');
    });

    test('gg and G go to the first non-blank of the first, last or counted line', () => {
        expect(after('a\n  b\n  |c', 'gg')).toBe('|a\n  b\n  c');
        expect(after('|a\n  b\n  c', 'G')).toBe('a\n  b\n  |c');
        expect(after('|a\n  b\n  c', '2G')).toBe('a\n  |b\n  c');
        expect(after('a\n  b\n  |c', '2gg')).toBe('a\n  |b\n  c');
        expect(after('|a\nb', '10G')).toBe('a\n|b');
    });
});

describe('operators', () => {
    test('charwise, exclusive motions: dw d2w db d0 dh x 3x', () => {
        expect(after('|mov 0, 1', 'dw')).toBe('|0, 1');
        expect(after('|mov 0, 1', 'd2w')).toBe('|, 1');
        expect(after('mov |0, 1', 'db')).toBe('|0, 1');
        expect(after('mov |0, 1', 'd0')).toBe('|0, 1');
        expect(after('mov |0, 1', 'd2h')).toBe('mo|0, 1');
        expect(after('m|ov', 'x')).toBe('m|v');
        expect(after('m|ov 0', '3x')).toBe('m|0');
        expect(after('mo|v', 'x')).toBe('m|o'); // the last character, then the cursor steps back
    });

    test('dw on the last word of a line does not join the next line', () => {
        expect(after('mov 0, |one\njmp 0', 'dw')).toBe('mov 0,| \njmp 0');
    });

    test('d2w crosses a line when the last word moved over does not end it', () => {
        expect(after('|one\ntwo three', 'd2w')).toBe('|three');
        expect(after('|one two\nthree', 'd2w')).toBe('|\nthree');
    });

    test('inclusive motions: de d$ c$', () => {
        expect(after('|loop add', 'de')).toBe('| add');
        expect(after('mov |0, 1\njmp', 'd$')).toBe('mov| \njmp');
        expect(after('mov |0, 1', 'c$#7<esc>')).toBe('mov #|7');
    });

    test('de on the last character of the text deletes it', () => {
        expect(after('ab|c', 'de')).toBe('a|b');
    });

    test('cw changes to the end of the word, not the next one', () => {
        expect(after('|mov 0, 1', 'cwadd<esc>')).toBe('ad|d 0, 1');
        expect(after('|a bc def', 'cwX<esc>')).toBe('|X bc def'); // a one-character word
        expect(after('mo|v 0', 'cwX<esc>')).toBe('mo|X 0'); // on a word's last character
        expect(after('|a bc def', 'c2wX<esc>')).toBe('|X def');
    });

    test('linewise: dd 2dd dj dk dG dgg cc, and the last line', () => {
        expect(after('a\n|b\nc', 'dd')).toBe('a\n|c');
        expect(after('a\n|b\nc\nd', '2dd')).toBe('a\n|d');
        expect(after('a\n|b\nc\nd', 'dj')).toBe('a\n|d');
        expect(after('a\nb\n|c\nd', 'dk')).toBe('a\n|d');
        expect(after('a\n|b\nc', 'dG')).toBe('|a');
        expect(after('a\nb\n|c\nd', 'dgg')).toBe('|d');
        expect(after('a\nb\n|c', 'dd')).toBe('a\n|b'); // the last line takes the line break before it
        expect(after('a\n|  b\nc', 'ccx<esc>')).toBe('a\n|x\nc');
    });

    test('y with a motion copies without changing the text; yy and P', () => {
        const { press, buf } = setup('a\n|b\nc');
        expect(press('y2j')).toBe('a\n|b\nc');
        expect(press('ggP')).toBe('|b\nc\na\nb\nc');
        expect(buf.text).toBe('b\nc\na\nb\nc');
        expect(after('|mov 0, 1', 'ywP')).toBe('mov| mov 0, 1');
        expect(after('a\nb\n|c', 'yk')).toBe('a\n|b\nc'); // the cursor goes to the start of the yanked lines
        expect(after('|a\nb', 'yyjp')).toBe('a\nb\n|a');
    });
});

describe('paste', () => {
    test('linewise text goes below (p) or above (P) the line; charwise after or at the cursor', () => {
        expect(after('|a\n  b\nc', 'jddp')).toBe('a\nc\n  |b');
        expect(after('|a\n  b\nc', 'jddP')).toBe('a\n  |b\nc');
        expect(after('|a\nb', 'yy2p')).toBe('a\n|a\na\nb');
        expect(after('|ab', 'xp')).toBe('b|a');
        expect(after('a|bc', 'xP')).toBe('a|bc');
        expect(after('a|bc', 'x3p')).toBe('acbb|b');
    });
});

describe('visual modes', () => {
    test('v: motions extend the selection; d, c and y act on it', () => {
        const { press, buf, vim } = setup('|mov 0, 1');
        press('v');
        expect(vim.status).toBe('-- VISUAL --');
        press('e');
        expect(buf.selected).toBe('mov');
        press('w');
        expect(buf.selected).toBe('mov 0');
        expect(press('d')).toBe('|, 1');
        expect(buf.selection).toBeNull();
        expect(vim.status).toBe('NORMAL');
        expect(after('|mov 0, 1', 'vecadd<esc>')).toBe('ad|d 0, 1');
        expect(after('mov |0, 1', 'v$yP')).toBe('mov 0, |10, 1');
        expect(after('mov |0, 1', 'vlx')).toBe('mov | 1');
    });

    test('p replaces the selection, and the replaced text becomes the register', () => {
        const { press } = setup('|add 1, 2');
        expect(press('yewvp')).toBe('add ad|d, 2');
        expect(press('0vep')).toBe('|1 add, 2'); // pastes the 1 that p replaced
    });

    test('V: whole lines for d, y and p; v and V switch', () => {
        expect(after('a\n|b\nc\nd', 'Vjd')).toBe('a\n|d');
        expect(after('a\n|b\nc', 'VyGp')).toBe('a\nb\nc\n|b');
        expect(after('|a\nb\nc', 'yyjVp')).toBe('a\n|a\nc');
        const { press, vim, buf } = setup('a|b\ncd');
        press('Vj');
        expect(buf.selected).toBe('ab\ncd');
        press('v');
        expect(vim.status).toBe('-- VISUAL --');
        expect(buf.selected).toBe('b\ncd');
        press('<esc>');
        expect(buf.selection).toBeNull();
    });
});

describe('insert mode', () => {
    test('i a I A o O, typing, enter and backspace; esc steps back one', () => {
        expect(after('m|v', 'io<esc>')).toBe('m|ov');
        expect(after('m|v', 'ao<esc>')).toBe('mv|o');
        expect(after('  m|v', 'Ix<esc>')).toBe('  |xmv');
        expect(after('m|v', 'A 0<esc>')).toBe('mv |0');
        expect(after('|a\nc', 'ob<esc>')).toBe('a\n|b\nc');
        expect(after('a\n|c', 'Ob<esc>')).toBe('a\n|b\nc');
        expect(after('|', 'iab<cr>cd<bs>x<esc>')).toBe('ab\nc|x');
    });

    test('insert mode leaves keys it does not type (arrows) to the text area; other modes take every key', () => {
        const { vim } = setup('|ab');
        expect(vim.handleKey({ name: 'z', sequence: 'z' })).toBe(true);
        expect(vim.handleKey({ name: 'i', sequence: 'i' })).toBe(true);
        expect(vim.handleKey({ name: 'left' })).toBe(false);
        expect(vim.status).toBe('-- INSERT --');
    });
});

describe('undo, redo and repeat', () => {
    test('u undoes one change (a whole insert), ctrl+r redoes, counts repeat', () => {
        const { press, vim } = setup('|a\nb\nc');
        press('ddddix<esc>');
        expect(press('u')).toBe('|c');
        expect(press('u')).toBe('|b\nc');
        expect(press('<c-r>')).toBe('|c');
        expect(press('2u')).toBe('|a\nb\nc');
        press('u');
        expect(vim.message).toBe('already at oldest change');
        expect(press('3<c-r>')).toBe('|xc');
    });

    test('. repeats dd, x with a new count, cw with its text, and A with its text', () => {
        expect(after('|a\nb\nc\nd', 'dd.')).toBe('|c\nd');
        expect(after('|abcdefg', '2x3.')).toBe('|fg');
        expect(after('|mov 0\nmov 1', 'cwadd<esc>j0.')).toBe('add 0\nad|d 1');
        expect(after('|a\nb', 'A;<esc>j.')).toBe('a;\nb|;');
        expect(after('|a', '.')).toBe('|a'); // nothing to repeat yet
        expect(after('|a\nb', 'yy.')).toBe('|a\nb'); // yanks are not changes
    });
});

describe('r (replace characters)', () => {
    test('r{char} replaces the character under the cursor and stays in normal mode', () => {
        const { press, vim } = setup('mov |0, 1');
        expect(press('r7')).toBe('mov |7, 1');
        expect(vim.mode).toBe('normal');
        expect(press('lrx')).toBe('mov 7|x 1'); // a digit or letter after r is the replacement, not a count or command
        expect(after('|abc', 'r ')).toBe('| bc');
    });

    test('a count replaces that many and ends on the last; too few left on the line does nothing', () => {
        expect(after('|abcde\nfg', '3rx')).toBe('xx|xde\nfg');
        expect(after('ab|cde\nfg', '3rx')).toBe('abxx|x\nfg');
        expect(after('abc|de\nfg', '3rx')).toBe('abc|de\nfg'); // only 2 left: no change, never into the next line
        expect(after('|\nfg', 'rx')).toBe('|\nfg'); // empty line
    });

    test('esc (or another non-character key) after r cancels; the status shows the pending r', () => {
        const { press, vim } = setup('|abc');
        press('2r');
        expect(vim.pending).toBe('2r');
        expect(press('<esc>')).toBe('|abc');
        expect(press('x')).toBe('|bc'); // back to normal commands
        expect(press('r<left>')).toBe('|bc');
        expect(press('dr')).toBe('|bc'); // r after an operator is not a motion
        expect(press('x')).toBe('|c');
    });

    test('u undoes it, ctrl+r redoes it, and . repeats it (with a new count)', () => {
        const { press } = setup('|abcdef');
        press('2rx');
        expect(press('u')).toBe('|abcdef');
        expect(press('<c-r>')).toBe('|xxcdef');
        expect(press('ll.')).toBe('xxx|xef');
        expect(press('l1.')).toBe('xxxx|xf');
    });

    test('in visual modes r replaces every selected character, keeping line breaks', () => {
        const { press, buf, vim } = setup('a|bc\ndef\ngh');
        expect(press('vjr-')).toBe('a|--\n--f\ngh');
        expect(vim.mode).toBe('normal');
        expect(buf.selection).toBeNull();
        expect(press('jVr.')).toBe('a--\n|...\ngh');
        expect(press('u')).toBe('a--\n|--f\ngh');
    });
});

describe('command line', () => {
    function host(saveOk = true) {
        const calls: string[] = [];
        return {
            calls,
            dirty: true,
            save: () => {
                calls.push('save');
                return saveOk;
            },
            close: (force: boolean) => void calls.push(force ? 'close!' : 'close'),
        };
    }

    test(':w saves, :q closes, :q! discards, :wq saves then closes, :x saves only when dirty', () => {
        for (const [command, expected] of [
            ['w', ['save']],
            ['q', ['close']],
            ['q!', ['close!']],
            ['wq', ['save', 'close']],
            ['x', ['save', 'close']],
        ] as const) {
            const h = host();
            setup('|a', h).press(`:${command}<cr>`);
            expect(h.calls).toEqual([...expected]);
        }
        const failing = host(false);
        setup('|a', failing).press(':wq<cr>');
        expect(failing.calls).toEqual(['save']); // stays open when the save failed
        const clean = { ...host(), dirty: false };
        setup('|a', clean).press(':x<cr>');
        expect(clean.calls).toEqual(['close']);
    });

    test('the status shows the command while typing; esc cancels; unknown commands say so', () => {
        const h = host();
        const { press, vim } = setup('|a', h);
        press(':wq');
        expect(vim.status).toBe(':wq');
        press('<bs><bs><esc>');
        expect(vim.status).toBe('NORMAL');
        press(':foo<cr>');
        expect(vim.message).toBe('not an editor command: foo');
        expect(h.calls).toEqual([]);
        press('2d');
        expect(vim.pending).toBe('2d');
    });
});

/** Buffer text after `keys`, starting from `marked`. */
function textAfter(marked: string, keys: string) {
    const v = setup(marked);
    v.press(keys);
    return v.buf.text;
}

describe('word text objects', () => {
    test('ciw changes the whole word from anywhere inside it', () => {
        const v = setup('mov bo|mb, >bomb');
        v.press('ciwx<esc>');
        expect(v.buf.text).toBe('mov x, >bomb');
    });
    test('diw on punctuation or blanks deletes just that run', () => {
        expect(textAfter('mov bomb, |>bomb', 'diw')).toBe('mov bomb, bomb');
        expect(textAfter('mov | bomb', 'diw')).toBe('movbomb');
    });
    test('daw takes the trailing blanks, or the leading ones at the end of a line', () => {
        expect(textAfter('add #4, 3\nmov |2, @2', 'daw')).toBe('add #4, 3\nmov, @2');
        expect(textAfter('jmp l|oop  ; back', 'daw')).toBe('jmp ; back');
        expect(textAfter('djn lo|op', 'daw')).toBe('djn');
    });
    test('iW takes a whole WORD; counts and . repeat work', () => {
        expect(textAfter('mov b|omb, >bomb', 'diW')).toBe('mov  >bomb');
        expect(textAfter('a |b c d', 'd3iw')).toBe('a  d');
        const v = setup('o|ne two');
        v.press('ciwX<esc>w.');
        expect(v.buf.text).toBe('X X');
    });
    test('viw selects the word; c then i in normal mode still inserts', () => {
        const v = setup('mov bo|mb, 1');
        v.press('viw');
        expect(v.buf.selected).toBe('bomb');
        expect(textAfter('a|b', 'iX<esc>')).toBe('aXb');
    });
    test('an unknown text object cancels the operator', () => {
        const v = setup('ab|c def');
        v.press('ciq');
        expect(v.vim.mode).toBe('normal');
        expect(v.buf.text).toBe('abc def');
    });
});


describe('replaceText (format on save)', () => {
    test('is one change: u brings the old text back, ctrl+r the new one', () => {
        const { vim, press, buf } = setup('a\nmov 0,|1\n');
        press('x');
        vim.replaceText('a\n  mov 0, \n', 10);
        expect(buf.marked).toBe('a\n  mov 0,| \n');
        expect(press('u')).toBe('a\n|mov 0,\n');
        expect(buf.text).toBe('a\nmov 0,\n');
        press('u');
        expect(buf.text).toBe('a\nmov 0,1\n');
        press('<c-r><c-r>');
        expect(buf.text).toBe('a\n  mov 0, \n');
    });

    test('an unchanged text records nothing', () => {
        const { vim, press, buf } = setup('|ab');
        vim.replaceText('ab', 0);
        press('u');
        expect(buf.text).toBe('ab');
        expect(vim.message).toBe('already at oldest change');
    });

    test('in insert mode it splits the session: typing before and after undo separately', () => {
        const { vim, press, buf } = setup('|b');
        press('ia');
        vim.replaceText('a  b', 1);
        expect(vim.mode).toBe('insert');
        press('z<esc>');
        expect(buf.text).toBe('az  b');
        press('u');
        expect(buf.text).toBe('a  b');
        press('u');
        expect(buf.text).toBe('ab');
        press('u');
        expect(buf.text).toBe('b');
    });
});

describe('host indent hooks', () => {
    // Indent two spaces; backspace takes a line of blanks it ends.
    const host: VimHost = {
        dirty: false,
        save: () => true,
        close: () => {},
        indent: () => '  ',
        backspaceWidth: (t, c) => (/(^|\n) +$/.test(t.slice(0, c)) && (t[c] ?? '\n') === '\n' ? c - t.lastIndexOf('\n', c - 1) - 1 : 1),
    };

    test('enter, o and O start the new line with the indent; backspace takes it at once; . repeats', () => {
        const { press, buf } = setup('a|b', host);
        expect(press('A<cr>')).toBe('ab\n  |');
        expect(press('<bs>x<esc>')).toBe('ab\n|x');
        expect(press('o')).toBe('ab\nx\n  |');
        expect(press('<esc>O')).toBe('ab\nx\n  |\n  ');
        expect(press('y<esc>j.')).toBe('ab\nx\n  y\n  |y\n  ');
        press('uuu');
        expect(buf.text).toBe('ab\nx');
    });

    test('enter before indented text drops its blanks, so it is indented once', () => {
        expect(setup('a|    b', host).press('i<cr>')).toBe('a\n  |b');
    });

    test('without the hooks nothing changes', () => {
        expect(after('a|b', 'A<cr>  <bs>')).toBe('ab\n |');
        expect(after('a|b', 'o')).toBe('ab\n|');
    });

    test('space types what the host gives, and . replays it', () => {
        const spacing: VimHost = { dirty: false, save: () => true, close: () => {}, space: (t, c) => (t[c - 1] === 'a' ? '   ' : ' ') };
        const { press, buf } = setup('|', spacing);
        expect(press('ia b<esc>')).toBe('a   |b');
        press('.');
        expect(buf.text).toBe('a   a   bb'); // the recorded insert, not the hook again
    });
});
