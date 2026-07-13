import { nanoquery, type Fetcher } from "@nanostores/query";
import {
	fetchAttemptTranscript,
	fetchSessionProjectionUrl,
	fetchSessions,
} from "./api.js";
import { sessionsUrl } from "./routes.js";

const transcriptRoute =
	/^\/api\/sessions\/([^/]+)\/attempts\/([^/]+)\/transcript$/;

const queryFetcher: Fetcher<unknown> = async (urlPart) => {
	const url = String(urlPart);
	const { pathname } = new URL(url, "http://plot.local");
	if (pathname === sessionsUrl) return fetchSessions();
	if (/^\/api\/sessions\/[^/]+\/projection$/.test(pathname))
		return fetchSessionProjectionUrl(url);
	const transcript = transcriptRoute.exec(pathname);
	if (transcript !== null)
		return fetchAttemptTranscript(
			decodeURIComponent(transcript[1] ?? ""),
			decodeURIComponent(transcript[2] ?? ""),
		);
	throw new Error(`unknown web query: ${url}`);
};

export const [createFetcherStore, createMutatorStore] = nanoquery({
	fetcher: queryFetcher,
	onErrorRetry: null,
});
