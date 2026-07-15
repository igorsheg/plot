import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { hasErrnoCode } from "@plot/common/primitives";
import {
	isActiveSession,
	parseSessionSummaries,
	type SessionSummary,
} from "./session.js";

export interface SessionStore {
	readonly list: () => Promise<readonly SessionSummary[]>;
	readonly get: (id: string) => Promise<SessionSummary | undefined>;
	readonly upsert: (session: SessionSummary) => Promise<void>;
	readonly recoverAfterRestart: () => Promise<void>;
}

const parseStore = (text: string): readonly SessionSummary[] =>
	parseSessionSummaries(JSON.parse(text) as unknown);

const readSessions = async (
	path: string,
): Promise<readonly SessionSummary[]> => {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if (hasErrnoCode(error, "ENOENT")) return [];
		throw error;
	}
	return parseStore(text);
};

export const createFileSessionStore = (path: string): SessionStore => {
	let writes: Promise<void> = Promise.resolve();
	const mutate = async (work: () => Promise<void>) => {
		const next = writes.then(work, work);
		writes = next.catch(() => undefined);
		await next;
	};
	const writeSessions = async (sessions: readonly SessionSummary[]) => {
		await mkdir(dirname(path), { recursive: true });
		const temporary = `${path}.${process.pid}.tmp`;
		await writeFile(temporary, `${JSON.stringify(sessions, null, 2)}\n`);
		await rename(temporary, path);
	};
	return {
		list: () => readSessions(path),
		get: async (id) =>
			(await readSessions(path)).find((session) => session.id === id),
		upsert: (session) =>
			mutate(async () => {
				const sessions = [...(await readSessions(path))];
				const index = sessions.findIndex((item) => item.id === session.id);
				if (index === -1) sessions.push(session);
				else sessions[index] = session;
				await writeSessions(sessions);
			}),
		recoverAfterRestart: () =>
			mutate(async () => {
				const updatedAt = new Date().toISOString();
				await writeSessions(
					(await readSessions(path)).map((session) =>
						isActiveSession(session)
							? {
									...session,
									state: "error" as const,
									updatedAt,
									diagnostic: "Session manager restarted",
								}
							: session,
					),
				);
			}),
	};
};

export const createMemorySessionStore = (
	initial: readonly SessionSummary[] = [],
): SessionStore => {
	const sessions = new Map(initial.map((session) => [session.id, session]));
	return {
		list: async () => [...sessions.values()],
		get: async (id) => sessions.get(id),
		upsert: async (session) => {
			sessions.set(session.id, session);
		},
		recoverAfterRestart: async () => {
			const updatedAt = new Date().toISOString();
			for (const [id, session] of sessions)
				if (isActiveSession(session))
					sessions.set(id, {
						...session,
						state: "error",
						updatedAt,
						diagnostic: "Session manager restarted",
					});
		},
	};
};
