/**
 * developer.md Simulator free functions over a module-level Simulator.
 * OWNER: simulator engineer. Exported signatures are frozen (barrel re-exports them).
 */

import type {
    ICoreLocation,
    ICoreView,
    IOptions,
    IParseResult,
    IPublishProvider,
    ISimulatorOptions,
    IWarriorProcessView,
} from '../types.ts';
import { Simulator } from './simulator.ts';

export { Simulator, toWarriorInputs, type IWarriorInput } from './simulator.ts';
export { PSpace } from './pspace.ts';

const instance = new Simulator();

/** The module-level instance used by the free functions (for the TUI's hook calls). */
export function getDefaultSimulator(): Simulator {
    return instance;
}

/** A fresh, independent simulator. */
export function createSimulator(): Simulator {
    return new Simulator();
}

export function initialiseSimulator(
    options: IOptions | ISimulatorOptions,
    parseResults: IParseResult[],
    messageProvider?: IPublishProvider | null,
): void {
    instance.initialise(options, parseResults, messageProvider);
}

export function step(steps?: number): boolean {
    return instance.step(steps);
}

export function run(): void {
    instance.run();
}

export function getWithInfoAt(address: number): ICoreLocation {
    return instance.getWithInfoAt(address);
}

export function republish(): void {
    instance.republish();
}

export function getCoreView(): ICoreView {
    return instance.getCoreView();
}

export function getProcessView(): IWarriorProcessView[] {
    return instance.getProcessView();
}
