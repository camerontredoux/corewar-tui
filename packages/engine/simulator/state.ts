/**
 * Mutable round state shared by the simulator's internal modules.
 * OWNER: simulator engineer. Internal; reshape freely.
 */

import type { IMetaData, IResolvedOptions, IRoundResult } from '../types.ts';
import type { Core } from './core.ts';
import type { ProcessQueue } from './processes.ts';
import type { PSpace } from './pspace.ts';

export interface IWarriorState {
    id: number;
    metaData: IMetaData;
    /** True when the parse result had an own `data` property (warriorData is then echoed, even if undefined). */
    hasData: boolean;
    data: unknown;
    loadAddress: number;
    length: number;
    /** Absolute address of the initial process. */
    startAddress: number;
    queue: ProcessQueue;
    alive: boolean;
}

export interface IRoundState {
    options: IResolvedOptions;
    core: Core;
    warriors: IWarriorState[];
    /** warriorId that executes next. */
    nextWarrior: number;
    liveCount: number;
    /** Instructions executed this round. */
    executions: number;
    /** Cycle counter per options.cycleUnit. */
    cycle: number;
    lastExecuted: number;
    result: IRoundResult | undefined;
    /** True when readDistance or writeDistance is below coresize (the fold is then applied). */
    limited: boolean;
    /** options.trackAccess: maintain the core's access arrays. */
    trackAccess: boolean;
    /** True when any access consumer exists (access arrays or a message provider). */
    tracing: boolean;
    /** The match's P-space; LDP/STP use it and the round end records each warrior's result in it. */
    pspace: PSpace;
}
