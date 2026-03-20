import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
	buildRunContext,
	normalizeState,
	PluginAuthError,
	PluginNotFoundError,
	PluginRateLimitError,
	type IssueLike,
	type IssueStateEntryLike,
	type PlainTrackerClient,
	type TrackerPluginConfig,
	type TrackerPluginDefinition,
	type TrackerRunContextLike,
} from "@plot/sdk";
import { BeadsDaemonTransport, tryCreateBeadsDaemonTransport } from "./daemon-transport.js";
import {
	type CommonTrackerConfig,
	deriveAllStates,
	fetchPrReviewFeedback,
	validateCommonTrackerFields,
} from "../shared.js";

const execFileAsync = promisify(execFile);

interface BeadsTrackerConfig extends CommonTrackerConfig {
	beadsDir?: string;
}

interface BdIssue {
	readonly id: string;
	readonly title: string;
	readonly description: string;
	readonly status: string;
	readonly priority: number;
	readonly labels: ReadonlyArray<string>;
	readonly created_at: string;
	readonly updated_at: string;
	readonly assignee: string;
}

interface BdIssueDetailed extends BdIssue {
	readonly comments: ReadonlyArray<{ readonly text: string }>;
}

function mapBdFailure(error: unknown, resourceId?: string): Error {
	const message = error instanceof Error ? error.message : String(error);
	const stderr =
		typeof error === "object" && error !== null && "stderr" in error
			? String((error as { stderr?: unknown }).stderr ?? "")
			: "";
	const details = [message, stderr].filter(Boolean).join("\n");
	const normalized = details.toLowerCase();

	if (
		normalized.includes("authentication failed") ||
		normalized.includes("not authenticated") ||
		normalized.includes("auth")
	) {
		return new PluginAuthError(`bd authentication failed: ${details}`);
	}

	if (normalized.includes("rate limit")) {
		return new PluginRateLimitError(`bd rate limited: ${details}`);
	}

	if (
		resourceId &&
		(normalized.includes("not found") ||
			normalized.includes("no issue found") ||
			normalized.includes("no such issue"))
	) {
		return new PluginNotFoundError(`beads issue not found: ${details}`, resourceId);
	}

	return new Error(`bd command failed: ${details}`);
}

