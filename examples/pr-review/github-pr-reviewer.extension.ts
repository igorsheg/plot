import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { definePlotExtension, defineTool } from "plot-ai/sdk";
import type { AgentToolResult, PlotExtensionWork } from "plot-ai/sdk";

const execFileAsync = promisify(execFile);

type RiskTier = "trivial" | "lite" | "full";
type ReviewDisposition = "COMMENT" | "BLOCKING_COMMENT";
type ReviewerName =
	| "code_quality"
	| "security"
	| "runtime_lifecycle"
	| "protocol"
	| "tests"
	| "docs_agents";
type ReviewPhase = ReviewerName | "prepare" | "synthesize" | "post" | "done";

interface GitHubPrReviewerConfig {
	readonly includeDrafts: boolean;
}

interface PullRequestInfo {
	readonly number: number;
	readonly title: string;
	readonly isDraft: boolean;
	readonly baseRefName: string;
	readonly headRefName: string;
	readonly url: string;
	readonly headRefOid?: string;
	readonly authorLogin?: string;
}

interface PrFileInfo {
	readonly path: string;
	readonly additions: number;
	readonly deletions: number;
}

interface PreviousReviewCommentInfo {
	readonly path?: string;
	readonly line?: number;
	readonly body?: string;
	readonly url?: string;
}

interface PreviousReviewInfo {
	readonly id?: number;
	readonly state: string;
	readonly submittedAt?: string;
	readonly url?: string;
	readonly commitId?: string;
	readonly body?: string;
	readonly comments: readonly PreviousReviewCommentInfo[];
}

interface PreviousPlotPostInfo {
	readonly kind: "issue_comment" | "pull_request_review";
	readonly createdAt?: string;
	readonly url?: string;
	readonly marker: string;
}

interface ReviewWorkContext {
	readonly repo: string;
	readonly branch: string;
	readonly includeDrafts: boolean;
	readonly pr?: PullRequestInfo;
	readonly previousReview?: PreviousReviewInfo;
	readonly previousPlotPost?: PreviousPlotPostInfo;
}

interface ReviewerFinding {
	readonly reviewer: ReviewerName;
	readonly severity: "critical" | "warning" | "suggestion";
	readonly path?: string;
	readonly line?: number;
	readonly title: string;
	readonly impact: string;
	readonly evidence: string;
	readonly suggestedFix: string;
}

interface InlineReviewComment {
	readonly path: string;
	readonly line: number;
	readonly body: string;
	readonly side?: "LEFT" | "RIGHT";
}

interface ReviewTelemetryEvent {
	readonly type: "prepare" | "review_phase" | "post_review";
	readonly at: string;
	readonly pr?: number;
	readonly head?: string;
	readonly durationMs?: number;
	readonly details: Record<string, unknown>;
}

interface ReviewState {
	readonly status: ReviewPhase;
	readonly tier?: RiskTier;
	readonly phases: readonly ReviewPhase[];
	readonly completed: readonly ReviewPhase[];
	readonly artifacts: Record<string, string>;
	readonly updatedAt: string;
}

const defaultConfig: GitHubPrReviewerConfig = { includeDrafts: true };

const schema = <A>(value: A): A => value;
const objectSchema = (
	properties: Record<string, unknown>,
	required: string[] = [],
) =>
	schema({ type: "object", properties, required, additionalProperties: false });
