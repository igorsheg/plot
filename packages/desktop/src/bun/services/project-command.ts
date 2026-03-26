export type ProjectCommand =
	| { readonly _tag: "start" }
	| { readonly _tag: "stop"; readonly reason: "user" | "shutdown" | "remove" }
	| { readonly _tag: "health_ok" }
	| { readonly _tag: "health_failed"; readonly error: string }
	| { readonly _tag: "snapshot"; readonly snapshot: unknown }
	| { readonly _tag: "sse_failed" }
	| { readonly _tag: "exit"; readonly code: number | null };
