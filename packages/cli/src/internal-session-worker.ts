import { serveSessionWorker } from "@plot/session/worker";

export interface InternalSessionWorkerInput {
	readonly cwd: string;
	readonly sessionId: string;
	readonly workflowPath: string;
}

export const runInternalSessionWorker = async (
	input: InternalSessionWorkerInput,
): Promise<void> => {
	try {
		await serveSessionWorker(input);
	} finally {
		process.disconnect?.();
	}
};
