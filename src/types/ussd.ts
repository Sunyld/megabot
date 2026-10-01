/*
 * Per-product USSD flow — mirrors products.ussd_flow, schema version 1
 * (migration 003, private.ussd_flow_is_valid). The app and the database only
 * store and validate it; the Android worker executes it in a later phase.
 *
 *   { version: 1, start: '*111#', steps: [select 5, select 8, input destination, confirm] }
 */

/** Values known only when an order is executed. */
export type UssdInputSource = 'destination_number' | 'amount_mb' | 'amount_gb' | 'price';

/** Text the operator's screen must contain (any of the entries, case-insensitive). */
export type UssdTextMatch = { contains: string[] };

type UssdStepBase = {
  /** Free description for people editing the flow (not sent to the network). */
  label?: string;
};

/** Chooses a menu option, e.g. "5". */
export type UssdSelectStep = UssdStepBase & { type: 'select'; value: string; expect?: UssdTextMatch };

/** Types a value known at execution time (customer number, amount…). */
export type UssdInputStep = UssdStepBase & { type: 'input'; source: UssdInputSource; expect?: UssdTextMatch };

/** Confirms the operation; sends `value` (default "1"). */
export type UssdConfirmStep = UssdStepBase & { type: 'confirm'; value?: string; expect?: UssdTextMatch };

/** Pauses before the next step (100–60000 ms). */
export type UssdWaitStep = UssdStepBase & { type: 'wait'; ms: number };

export type UssdStep = UssdSelectStep | UssdInputStep | UssdConfirmStep | UssdWaitStep;

export type UssdStepType = UssdStep['type'];

export type UssdFlow = {
  version: 1;
  /** USSD code that opens the session, e.g. "*111#". */
  start: string;
  steps: UssdStep[];
  /** Final screen texts that mean the activation worked / failed. */
  success?: UssdTextMatch;
  failure?: UssdTextMatch;
};