const stringSchema = { type: "string" };
const numberSchema = { type: "number" };
const arraySchema = (items: unknown) => ({ type: "array", items });
const enumSchema = <A extends readonly string[]>(values: A) => ({
	enum: values,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const stringField = (record: Record<string, unknown>, field: string) =>
	typeof record[field] === "string" ? (record[field] as string) : undefined;
const booleanField = (record: Record<string, unknown>, field: string) =>
	typeof record[field] === "boolean" ? (record[field] as boolean) : undefined;
const numberField = (record: Record<string, unknown>, field: string) =>
	typeof record[field] === "number" ? (record[field] as number) : undefined;

const indentBlock = (value: string) =>
	value
		.split("\n")
		.map((line) => `  ${line}`)
		.join("\n");

const command = async (
	cwd: string,
	file: string,
	args: readonly string[],
): Promise<string> => {
	const { stdout } = await execFileAsync(file, [...args], {
		cwd,
		encoding: "utf8",
		maxBuffer: 32 * 1024 * 1024,
		env: { ...process.env, NO_COLOR: "1" },
	});
	return stdout.trim();
};

const commandOptional = async (
	cwd: string,
	file: string,
	args: readonly string[],
): Promise<string | undefined> => {
	try {
		return await command(cwd, file, args);
	} catch {
		return undefined;
	}
};

const parseJson = (text: string | undefined): unknown | undefined => {
	if (text === undefined || text.length === 0) return undefined;
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
};

const parseConfig = (input: unknown): GitHubPrReviewerConfig => {
	if (!isRecord(input)) return defaultConfig;
	return { includeDrafts: booleanField(input, "includeDrafts") ?? true };
};

const parsePullRequest = (value: unknown): PullRequestInfo | undefined => {
	if (!isRecord(value)) return undefined;
	const number = numberField(value, "number");
	const title = stringField(value, "title");
	const isDraft = booleanField(value, "isDraft");
	const baseRefName = stringField(value, "baseRefName");
	const headRefName = stringField(value, "headRefName");
	const url = stringField(value, "url");
	if (
		number === undefined ||
		title === undefined ||
		isDraft === undefined ||
		baseRefName === undefined ||
		headRefName === undefined ||
		url === undefined
	)
		return undefined;
	const author = value["author"];
	const authorLogin = isRecord(author)
		? stringField(author, "login")
		: undefined;
	const headRefOid = stringField(value, "headRefOid");
	return {
		number,
		title,
		isDraft,
		baseRefName,
		headRefName,
		url,
		...(headRefOid === undefined ? {} : { headRefOid }),
		...(authorLogin === undefined ? {} : { authorLogin }),
	};
};

const firstPullRequest = (value: unknown): PullRequestInfo | undefined => {
	if (!Array.isArray(value)) return undefined;
	return parsePullRequest(value[0]);
};

const parsePreviousReviewComment = (
	value: unknown,
): PreviousReviewCommentInfo | undefined => {
	if (!isRecord(value)) return undefined;
	const path = stringField(value, "path");
	const line =
		numberField(value, "line") ?? numberField(value, "original_line");
	const body = stringField(value, "body");
	const url = stringField(value, "html_url");
	return {
		...(path === undefined ? {} : { path }),
		...(line === undefined ? {} : { line }),
		...(body === undefined ? {} : { body }),
		...(url === undefined ? {} : { url }),
	};
};

const parsePreviousReview = (
	value: unknown,
	comments: readonly PreviousReviewCommentInfo[],
): PreviousReviewInfo | undefined => {
	if (!isRecord(value)) return undefined;
	const state = stringField(value, "state");
	if (state === undefined) return undefined;
	const id = numberField(value, "id");
	const submittedAt = stringField(value, "submitted_at");
	const url = stringField(value, "html_url");
	const commitId = stringField(value, "commit_id");
	const body = stringField(value, "body");
	return {
		...(id === undefined ? {} : { id }),
		state,
		...(submittedAt === undefined ? {} : { submittedAt }),
		...(url === undefined ? {} : { url }),
		...(commitId === undefined ? {} : { commitId }),
		...(body === undefined ? {} : { body }),
		comments,
	};
};

const parsePreviousPlotPost = (
	value: unknown,
	marker: string,
	kind: PreviousPlotPostInfo["kind"],
): PreviousPlotPostInfo | undefined => {
	if (!isRecord(value)) return undefined;
	const createdAt =
		stringField(value, "created_at") ?? stringField(value, "submitted_at");
	const url = stringField(value, "html_url");
	return {
		kind,
		marker,
		...(createdAt === undefined ? {} : { createdAt }),
		...(url === undefined ? {} : { url }),
	};
};

const loadCurrentPullRequest = async (cwd: string, branch: string) => {
	const fields = [
		"number",
		"title",
		"isDraft",
		"baseRefName",
		"headRefName",
		"url",
		"author",
		"headRefOid",
	].join(",");
	const byView = parsePullRequest(
		parseJson(
			await commandOptional(cwd, "gh", ["pr", "view", "--json", fields]),
		),
	);
	if (byView !== undefined) return byView;
	return firstPullRequest(
		parseJson(
			await commandOptional(cwd, "gh", [
				"pr",
				"list",
				"--head",
				branch,
				"--json",
				fields,
			]),
		),
	);
};

const loadCurrentUser = (cwd: string) =>
	commandOptional(cwd, "gh", ["api", "user", "-q", ".login"]);

const loadPreviousReview = async (
	cwd: string,
	repo: string,
	prNumber: number,
): Promise<PreviousReviewInfo | undefined> => {
	const currentUser = await loadCurrentUser(cwd);
	if (currentUser === undefined || currentUser.length === 0) return undefined;
	const jq = `[
  .[]
  | select(.user.login == ${JSON.stringify(currentUser)} and .state != "DISMISSED")
] | sort_by(.submitted_at) | last`;
	const reviewJson = parseJson(
		await commandOptional(cwd, "gh", [
			"api",
			`repos/${repo}/pulls/${prNumber}/reviews`,
			"--jq",
			jq,
		]),
	);
	const reviewId = isRecord(reviewJson)
		? numberField(reviewJson, "id")
		: undefined;
	const commentsJson =
		reviewId === undefined
			? undefined
			: parseJson(
					await commandOptional(cwd, "gh", [
						"api",
						`repos/${repo}/pulls/${prNumber}/reviews/${reviewId}/comments`,
					]),
				);
	const comments = Array.isArray(commentsJson)
		? commentsJson
				.map(parsePreviousReviewComment)
				.filter(
					(comment): comment is PreviousReviewCommentInfo =>
						comment !== undefined,
				)
		: [];
	return parsePreviousReview(reviewJson, comments);
};

const plotCommentMarker = (headSha: string) =>
	`<!-- plot-pr-review:${headSha} -->`;

const loadPreviousPlotPostByKind = async (
	cwd: string,
	repo: string,
	prNumber: number,
	headSha: string,
	kind: PreviousPlotPostInfo["kind"],
): Promise<PreviousPlotPostInfo | undefined> => {
	const currentUser = await loadCurrentUser(cwd);
	if (currentUser === undefined || currentUser.length === 0) return undefined;
	const marker = plotCommentMarker(headSha);
	const endpoint =
		kind === "pull_request_review"
			? `repos/${repo}/pulls/${prNumber}/reviews`
			: `repos/${repo}/issues/${prNumber}/comments`;
	const timeField =
		kind === "pull_request_review" ? "submitted_at" : "created_at";
	const stateClause =
		kind === "pull_request_review" ? ' and .state != "DISMISSED"' : "";
	const jq = `[
  .[]
  | select(.user.login == ${JSON.stringify(currentUser)}${stateClause} and ((.body // "") | contains(${JSON.stringify(marker)})))
] | sort_by(.${timeField}) | last`;
	return parsePreviousPlotPost(
		parseJson(await commandOptional(cwd, "gh", ["api", endpoint, "--jq", jq])),
		marker,
		kind,
	);
};

const loadPreviousPlotPost = async (
	cwd: string,
	repo: string,
	prNumber: number,
	headSha: string,
) =>
	(await loadPreviousPlotPostByKind(
		cwd,
		repo,
		prNumber,
		headSha,
		"pull_request_review",
	)) ??
	(await loadPreviousPlotPostByKind(
		cwd,
		repo,
		prNumber,
		headSha,
		"issue_comment",
	));

const parsePrFiles = (value: unknown): PrFileInfo[] => {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		if (!isRecord(item)) return [];
		const path = stringField(item, "path");
		if (path === undefined) return [];
		return [
			{
				path,
				additions: numberField(item, "additions") ?? 0,
				deletions: numberField(item, "deletions") ?? 0,
			},
		];
	});
};

