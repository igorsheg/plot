import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
	buildRunContext,
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

const execFileAsync = promisify(execFile);

interface BeadsTrackerConfig {
	kind: string;
	beadsDir?: string;
	dispatchStates?: ReadonlyArray<string>;
	parkedStates?: ReadonlyArray<string>;
	terminalStates?: ReadonlyArray<string>;
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
		return new PluginNotFoundError(
			`beads issue not found: ${details}`,
			resourceId,
		);
	}

	return new Error(`bd command failed: ${details}`);
}

function createBeadsOps(config: {
	beadsDir?: string;
	dispatchStates?: ReadonlyArray<string>;
	parkedStates?: ReadonlyArray<string>;
	terminalStates?: ReadonlyArray<string>;
}) {
	const runBd = async (
		args: ReadonlyArray<string>,
		options?: { resourceId?: string },
	): Promise<{ stdout: string; stderr: string }> => {
		try {
			return await execFileAsync("bd", args as string[], {
				maxBuffer: 50 * 1024 * 1024,
				...(config.beadsDir ? { cwd: config.beadsDir } : {}),
			});
		} catch (error) {
			throw mapBdFailure(error, options?.resourceId);
		}
	};

	const listIssues = async (status: string) => {
		const result = await runBd(["list", "--json", "--status", status]);
		return JSON.parse(result.stdout) as ReadonlyArray<BdIssue>;
	};

	const listAllIssues = async () => {
		const result = await runBd(["list", "--json", "--status", "all"]);
		return JSON.parse(result.stdout) as ReadonlyArray<BdIssue>;
	};

	const viewIssue = async (id: string) => {
		const result = await runBd(["show", id, "--json"], { resourceId: id });
		return JSON.parse(result.stdout) as BdIssueDetailed;
	};

	const mapState = (bd: { status: string }): string => bd.status;

	const mapIssue = (bd: BdIssue): IssueLike => ({
		id: bd.id,
		identifier: bd.id,
		title: bd.title,
		description: bd.description || null,
		state: mapState(bd),
		url: null,
		labels: bd.labels.map((l) => l.toLowerCase()),
		createdAt: bd.created_at || null,
		updatedAt: bd.updated_at || null,
	});

	const fetchRunContext = async (
		issueId: string,
		_state: string,
	): Promise<TrackerRunContextLike | null> => {
		let comments: ReadonlyArray<{ text: string }> = [];
		try {
			const issue = await viewIssue(issueId);
			comments = issue.comments ?? [];
		} catch {
			comments = [];
		}

		let workpad: string | null = null;
		const workpadComment = comments.find((c) =>
			c.text.startsWith("## Plot Workpad"),
		);
		if (workpadComment) workpad = workpadComment.text;

		return buildRunContext({ workpad, reviewFeedback: null });
	};

	return {
		runBd,
		listIssues,
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
			kind: String(raw.kind),
			beadsDir:
				typeof raw["beadsDir"] === "string" ? raw["beadsDir"] : undefined,
			dispatchStates: Array.isArray(raw["dispatchStates"])
				? raw["dispatchStates"]
				: undefined,
			parkedStates: Array.isArray(raw["parkedStates"])
				? raw["parkedStates"]
				: undefined,
			terminalStates: Array.isArray(raw["terminalStates"])
				? raw["terminalStates"]
				: undefined,
		};
	},
	async factory(config): Promise<PlainTrackerClient> {
		const ops = createBeadsOps({
			beadsDir: config.beadsDir,
			dispatchStates: config.dispatchStates,
			parkedStates: config.parkedStates,
			terminalStates: config.terminalStates,
		});

		return {
			async fetchCandidateIssues(dispatchStates) {
				const results = await Promise.all(
					dispatchStates.map((s) => ops.listIssues(s)),
				);
				const allIssues = results.flat();
				const seen = new Set<string>();
				return allIssues
					.filter((i) => {
						if (seen.has(i.id)) return false;
						seen.add(i.id);
						return true;
					})
					.map(ops.mapIssue);
			},
			async fetchIssuesByStates(states) {
				const results = await Promise.all(states.map((s) => ops.listIssues(s)));
				const allIssues = results.flat();
				const seen = new Set<string>();
				return allIssues
					.filter((i) => {
						if (seen.has(i.id)) return false;
						seen.add(i.id);
						return true;
					})
					.map(ops.mapIssue);
			},
			async fetchIssueStatesByIds(ids) {
				const results = await Promise.all(
					ids.map(async (id) => {
						try {
							const bd = await ops.viewIssue(id);
							return [
								{ id: bd.id, state: ops.mapState(bd) },
							] as IssueStateEntryLike[];
						} catch (e) {
							if (e instanceof PluginNotFoundError) return [];
							throw e;
						}
					}),
				);
				return results.flat();
			},
			fetchRunContext: (issueId, state) => ops.fetchRunContext(issueId, state),
		};
	},
};

export default plugin;
