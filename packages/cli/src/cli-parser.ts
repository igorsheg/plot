import { isDocName, type DocName } from "./docs.js";

export class CliUsageError extends Error {
	override readonly name = "CliUsageError";
}

export type CliHelpTarget =
	| "root"
	| "start"
	| "stop"
	| "web"
	| "check"
	| "docs"
	| "auth"
	| "auth status"
	| "auth login"
	| "auth logout"
	| "models";

export type CliInvocation =
	| { readonly kind: "version" }
	| { readonly kind: "help"; readonly target: CliHelpTarget }
	| { readonly kind: "attach"; readonly workflowPath?: string }
	| { readonly kind: "start"; readonly workflowPath?: string }
	| { readonly kind: "stop"; readonly workflowPath?: string }
	| { readonly kind: "check"; readonly workflowPath?: string }
	| {
			readonly kind: "web";
			readonly host?: string;
			readonly port?: number;
	  }
	| {
			readonly kind: "docs";
			readonly topic?: DocName | "sdk";
			readonly paths: boolean;
	  }
	| {
			readonly kind: "auth";
			readonly action: "status" | "login" | "logout";
			readonly provider?: string;
	  }
	| { readonly kind: "models"; readonly search?: string };

const commands = new Set([
	"start",
	"stop",
	"web",
	"check",
	"docs",
	"auth",
	"models",
]);

const fail = (message: string): never => {
	throw new CliUsageError(message);
};

const pathLike = (value: string): boolean =>
	value.includes("/") ||
	value.includes("\\") ||
	value.startsWith(".") ||
	/\.md$/i.test(value) ||
	/^[A-Za-z]:/.test(value);

const positional = (
	command: string,
	args: readonly string[],
): string | undefined => {
	if (args[0] === "--") {
		if (args.length !== 2)
			return fail(`${command} -- requires exactly one argument`);
		return args[1];
	}
	if (args.some((arg) => arg.startsWith("-")))
		return fail(
			`Unknown option for ${command}: ${args.find((arg) => arg.startsWith("-"))}`,
		);
	if (args.length > 1) return fail(`${command} accepts at most one argument`);
	return args[0];
};

const helpTarget = (args: readonly string[]): CliHelpTarget => {
	const target = args.join(" ") || "root";
	const targets = new Set<CliHelpTarget>([
		"root",
		"start",
		"stop",
		"web",
		"check",
		"docs",
		"auth",
		"auth status",
		"auth login",
		"auth logout",
		"models",
	]);
	if (!targets.has(target as CliHelpTarget))
		return fail(`Unknown help target: ${target}`);
	return target as CliHelpTarget;
};

const parseHelp = (args: readonly string[]): CliInvocation | undefined => {
	if (args[0] === "help") {
		if (args.slice(1).some((arg) => arg.startsWith("-")))
			return fail("help accepts only a command name");
		return { kind: "help", target: helpTarget(args.slice(1)) };
	}
	const indexes = args.flatMap((arg, index) =>
		arg === "--help" || arg === "-h" ? [index] : [],
	);
	if (indexes.length === 0) return undefined;
	if (indexes.length > 1) return fail("help flag may be passed only once");
	const index = indexes[0]!;
	if (index !== args.length - 1)
		return fail("help flag must be the final argument");
	const target = args.slice(0, index);
	if (target.some((arg) => arg.startsWith("-")))
		return fail("help accepts only a command name");
	return { kind: "help", target: helpTarget(target) };
};

const parseWeb = (args: readonly string[]): CliInvocation => {
	let host: string | undefined;
	let port: number | undefined;
	for (let index = 0; index < args.length; index++) {
		const arg = args[index]!;
		const [flag, inline] = arg.split("=", 2);
		if (flag !== "--host" && flag !== "--port")
			return fail(`Unknown option for web: ${arg}`);
		const value = inline ?? args[++index];
		if (value === undefined || value.length === 0)
			return fail(`${flag} requires a value`);
		if (flag === "--host") {
			if (host !== undefined) return fail("--host may be passed only once");
			host = value;
			continue;
		}
		if (port !== undefined) return fail("--port may be passed only once");
		if (!/^\d+$/.test(value)) return fail(`Invalid Web port: ${value}`);
		port = Number(value);
		if (port < 1 || port > 65_535) return fail(`Invalid Web port: ${value}`);
	}
	const invocation: {
		kind: "web";
		host?: string;
		port?: number;
	} = { kind: "web" };
	if (host !== undefined) invocation.host = host;
	if (port !== undefined) invocation.port = port;
	return invocation;
};

const parseDocs = (args: readonly string[]): CliInvocation => {
	let paths = false;
	const topics: string[] = [];
	for (const arg of args) {
		if (arg === "--paths") {
			if (paths) return fail("--paths may be passed only once");
			paths = true;
		} else if (arg.startsWith("-"))
			return fail(`Unknown option for docs: ${arg}`);
		else topics.push(arg);
	}
	if (topics.length > 1) return fail("docs accepts at most one topic");
	if (paths && topics.length > 0)
		return fail("docs accepts either a topic or --paths, not both");
	const topic = topics[0];
	if (topic !== undefined && topic !== "sdk" && !isDocName(topic))
		return fail(`Unknown docs topic: ${topic}`);
	return topic === undefined
		? { kind: "docs", paths }
		: { kind: "docs", topic, paths };
};

const parseAuth = (args: readonly string[]): CliInvocation => {
	if (args.some((arg) => arg.startsWith("-")))
		return fail(
			`Unknown option for auth: ${args.find((arg) => arg.startsWith("-"))}`,
		);
	const action = args[0] ?? "status";
	if (action !== "status" && action !== "login" && action !== "logout")
		return fail(`Unknown auth command: ${action}`);
	if (action === "status" && args.length > 1)
		return fail("auth status accepts no arguments");
	if (args.length > 2)
		return fail(`auth ${action} accepts at most one provider`);
	const provider = args[1];
	return provider === undefined
		? { kind: "auth", action }
		: { kind: "auth", action, provider };
};

export const parseCliInvocation = (args: readonly string[]): CliInvocation => {
	const help = parseHelp(args);
	if (help !== undefined) return help;
	if (args[0] === "--version" || args[0] === "-v") {
		if (args.length !== 1) return fail("version flag accepts no arguments");
		return { kind: "version" };
	}
	if (args[0] === "--") {
		if (args.length !== 2) return fail("-- requires exactly one Workflow path");
		return { kind: "attach", workflowPath: args[1]! };
	}
	const first = args[0];
	if (first === undefined) return { kind: "attach" };
	if (first.startsWith("-")) return fail(`Unknown option: ${first}`);
	const rest = args.slice(1);
	if (!commands.has(first)) {
		if (!pathLike(first)) return fail(`Unknown command: ${first}`);
		if (rest.length > 0)
			return fail("Workflow invocation accepts exactly one path");
		return { kind: "attach", workflowPath: first };
	}
	if (first === "start" || first === "stop" || first === "check") {
		const workflowPath = positional(first, rest);
		return workflowPath === undefined
			? { kind: first }
			: { kind: first, workflowPath };
	}
	if (first === "web") return parseWeb(rest);
	if (first === "docs") return parseDocs(rest);
	if (first === "auth") return parseAuth(rest);
	const search = positional("models", rest);
	return search === undefined ? { kind: "models" } : { kind: "models", search };
};