const loadPrFiles = async (
	cwd: string,
	prNumber: number,
): Promise<PrFileInfo[]> =>
	parsePrFiles(
		parseJson(
			await commandOptional(cwd, "gh", [
				"pr",
				"view",
				String(prNumber),
				"--json",
				"files",
				"-q",
				".files",
			]),
		),
	);

const securitySensitive = (path: string) =>
	/(^|\/)(auth|crypto|security|secrets?|permissions?|policy|oauth|session)(\/|\.|$)/i.test(
		path,
	) || /(token|credential|password|permission|csrf|xss|injection)/i.test(path);

const runtimeSensitive = (path: string) =>
	path.startsWith("packages/agent/") ||
	path.startsWith("packages/session/src/protocol") ||
	path.startsWith("packages/session/src/pi-") ||
	path.startsWith("packages/session/src/extension") ||
	path.startsWith("packages/cli/") ||
	path.startsWith("packages/tui/") ||
	path.startsWith("packages/common/");

const noiseFile = (path: string) =>
	/(^|\/)(bun\.lock|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|go\.sum|poetry\.lock|Pipfile\.lock|flake\.lock)$/.test(
		path,
	) || /\.(min\.(js|css)|bundle\.js|map)$/.test(path);

const assessRisk = (
	files: readonly PrFileInfo[],
): {
	readonly tier: RiskTier;
	readonly reason: string;
	readonly totalLines: number;
	readonly reviewAgents: readonly ReviewerName[];
} => {
	const reviewable = files.filter((file) => !noiseFile(file.path));
	const totalLines = reviewable.reduce(
		(sum, file) => sum + file.additions + file.deletions,
		0,
	);
	const risky = reviewable.some(
		(file) => securitySensitive(file.path) || runtimeSensitive(file.path),
	);
	const tier: RiskTier =
		reviewable.length > 50 || risky || totalLines > 100
			? "full"
			: totalLines <= 10 && reviewable.length <= 20
				? "trivial"
				: "lite";
	const reviewAgents: readonly ReviewerName[] =
		tier === "trivial"
			? ["code_quality"]
			: tier === "lite"
				? ["code_quality", "tests", "docs_agents"]
				: [
						"code_quality",
						"security",
						"runtime_lifecycle",
						"protocol",
						"tests",
						"docs_agents",
					];
	return {
		tier,
		totalLines,
		reviewAgents,
		reason: risky
			? "security/runtime/protocol-sensitive paths changed"
			: `${reviewable.length} reviewable files and ${totalLines} changed lines`,
	};
};

