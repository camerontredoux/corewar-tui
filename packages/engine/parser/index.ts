/**
 * Parser public entry points. OWNER: parser engineer.
 * The two exported signatures below are frozen (the barrel re-exports them).
 * Everything else under parser/ may be restructured freely.
 *
 * Pipeline: lex (lexer.ts) -> preprocess (preprocessor.ts: metadata, assert,
 * EQU, FOR/ROF, END, labels) -> assemble (assembler.ts: operands, defaults,
 * ORG/END, asserts, length, load-format emission).
 */

import { MessageType, type IMessage, type IParseOptions, type IParseResult } from '../types.ts';
import { resolveParseOptions } from '../options.ts';
import { assemble } from './assembler.ts';
import { lex } from './lexer.ts';
import { preprocess } from './preprocessor.ts';

export { serialise } from './serialiser.ts';
export { formatRedcode, formatRedcodeSafely, instructionColumn, operandColumn, type FormatSkipReason, type IFormatOutcome } from './format.ts';

/**
 * Parse Redcode into the load format (ARCHITECTURE.md "Load format").
 * Never throws; every problem is an Error message. Never sets `data`.
 * `options` supplies predefined constants, the instructionLimit check and the
 * standard; omitted fields use options.ts defaults.
 */
export function parse(redcode: string, options?: IParseOptions): IParseResult {
    const messages: IMessage[] = [];
    try {
        const source = typeof redcode === 'string' ? redcode : String(redcode ?? '');
        const resolved = resolveParseOptions(options);
        const pre = preprocess(lex(source), resolved, messages);
        const { tokens } = assemble(pre, resolved, messages);
        return { metaData: pre.metaData, tokens, messages: tidy(messages) };
    } catch (e) {
        messages.push({
            type: MessageType.Error,
            position: { line: 1, char: 1 },
            text: `Internal parser error: ${e instanceof Error ? e.message : String(e)}`,
        });
        return { metaData: { name: '', author: '', strategy: '' }, tokens: [], messages: tidy(messages) };
    }
}

/** Drop exact duplicates (a FOR body repeats its diagnostics) and order by position. */
function tidy(messages: IMessage[]): IMessage[] {
    const seen = new Set<string>();
    const unique = messages.filter((m) => {
        const key = `${m.type}:${m.position.line}:${m.position.char}:${m.text}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    return unique
        .map((m, i) => ({ m, i }))
        .sort((x, y) => x.m.position.line - y.m.position.line || x.m.position.char - y.m.position.char || x.i - y.i)
        .map(({ m }) => m);
}
