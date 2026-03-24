import { execFileAsync } from "../../lib/exec.js";
import {
	defineTracker,
	normalizeState,
	type TrackerIssue,
	type TrackerIssueState,
	type TrackerRunContextRaw,
	type TrackerPluginConfig,
} from "@plot/sdk";
import { BeadsDaemonTransport, tryCreateBeadsDaemonTransport } from "./daemon-transport.js";
import {
	type CommonTrackerConfig,
	deriveAllStates,
	fetchPrReviewFeedback,
	validateCommonTrackerFields,
	mapCliFailure,
} from "../shared.js";


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
			throw mapCliFailure("bd", error, options?.resourceId);
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

	const mapIssue = (bd: BdIssue): TrackerIssue => ({
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
	): Promise<TrackerRunContextRaw | null> => {
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

		return { workpad, reviewFeedback: reviews };
	};

	return {
		listAllIssues,
		viewIssue,
		mapState,
		mapIssue,
		fetchRunContext,
	};
}

type BeadsSetup = {
	ops: Awaited<ReturnType<typeof createBeadsOps>>;
};

export default defineTracker<BeadsTrackerConfig, BeadsSetup>({
	name: "beads",
	config(raw: TrackerPluginConfig): BeadsTrackerConfig {
		return {
			...validateCommonTrackerFields(raw),
			beadsDir: typeof raw["beadsDir"] === "string" ? raw["beadsDir"] : undefined,
		};
	},
	async setup(ctx) {
		const allStates = deriveAllStates(
			ctx.config.dispatchStates,
			ctx.config.parkedStates,
			ctx.config.terminalStates,
		);
		const ops = await createBeadsOps({
			beadsDir: ctx.config.beadsDir,
			githubRepo: ctx.config.githubRepo,
			dispatchStates: ctx.config.dispatchStates ?? [],
			allStates,
		});
		return { ops };
	},
	async fetchCandidateIssues(ctx, dispatchStates) {
		const bdIssues = await ctx.ops.listAllIssues();
		const issues = bdIssues.map(ctx.ops.mapIssue);
		const normalized = new Set(dispatchStates.map(normalizeState));
		return issues.filter((i) => normalized.has(normalizeState(i.state)));
	},
	async fetchIssuesByStates(ctx, states) {
		const bdIssues = await ctx.ops.listAllIssues();
		const issues = bdIssues.map(ctx.ops.mapIssue);
		const normalized = new Set(states.map(normalizeState));
		return issues.filter((i) => normalized.has(normalizeState(i.state)));
	},
	async fetchIssueStatesByIds(ctx, ids) {
		const wantedIds = new Set(ids);
		const allIssues = await ctx.ops.listAllIssues();
		return allIssues
			.filter((issue) => wantedIds.has(issue.id))
			.map(
				(issue): TrackerIssueState => ({
					id: issue.id,
					state: ctx.ops.mapState(issue),
				}),
			);
	},
	async fetchRunContext(ctx, issueId, state) {
		return ctx.ops.fetchRunContext(issueId, state);
	},
});