async function createBeadsOps(config: {
	beadsDir?: string;
	githubRepo?: string;
	dispatchStates: ReadonlyArray<string>;
	allStates: ReadonlyArray<string>;
}) {
	const workspaceRoot = config.beadsDir ?? process.cwd();
	const daemon = await tryCreateBeadsDaemonTransport(workspaceRoot);

	const runBd = async (
		args: ReadonlyArray<string>,
		options?: { resourceId?: string },
	): Promise<{ stdout: string; stderr: string }> => {
		try {
			return await execFileAsync("bd", args as string[], {
				maxBuffer: 50 * 1024 * 1024,
				cwd: workspaceRoot,
			});
		} catch (error) {
			throw mapBdFailure(error, options?.resourceId);
		}
	};

	const parseIssueList = (value: unknown) => value as ReadonlyArray<BdIssue>;

	const parseDetailedIssue = (value: unknown, id: string) => {
		const issue = Array.isArray(value) ? value[0] : value;
		if (!issue) throw new Error(`bd show returned empty result for ${id}`);
		return issue as BdIssueDetailed;
	};

	const runDaemon = async <T>(
		operation: (transport: BeadsDaemonTransport) => Promise<T>,
	): Promise<T | null> => {
		if (!daemon) return null;
		try {
			return await operation(daemon);
		} catch {
			return null;
		}
	};

	const listAllIssues = async () => {
		const daemonResult = await runDaemon((transport) =>
			transport.listAllIssues<ReadonlyArray<BdIssue>>(),
		);
		if (daemonResult) return daemonResult;
		const result = await runBd(["list", "--json", "--status", "all"]);
		return parseIssueList(JSON.parse(result.stdout));
	};

	const viewIssue = async (id: string) => {
		const daemonResult = await runDaemon((transport) => transport.viewIssue<BdIssueDetailed>(id));
		if (daemonResult) return parseDetailedIssue(daemonResult, id);
		const result = await runBd(["show", id, "--json"], { resourceId: id });
		return parseDetailedIssue(JSON.parse(result.stdout), id);
	};

	const mapState = (bd: { status: string; labels?: ReadonlyArray<string> }): string => {
		const labelNames = (bd.labels ?? []).map((l) => normalizeState(l));
		for (const s of config.allStates) {
			if (labelNames.includes(normalizeState(s))) return s;
		}
		return bd.status;
	};

	const mapIssue = (bd: BdIssue): IssueLike => ({
		id: bd.id,
		identifier: bd.id,
		title: bd.title,
		description: bd.description || null,
		state: mapState(bd),
		url: null,
		labels: (bd.labels ?? []).map((l) => l.toLowerCase()),
		createdAt: bd.created_at || null,
		updatedAt: bd.updated_at || null,
	});

	const fetchRunContext = async (
		issueId: string,
		state: string,
	): Promise<TrackerRunContextLike | null> => {
		let comments: ReadonlyArray<{ text: string }> = [];
		try {
			const issue = await viewIssue(issueId);
			comments = issue.comments ?? [];
		} catch {
			comments = [];
		}

		let workpad: string | null = null;
		const workpadComment = comments.find((c) => c.text.startsWith("## Plot Workpad"));
		if (workpadComment) workpad = workpadComment.text;

		let reviews: string | null = null;
		const normalizedDispatch = config.dispatchStates.map(normalizeState);
		if (normalizedDispatch.includes(normalizeState(state))) {
			const repoArgs = config.githubRepo ? ["--repo", config.githubRepo] : [];
			reviews = await fetchPrReviewFeedback(issueId, repoArgs, workspaceRoot);
		}

		return buildRunContext({ workpad, reviewFeedback: reviews });
	};

	return {
		listAllIssues,
		viewIssue,
		mapState,
		mapIssue,
		fetchRunContext,
	};
}

const plugin: TrackerPluginDefinition<BeadsTrackerConfig> = {
	name: "beads",
	validateConfig(raw: TrackerPluginConfig): BeadsTrackerConfig {
		return {
			...validateCommonTrackerFields(raw),
			beadsDir: typeof raw["beadsDir"] === "string" ? raw["beadsDir"] : undefined,
		};
	},
	async factory(config): Promise<PlainTrackerClient> {
		const allStates = deriveAllStates(
			config.dispatchStates,
			config.parkedStates,
			config.terminalStates,
		);

		const ops = await createBeadsOps({
			beadsDir: config.beadsDir,
			githubRepo: config.githubRepo,
			dispatchStates: config.dispatchStates ?? [],
			allStates,
		});

		return {
			async fetchCandidateIssues(dispatchStates) {
				const bdIssues = await ops.listAllIssues();
				const issues = bdIssues.map(ops.mapIssue);
				const normalized = new Set(dispatchStates.map(normalizeState));
				return issues.filter((i) => normalized.has(normalizeState(i.state)));
			},
			async fetchIssuesByStates(states) {
				const bdIssues = await ops.listAllIssues();
				const issues = bdIssues.map(ops.mapIssue);
				const normalized = new Set(states.map(normalizeState));
				return issues.filter((i) => normalized.has(normalizeState(i.state)));
			},
			async fetchIssueStatesByIds(ids) {
				const wantedIds = new Set(ids);
				const allIssues = await ops.listAllIssues();
				return allIssues
					.filter((issue) => wantedIds.has(issue.id))
					.map(
						(issue): IssueStateEntryLike => ({
							id: issue.id,
							state: ops.mapState(issue),
						}),
					);
			},
			fetchRunContext: (issueId, state) => ops.fetchRunContext(issueId, state),
		};
	},
};

export default plugin;
