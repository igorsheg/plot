import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TrackerPluginConfig } from "@plot/sdk";

const execFileAsync = promisify(execFile);

export interface CommonTrackerConfig {
	kind: string;
	githubRepo?: string;
	dispatchStates?: ReadonlyArray<string>;
	parkedStates?: ReadonlyArray<string>;
	terminalStates?: ReadonlyArray<string>;
}

export function validateCommonTrackerFields(raw: TrackerPluginConfig): CommonTrackerConfig {
	return {
		kind: String(raw.kind),
		githubRepo: typeof raw["githubRepo"] === "string" ? raw["githubRepo"] : undefined,
		dispatchStates: Array.isArray(raw["dispatchStates"]) ? raw["dispatchStates"] : undefined,
		parkedStates: Array.isArray(raw["parkedStates"]) ? raw["parkedStates"] : undefined,
		terminalStates: Array.isArray(raw["terminalStates"]) ? raw["terminalStates"] : undefined,
	};
}

export function deriveAllStates(
	dispatch?: ReadonlyArray<string>,
	parked?: ReadonlyArray<string>,
	terminal?: ReadonlyArray<string>,
): ReadonlyArray<string> {
	return [...(dispatch ?? []), ...(parked ?? []), ...(terminal ?? [])].filter(
		(state, index, states) => states.indexOf(state) === index,
	);
}

/**
 * Fetch PR review feedback for an issue by searching open PRs that mention the
 * issue id in their body, then pulling reviews and comments from the linked PR.
 * Shared between github and beads trackers.
 */
export async function fetchPrReviewFeedback(
	issueId: string,
	repoArgs: ReadonlyArray<string>,
	cwd?: string,
): Promise<string | null> {
	try {
		const { stdout: prListOut } = await execFileAsync(
			"gh",
			[
				"pr",
				"list",
				...repoArgs,
				"--state",
				"open",
				"--json",
				"number,body",
				"--limit",
				"50",
			] as string[],
			{ maxBuffer: 50 * 1024 * 1024, cwd },
		);

		const prs = JSON.parse(prListOut) as ReadonlyArray<{
			number: number;
			body: string;
		}>;
		const linkedPr = prs.find((pr) => pr.body?.includes(issueId));
		if (!linkedPr) return null;

		const { stdout: reviewOut } = await execFileAsync(
			"gh",
			[
				"pr",
				"view",
				String(linkedPr.number),
				...repoArgs,
				"--json",
				"reviews,comments",
			] as string[],
			{ maxBuffer: 50 * 1024 * 1024, cwd },
		);

		const prData = JSON.parse(reviewOut) as {
			reviews?: ReadonlyArray<{
				body: string;
				state: string;
				author: { login: string };
			}>;
			comments?: ReadonlyArray<{
				body: string;
				author: { login: string };
			}>;
		};

		const parts: string[] = [];
		if (prData.reviews?.length) {
			for (const r of prData.reviews) {
				if (r.body) parts.push(`**${r.author.login}** (${r.state}):\n${r.body}`);
			}
		}
		if (prData.comments?.length) {
			for (const c of prData.comments) {
				if (c.body) parts.push(`**${c.author.login}**:\n${c.body}`);
			}
		}
		return parts.length > 0 ? parts.join("\n\n---\n\n") : null;
	} catch {
		return null;
	}
}
