import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { definePlotExtension, defineTool } from "plot-ai/sdk";
import type { PlotExtensionWork } from "plot-ai/sdk";

const execFileAsync = promisify(execFile);

/**
 * Generic trusted GitHub reader/writer for PR reviews.
 *
 * The Source observes cheap PR facts and the durable Plot anchor. The Agent Run
 * owns review judgment. TypeScript only owns GitHub API-shaped mutations whose
 * idempotency and head checks should not live in prompt prose.
 *
 * Marker contract (the upsert_review_anchor tool writes it):
 *   <!-- plot-review:v1 status=<reviewing|done> head=<sha> tier=<tier> -->
 */

const REVIEW_STATUSES = ["reviewing", "done"] as const;
type ReviewStatus = (typeof REVIEW_STATUSES)[number];

const REVIEW_TIERS = ["trivial", "lite", "full"] as const;
type ReviewTier = (typeof REVIEW_TIERS)[number];

interface GitHubPrReviewerConfig {
	readonly includeDrafts: boolean;
	/** owner/name. When omitted, inferred once from the launch directory. */
	readonly repo?: string;
	/** Maximum open PRs discovered per tick. */
	readonly maxOpenPrs: number;
	/** Maximum changed-file rows included in the prompt context. */
	readonly maxContextFiles: number;
	/** Keep done work visible briefly so a posting run can exit cleanly. */
	readonly doneGraceMs: number;
}

interface PullRequestFileInfo {
	readonly path: string;
	readonly additions: number;
	readonly deletions: number;
	readonly changeType?: string;
}

interface PullRequestInfo {
	readonly number: number;
	readonly title: string;
	readonly isDraft: boolean;
	readonly baseRefName: string;
	readonly headRefName: string;
	readonly url: string;
	readonly additions: number;
	readonly deletions: number;
	readonly changedFiles: number;
	readonly files: readonly PullRequestFileInfo[];
	readonly headRefOid?: string;
	readonly authorLogin?: string;
}

interface AnchorMarker {
	readonly status: ReviewStatus;
	readonly head: string;
	readonly tier?: ReviewTier;
	readonly url?: string;
	readonly updatedAtMs?: number;
}

interface RawAnchorComment {
	readonly id: number;
	readonly body: string;
	readonly url?: string;
	readonly updatedAtMs?: number;
}

interface AnchorComment extends AnchorMarker, RawAnchorComment {}

interface GitHubTarget {
	readonly repo: string;
	readonly prNumber: number;
	readonly head: string;
}

interface ChangedLineRange {
	readonly start: number;
	readonly end: number;
	readonly deletion?: true;
}

