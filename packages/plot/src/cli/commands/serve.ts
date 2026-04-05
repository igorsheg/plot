import { Command } from "effect/unstable/cli";
import { Effect } from "effect";
import { runRpcMain } from "../../rpc-main.js";

export const ServeCommand = Command.make(
	"serve",
	{},
	Effect.fn(function* () {
		yield* Effect.promise(() => runRpcMain());
	}),
).pipe(Command.withDescription("run the orchestrator headless (JSON-RPC on stdin/stdout)"));
