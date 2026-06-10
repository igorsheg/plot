import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface InlineReviewCommentInput {
	readonly path: string;
	readonly line: number;
	readonly body: string;
	readonly side?: "LEFT" | "RIGHT";
	readonly position?: number;
	readonly startLine?: number;
	readonly startSide?: "LEFT" | "RIGHT";
}

interface GitHubReviewComment {
	readonly path: string;
	readonly position: number;
	readonly body: string;
}

interface ReviewPostInput {
	readonly repo: string;
	readonly prNumber: number;
	readonly commitId: string;
	readonly body: string;
	readonly marker?: string;
	readonly comments?: readonly InlineReviewCommentInput[];
	readonly fallbackToSummary?: boolean;
}

interface PostedReviewResult {
	readonly ok: true;
	readonly repo: string;
	readonly prNumber: number;
	readonly reviewUrl?: string;
	readonly inlineCommentCount: number;
	readonly skippedInlineCommentCount: number;
	readonly fallbackUsed: boolean;
	readonly fallbackReason?: string;
}

const usage = `Usage: bun github-pr-review-poster.ts <review.json>

Posts a GitHub pull request review with event COMMENT only.

Input JSON:
{
  "repo": "owner/name",
  "prNumber": 123,
  "commitId": "<head sha>",
  "marker": "<!-- plot-pr-review:<head-sha> -->",
  "body": "Markdown summary including the marker",
  "comments": [
    {
      "path": "packages/example.ts",
      "line": 42,
      "side": "RIGHT",
      "body": "Inline review comment"
    }
  ]
}
`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown, name: string): string => {
	if (typeof value === "string" && value.trim().length > 0) return value;
	throw new Error(`${name} must be a non-empty string`);
};

const asPositiveInteger = (value: unknown, name: string): number => {
	if (typeof value === "number" && Number.isInteger(value) && value > 0) {
		return value;
	}
	throw new Error(`${name} must be a positive integer`);
};

const asSide = (value: unknown, name: string): "LEFT" | "RIGHT" | undefined => {
	if (value === undefined) return undefined;
	if (value === "LEFT" || value === "RIGHT") return value;
	throw new Error(`${name} must be LEFT or RIGHT`);
};

const asOptionalPositiveInteger = (
	value: unknown,
	name: string,
): number | undefined => {
	if (value === undefined) return undefined;
	return asPositiveInteger(value, name);
};

const parseComment = (
	value: unknown,
	index: number,
): InlineReviewCommentInput => {
	if (!isRecord(value)) throw new Error(`comments[${index}] must be an object`);
	const path = asString(value["path"], `comments[${index}].path`);
	if (path.startsWith("/")) {
		throw new Error(`comments[${index}].path must be repository-relative`);
	}
	const side = asSide(value["side"], `comments[${index}].side`);
	const position = asOptionalPositiveInteger(
		value["position"],
		`comments[${index}].position`,
	);
	const startLine = asOptionalPositiveInteger(
		value["startLine"],
		`comments[${index}].startLine`,
	);
	const startSide = asSide(value["startSide"], `comments[${index}].startSide`);
	return {
		path,
		line: asPositiveInteger(value["line"], `comments[${index}].line`),
		body: asString(value["body"], `comments[${index}].body`),
		...(side === undefined ? {} : { side }),
		...(position === undefined ? {} : { position }),
		...(startLine === undefined ? {} : { startLine }),
		...(startSide === undefined ? {} : { startSide }),
	};
};

const parseInput = (value: unknown): ReviewPostInput => {
	if (!isRecord(value)) throw new Error("review input must be an object");
	const repo = asString(value["repo"], "repo");
	if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
		throw new Error("repo must be in owner/name form");
	}
	const body = asString(value["body"], "body");
	const marker =
		value["marker"] === undefined
			? undefined
			: asString(value["marker"], "marker");
	const requiredMarker = marker ?? "<!-- plot-pr-review:";
	if (!body.includes(requiredMarker)) {
		throw new Error("body must include the Plot durable review marker");
	}
	const rawComments = value["comments"];
	if (rawComments !== undefined && !Array.isArray(rawComments)) {
		throw new Error("comments must be an array when provided");
	}
	const comments = (rawComments ?? []).map(parseComment);
	if (comments.length > 50) {
		throw new Error("comments must contain at most 50 inline comments");
	}
	const fallbackToSummary =
		value["fallbackToSummary"] === undefined
			? true
			: value["fallbackToSummary"] === true;
	if (
		value["fallbackToSummary"] !== undefined &&
		typeof value["fallbackToSummary"] !== "boolean"
	) {
		throw new Error("fallbackToSummary must be a boolean when provided");
	}
	return {
		repo,
		prNumber: asPositiveInteger(value["prNumber"], "prNumber"),
		commitId: asString(value["commitId"], "commitId"),
		body,
		...(marker === undefined ? {} : { marker }),
		...(comments.length === 0 ? {} : { comments }),
		fallbackToSummary,
	};
};

const readInputFile = async (path: string): Promise<ReviewPostInput> => {
	const file = Bun.file(path);
	const parsed = (await file.json()) as unknown;
	return parseInput(parsed);
};

const diffPathFromHeader = (line: string): string | undefined => {
	if (!line.startsWith("+++ b/")) return undefined;
	return line.slice("+++ b/".length);
};

const parseHunkStart = (line: string): { oldLine: number; newLine: number } => {
	const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
	if (match === null) throw new Error(`invalid diff hunk header: ${line}`);
	return { oldLine: Number(match[1]), newLine: Number(match[2]) };
};

