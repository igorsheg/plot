import type { ParsedArgs } from "citty";
import { createSessionAuth } from "@plot/session/auth";

export const str = (
	args: Record<string, unknown>,
	name: string,
): string | undefined =>
	typeof args[name] === "string" ? (args[name] as string) : undefined;

export const workflowPathFromArgs = (args: ParsedArgs): string | undefined =>
	str(args, "workflowPath");

export const makeAuth = () => createSessionAuth({ cwd: process.cwd() });
