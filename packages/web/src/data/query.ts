import { nanoquery, type Fetcher } from "@nanostores/query";
import {
	fetchAttemptTranscript,
	fetchRunProjectionUrl,
	fetchRuns,
} from "./api.js";
import { runsUrl } from "./routes.js";

const transcriptRoute = /^\/api\/runs\/([^/]+)\/attempts\/([^/]+)\/transcript$/;

const queryFetcher: Fetcher<unknown> = async (urlPart) => {
	const url = String(urlPart);
	const { pathname } = new URL(url, "http://plot.local");
	if (pathname === runsUrl) return fetchRuns();
	if (/^\/api\/runs\/[^/]+\/projection$/.test(pathname)) {
		return fetchRunProjectionUrl(url);
	}
	const transcript = transcriptRoute.exec(pathname);
	if (transcript !== null) {
		return fetchAttemptTranscript(
			decodeURIComponent(transcript[1] ?? ""),
			decodeURIComponent(transcript[2] ?? ""),
		);
	}
	throw new Error(`unknown web query: ${url}`);
};

export const [createFetcherStore, createMutatorStore] = nanoquery({
	fetcher: queryFetcher,
	onErrorRetry: null,
});
