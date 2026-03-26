import { Schema } from "effect";

export class ProjectsError extends Schema.TaggedErrorClass<ProjectsError>()("ProjectsError", {
	code: Schema.String,
	message: Schema.String,
}) {}

export class SupervisorError extends Schema.TaggedErrorClass<SupervisorError>()("SupervisorError", {
	code: Schema.String,
	message: Schema.String,
	projectId: Schema.optional(Schema.String),
}) {}

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
	code: Schema.String,
	message: Schema.String,
}) {}