const contextBlock = (values: ReviewWorkContext) => {
	const lines = [
		"## Extension-discovered target",
		`- Repository: ${values.repo}`,
		`- Current branch: ${values.branch}`,
	];
	if (values.pr === undefined) {
		return [...lines, "- Pull request: not found for the current branch"].join(
			"\n",
		);
	}
	lines.push(
		`- Pull request: #${values.pr.number} ${values.pr.title}`,
		`- URL: ${values.pr.url}`,
		`- Draft: ${String(values.pr.isDraft)}`,
		`- Base/head: ${values.pr.baseRefName}...${values.pr.headRefName}`,
	);
	if (values.pr.authorLogin !== undefined)
		lines.push(`- Author: ${values.pr.authorLogin}`);
	if (values.pr.headRefOid !== undefined) {
		lines.push(
			`- Head SHA: ${values.pr.headRefOid}`,
			`- Required durable review marker: ${plotCommentMarker(values.pr.headRefOid)}`,
		);
	}
	if (values.pr.isDraft && !values.includeDrafts)
		lines.push("- Draft policy: stop after reporting that the PR is draft");
	if (values.previousPlotPost === undefined) {
		lines.push("- Previous Plot review post for current head: none found");
	} else {
		lines.push(
			`- Previous Plot review post already covers current head (${values.previousPlotPost.kind})`,
		);
		if (values.previousPlotPost.url !== undefined)
			lines.push(
				`- Previous Plot review post URL: ${values.previousPlotPost.url}`,
			);
	}
	if (values.previousReview === undefined) {
		lines.push("- Previous GitHub review by current user: none found");
	} else {
		lines.push(
			`- Previous GitHub review by current user: ${values.previousReview.state}`,
		);
		if (values.previousReview.commitId !== undefined)
			lines.push(`- Previous review commit: ${values.previousReview.commitId}`);
		if (values.previousReview.body !== undefined)
			lines.push(
				"- Previous review body excerpt:",
				indentBlock(values.previousReview.body.slice(0, 2000)),
			);
		if (values.previousReview.comments.length > 0) {
			lines.push("- Previous inline review comments:");
			for (const comment of values.previousReview.comments.slice(0, 12)) {
				const location = `${comment.path ?? "unknown"}${comment.line === undefined ? "" : `:${comment.line}`}`;
				lines.push(
					`  - ${location}: ${(comment.body ?? "").replace(/\s+/g, " ").slice(0, 500)}`,
				);
			}
		}
		if (values.previousReview.commitId !== values.pr.headRefOid) {
			lines.push(
				"- Review mode: incremental re-review. Verify previous findings and review new changes.",
			);
		}
	}
	return lines.join("\n");
};

const reviewContextFromWork = (work: PlotExtensionWork): ReviewWorkContext => {
	const context = isRecord(work.context) ? work.context["prReview"] : undefined;
	if (!isRecord(context)) {
		throw new Error("current work does not contain PR review context");
	}
	return context as unknown as ReviewWorkContext;
};

const toolResult = <T>(text: string, details: T): AgentToolResult<T> => ({
	content: [{ type: "text", text }],
	details,
});

const writeTelemetry = async (
	cwd: string,
	event: ReviewTelemetryEvent,
): Promise<void> => {
	try {
		await mkdir(join(cwd, ".plot", "review"), { recursive: true });
		await appendFile(
			join(cwd, ".plot", "review", "telemetry.jsonl"),
			`${JSON.stringify(event)}\n`,
		);
	} catch {
		// Telemetry must never affect review execution.
	}
};

const nowIso = () => new Date().toISOString();

const reviewRoot = (cwd: string, prNumber: number) =>
	join(cwd, ".plot", "review", `pr-${prNumber}`);

const reviewStatePath = (cwd: string, prNumber: number) =>
	join(reviewRoot(cwd, prNumber), "state.json");

const artifactPath = (cwd: string, prNumber: number, phase: ReviewPhase) =>
	join(reviewRoot(cwd, prNumber), `${phase}.xml`);

const phasesForTier = (tier: RiskTier): readonly ReviewPhase[] =>
	tier === "trivial"
		? (["prepare", "code_quality", "synthesize", "post", "done"] as const)
		: tier === "lite"
			? ([
					"prepare",
					"code_quality",
					"tests",
					"docs_agents",
					"synthesize",
					"post",
					"done",
				] as const)
			: ([
					"prepare",
					"code_quality",
					"security",
					"runtime_lifecycle",
					"protocol",
					"tests",
					"docs_agents",
					"synthesize",
					"post",
					"done",
				] as const);

const parseReviewState = (value: unknown): ReviewState | undefined => {
	if (!isRecord(value)) return undefined;
	const status = stringField(value, "status") as ReviewPhase | undefined;
	const phases = Array.isArray(value["phases"])
		? value["phases"].filter(
				(phase): phase is ReviewPhase => typeof phase === "string",
			)
		: [];
	const completed = Array.isArray(value["completed"])
		? value["completed"].filter(
				(phase): phase is ReviewPhase => typeof phase === "string",
			)
		: [];
	const artifacts = isRecord(value["artifacts"]) ? value["artifacts"] : {};
	if (status === undefined || phases.length === 0) return undefined;
	return {
		status,
		...(stringField(value, "tier") === undefined
			? {}
			: { tier: stringField(value, "tier") as RiskTier }),
		phases,
		completed,
		artifacts: Object.fromEntries(
			Object.entries(artifacts).filter(
				(entry): entry is [string, string] => typeof entry[1] === "string",
			),
		),
		updatedAt: stringField(value, "updatedAt") ?? nowIso(),
	};
};

const readReviewState = async (
	cwd: string,
	prNumber: number,
): Promise<ReviewState | undefined> => {
	try {
		return parseReviewState(
			JSON.parse(await readFile(reviewStatePath(cwd, prNumber), "utf8")),
		);
	} catch {
		return undefined;
	}
};

