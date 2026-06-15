import { z } from "zod";
import { nonEmptyStringSchema } from "./session-summary.js";

export const operatorActionToneSchema = z.enum([
	"primary",
	"secondary",
	"danger",
]);
export type OperatorActionTone = z.infer<typeof operatorActionToneSchema>;

export const operatorActionConfirmSchema = z
	.object({
		title: nonEmptyStringSchema,
		message: z.string().optional(),
	})
	.strict();
export type OperatorActionConfirm = z.infer<typeof operatorActionConfirmSchema>;

export const operatorActionSchema = z
	.object({
		id: nonEmptyStringSchema,
		label: nonEmptyStringSchema,
		tone: operatorActionToneSchema.optional(),
		disabledReason: z.string().optional(),
		requiresComment: z.boolean().optional(),
		confirm: operatorActionConfirmSchema.optional(),
	})
	.strict();
export type OperatorAction = z.infer<typeof operatorActionSchema>;

export const operatorObservationRequestSchema = z
	.object({
		sessionId: nonEmptyStringSchema,
		workKey: nonEmptyStringSchema,
		actionId: nonEmptyStringSchema,
		comment: z.string().optional(),
	})
	.strict();
export type OperatorObservationRequest = z.infer<
	typeof operatorObservationRequestSchema
>;

export const operatorObservationActorSchema = z
	.object({
		id: nonEmptyStringSchema.optional(),
		label: nonEmptyStringSchema.optional(),
		role: z.enum(["controller", "observer"]).optional(),
	})
	.strict();
export type OperatorObservationActor = z.infer<
	typeof operatorObservationActorSchema
>;

export const operatorObservationSchema = z
	.object({
		sessionId: nonEmptyStringSchema,
		sourceId: nonEmptyStringSchema,
		workKey: nonEmptyStringSchema,
		actionId: nonEmptyStringSchema,
		actionLabel: nonEmptyStringSchema,
		timestamp: nonEmptyStringSchema,
		comment: z.string().optional(),
		actor: operatorObservationActorSchema.optional(),
		clientId: nonEmptyStringSchema.optional(),
		workDisplay: z.unknown().optional(),
		workVersion: z.string().optional(),
	})
	.strict();
export type OperatorObservation = z.infer<typeof operatorObservationSchema>;

export const safeParseOperatorAction = (value: unknown) =>
	operatorActionSchema.safeParse(value);
export const safeParseOperatorObservationRequest = (value: unknown) =>
	operatorObservationRequestSchema.safeParse(value);
export const safeParseOperatorObservation = (value: unknown) =>
	operatorObservationSchema.safeParse(value);
