import { Data } from "effect";

export type StartupError = {
	readonly tag: string;
	readonly message: string;
	readonly pluginName?: string;
	readonly phase?: string;
	readonly retryable?: boolean;
};

export type ProjectCommand = Data.TaggedEnum<{
	Start: {};
	Stop: { readonly reason: "user" | "shutdown" | "remove" };
	StartupError: { readonly error: StartupError };
	Snapshot: { readonly snapshot: unknown };
	Exit: { readonly code: number | null };
}>;

export const ProjectCommand = Data.taggedEnum<ProjectCommand>();