const writeReviewState = async (
	cwd: string,
	prNumber: number,
	state: ReviewState,
): Promise<void> => {
	await mkdir(reviewRoot(cwd, prNumber), { recursive: true });
	await writeFile(
		reviewStatePath(cwd, prNumber),
		JSON.stringify(state, null, "\t"),
	);
};

const prepareReviewContext = async (
	cwd: string,
	work: PlotExtensionWork,
): Promise<AgentToolResult<unknown>> => {
	const startedAt = Date.now();
	const context = reviewContextFromWork(work);
	if (context.pr === undefined) {
		return toolResult("No pull request found for this branch.", {
			status: "no_pr",
		});
	}
	if (context.pr.isDraft && !context.includeDrafts) {
		return toolResult("Pull request is draft and draft reviews are disabled.", {
			status: "draft_skipped",
			pr: context.pr.number,
		});
	}
	const root = reviewRoot(cwd, context.pr.number);
	const diffDir = join(root, "diff");
	await mkdir(diffDir, { recursive: true });
	const files = await loadPrFiles(cwd, context.pr.number);
	const diff =
		(await commandOptional(cwd, "gh", [
			"pr",
			"diff",
			String(context.pr.number),
		])) ?? "";
	const sharedContext = contextBlock(context);
	const sharedContextPath = join(root, "shared-pr-context.txt");
	const diffPath = join(diffDir, "pull-request.patch");
	const filesPath = join(root, "changed-files.json");
	const previousReviewPath = join(root, "previous-review.json");
	await Promise.all([
		writeFile(sharedContextPath, sharedContext),
		writeFile(diffPath, diff),
		writeFile(filesPath, JSON.stringify(files, null, "\t")),
		writeFile(
			previousReviewPath,
			JSON.stringify(context.previousReview ?? null, null, "\t"),
		),
	]);
	const risk = assessRisk(files);
	const existingState = await readReviewState(cwd, context.pr.number);
	const phases = phasesForTier(risk.tier);
	const state: ReviewState = existingState ?? {
		status: "code_quality",
		tier: risk.tier,
		phases,
		completed: ["prepare"],
		artifacts: {},
		updatedAt: nowIso(),
	};
	await writeReviewState(cwd, context.pr.number, state);
	await writeTelemetry(cwd, {
		type: "prepare",
		at: nowIso(),
		pr: context.pr.number,
		head: context.pr.headRefOid,
		durationMs: Date.now() - startedAt,
		details: {
			fileCount: files.length,
			tier: risk.tier,
			totalLines: risk.totalLines,
		},
	});
	return toolResult(
		`Prepared review context for ${context.repo}#${context.pr.number}. Risk tier: ${risk.tier}.`,
		{
			status: "prepared",
			root,
			sharedContextPath,
			diffPath,
			filesPath,
			previousReviewPath,
			statePath: reviewStatePath(cwd, context.pr.number),
			files,
			risk,
			state,
		},
	);
};

const findingKey = (
	finding: Pick<ReviewerFinding, "path" | "line" | "title">,
) => `${finding.path ?? "general"}:${finding.line ?? ""}:${finding.title}`;

const previousFindingKeys = (body: string | undefined): Set<string> => {
	const keys = new Set<string>();
	if (body === undefined) return keys;
	for (const match of body.matchAll(/`([^`]+)` — ([^.]+)\./g)) {
		const location = match[1] ?? "general";
		const [path, lineText] = location.split(":", 2);
		const line = lineText === undefined ? undefined : Number(lineText);
		keys.add(
			findingKey({
				path: path === "general" ? undefined : path,
				...(Number.isInteger(line) ? { line } : {}),
				title: match[2] ?? "",
			}),
		);
	}
	return keys;
};

const applyDispositionRubric = (
	disposition: ReviewDisposition,
	findings: readonly ReviewerFinding[],
): ReviewDisposition =>
	findings.some((finding) => finding.severity === "critical")
		? "BLOCKING_COMMENT"
		: disposition === "BLOCKING_COMMENT"
			? "COMMENT"
			: disposition;

const severityBadge = (severity: ReviewerFinding["severity"]) =>
	severity === "critical"
		? "![P0](https://img.shields.io/badge/P0-red?style=flat)"
		: severity === "warning"
			? "![P1](https://img.shields.io/badge/P1-orange?style=flat)"
			: "![P2](https://img.shields.io/badge/P2-yellow?style=flat)";

const buildReviewBody = (values: {
	readonly context: ReviewWorkContext;
	readonly disposition: ReviewDisposition;
	readonly verification: string;
	readonly summary: string;
	readonly findings: readonly ReviewerFinding[];
	readonly confidence: "High" | "Medium" | "Low";
	readonly resolvedFindingKeys?: readonly string[];
	readonly carriedFindingKeys?: readonly string[];
}) => {
	const head = values.context.pr?.headRefOid ?? values.context.branch;
	const lines = [
		plotCommentMarker(head),
		"",
		"## Plot Review",
		"",
		`**Disposition:** ${values.disposition}`,
		`**Verification:** ${values.verification}`,
		`**Head:** \`${head}\``,
		"",
		"### Summary",
		"",
		values.summary,
	];
	if (values.findings.length > 0) {
		lines.push("", "### Findings", "");
		for (const finding of values.findings) {
			const location =
				finding.path === undefined
					? "general"
					: `${finding.path}${finding.line === undefined ? "" : `:${finding.line}`}`;
			lines.push(
				`- ${severityBadge(finding.severity)} \`${location}\` — ${finding.title}. ${finding.impact} Evidence: ${finding.evidence} Fix: ${finding.suggestedFix}`,
			);
		}
	}
	if (
		(values.resolvedFindingKeys?.length ?? 0) > 0 ||
		(values.carriedFindingKeys?.length ?? 0) > 0
	) {
		lines.push("", "### Re-review lifecycle", "");
		if ((values.resolvedFindingKeys?.length ?? 0) > 0)
			lines.push(
				`- Resolved previous Plot findings: ${values.resolvedFindingKeys!.length}`,
			);
		if ((values.carriedFindingKeys?.length ?? 0) > 0)
			lines.push(
				`- Re-emitted previous Plot findings: ${values.carriedFindingKeys!.length}`,
			);
	}
	lines.push("", "### Confidence", "", values.confidence);
	return lines.join("\n");
};

