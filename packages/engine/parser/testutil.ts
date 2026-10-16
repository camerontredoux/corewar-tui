/** Test helpers for the parser suites. Not used by production code. */

import { MessageType, TokenCategory, type IMessage, type IParseOptions, type IParseResult } from '../types.ts';
import { formatInstruction } from '../instruction.ts';
import { readLoadFormat } from '../loadformat.ts';
import { parse } from './index.ts';

/** Instruction lines of the load file, e.g. ["MOV.I $0, $1"]. Fails the test on parse errors. */
export function asm(source: string, options?: IParseOptions): string[] {
    const result = parse(source, options);
    const errs = errors(result);
    if (errs.length > 0) throw new Error(`unexpected parse errors: ${errs.map((m) => m.text).join('; ')}`);
    return readLoadFormat(result.tokens).instructions.map((i) => formatInstruction(i));
}

/** Start offset (the ORG line) of a parse that has no errors. */
export function startOf(source: string, options?: IParseOptions): number {
    return readLoadFormat(parse(source, options).tokens).startOffset;
}

export const errors = (r: IParseResult): IMessage[] => r.messages.filter((m) => m.type === MessageType.Error);
export const warnings = (r: IParseResult): IMessage[] => r.messages.filter((m) => m.type === MessageType.Warning);

/** Error texts for `source`. */
export const errorTexts = (source: string, options?: IParseOptions): string[] => errors(parse(source, options)).map((m) => m.text);
export const warningTexts = (source: string, options?: IParseOptions): string[] => warnings(parse(source, options)).map((m) => m.text);

/** Metadata comment lines of the load file. */
export const commentLines = (source: string): string[] =>
    parse(source).tokens.filter((t) => t.category === TokenCategory.Comment).map((t) => t.lexeme);
