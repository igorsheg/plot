import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Effect, RcMap, Scope } from "effect";
import { Octokit } from "octokit";

const execFileAsync = promisify(execFile);

interface CachedGetResponse {
	readonly etag: string;
	readonly data: unknown;
	readonly headers: Record<string, string | undefined>;
	readonly url: string;
}

function createOctokitWithCache(token: string): Octokit {
	const octokit = new Octokit({ auth: token });
	const etagCache = new Map<string, CachedGetResponse>();

	octokit.hook.wrap("request", async (request, options) => {
		const method = options.method?.toUpperCase() ?? "GET";
		if (method !== "GET") return request(options);

		const key = `${method}:${options.url ?? ""}:${String(options.headers?.accept ?? "")}`;
		const cached = etagCache.get(key);
		const headers = cached
			? { ...options.headers, "if-none-match": cached.etag }
			: options.headers;

		try {
			const response = await request({ ...options, headers });
			const etag = response.headers.etag;
			if (typeof etag === "string" && etag.length > 0) {
				etagCache.set(key, {
					etag,
					data: response.data,
					headers: response.headers as Record<string, string | undefined>,
					url: response.url,
				});
			}
			return response;
		} catch (cause: unknown) {
			if (
				typeof cause === "object" &&
				cause !== null &&
				"status" in cause &&
				(cause as { status: unknown }).status === 304 &&
				cached
			) {
				return {
					status: 200,
					headers: cached.headers,
					url: cached.url,
					data: cached.data,
				} as ReturnType<typeof request> extends Promise<infer R> ? R : never;
			}
			throw cause;
		}
	});

	return octokit;
}

export function makeClientMap(): Effect.Effect<
	RcMap.RcMap<string, Octokit>,
	never,
	Scope.Scope
> {
	return RcMap.make({
		lookup: (token: string) =>
			Effect.sync(() => createOctokitWithCache(token)),
		idleTimeToLive: "1 minute",
	});
}

export async function getAuthToken(): Promise<string> {
	const { stdout } = await execFileAsync("gh", ["auth", "token"]);
	return stdout.trim();
}

export function parseRepoSlug(slug: string): { owner: string; repo: string } {
	const [owner, repo] = slug.split("/");
	if (!owner || !repo) {
		throw new Error(`invalid repo slug: ${slug}`);
	}
	return { owner, repo };
}

export async function detectRepo(): Promise<{ owner: string; repo: string }> {
	const { stdout } = await execFileAsync("gh", [
		"repo",
		"view",
		"--json",
		"nameWithOwner",
	]);
	const data = JSON.parse(stdout) as { nameWithOwner: string };
	return parseRepoSlug(data.nameWithOwner);
}
