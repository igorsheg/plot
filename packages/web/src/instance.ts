import { z } from "zod";

export interface PlotInstance {
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

const plotInstanceSchema: z.ZodType<PlotInstance> = z.object({
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

const instanceListSchema = z.union([
	z.array(z.unknown()),
	z
		.object({ instances: z.array(z.unknown()) })
		.transform((value) => value.instances),
]);

const parseInstance = (value: unknown): PlotInstance | undefined => {
	const parsed = plotInstanceSchema.safeParse(value);
	return parsed.success ? parsed.data : undefined;
};

export const parsePlotInstances = (value: unknown): readonly PlotInstance[] => {
	const parsed = instanceListSchema.safeParse(value);
	if (!parsed.success) return [];
	return parsed.data.map(parseInstance).filter((entry) => entry !== undefined);
};
