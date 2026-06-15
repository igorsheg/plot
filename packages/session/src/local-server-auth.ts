import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import type { LocalPlotServerPaths } from "./local-server-paths.js";

export interface LocalControlToken {
	readonly token: string;
	readonly fingerprint: string;
}

const tokenBytes = 32;

const normalizeToken = (value: string) => value.trim();

export const fingerprintLocalControlToken = (token: string): string =>
	createHash("sha256").update(token).digest("hex").slice(0, 16);

export const generateLocalControlToken = (): LocalControlToken => {
	const token = randomBytes(tokenBytes).toString("base64url");
	return { token, fingerprint: fingerprintLocalControlToken(token) };
};

export const readLocalControlToken = async (
	paths: Pick<LocalPlotServerPaths, "tokenPath">,
): Promise<LocalControlToken | undefined> => {
	try {
		const token = normalizeToken(await readFile(paths.tokenPath, "utf8"));
		if (token === "") return undefined;
		return { token, fingerprint: fingerprintLocalControlToken(token) };
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			(error as { readonly code?: unknown }).code === "ENOENT"
		)
			return undefined;
		throw error;
	}
};

export const ensureLocalControlToken = async (
	paths: Pick<LocalPlotServerPaths, "serverDir" | "tokenPath">,
): Promise<LocalControlToken> => {
	const existing = await readLocalControlToken(paths);
	if (existing) return existing;
	const token = generateLocalControlToken();
	await mkdir(paths.serverDir, { recursive: true, mode: 0o700 });
	await writeFile(paths.tokenPath, `${token.token}\n`, { mode: 0o600 });
	try {
		await chmod(paths.serverDir, 0o700);
		await chmod(paths.tokenPath, 0o600);
	} catch {
		// Some filesystems/platforms do not support POSIX chmod. The token is
		// still required for every local control connection.
	}
	return token;
};

export const localControlTokenMatches = (
	expectedToken: string,
	candidateToken: string | undefined,
): boolean => {
	if (!candidateToken) return false;
	const expected = Buffer.from(expectedToken);
	const candidate = Buffer.from(candidateToken);
	return (
		expected.length === candidate.length && timingSafeEqual(expected, candidate)
	);
};

export const bearerTokenFromHeader = (
	header: string | null,
): string | undefined => {
	if (!header) return undefined;
	const prefix = "Bearer ";
	if (!header.startsWith(prefix)) return undefined;
	return header.slice(prefix.length).trim();
};

export const tokenFromRequest = (request: Request): string | undefined => {
	const headerToken = bearerTokenFromHeader(
		request.headers.get("authorization"),
	);
	if (headerToken) return headerToken;
	const url = new URL(request.url);
	return url.searchParams.get("token") ?? undefined;
};