const postReview = async (
	cwd: string,
	work: PlotExtensionWork,
	input: {
		readonly disposition: ReviewDisposition;
		readonly verification: string;
		readonly summary: string;
		readonly confidence: "High" | "Medium" | "Low";
		readonly findings?: readonly ReviewerFinding[];
		readonly inlineComments?: readonly InlineReviewComment[];
	},
) => {
	const startedAt = Date.now();
	const context = reviewContextFromWork(work);
	if (context.pr === undefined)
		throw new Error("cannot post review without a PR");
	if (context.pr.headRefOid === undefined)
		throw new Error("cannot post review without PR head SHA");
	const findings = input.findings ?? [];
	const disposition = applyDispositionRubric(input.disposition, findings);
	const priorKeys = previousFindingKeys(context.previousReview?.body);
	const currentKeys = new Set(findings.map(findingKey));
	const resolvedFindingKeys = [...priorKeys].filter(
		(key) => !currentKeys.has(key),
	);
	const carriedFindingKeys = [...priorKeys].filter((key) =>
		currentKeys.has(key),
	);
	const body = buildReviewBody({
		context,
		disposition,
		verification: input.verification,
		summary: input.summary,
		confidence: input.confidence,
		findings,
		resolvedFindingKeys,
		carriedFindingKeys,
	});
	const ownerRepo = context.repo;
	const payload = {
		commit_id: context.pr.headRefOid,
		event: disposition === "BLOCKING_COMMENT" ? "REQUEST_CHANGES" : "COMMENT",
		body,
		comments: (input.inlineComments ?? []).map((comment) => ({
			path: comment.path,
			line: comment.line,
			side: comment.side ?? "RIGHT",
			body: comment.body,
		})),
	};
	const payloadPath = join(
		cwd,
		".plot",
		"review",
		`pr-${context.pr.number}`,
		"review.json",
	);
	await mkdir(join(cwd, ".plot", "review", `pr-${context.pr.number}`), {
		recursive: true,
	});
	await writeFile(payloadPath, JSON.stringify(payload, null, "\t"));
	try {
		await command(cwd, "gh", [
			"api",
			`repos/${ownerRepo}/pulls/${context.pr.number}/reviews`,
			"--method",
			"POST",
			"--input",
			payloadPath,
		]);
		await writeTelemetry(cwd, {
			type: "post_review",
			at: nowIso(),
			pr: context.pr.number,
			head: context.pr.headRefOid,
			durationMs: Date.now() - startedAt,
			details: {
				kind: "pull_request_review",
				disposition,
				requestedDisposition: input.disposition,
				findingCount: findings.length,
				inlineCommentCount: payload.comments.length,
				resolvedFindingCount: resolvedFindingKeys.length,
				carriedFindingCount: carriedFindingKeys.length,
			},
		});
		return toolResult("Posted GitHub pull request review.", {
			posted: true,
			kind: "pull_request_review",
			inlineCommentCount: payload.comments.length,
			disposition,
			requestedDisposition: input.disposition,
			resolvedFindingKeys,
			carriedFindingKeys,
		});
	} catch (error) {
		const bodyPath = join(
			cwd,
			".plot",
			"review",
			`pr-${context.pr.number}`,
			"review-body.md",
		);
		await writeFile(bodyPath, body);
		await command(cwd, "gh", [
			"pr",
			"review",
			String(context.pr.number),
			"--comment",
			"--body-file",
			bodyPath,
		]);
		await writeTelemetry(cwd, {
			type: "post_review",
			at: nowIso(),
			pr: context.pr.number,
			head: context.pr.headRefOid,
			durationMs: Date.now() - startedAt,
			details: {
				kind: "fallback_review_comment",
				disposition,
				requestedDisposition: input.disposition,
				findingCount: findings.length,
				inlineCommentCount: 0,
				resolvedFindingCount: resolvedFindingKeys.length,
				carriedFindingCount: carriedFindingKeys.length,
			},
		});
		return toolResult(
			`Inline review failed (${error instanceof Error ? error.message : String(error)}); posted top-level review comment fallback.`,
			{
				posted: true,
				kind: "fallback_review_comment",
				inlineCommentCount: 0,
				disposition,
				requestedDisposition: input.disposition,
				resolvedFindingKeys,
				carriedFindingKeys,
			},
		);
	}
};

