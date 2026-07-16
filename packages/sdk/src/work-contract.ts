/**
 * Presentation hints for a Work Item. Dashboards own rendering; none of
 * these fields affect scheduling.
 */
export interface WorkDisplay {
	/** Domain kind, e.g. `pr` or `incident`. */
	readonly kind?: string;
	/** Short badge text, e.g. a repo slug or ticket prefix. */
	readonly primary?: string;
	readonly title?: string;
	readonly subtitle?: string;
	readonly url?: string;
	readonly version?: string;
	readonly labels?: readonly string[];
}

export type WorkStatus =
	| "pending"
	| "waiting"
	| "blocked"
	| "cancelled"
	| "running"
	| "draining";

export type AgentRunOutcome =
	| "succeeded"
	| "failed"
	| "interrupted"
	| "timed_out";

export interface OperatorActionInput {
	readonly sourceId: string;
	readonly workKey: string;
	readonly actionId: string;
	readonly comment?: string;
}

export interface OperatorObservationInput extends OperatorActionInput {
	readonly clientId?: string;
	readonly actor?: unknown;
}

export type OperatorActionTone = "primary" | "secondary" | "danger";

/** Confirmation dialog shown before an Operator Action runs. */
export interface OperatorActionConfirm {
	readonly title: string;
	readonly message?: string | undefined;
}

/**
 * A Source-declared choice a human operator can take on a Work Item,
 * typically on `blocked` work. Plot records the choice as an Operator
 * Observation and calls the runtime's `operatorAction` hook; a later
 * `discover` remains authoritative for what the choice means.
 */
export interface OperatorAction {
	/** Stable action id reported back in the Operator Observation. */
	readonly id: string;
	/** Button label. */
	readonly label: string;
	readonly tone?: OperatorActionTone;
	/** Renders the action disabled with this explanation. */
	readonly disabledReason?: string;
	/** Require a free-text comment with the choice. */
	readonly requiresComment?: boolean;
	readonly confirm?: OperatorActionConfirm;
}
