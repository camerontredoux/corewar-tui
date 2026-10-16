/**
 * Event batching and publishing in the documented order (ARCHITECTURE.md
 * "Event ordering"). With a null provider every method is a cheap no-op and
 * no payload objects are allocated. OWNER: simulator engineer.
 */

import {
    MessageTopic,
    type AccessType,
    type ICoreAccessEventArgs,
    type INextExecutionEventArgs,
    type IPublishProvider,
    type IRoundResult,
    type IRunProgressEventArgs,
    type IState,
    type ITaskCountEventArgs,
} from '../types.ts';
import type { IWarriorState } from './state.ts';

/** `{ warriorId, warriorData? }`: warriorData only when the parse result had a `data` property. */
export function warriorRef(warrior: IWarriorState): { warriorId: number; warriorData?: any } {
    return warrior.hasData ? { warriorId: warrior.id, warriorData: warrior.data } : { warriorId: warrior.id };
}

export class EventPublisher {
    private accesses: ICoreAccessEventArgs[] = [];
    private taskCounts: ITaskCountEventArgs[] = [];
    /** Integer percent of the last RUN_PROGRESS. */
    private lastPercent = -1;

    constructor(
        readonly provider: IPublishProvider | null | undefined,
        private readonly warriors: readonly IWarriorState[],
    ) {}

    get enabled(): boolean {
        return this.provider != null;
    }

    private publish(topic: MessageTopic, payload: unknown): void {
        this.provider?.publishSync(topic, payload);
    }

    /** Buffer one access for the current execution's CORE_ACCESS array. */
    access(warriorId: number, accessType: AccessType, address: number): void {
        this.accesses.push({ ...warriorRef(this.warriors[warriorId]!), accessType, address });
    }

    /** Mark a warrior's task count as changed this execution. */
    taskCountChanged(warriorId: number, taskCount: number): void {
        const existing = this.taskCounts.find((t) => t.warriorId === warriorId);
        if (existing) existing.taskCount = taskCount;
        else this.taskCounts.push({ ...warriorRef(this.warriors[warriorId]!), taskCount });
    }

    /** End of one execution: publish CORE_ACCESS then TASK_COUNT if non-empty. */
    endExecution(): void {
        if (this.accesses.length > 0) {
            this.publish(MessageTopic.CORE_ACCESS, this.accesses);
            this.accesses = [];
        }
        if (this.taskCounts.length > 0) {
            this.publish(MessageTopic.TASK_COUNT, this.taskCounts);
            this.taskCounts = [];
        }
    }

    coreInitialise(state: IState): void {
        this.publish(MessageTopic.CORE_INITIALISE, { state });
    }

    /** One CORE_ACCESS array with arbitrary entries (republish). */
    coreAccess(payload: ICoreAccessEventArgs[]): void {
        this.publish(MessageTopic.CORE_ACCESS, payload);
    }

    /** TASK_COUNT with an entry for every warrior (initialise and republish). */
    allTaskCounts(): void {
        this.publish(
            MessageTopic.TASK_COUNT,
            this.warriors.map((w): ITaskCountEventArgs => ({ ...warriorRef(w), taskCount: w.queue.size })),
        );
    }

    roundEnd(result: IRoundResult): void {
        this.publish(MessageTopic.ROUND_END, { ...result });
    }

    /** RUN_PROGRESS, throttled to integer-percent changes unless `force`. */
    runProgress(cycle: number, maximumCycles: number, force: boolean): void {
        const runProgress = (cycle / maximumCycles) * 100;
        const percent = Math.floor(runProgress);
        if (!force && percent === this.lastPercent) return;
        this.lastPercent = percent;
        const payload: IRunProgressEventArgs = { runProgress, cycle, maximumCycles };
        this.publish(MessageTopic.RUN_PROGRESS, payload);
    }

    nextExecution(warriorId: number, address: number): void {
        const payload: INextExecutionEventArgs = { ...warriorRef(this.warriors[warriorId]!), address };
        this.publish(MessageTopic.NEXT_EXECUTION, payload);
    }
}