const readPhaseArtifacts = async (
	cwd: string,
	prNumber: number,
	state: ReviewState,
): Promise<Record<string, string>> => {
	const entries = await Promise.all(
		Object.entries(state.artifacts).map(async ([phase, path]) => {
			try {
				return [phase, await readFile(path, "utf8")] as const;
			} catch {
				return [phase, ""] as const;
			}
		}),
	);
	return Object.fromEntries(entries);
};

const loadReviewState = async (
	cwd: string,
	work: PlotExtensionWork,
): Promise<AgentToolResult<unknown>> => {
	const context = reviewContextFromWork(work);
	if (context.pr === undefined)
		return toolResult("No PR found for review state.", { status: "no_pr" });
	const state = await readReviewState(cwd, context.pr.number);
	if (state === undefined)
		return toolResult("Review state is not prepared yet.", {
			status: "unprepared",
		});
	return toolResult(`Current review phase: ${state.status}.`, {
		status: "loaded",
		state,
		artifacts: await readPhaseArtifacts(cwd, context.pr.number, state),
	});
};

const completeReviewPhase = async (
	cwd: string,
	work: PlotExtensionWork,
	input: {
		readonly phase: ReviewPhase;
		readonly artifactXml: string;
		readonly nextStatus?: ReviewPhase;
	},
): Promise<AgentToolResult<unknown>> => {
	const context = reviewContextFromWork(work);
	if (context.pr === undefined)
		throw new Error("cannot complete review phase without a PR");
	const state = await readReviewState(cwd, context.pr.number);
	if (state === undefined)
		throw new Error("prepare_review_context must create review state first");
	if (state.status !== input.phase)
		throw new Error(
			`cannot complete phase ${input.phase}; current phase is ${state.status}`,
		);
	const path = artifactPath(cwd, context.pr.number, input.phase);
	await writeFile(path, input.artifactXml);
	const currentIndex = state.phases.indexOf(input.phase);
	const nextStatus =
		input.nextStatus ?? state.phases[currentIndex + 1] ?? "done";
	const nextState: ReviewState = {
		...state,
		status: nextStatus,
		completed: state.completed.includes(input.phase)
			? state.completed
			: [...state.completed, input.phase],
		artifacts: { ...state.artifacts, [input.phase]: path },
		updatedAt: nowIso(),
	};
	await writeReviewState(cwd, context.pr.number, nextState);
	await writeTelemetry(cwd, {
		type: "review_phase",
		at: nowIso(),
		pr: context.pr.number,
		head: context.pr.headRefOid,
		details: { phase: input.phase, nextStatus, artifactPath: path },
	});
	return toolResult(`Completed ${input.phase}; next phase: ${nextStatus}.`, {
		state: nextState,
		artifactPath: path,
	});
};

