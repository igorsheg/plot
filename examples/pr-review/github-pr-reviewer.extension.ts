import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { definePlotExtension } from "plot-ai/sdk";
import type { PlotExtensionWork } from "plot-ai/sdk";

const execFileAsync = promisify(execFile);

/**
 * Pure reader. This extension owns exactly one deterministic job: tell Plot
 * whether PR-review work exists and at which version, by reading the anchor
 * comment's marker. The agent session owns everything else — reading the PR,
 * judging the code, editing the anchor, and posting the review — with bash
 * and `gh`, guided by WORKFLOW.md.
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

const commandOptional = async (
	cwd: string,
	file: string,
	args: readonly string[],
): Promise<string | undefined> => {
	try {
		const { stdout } = await execFileAsync(file, [...args], {
			cwd,
			encoding: "utf8",
			maxBuffer: 32 * 1024 * 1024,
			env: { ...process.env, NO_COLOR: "1" },
		});
		return stdout.trim();
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
	if (!isRecord(input)) return { includeDrafts: true };
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

const loadCurrentPullRequest = async (cwd: string, branch: string) => {
	const fields =
		"number,title,isDraft,baseRefName,headRefName,url,author,headRefOid";
	const byView = parsePullRequest(
		parseJson(
			await commandOptional(cwd, "gh", ["pr", "view", "--json", fields]),
		),
	);
	if (byView !== undefined) return byView;
	const listed = parseJson(
		await commandOptional(cwd, "gh", [
			"pr",
			"list",
			"--head",
			branch,
			"--json",
			fields,
		]),
	);
	return Array.isArray(listed) ? parsePullRequest(listed[0]) : undefined;
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

const findAnchorMarker = async (
	cwd: string,
	repo: string,
	prNumber: number,
): Promise<AnchorMarker | undefined> => {
	const currentUser = await commandOptional(cwd, "gh", [
		"api",
		"user",
		"-q",
		".login",
	]);
	if (currentUser === undefined || currentUser.length === 0) return undefined;
	const jq = `[ .[] | select(.user.login == ${JSON.stringify(currentUser)} and ((.body // "") | contains("<!-- plot-review:v1 "))) | {body, html_url, created_at} ] | sort_by(.created_at) | tostring`;
	const output = await commandOptional(cwd, "gh", [
		"api",
		`repos/${repo}/issues/${prNumber}/comments`,
		"--paginate",
		"--jq",
		jq,
	]);
	if (output === undefined) return undefined;
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

const contextBlock = (values: {
	readonly repo: string;
	readonly branch: string;
	readonly includeDrafts: boolean;
	readonly pr?: PullRequestInfo;
	readonly anchor?: AnchorMarker;
	readonly phase: ReviewPhase;
}) => {
	const lines = [
		"## Extension-discovered target",
		`- Repository: ${values.repo}`,
		`- Current branch: ${values.branch}`,
	];
	if (values.pr === undefined)
		return [...lines, "- Pull request: not found for the current branch"].join(
			"\n",
		);
	lines.push(
		`- Pull request: #${values.pr.number} ${values.pr.title}`,
		`- URL: ${values.pr.url}`,
		`- Draft: ${String(values.pr.isDraft)}`,
		`- Base/head: ${values.pr.baseRefName}...${values.pr.headRefName}`,
	);
	if (values.pr.authorLogin !== undefined)
		lines.push(`- Author: ${values.pr.authorLogin}`);
	if (values.pr.headRefOid !== undefined)
		lines.push(`- Head SHA: ${values.pr.headRefOid}`);
	if (values.pr.isDraft && !values.includeDrafts)
		lines.push("- Draft policy: stop after reporting that the PR is draft");
	lines.push(`- Current review phase for this tick: ${values.phase}`);
	if (values.anchor === undefined) {
		lines.push("- Anchor comment: none yet; this tick creates it");
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
	return lines.join("\n");
};

export default definePlotExtension<GitHubPrReviewerConfig>({
	id: "plot-alpha-github-pr-reviewer",
	parseConfig,
	create: ({ config, paths, work }) => ({
		discover: async (): Promise<readonly PlotExtensionWork[]> => {
			const cwd = paths.cwd;
			const repo =
				(await commandOptional(cwd, "gh", [
					"repo",
					"view",
					"--json",
					"nameWithOwner",
					"-q",
					".nameWithOwner",
				])) ?? "unknown/unknown";
			const branch =
				(await commandOptional(cwd, "git", ["branch", "--show-current"])) ??
				"unknown";
			const pr = await loadCurrentPullRequest(cwd, branch);
			// Draft PRs hold their claim without dispatching: the work stays
			// visible as blocked and review starts when the draft is marked
			// ready, instead of silently vanishing.
			const draftBlocked =
				pr !== undefined && pr.isDraft && !config.includeDrafts;
			const anchor =
				pr === undefined
					? undefined
					: await findAnchorMarker(cwd, repo, pr.number);
			const headMatches =
				anchor !== undefined && anchor.head === pr?.headRefOid;
			// Reconcile: a done anchor for the current head means nothing to do.
			// A missing/unparseable marker or a moved head restarts at prepare.
			if (headMatches && anchor.status === "done") return [];
			const phase: ReviewPhase = headMatches ? anchor.status : "prepare";
			const version =
				pr === undefined
					? branch
					: `${pr.headRefOid ?? pr.headRefName}:${phase}`;
			return [
				work({
					id:
						pr === undefined
							? `github:${repo}:branch:${branch}:no-pr`
							: `github:${repo}:pr:${pr.number}`,
					version,
					...(draftBlocked ? { blocked: "draft pull request" } : {}),
					title:
						pr === undefined
							? `No pull request found for ${branch}`
							: `Review ${repo} PR #${pr.number}: ${pr.title} (${phase})`,
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
										...(draftBlocked ? ["blocked:draft"] : []),
										anchor === undefined ? "fresh" : "incremental",
										`phase:${phase}`,
									],
								},
					context: {
						githubContext: contextBlock({
							repo,
							branch,
							includeDrafts: config.includeDrafts,
							...(pr === undefined ? {} : { pr }),
							...(anchor === undefined ? {} : { anchor }),
							phase,
						}),
					},
				}),
			];
		},
	}),
});