interface DiffContextFile {
	readonly path: string;
	readonly changedLines: readonly ChangedLineRange[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const stringField = (record: Record<string, unknown>, field: string) =>
	typeof record[field] === "string" ? (record[field] as string) : undefined;
const booleanField = (record: Record<string, unknown>, field: string) =>
	typeof record[field] === "boolean" ? (record[field] as boolean) : undefined;
const numberField = (record: Record<string, unknown>, field: string) =>
	typeof record[field] === "number" ? (record[field] as number) : undefined;

/**
 * Strict by default: a failed `gh` call throws, so the runtime keeps the
 * last-known discovery instead of mistaking an observation failure for
 * "the work disappeared" (which would release and interrupt live reviews).
 */
const command = async (
	cwd: string,
	file: string,
	args: readonly string[],
): Promise<string> => {
	try {
		const { stdout } = await execFileAsync(file, [...args], {
			cwd,
			encoding: "utf8",
			maxBuffer: 32 * 1024 * 1024,
			env: { ...process.env, NO_COLOR: "1" },
		});
		return stdout.trim();
	} catch (error) {
		const stderr =
			typeof (error as { stderr?: unknown }).stderr === "string"
				? ((error as { stderr: string }).stderr.trim().split("\n")[0] ?? "")
				: "";
		throw new Error(
			`${file} ${args.slice(0, 3).join(" ")} failed${stderr === "" ? "" : `: ${stderr}`}`,
			{ cause: error },
		);
	}
};

const ghJson = async (
	cwd: string,
	args: readonly string[],
	payload: unknown,
): Promise<string> => {
	const dir = await mkdtemp(join(tmpdir(), "plot-gh-"));
	try {
		const input = join(dir, "payload.json");
		await writeFile(input, JSON.stringify(payload), "utf8");
		return await command(cwd, "gh", [...args, "--input", input]);
	} finally {
		await rm(dir, { recursive: true, force: true });
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

const positiveInteger = (value: number | undefined, fallback: number) =>
	value === undefined || !Number.isInteger(value) || value <= 0
		? fallback
		: value;

const safePathSegment = (value: string) =>
	value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

const prWorkspacePath = (repo: string, prNumber: number) =>
	join(
		homedir(),
		".plot",
		"workspaces",
		safePathSegment(repo),
		`pr-${prNumber}`,
	);

const parseConfig = (input: unknown): GitHubPrReviewerConfig => {
	if (!isRecord(input))
		return {
			includeDrafts: true,
			maxOpenPrs: 10,
			maxContextFiles: 200,
			doneGraceMs: 60_000,
		};
	const repo = stringField(input, "repo");
	return {
		includeDrafts: booleanField(input, "includeDrafts") ?? true,
		...(repo === undefined ? {} : { repo }),
		maxOpenPrs: positiveInteger(numberField(input, "maxOpenPrs"), 10),
		maxContextFiles: positiveInteger(
			numberField(input, "maxContextFiles"),
			200,
		),
		doneGraceMs: positiveInteger(numberField(input, "doneGraceMs"), 60_000),
	};
};

const parsePullRequestFile = (
	value: unknown,
): PullRequestFileInfo | undefined => {
	if (!isRecord(value)) return undefined;
	const path = stringField(value, "path") ?? stringField(value, "filename");
	if (path === undefined) return undefined;
	const changeType =
		stringField(value, "changeType") ?? stringField(value, "status");
	return {
		path,
		additions: numberField(value, "additions") ?? 0,
		deletions: numberField(value, "deletions") ?? 0,
		...(changeType === undefined ? {} : { changeType }),
	};
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
	const files = Array.isArray(value["files"])
		? value["files"].flatMap((item) => {
				const file = parsePullRequestFile(item);
				return file === undefined ? [] : [file];
			})
		: [];
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
		additions: numberField(value, "additions") ?? 0,
		deletions: numberField(value, "deletions") ?? 0,
		changedFiles: numberField(value, "changedFiles") ?? files.length,
		files,
		...(headRefOid === undefined ? {} : { headRefOid }),
		...(authorLogin === undefined ? {} : { authorLogin }),
	};
};

/** Discover open PRs by repository API only. */
const loadOpenPullRequests = async (
	cwd: string,
	repo: string,
	limit: number,
): Promise<PullRequestInfo[]> => {
	const fields =
		"number,title,isDraft,baseRefName,headRefName,url,author,headRefOid,additions,deletions,changedFiles,files";
	const listed = parseJson(
		await command(cwd, "gh", [
			"pr",
			"list",
			"--repo",
			repo,
			"--state",
			"open",
			"--limit",
			String(limit),
			"--json",
			fields,
		]),
	);
	if (!Array.isArray(listed))
		throw new Error(`unexpected gh pr list output for ${repo}`);
	return listed.flatMap((item) => {
		const pr = parsePullRequest(item);
		return pr === undefined ? [] : [pr];
	});
};

const MARKER_PATTERN = /<!--\s*plot-review:v1\s+([^>]*?)\s*-->/i;
const MARKER_PATTERN_GLOBAL = /<!--\s*plot-review:v1\s+[^>]*?\s*-->\s*/gi;

const parseTier = (tier: string | undefined): ReviewTier | undefined =>
	tier !== undefined && (REVIEW_TIERS as readonly string[]).includes(tier)
		? (tier as ReviewTier)
		: undefined;

const parseMarker = (body: string): Omit<AnchorMarker, "url"> | undefined => {
	const match = body.match(MARKER_PATTERN);
	if (match?.[1] === undefined) return undefined;
	const fields = new Map<string, string>();
	for (const pair of match[1].trim().split(/\s+/)) {
		const eq = pair.indexOf("=");
		if (eq > 0) fields.set(pair.slice(0, eq), pair.slice(eq + 1));
	}
	const status = fields.get("status");
	const head = fields.get("head");
	if (
		status === undefined ||
		head === undefined ||
		!(REVIEW_STATUSES as readonly string[]).includes(status) ||
		!/^[0-9a-f]{7,40}$/.test(head)
	)
		return undefined;
	const tier = parseTier(fields.get("tier"));
	return {
		status: status as ReviewStatus,
		head,
		...(tier === undefined ? {} : { tier }),
	};
};

let cachedLogin: string | undefined;
const currentLogin = async (cwd: string): Promise<string> => {
	if (cachedLogin === undefined)
		cachedLogin = await command(cwd, "gh", ["api", "user", "-q", ".login"]);
	return cachedLogin;
};

const parseCommentPages = (output: string) =>
	output
		.split("\n")
		.map((line) => parseJson(line.trim()))
		.flatMap((page) => {
			if (Array.isArray(page)) return page;
			if (typeof page === "string") {
				const nested = parseJson(page);
				return Array.isArray(nested) ? nested : [];
			}
			return isRecord(page) ? [page] : [];
		})
		.filter(isRecord);

const loadAnchorComments = async (
	cwd: string,
	repo: string,
	prNumber: number,
): Promise<RawAnchorComment[]> => {
	const currentUser = await currentLogin(cwd);
	const jq = `[ .[] | select(.user.login == ${JSON.stringify(currentUser)} and ((.body // "") | contains("<!-- plot-review:v1 "))) | {id, body, html_url, created_at, updated_at} ] | sort_by(.created_at)`;
	const output = await command(cwd, "gh", [
		"api",
		`repos/${repo}/issues/${prNumber}/comments`,
		"--paginate",
		"--jq",
		jq,
	]);
	return parseCommentPages(output)
		.toSorted((a, b) => {
			const aCreated = stringField(a, "created_at") ?? "";
			const bCreated = stringField(b, "created_at") ?? "";
			return aCreated.localeCompare(bCreated);
		})
		.flatMap((comment) => {
			const id = numberField(comment, "id");
			const body = stringField(comment, "body");
			if (id === undefined || body === undefined) return [];
			const url = stringField(comment, "html_url");
			const updatedAt = stringField(comment, "updated_at");
			const updatedAtMs = updatedAt === undefined ? NaN : Date.parse(updatedAt);
			return [
				{
					id,
					body,
					...(url === undefined ? {} : { url }),
					...(Number.isNaN(updatedAtMs) ? {} : { updatedAtMs }),
				},
			];
		});
};

const latest = <A>(values: readonly A[]): A | undefined =>
	values[values.length - 1];

const findAnchorComment = async (
	cwd: string,
	repo: string,
	prNumber: number,
): Promise<AnchorComment | undefined> => {
	const raw = latest(await loadAnchorComments(cwd, repo, prNumber));
	if (raw === undefined) return undefined;
	const marker = parseMarker(raw.body);
	if (marker === undefined) return undefined;
	return { ...raw, ...marker };
};

const findAnchorCommentForWrite = async (
	cwd: string,
	repo: string,
	prNumber: number,
): Promise<RawAnchorComment | undefined> =>
	latest(await loadAnchorComments(cwd, repo, prNumber));

const markerLine = (values: {
	readonly status: ReviewStatus;
	readonly head: string;
	readonly tier?: ReviewTier;
}) =>
	`<!-- plot-review:v1 status=${values.status} head=${values.head}${values.tier === undefined ? "" : ` tier=${values.tier}`} -->`;

const anchorBody = (values: {
	readonly status: ReviewStatus;
	readonly head: string;
	readonly tier?: ReviewTier;
	readonly body: string;
}) =>
	[
		markerLine(values),
		"",
		values.body.replace(MARKER_PATTERN_GLOBAL, "").trim(),
		"",
	]
		.filter((part) => part.length > 0)
		.join("\n");

const FILE_NOISE_PATTERNS = [
	/(^|\/)(bun\.lock|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/,
	/(^|\/)(Cargo\.lock|go\.sum|poetry\.lock|Pipfile\.lock|flake\.lock)$/,
	/\.min\.(js|css)$/,
	/\.map$/,
];

const isNoiseFile = (path: string) =>
	FILE_NOISE_PATTERNS.some((pattern) => pattern.test(path));

const formatFile = (file: PullRequestFileInfo) =>
	`${file.path} (+${file.additions}/-${file.deletions}${file.changeType === undefined ? "" : ` ${file.changeType}`})`;

const reviewStateLabel = (values: {
	readonly anchor?: AnchorMarker;
	readonly head?: string;
}) => {
	if (values.anchor === undefined) return "fresh";
	if (values.anchor.head !== values.head) return "new head";
	return values.anchor.status === "reviewing" ? "resume" : "done grace";
};

const contextBlock = (values: {
	readonly repo: string;
	readonly pr: PullRequestInfo;
	readonly anchor?: AnchorMarker;
	readonly maxContextFiles: number;
}) => {
	const changedFiles = values.pr.files.slice(0, values.maxContextFiles);
	const omittedFiles = Math.max(
		values.pr.files.length - changedFiles.length,
		0,
	);
	const noiseFiles = values.pr.files.filter((file) => isNoiseFile(file.path));
	const head = values.pr.headRefOid;
	const lines = [
		"## Extension-discovered target",
		`- Repository: ${values.repo}`,
		`- Pull request: #${values.pr.number} ${values.pr.title}`,
		`- URL: ${values.pr.url}`,
		`- Draft: ${String(values.pr.isDraft)}`,
		`- Base/head: ${values.pr.baseRefName}...${values.pr.headRefName}`,
		`- Review state: ${reviewStateLabel({ anchor: values.anchor, head })}`,
	];
	if (values.pr.authorLogin !== undefined)
		lines.push(`- Author: ${values.pr.authorLogin}`);
	if (head !== undefined) lines.push(`- Head SHA: ${head}`);
	lines.push(
		`- Diff stats: ${values.pr.changedFiles} files, +${values.pr.additions}/-${values.pr.deletions}`,
		`- Noise-file candidates: ${noiseFiles.length === 0 ? "none" : noiseFiles.map((file) => file.path).join(", ")}`,
	);
	if (values.anchor === undefined) {
		lines.push("- Anchor comment: none yet; this run creates it");
	} else {
		lines.push(
			`- Anchor marker: status=${values.anchor.status} head=${values.anchor.head}${values.anchor.tier === undefined ? "" : ` tier=${values.anchor.tier}`}`,
		);
		if (values.anchor.url !== undefined)
			lines.push(`- Anchor URL: ${values.anchor.url}`);
		if (values.anchor.head !== head)
			lines.push(
				"- Head moved since the anchor was written: treat this as an incremental re-review.",
			);
	}
	lines.push(
		"",
		"## Changed files from GitHub",
		...changedFiles.map((file) => `- ${formatFile(file)}`),
	);
	if (omittedFiles > 0)
		lines.push(
			`- ... ${omittedFiles} more file(s) omitted from prompt context`,
		);
	return lines.join("\n");
};

const targetFromWork = (work: PlotExtensionWork): GitHubTarget => {
	if (!isRecord(work.context))
		throw new Error("work is missing GitHub context");
	const github = work.context["github"];
	if (!isRecord(github)) throw new Error("work is missing GitHub context");
	const repo = stringField(github, "repo");
	const prNumber = numberField(github, "prNumber");
	const head = stringField(github, "head");
	if (repo === undefined || prNumber === undefined || head === undefined)
		throw new Error("work has incomplete GitHub context");
	return { repo, prNumber, head };
};

const assertCurrentHead = async (cwd: string, target: GitHubTarget) => {
	const current = await command(cwd, "gh", [
		"pr",
		"view",
		String(target.prNumber),
		"--repo",
		target.repo,
		"--json",
		"headRefOid",
		"-q",
		".headRefOid",
	]);
	if (current !== target.head)
		throw new Error(
			`PR head moved before write: expected ${target.head}, got ${current}`,
		);
};

const toolText = (text: string, details: Record<string, unknown> = {}) => ({
	content: [{ type: "text" as const, text }],
	details,
});

const parseToolTier = (params: Record<string, unknown>) => {
	const tier = stringField(params, "tier");
	if (tier === undefined) return undefined;
	const parsed = parseTier(tier);
	if (parsed === undefined)
		throw new Error("tier must be trivial, lite, or full");
	return parsed;
};

const parseDiffContext = (diff: string): DiffContextFile[] => {
	const files: DiffContextFile[] = [];
	let current: { path: string; changedLines: ChangedLineRange[] } | undefined;
	for (const line of diff.split("\n")) {
		const header = line.match(/^diff --git a\/.+ b\/(.+)$/);
		if (header?.[1] !== undefined) {
			current = { path: header[1], changedLines: [] };
			files.push(current);
			continue;
		}
		if (current === undefined) continue;
		const hunk = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
		if (hunk === null) continue;
		const start = Number.parseInt(hunk[3] ?? "0", 10);
		const count = hunk[4] === undefined ? 1 : Number.parseInt(hunk[4], 10);
		current.changedLines.push(
			count > 0
				? { start, end: start + count - 1 }
				: { start, end: start, deletion: true },
		);
	}
	return files;
};

const parseReviewComments = (value: unknown) => {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new Error("comments must be an array");
	return value.map((item) => {
		if (!isRecord(item)) throw new Error("comment must be an object");
		const path = stringField(item, "path");
		const line = numberField(item, "line");
		const startLine = numberField(item, "startLine");
		const body = stringField(item, "body");
		const side = stringField(item, "side") ?? "RIGHT";
		if (path === undefined || line === undefined || body === undefined)
			throw new Error("comment requires path, line, and body");
		if (!Number.isInteger(line) || line <= 0)
			throw new Error("comment line must be a positive integer");
		if (
			startLine !== undefined &&
			(!Number.isInteger(startLine) || startLine <= 0 || startLine > line)
		)
			throw new Error(
				"comment startLine must be a positive integer no greater than line",
			);
		if (side !== "LEFT" && side !== "RIGHT")
			throw new Error("comment side must be LEFT or RIGHT");
		return {
			path,
			line,
			side,
			body,
			...(startLine === undefined || startLine === line
				? {}
				: { start_line: startLine, start_side: side }),
		};
	});
};

export default definePlotExtension<GitHubPrReviewerConfig>({
	id: "github-pr-reviewer",
	parseConfig,
	create: ({ config, paths, work, registerTool }) => {
		let pinnedRepo: string | undefined = config.repo;
		const resolveRepo = async (cwd: string) => {
			if (pinnedRepo === undefined)
				pinnedRepo = await command(cwd, "gh", [
					"repo",
					"view",
					"--json",
					"nameWithOwner",
					"-q",
					".nameWithOwner",
				]);
			return pinnedRepo;
		};

		registerTool(({ paths: toolPaths, work: toolWork }) => {
			const target = targetFromWork(toolWork);
			return defineTool({
				name: "load_pr_diff_context",
				label: "Load PR Diff Context",
				description:
					"Load the current PR diff changed-line map for accurate inline review coordinates.",
				parameters: { type: "object", properties: {} },
				execute: async () => {
					await assertCurrentHead(toolPaths.cwd, target);
					const diff = await command(toolPaths.cwd, "gh", [
						"pr",
						"diff",
						String(target.prNumber),
						"--repo",
						target.repo,
						"--patch",
					]);
					const files = parseDiffContext(diff);
					return toolText(JSON.stringify({ ...target, files }, null, 2), {
						files: files.length,
					});
				},
			});
		});

		registerTool(({ paths: toolPaths, work: toolWork }) => {
			const target = targetFromWork(toolWork);
			return defineTool({
				name: "upsert_review_anchor",
				label: "Upsert Review Anchor",
				description:
					"Create or update the PR's single Plot review anchor comment after checking the head SHA.",
				parameters: {
					type: "object",
					properties: {
						status: { type: "string", enum: REVIEW_STATUSES },
						tier: { type: "string", enum: REVIEW_TIERS },
						body: { type: "string" },
					},
					required: ["status", "body"],
				},
				execute: async (params) => {
					if (!isRecord(params)) throw new Error("params must be an object");
					const status = stringField(params, "status");
					const body = stringField(params, "body");
					if (
						status === undefined ||
						!(REVIEW_STATUSES as readonly string[]).includes(status)
					)
						throw new Error("status must be reviewing or done");
					if (body === undefined) throw new Error("body is required");
					await assertCurrentHead(toolPaths.cwd, target);
					const anchor = await findAnchorCommentForWrite(
						toolPaths.cwd,
						target.repo,
						target.prNumber,
					);
					const payload = {
						body: anchorBody({
							status: status as ReviewStatus,
							head: target.head,
							tier: parseToolTier(params),
							body,
						}),
					};
					const output = await ghJson(
						toolPaths.cwd,
						anchor === undefined
							? [
									"api",
									`repos/${target.repo}/issues/${target.prNumber}/comments`,
									"--method",
									"POST",
								]
							: [
									"api",
									`repos/${target.repo}/issues/comments/${anchor.id}`,
									"--method",
									"PATCH",
								],
						payload,
					);
					const response = parseJson(output);
					const url = isRecord(response)
						? stringField(response, "html_url")
						: undefined;
					return toolText(
						url === undefined ? "anchor updated" : `anchor updated: ${url}`,
						{ url },
					);
				},
			});
		});

		registerTool(({ paths: toolPaths, work: toolWork }) => {
			const target = targetFromWork(toolWork);
			return defineTool({
				name: "post_pr_review",
				label: "Post PR Review",
				description:
					"Post exactly one GitHub pull request review for the current head SHA.",
				parameters: {
					type: "object",
					properties: {
						event: {
							type: "string",
							enum: ["COMMENT", "REQUEST_CHANGES"],
						},
						body: { type: "string" },
						comments: {
							type: "array",
							items: {
								type: "object",
								properties: {
									path: { type: "string" },
									line: { type: "number" },
									startLine: { type: "number" },
									side: { type: "string", enum: ["LEFT", "RIGHT"] },
									body: { type: "string" },
								},
								required: ["path", "line", "body"],
							},
						},
					},
					required: ["event", "body"],
				},
				execute: async (params) => {
					if (!isRecord(params)) throw new Error("params must be an object");
					const event = stringField(params, "event");
					const body = stringField(params, "body");
					if (event !== "COMMENT" && event !== "REQUEST_CHANGES")
						throw new Error("event must be COMMENT or REQUEST_CHANGES");
					if (body === undefined) throw new Error("body is required");
					await assertCurrentHead(toolPaths.cwd, target);
					const comments = parseReviewComments(params["comments"]);
					const output = await ghJson(
						toolPaths.cwd,
						[
							"api",
							`repos/${target.repo}/pulls/${target.prNumber}/reviews`,
							"--method",
							"POST",
						],
						{
							commit_id: target.head,
							event,
							body,
							comments,
						},
					);
					const response = parseJson(output);
					const url = isRecord(response)
						? stringField(response, "html_url")
						: undefined;
					return toolText(
						url === undefined ? "review posted" : `review posted: ${url}`,
						{ url, inlineComments: comments.length },
					);
				},
			});
		});

		return {
			discover: async (): Promise<readonly PlotExtensionWork[]> => {
				const cwd = paths.cwd;
				const repo = await resolveRepo(cwd);
				const prs = await loadOpenPullRequests(cwd, repo, config.maxOpenPrs);
				const prsWithAnchors = await Promise.all(
					prs.map(async (pr) => ({
						pr,
						anchor: await findAnchorComment(cwd, repo, pr.number),
					})),
				);
				const works: PlotExtensionWork[] = [];
				for (const { pr, anchor } of prsWithAnchors) {
					const draftBlocked = pr.isDraft && !config.includeDrafts;
					const head = pr.headRefOid ?? pr.headRefName;
					const workspacePath = prWorkspacePath(repo, pr.number);
					// eslint-disable-next-line no-await-in-loop -- work records are built sequentially for stable output order.
					await mkdir(workspacePath, { recursive: true });
					const headMatches =
						anchor !== undefined && anchor.head === pr.headRefOid;
					const doneGraceActive =
						headMatches &&
						anchor.status === "done" &&
						anchor.updatedAtMs !== undefined &&
						Date.now() - anchor.updatedAtMs <= config.doneGraceMs;
					if (headMatches && anchor.status === "done" && !doneGraceActive)
						continue;
					const labels = [
						...(draftBlocked ? ["blocked:draft"] : []),
						...(doneGraceActive ? ["done"] : []),
						reviewStateLabel({ anchor, head: pr.headRefOid }),
					];
					works.push(
						work({
							id: `github:${repo}:pr:${pr.number}`,
							version: head,
							...(draftBlocked || doneGraceActive
								? {
										status: "blocked" as const,
										blockedReason: draftBlocked
											? "draft pull request"
											: "review complete; releasing soon",
									}
								: {}),
							title: `Review ${repo} PR #${pr.number}: ${pr.title}`,
							url: pr.url,
							subject: `github:${repo}:pr:${pr.number}`,
							display: {
								kind: "github-pr-review",
								primary: `#${pr.number}`,
								title: pr.title,
								subtitle: `${repo} · ${pr.baseRefName}...${pr.headRefName}`,
								url: pr.url,
								...(pr.headRefOid === undefined
									? {}
									: { version: pr.headRefOid.slice(0, 7) }),
								labels,
							},
							context: {
								workspace: { path: workspacePath },
								github: {
									repo,
									prNumber: pr.number,
									head,
									url: pr.url,
									title: pr.title,
									baseRefName: pr.baseRefName,
									headRefName: pr.headRefName,
									...(anchor === undefined
										? {}
										: {
												anchor: {
													status: anchor.status,
													head: anchor.head,
													...(anchor.tier === undefined
														? {}
														: { tier: anchor.tier }),
													...(anchor.url === undefined
														? {}
														: { url: anchor.url }),
												},
											}),
								},
								githubContext: contextBlock({
									repo,
									pr,
									...(anchor === undefined ? {} : { anchor }),
									maxContextFiles: config.maxContextFiles,
								}),
							},
						}),
					);
				}
				return works;
			},
		};
	},
});