const diffPositionKey = (path: string, side: "LEFT" | "RIGHT", line: number) =>
	`${path}\0${side}\0${line}`;

const diffPositions = async (
	repo: string,
	prNumber: number,
): Promise<ReadonlyMap<string, number>> => {
	const { stdout } = await execFileAsync(
		"gh",
		["pr", "diff", String(prNumber), "--repo", repo],
		{
			encoding: "utf8",
			maxBuffer: 32 * 1024 * 1024,
			env: { ...process.env, NO_COLOR: "1" },
		},
	);
	const positions = new Map<string, number>();
	let currentPath: string | undefined;
	let oldLine = 0;
	let newLine = 0;
	let position = 0;
	for (const line of stdout.split("\n")) {
		if (line.startsWith("diff --git ")) {
			currentPath = undefined;
			position = 0;
			continue;
		}
		const headerPath = diffPathFromHeader(line);
		if (headerPath !== undefined) {
			currentPath = headerPath;
			continue;
		}
		if (line.startsWith("@@ ")) {
			const hunk = parseHunkStart(line);
			oldLine = hunk.oldLine;
			newLine = hunk.newLine;
			continue;
		}
		if (currentPath === undefined) continue;
		if (line.startsWith("\\")) continue;
		if (line.startsWith("+")) {
			position += 1;
			positions.set(diffPositionKey(currentPath, "RIGHT", newLine), position);
			newLine += 1;
			continue;
		}
		if (line.startsWith("-")) {
			position += 1;
			positions.set(diffPositionKey(currentPath, "LEFT", oldLine), position);
			oldLine += 1;
			continue;
		}
		if (line.startsWith(" ")) {
			position += 1;
			positions.set(diffPositionKey(currentPath, "LEFT", oldLine), position);
			positions.set(diffPositionKey(currentPath, "RIGHT", newLine), position);
			oldLine += 1;
			newLine += 1;
		}
	}
	return positions;
};

const resolveGitHubComments = (
	comments: readonly InlineReviewCommentInput[],
	positions: ReadonlyMap<string, number>,
): readonly GitHubReviewComment[] =>
	comments.flatMap((comment) => {
		const position =
			comment.position ??
			positions.get(
				diffPositionKey(comment.path, comment.side ?? "RIGHT", comment.line),
			);
		if (position === undefined) return [];
		return [{ path: comment.path, position, body: comment.body }];
	});

const reviewPayload = (
	input: ReviewPostInput,
	comments: readonly GitHubReviewComment[],
) => ({
	commit_id: input.commitId,
	event: "COMMENT",
	body: input.body,
	...(comments.length === 0 ? {} : { comments }),
});

const errorText = (error: unknown): string => {
	if (error instanceof Error) return error.message;
	return String(error);
};

const ghApi = async (repo: string, prNumber: number, payload: unknown) => {
	const dir = await mkdtemp(join(tmpdir(), "plot-github-review-"));
	const inputPath = join(dir, "review.json");
	try {
		await writeFile(inputPath, JSON.stringify(payload, null, 2));
		const { stdout } = await execFileAsync(
			"gh",
			[
				"api",
				"-X",
				"POST",
				`repos/${repo}/pulls/${prNumber}/reviews`,
				"--input",
				inputPath,
			],
			{
				encoding: "utf8",
				maxBuffer: 8 * 1024 * 1024,
				env: { ...process.env, NO_COLOR: "1" },
			},
		);
		return JSON.parse(stdout) as unknown;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
};

const reviewUrl = (value: unknown): string | undefined => {
	if (!isRecord(value)) return undefined;
	const htmlUrl = value["html_url"];
	return typeof htmlUrl === "string" ? htmlUrl : undefined;
};

const postReview = async (
	input: ReviewPostInput,
): Promise<PostedReviewResult> => {
	const requestedComments = input.comments ?? [];
	const positions =
		requestedComments.length === 0
			? new Map<string, number>()
			: await diffPositions(input.repo, input.prNumber);
	const comments = resolveGitHubComments(requestedComments, positions);
	const skippedInlineCommentCount = requestedComments.length - comments.length;
	try {
		const response = await ghApi(
			input.repo,
			input.prNumber,
			reviewPayload(input, comments),
		);
		const url = reviewUrl(response);
		return {
			ok: true,
			repo: input.repo,
			prNumber: input.prNumber,
			...(url === undefined ? {} : { reviewUrl: url }),
			inlineCommentCount: comments.length,
			skippedInlineCommentCount,
			fallbackUsed: false,
		};
	} catch (error) {
		if (comments.length === 0 || input.fallbackToSummary === false) throw error;
		const fallbackReason = errorText(error);
		const response = await ghApi(
			input.repo,
			input.prNumber,
			reviewPayload(input, []),
		);
		const url = reviewUrl(response);
		return {
			ok: true,
			repo: input.repo,
			prNumber: input.prNumber,
			...(url === undefined ? {} : { reviewUrl: url }),
			inlineCommentCount: 0,
			skippedInlineCommentCount: requestedComments.length,
			fallbackUsed: true,
			fallbackReason,
		};
	}
};

const main = async () => {
	const inputPath = process.argv[2];
	if (inputPath === "--help" || inputPath === "-h") {
		process.stdout.write(usage);
		return;
	}
	if (inputPath === undefined || process.argv.length > 3) {
		process.stderr.write(usage);
		process.exitCode = 2;
		return;
	}
	try {
		const input = await readInputFile(inputPath);
		const result = await postReview(input);
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
	} catch (error) {
		process.stderr.write(`${errorText(error)}\n`);
		process.exitCode = 1;
	}
};

if (import.meta.main) {
	await main();
}
