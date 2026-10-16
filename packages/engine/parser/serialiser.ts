/**
 * serialise(tokens): the developer.md 2.2 deterministic format. OWNER: parser engineer.
 *
 * An EOL token emits "\n"; every other token emits its lexeme. Two
 * consecutive tokens on one line are separated by a single space, except: no
 * space before a Comma, none before a Modifier (it joins its opcode), and none
 * after a Mode. Categories are not validated; unknown ones are spaced like any
 * other token. For a load-format stream the output is the redcode.md load file:
 * ";redcode-94\n;name dwarf\n;author Blameless\nORG 0\nADD.AB #4, $3\n...".
 */

import { TokenCategory, type IToken } from '../types.ts';

export function serialise(tokens: IToken[]): string {
    let out = '';
    let previous: IToken | undefined;
    for (const token of tokens) {
        if (token.category === TokenCategory.EOL) {
            out += '\n';
            previous = undefined;
            continue;
        }
        const joined =
            previous === undefined ||
            token.category === TokenCategory.Comma ||
            token.category === TokenCategory.Modifier ||
            previous.category === TokenCategory.Mode;
        out += (joined ? '' : ' ') + token.lexeme;
        previous = token;
    }
    return out;
}
