import { Schema } from "effect";

export const HealthStatus = Schema.Literals(["pass", "warn", "fail"]);
export type HealthStatus = typeof HealthStatus.Type;

export class HealthCheckResult extends Schema.Class<HealthCheckResult>("HealthCheckResult")({
	componentId: Schema.optional(Schema.String),
	observedValue: Schema.optional(Schema.Number),
	observedUnit: Schema.optional(Schema.String),
	status: HealthStatus,
	time: Schema.optional(Schema.String),
}) {}

export class HealthResponse extends Schema.Class<HealthResponse>("HealthResponse")({
	status: HealthStatus,
	version: Schema.optional(Schema.String),
	description: Schema.optional(Schema.String),
	checks: Schema.optional(Schema.Record(Schema.String, Schema.Array(HealthCheckResult))),
}) {}
