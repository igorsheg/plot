#!/usr/bin/env bun
import { Effect } from "effect";
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { runPlotCli } from "./cli.js";

runPlotCli(process.argv.slice(2)).pipe(
	Effect.provide(BunServices.layer),
	BunRuntime.runMain({ disableErrorReporting: false }),
);
