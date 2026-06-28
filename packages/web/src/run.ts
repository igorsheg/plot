import { z } from "zod";

export interface PlotRun {
	readonly id: string;
	readonly status: string;
	readonly cwd: string;
	readonly createdAt: string;
	readonly lastSeenAt?: string | undefined;
	readonly label?: string | undefined;
	readonly sessionId?: string | undefined;
	readonly workflowName?: string | undefined;
	readonly workflowPath?: string | undefined;
	readonly cwdName?: string | undefined;
	readonly sessionDir?: string | undefined;
	readonly eventLogPath?: string | undefined;
	readonly lastSequence?: number | undefined;
	readonly lastEventType?: string | undefined;
}

const plotRunSchema: z.ZodType<PlotRun> = z.object({
	id: z.string(),
	status: z.string(),
	cwd: z.string(),
	createdAt: z.string(),
	lastSeenAt: z.string().optional(),
	label: z.string().optional(),
	sessionId: z.string().optional(),
	workflowName: z.string().optional(),
	workflowPath: z.string().optional(),
	cwdName: z.string().optional(),
	sessionDir: z.string().optional(),
	eventLogPath: z.string().optional(),
	lastSequence: z.number().optional(),
	lastEventType: z.string().optional(),
});

const runListSchema = z.union([
	z.array(z.unknown()),
	z.object({ runs: z.array(z.unknown()) }).transform((value) => value.runs),
]);

const parseRun = (value: unknown): PlotRun | undefined => {
	const parsed = plotRunSchema.safeParse(value);
	return parsed.success ? parsed.data : undefined;
};

export const parsePlotRuns = (value: unknown): readonly PlotRun[] => {
	const parsed = runListSchema.safeParse(value);
	if (!parsed.success) return [];
	return parsed.data.map(parseRun).filter((entry) => entry !== undefined);
};
