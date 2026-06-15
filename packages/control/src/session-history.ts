import { z } from "zod";
import { operatorObservationSchema } from "./operator.js";
import {
	nonEmptyStringSchema,
	nonNegativeIntegerSchema,
	positiveIntegerSchema,
} from "./session-summary.js";

export const sessionHistorySequenceSchema = positiveIntegerSchema;
export type SessionHistorySequence = z.infer<
	typeof sessionHistorySequenceSchema
>;

export const sessionHistoryEventBaseSchema = z
	.object({
		sessionId: nonEmptyStringSchema,
		epoch: nonEmptyStringSchema,
		sequence: sessionHistorySequenceSchema,
		timestamp: nonEmptyStringSchema,
		type: nonEmptyStringSchema,
		payload: z.unknown(),
	})
	.strict();
export type SessionHistoryEventBase = z.infer<
	typeof sessionHistoryEventBaseSchema
>;

export const genericSessionHistoryEventSchema = z
	.object({
		sessionId: nonEmptyStringSchema,
		epoch: nonEmptyStringSchema,
		sequence: sessionHistorySequenceSchema,
		timestamp: nonEmptyStringSchema,
		type: nonEmptyStringSchema.refine(
			(type) => type !== "operator_observation_recorded",
			"operator observation events must use operatorObservationRecordedEventSchema",
		),
		payload: z.unknown(),
	})
	.strict();
export type GenericSessionHistoryEvent = z.infer<
	typeof genericSessionHistoryEventSchema
>;

export const operatorObservationRecordedEventSchema = z
	.object({
		sessionId: nonEmptyStringSchema,
		epoch: nonEmptyStringSchema,
		sequence: sessionHistorySequenceSchema,
		timestamp: nonEmptyStringSchema,
		type: z.literal("operator_observation_recorded"),
		payload: operatorObservationSchema,
	})
	.strict();
export type OperatorObservationRecordedEvent = z.infer<
	typeof operatorObservationRecordedEventSchema
>;

export const sessionHistoryEventSchema = z.union([
	operatorObservationRecordedEventSchema,
	genericSessionHistoryEventSchema,
]);
export type SessionHistoryEvent = z.infer<typeof sessionHistoryEventSchema>;

export const sessionHistoryCursorSchema = z
	.object({
		sessionId: nonEmptyStringSchema,
		epoch: nonEmptyStringSchema.optional(),
		afterSequence: nonNegativeIntegerSchema,
	})
	.strict();
export type SessionHistoryCursor = z.infer<typeof sessionHistoryCursorSchema>;

export const safeParseSessionHistoryEvent = (value: unknown) =>
	sessionHistoryEventSchema.safeParse(value);
export const safeParseSessionHistoryCursor = (value: unknown) =>
	sessionHistoryCursorSchema.safeParse(value);
