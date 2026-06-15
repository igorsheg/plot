import { z } from "zod";

export const nonEmptyStringSchema = z.string().min(1);
export const nonNegativeIntegerSchema = z.number().int().nonnegative();
export const positiveIntegerSchema = z.number().int().positive();

export const plotSessionModeSchema = z.enum(["watch", "oneshot"]);
export type PlotSessionMode = z.infer<typeof plotSessionModeSchema>;

export const plotSessionStateSchema = z.enum([
	"starting",
	"watching",
	"reconciling",
	"acting",
	"idle",
	"paused",
	"stopping",
	"stopped",
	"error",
]);
export type PlotSessionState = z.infer<typeof plotSessionStateSchema>;

export const plotSessionAgentsSummarySchema = z
	.object({
		active: nonNegativeIntegerSchema,
		max: nonNegativeIntegerSchema,
	})
	.strict();
export type PlotSessionAgentsSummary = z.infer<
	typeof plotSessionAgentsSummarySchema
>;

export const plotSessionAttachmentsSummarySchema = z
	.object({
		observers: nonNegativeIntegerSchema,
		controllers: nonNegativeIntegerSchema,
	})
	.strict();
export type PlotSessionAttachmentsSummary = z.infer<
	typeof plotSessionAttachmentsSummarySchema
>;

export const plotSessionSummarySchema = z
	.object({
		id: nonEmptyStringSchema,
		epoch: nonEmptyStringSchema,
		mode: plotSessionModeSchema,
		state: plotSessionStateSchema,
		workflowName: nonEmptyStringSchema,
		workflowPath: nonEmptyStringSchema,
		cwd: nonEmptyStringSchema,
		cwdName: nonEmptyStringSchema,
		agents: plotSessionAgentsSummarySchema,
		needsYouCount: nonNegativeIntegerSchema,
		tokenThroughputPerSecond: z.number().nonnegative().nullable(),
		totalTokens: nonNegativeIntegerSchema,
		lastActivityAt: nonEmptyStringSchema.nullable(),
		attachments: plotSessionAttachmentsSummarySchema,
	})
	.strict();
export type PlotSessionSummary = z.infer<typeof plotSessionSummarySchema>;

export const safeParsePlotSessionSummary = (value: unknown) =>
	plotSessionSummarySchema.safeParse(value);