const registeredTools = (cwd: string, currentWork: PlotExtensionWork) => [
	defineTool({
		name: "prepare_review_context",
		label: "Prepare PR review context",
		description:
			"Prepare shared PR metadata, changed-file lists, previous review state, and a reusable diff directory for the current Plot PR review work item.",
		promptSnippet:
			"prepare_review_context: writes shared PR context and diff artifacts to .plot/review for this PR.",
		promptGuidelines: [
			"Call prepare_review_context before loading state, completing phases, or posting a review.",
			"Read the returned files instead of duplicating large PR metadata in every prompt.",
		],
		parameters: objectSchema({}),
		executionMode: "sequential" as const,
		execute: async () => prepareReviewContext(cwd, currentWork),
	}),
	defineTool({
		name: "assess_pr_risk",
		label: "Assess PR risk",
		description:
			"Classify the current PR as trivial, lite, or full and return the specialist reviewer set that should run.",
		promptSnippet:
			"assess_pr_risk: classifies review tier and selected reviewers from changed files.",
		parameters: objectSchema({}),
		execute: async () => {
			const context = reviewContextFromWork(currentWork);
			if (context.pr === undefined)
				return toolResult("No PR found.", {
					tier: "trivial" as RiskTier,
					files: [],
				});
			const files = await loadPrFiles(cwd, context.pr.number);
			const risk = assessRisk(files);
			return toolResult(`Risk tier: ${risk.tier} (${risk.reason}).`, {
				...risk,
				files,
			});
		},
	}),
	defineTool({
		name: "load_review_state",
		label: "Load review state",
		description:
			"Load the durable PR review phase state and previously written phase XML artifacts.",
		promptSnippet:
			"load_review_state: returns current durable review phase and prior XML artifacts.",
		promptGuidelines: [
			"Use the current status to choose which role/hat to operate under from WORKFLOW.md.",
			"Continue the current phase if it was interrupted; do not skip ahead without writing an artifact.",
		],
		parameters: objectSchema({}),
		executionMode: "sequential" as const,
		execute: async () => loadReviewState(cwd, currentWork),
	}),
	defineTool({
		name: "complete_review_phase",
		label: "Complete review phase",
		description:
			"Persist this tick's phase XML artifact and advance the durable PR review status.",
		promptSnippet:
			"complete_review_phase: writes phase XML and advances review status.",
		promptGuidelines: [
			"Call only after writing useful phase evidence/findings in artifactXml.",
			"Do not advance status if the phase is incomplete; leave it for the next tick.",
		],
		parameters: objectSchema(
			{
				phase: stringSchema,
				artifactXml: stringSchema,
				nextStatus: stringSchema,
			},
			["phase", "artifactXml"],
		),
		executionMode: "sequential" as const,
		execute: async (_id, params) =>
			completeReviewPhase(
				cwd,
				currentWork,
				params as Parameters<typeof completeReviewPhase>[2],
			),
	}),
	defineTool({
		name: "post_pr_review",
		label: "Post PR review",
		description:
			"Post exactly one durable GitHub PR review for the current head SHA. Owns marker insertion, review API payloads, inline threads, and fallback posting.",
		promptSnippet:
			"post_pr_review: posts the final GitHub review with durable Plot marker and optional inline comments.",
		promptGuidelines: [
			"Call post_pr_review exactly once before finishing when a review should be posted.",
			"Use BLOCKING_COMMENT only for verified P0 / merge-blocking issues.",
		],
		parameters: objectSchema(
			{
				disposition: enumSchema(["COMMENT", "BLOCKING_COMMENT"] as const),
				verification: stringSchema,
				summary: stringSchema,
				confidence: enumSchema(["High", "Medium", "Low"] as const),
				findings: arraySchema(
					objectSchema({
						reviewer: stringSchema,
						severity: enumSchema([
							"critical",
							"warning",
							"suggestion",
						] as const),
						path: stringSchema,
						line: numberSchema,
						title: stringSchema,
						impact: stringSchema,
						evidence: stringSchema,
						suggestedFix: stringSchema,
					}),
				),
				inlineComments: arraySchema(
					objectSchema({
						path: stringSchema,
						line: numberSchema,
						body: stringSchema,
						side: enumSchema(["LEFT", "RIGHT"] as const),
					}),
				),
			},
			["disposition", "verification", "summary", "confidence"],
		),
		executionMode: "sequential" as const,
		execute: async (_id, params) =>
			postReview(cwd, currentWork, params as Parameters<typeof postReview>[2]),
	}),
];

export default definePlotExtension<GitHubPrReviewerConfig>({
	id: "plot-alpha-github-pr-reviewer",
	parseConfig,
	create: ({ config, paths, work, registerTool }) => {
		for (const index of [0, 1, 2, 3, 4]) {
			registerTool(
				({ work: currentWork }) =>
					registeredTools(paths.cwd, currentWork)[index]!,
			);
		}
		return {
			discover: async (): Promise<readonly PlotExtensionWork[]> => {
				const repo =
					(await commandOptional(paths.cwd, "gh", [
						"repo",
						"view",
						"--json",
						"nameWithOwner",
						"-q",
						".nameWithOwner",
					])) ?? "unknown/unknown";
				const branch =
					(await commandOptional(paths.cwd, "git", [
						"branch",
						"--show-current",
					])) ?? "unknown";
				const pr = await loadCurrentPullRequest(paths.cwd, branch);
				const previousReview =
					pr === undefined
						? undefined
						: await loadPreviousReview(paths.cwd, repo, pr.number);
				const previousPlotPost =
					pr?.headRefOid === undefined
						? undefined
						: await loadPreviousPlotPost(
								paths.cwd,
								repo,
								pr.number,
								pr.headRefOid,
							);
				if (previousPlotPost !== undefined) return [];
				const reviewContext: ReviewWorkContext = {
					repo,
					branch,
					includeDrafts: config.includeDrafts,
					...(pr === undefined ? {} : { pr }),
					...(previousReview === undefined ? {} : { previousReview }),
					...(previousPlotPost === undefined ? {} : { previousPlotPost }),
				};
				const id =
					pr === undefined
						? `github:${repo}:branch:${branch}:no-pr`
						: `github:${repo}:pr:${pr.number}`;
				const title =
					pr === undefined
						? `No pull request found for ${branch}`
						: `Review ${repo} PR #${pr.number}: ${pr.title}`;
				return [
					work({
						id,
						version: pr?.headRefOid ?? branch,
						title,
						...(pr === undefined ? {} : { url: pr.url }),
						subject:
							pr === undefined
								? `github:${repo}`
								: `github:${repo}:pr:${pr.number}`,
						display:
							pr === undefined
								? {
										kind: "github-pr-review",
										primary: branch,
										title: "No pull request found",
										subtitle: repo,
										labels: ["no-pr"],
									}
								: {
										kind: "github-pr-review",
										primary: `#${pr.number}`,
										title: pr.title,
										subtitle: `${repo} · ${pr.baseRefName}...${pr.headRefName}`,
										url: pr.url,
										...(pr.headRefOid === undefined
											? {}
											: { version: pr.headRefOid.slice(0, 7) }),
										labels: [
											previousReview === undefined ? "fresh" : "incremental",
										],
									},
						context: {
							prReview: reviewContext,
							githubContext: contextBlock(reviewContext),
						},
					}),
				];
			},
		};
	},
});
