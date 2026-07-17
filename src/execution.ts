export const executionStates = [
  "DISCOVERED",
  "SELECTED",
  "IN_PROGRESS",
  "SUBMITTED",
  "WON",
  "PAID",
  "REJECTED",
  "FAILED",
  "EXPIRED",
] as const;

export type ExecutionState = (typeof executionStates)[number];

const allowedTransitions: Record<ExecutionState, readonly ExecutionState[]> = {
  DISCOVERED: ["SELECTED", "REJECTED", "EXPIRED"],
  SELECTED: ["IN_PROGRESS", "REJECTED", "EXPIRED"],
  IN_PROGRESS: ["SUBMITTED", "FAILED", "EXPIRED"],
  SUBMITTED: ["WON", "FAILED", "EXPIRED"],
  WON: ["PAID", "FAILED"],
  PAID: [],
  REJECTED: [],
  FAILED: [],
  EXPIRED: [],
};

export function canTransition(from: ExecutionState, to: ExecutionState): boolean {
  return allowedTransitions[from].includes(to);
}

export function assertTransition(from: ExecutionState, to: ExecutionState): void {
  if (!canTransition(from, to)) throw new Error(`invalid opportunity transition: ${from} -> ${to}`);
}

export function cronExecutionKey(cron: string, scheduledTime: number): string {
  return `${cron}:${new Date(scheduledTime).toISOString()}`;
}

