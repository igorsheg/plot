/**
 * Pure PR eligibility policy: decides whether a PR is omitted from the board,
 * held visibly without dispatch, or reviewable (and in which review state).
 * Kept side-effect free so the discovery loop stays a thin observer.
 */

export interface PrEligibilityFacts {
	readonly title: string;
	readonly isDraft: boolean;
	readonly authorIsBot: boolean;
	readonly labels: readonly string[];
	readonly head?: string;
}

export interface AnchorFacts {
	readonly status: "reviewing" | "done";
	readonly head: string;
}

export interface EligibilityConfig {
	readonly includeDrafts: boolean;
	readonly includeBots: boolean;
	readonly requireLabel?: string;
	readonly quietPeriodMs: number;
}

export interface OperatorState {
	/** Head SHA recorded when the operator pressed Skip. */
	readonly skippedAtHead?: string;
	/** Operator pressed Review now / Review again for the current head. */
	readonly rereviewRequested: boolean;
}

export type PrEligibility =
	| { readonly kind: "omit"; readonly reason: string }
	| { readonly kind: "hold"; readonly reason: string; readonly label: string }
	| {
			readonly kind: "review";
			readonly state: "fresh" | "new head" | "resume" | "re-review";
	  };

const TITLE_OPT_OUT = /\[(?:skip[ -]review|no[ -]review)\]/i;

/**
 * Seed for the head-first-seen clock. GitHub's updatedAt is an upper bound on
 * head age (a push bumps it), so settled PRs pass the quiet period immediately
 * even on a fresh process. The min clamps clock skew back to local now.
 */
export const firstSeenSeedMs = (nowMs: number, updatedAt?: string): number => {
	const parsed = updatedAt === undefined ? NaN : Date.parse(updatedAt);
	return Number.isNaN(parsed) ? nowMs : Math.min(nowMs, parsed);
};

export const evaluatePr = (input: {
	readonly pr: PrEligibilityFacts;
	readonly anchor?: AnchorFacts;
	readonly config: EligibilityConfig;
	readonly operator: OperatorState;
	/** First tick this (PR, head) pair was observed. */
	readonly headFirstSeenAtMs: number;
	readonly nowMs: number;
}): PrEligibility => {
	const { pr, anchor, config, operator } = input;
	if (
		config.requireLabel !== undefined &&
		!pr.labels.includes(config.requireLabel)
	)
		return { kind: "omit", reason: `missing label ${config.requireLabel}` };
	if (TITLE_OPT_OUT.test(pr.title))
		return { kind: "omit", reason: "author opted out in title" };
	if (pr.authorIsBot && !config.includeBots)
		return { kind: "omit", reason: "bot-authored pull request" };
	if (pr.isDraft && !config.includeDrafts)
		return { kind: "hold", reason: "draft pull request", label: "draft" };
	if (
		operator.skippedAtHead !== undefined &&
		operator.skippedAtHead === pr.head
	)
		return {
			kind: "hold",
			reason: "skipped by operator until a new head",
			label: "skipped",
		};
	if (operator.rereviewRequested) return { kind: "review", state: "re-review" };
	if (anchor !== undefined && anchor.head === pr.head) {
		if (anchor.status === "done")
			return {
				kind: "hold",
				reason: "reviewed at this head",
				label: "reviewed",
			};
		// A review already started at this head; settling would be pointless.
		return { kind: "review", state: "resume" };
	}
	if (input.nowMs - input.headFirstSeenAtMs < config.quietPeriodMs)
		return {
			kind: "hold",
			reason: "waiting for pushes to settle",
			label: "settling",
		};
	if (anchor === undefined) return { kind: "review", state: "fresh" };
	return { kind: "review", state: "new head" };
};
