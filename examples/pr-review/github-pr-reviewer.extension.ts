import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { definePlotExtension } from "plot-ai/sdk";
import type { PlotExtensionWork } from "plot-ai/sdk";

const execFileAsync = promisify(execFile);

/**
 * Trusted reader. This extension owns cheap GitHub observation only: open PRs,
 * head SHA, changed-file facts, and the anchor marker. It does not choose the
 * review plan, run specialist reviewers, post findings, or encode GitHub
 * review judgment. The agent session owns that work with bash and `gh`, guided
 * by WORKFLOW.md.
 *
 * Marker contract (written by the agent, parsed here):
 *   <!-- plot-review:v1 status=<phase> head=<sha> tier=<tier> -->
 * One anchor comment per PR. An unparseable or missing marker means the
 * review starts (or restarts) at `prepare`.
 */

const REVIEW_PHASES = [
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
] as const;
type ReviewPhase = (typeof REVIEW_PHASES)[number];

interface GitHubPrReviewerConfig {
	readonly includeDrafts: boolean;
	/** owner/name. When omitted, inferred once from the launch directory. */
	readonly repo?: string;
	/** Maximum open PRs discovered per tick. */
	readonly maxOpenPrs: number;
	/** Maximum changed-file rows included in the prompt context. */
	readonly maxContextFiles: number;
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
	readonly status: ReviewPhase;
	readonly head: string;
	readonly tier?: string;
	readonly url?: string;
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

const parseConfig = (input: unknown): GitHubPrReviewerConfig => {
	if (!isRecord(input))
		return { includeDrafts: true, maxOpenPrs: 10, maxContextFiles: 200 };
	const repo = stringField(input, "repo");
	return {
		includeDrafts: booleanField(input, "includeDrafts") ?? true,
		...(repo === undefined ? {} : { repo }),
		maxOpenPrs: positiveInteger(numberField(input, "maxOpenPrs"), 10),
		maxContextFiles: positiveInteger(
			numberField(input, "maxContextFiles"),
			200,
		),
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

/**
 * Discover open PRs by repository API only. The daemon's filesystem and git
 * state are never consulted: this extension can run from any directory.
 */
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

const MARKER_PATTERN = /<!-- plot-review:v1 ([^>]*?) -->/;

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
		!(REVIEW_PHASES as readonly string[]).includes(status) ||
		!/^[0-9a-f]{7,40}$/.test(head)
	)
		return undefined;
	const tier = fields.get("tier");
	return {
		status: status as ReviewPhase,
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

const findAnchorMarker = async (
	cwd: string,
	repo: string,
	prNumber: number,
): Promise<AnchorMarker | undefined> => {
	const currentUser = await currentLogin(cwd);
	const jq = `[ .[] | select(.user.login == ${JSON.stringify(currentUser)} and ((.body // "") | contains("<!-- plot-review:v1 "))) | {body, html_url, created_at} ] | sort_by(.created_at) | tostring`;
	const output = await command(cwd, "gh", [
		"api",
		`repos/${repo}/issues/${prNumber}/comments`,
		"--paginate",
		"--jq",
		jq,
	]);
	const comments = output
		.split("\n")
		.map((line) => parseJson(line.trim()))
		.flatMap((page) => (Array.isArray(page) ? page : []))
		.filter(isRecord);
	const latest = comments[comments.length - 1];
	if (latest === undefined) return undefined;
	const body = stringField(latest, "body");
	if (body === undefined) return undefined;
	const marker = parseMarker(body);
	if (marker === undefined) return undefined;
	const url = stringField(latest, "html_url");
	return { ...marker, ...(url === undefined ? {} : { url }) };
};

const FILE_NOISE_PATTERNS = [
	/(^|\/)(bun\.lock|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/,
	/(^|\/)(Cargo\.lock|go\.sum|poetry\.lock|Pipfile\.lock|flake\.lock)$/,
	/\.min\.(js|css)$/,
	/\.map$/,
];

const isNoiseFile = (path: string) =>
	FILE_NOISE_PATTERNS.some((pattern) => pattern.test(path));

const domainHint = (path: string): string | undefined => {
	if (path.startsWith("packages/agent/")) return "agent runtime";
	if (path.startsWith("packages/session/src/protocol")) return "protocol";
	if (path.startsWith("packages/session/src/pi-") || path.includes("auth"))
		return "provider/auth boundary";
	if (
		path.startsWith("packages/session/src/extension") ||
		path.startsWith("packages/sdk/")
	)
		return "extension/sdk boundary";
	if (path.startsWith("packages/cli/")) return "cli process boundary";
	if (path.startsWith("packages/tui/")) return "terminal lifecycle";
	if (path.startsWith("packages/common/")) return "shared async primitive";
	if (path === "AGENTS.md" || path.endsWith("/AGENTS.md"))
		return "agent instructions";
	if (path.endsWith("WORKFLOW.md") || path.startsWith("docs/"))
		return "docs/workflow";
	return undefined;
};

const formatFile = (file: PullRequestFileInfo) =>
	`${file.path} (+${file.additions}/-${file.deletions}${file.changeType === undefined ? "" : ` ${file.changeType}`})`;

const contextBlock = (values: {
	readonly repo: string;
	readonly pr: PullRequestInfo;
	readonly anchor?: AnchorMarker;
	readonly phase: ReviewPhase;
	readonly maxContextFiles: number;
}) => {
	const changedFiles = values.pr.files.slice(0, values.maxContextFiles);
	const omittedFiles = Math.max(
		values.pr.files.length - changedFiles.length,
		0,
	);
	const noiseFiles = values.pr.files.filter((file) => isNoiseFile(file.path));
	const domainHints = [
		...new Set(
			values.pr.files
				.map((file) => domainHint(file.path))
				.filter((hint): hint is string => hint !== undefined),
		),
	];
	const lines = [
		"## Extension-discovered target",
		`- Repository: ${values.repo}`,
		`- Pull request: #${values.pr.number} ${values.pr.title}`,
		`- URL: ${values.pr.url}`,
		`- Draft: ${String(values.pr.isDraft)}`,
		`- Base/head: ${values.pr.baseRefName}...${values.pr.headRefName}`,
	];
	if (values.pr.authorLogin !== undefined)
		lines.push(`- Author: ${values.pr.authorLogin}`);
	if (values.pr.headRefOid !== undefined)
		lines.push(`- Head SHA: ${values.pr.headRefOid}`);
	lines.push(
		`- Current anchor phase: ${values.phase}`,
		`- Diff stats: ${values.pr.changedFiles} files, +${values.pr.additions}/-${values.pr.deletions}`,
		`- Domain hints from paths: ${domainHints.length === 0 ? "none" : domainHints.join(", ")}`,
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
		if (values.anchor.head !== values.pr.headRefOid)
			lines.push(
				"- Head moved since the anchor was written: restart at prepare and carry the anchor's previous findings.",
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

export default definePlotExtension<GitHubPrReviewerConfig>({
	id: "plot-alpha-github-pr-reviewer",
	parseConfig,
	create: ({ config, paths, work }) => {
		// The target repository comes from config, or is inferred exactly once
		// from the launch directory as a convenience. Discovery never reads
		// the daemon's git state again: the loop can run from anywhere, and
		// nothing the dispatched agents do to any checkout can retarget it.
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
		return {
			discover: async (): Promise<readonly PlotExtensionWork[]> => {
				const cwd = paths.cwd;
				const repo = await resolveRepo(cwd);
				const prs = await loadOpenPullRequests(cwd, repo, config.maxOpenPrs);
				const works: PlotExtensionWork[] = [];
				for (const pr of prs) {
					// Draft PRs hold their claim without dispatching: the work
					// stays visible as blocked and the review starts when the
					// draft is marked ready, instead of silently vanishing.
					const draftBlocked = pr.isDraft && !config.includeDrafts;
					const anchor = await findAnchorMarker(cwd, repo, pr.number);
					const headMatches =
						anchor !== undefined && anchor.head === pr.headRefOid;
					// A done anchor for the current head means nothing to do for
					// this PR. A missing/unparseable marker or a moved head
					// restarts at prepare.
					if (headMatches && anchor.status === "done") continue;
					const phase: ReviewPhase = headMatches ? anchor.status : "prepare";
					works.push(
						work({
							id: `github:${repo}:pr:${pr.number}`,
							version: `${pr.headRefOid ?? pr.headRefName}:${phase}`,
							...(draftBlocked
								? {
										status: "blocked" as const,
										blockedReason: "draft pull request",
									}
								: {}),
							title: `Review ${repo} PR #${pr.number}: ${pr.title} (${phase})`,
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
								labels: [
									...(draftBlocked ? ["blocked:draft"] : []),
									anchor === undefined ? "fresh" : "incremental",
									`phase:${phase}`,
								],
							},
							context: {
								githubContext: contextBlock({
									repo,
									pr,
									...(anchor === undefined ? {} : { anchor }),
									phase,
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
