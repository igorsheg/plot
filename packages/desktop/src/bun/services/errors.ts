import { Schema } from "effect";

export class ProjectsError extends Schema.TaggedErrorClass<ProjectsError>()("ProjectsError", {
	code: Schema.String,
	message: Schema.String,
	cause: Schema.optional(Schema.Defect),
}) {
	override get message(): string {
		return `Projects error [${this.code}]: ${this.message}`;
	}
}

export class SupervisorError extends Schema.TaggedErrorClass<SupervisorError>()("SupervisorError", {
	code: Schema.String,
	message: Schema.String,
	projectId: Schema.optional(Schema.String),
	cause: Schema.optional(Schema.Defect),
}) {
	override get message(): string {
		return `Supervisor error [${this.code}]: ${this.message}${this.projectId ? ` (project: ${this.projectId})` : ""}`;
	}
}

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
	code: Schema.String,
	message: Schema.String,
	cause: Schema.optional(Schema.Defect),
}) {
	override get message(): string {
		return `Auth error [${this.code}]: ${this.message}`;
	}
}
