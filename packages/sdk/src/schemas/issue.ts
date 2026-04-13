import type { TrackerIssue, TrackerIssueState } from "../plugin/types.js";

export interface BlockerRef {
	readonly id: string | null;
	readonly identifier: string | null;
	readonly state: string | null;
}

export interface Issue {
	readonly id: string;
	readonly identifier: string;
	readonly title: string;
	readonly description: string | null;
	readonly priority?: number;
	readonly state: string;
	readonly branchName?: string;
	readonly url: string | null;
	readonly labels: readonly string[];
	readonly blockedBy?: readonly BlockerRef[];
	readonly autoMerge?: boolean;
	readonly metadata?: Record<string, unknown>;
	readonly createdAt: string | null;
	readonly updatedAt: string | null;
}

/** Compile-time proof: Issue fields must stay in sync with TrackerIssue. */
export type _IssueEncodedMatchesTrackerIssue = Issue extends TrackerIssue ? true : never;

export interface IssueStateEntry {
	readonly id: string;
	readonly state: string;
}

/** Compile-time proof: IssueStateEntry fields must stay in sync with TrackerIssueState. */
export type _IssueStateEntryMatchesTrackerIssueState = IssueStateEntry extends TrackerIssueState ? true : never;
