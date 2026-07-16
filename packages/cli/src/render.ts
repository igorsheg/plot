import { BoundaryError } from "@plot/common/boundary-error";
import { errorMessage } from "@plot/common/primitives";
import type { CheckedWorkflow } from "@plot/session/preparation";
import type { AuthStatusInfo, ModelInfo } from "@plot/session/auth";
import type { StartSessionResult } from "@plot/session-manager/manager";
import type { SessionStatus } from "./status.js";

const formatTokenCount = (count: number): string => {
	const scaled =
		count >= 1_000_000
			? count / 1_000_000
			: count >= 1_000
				? count / 1_000
				: count;
	const unit = count >= 1_000_000 ? "M" : count >= 1_000 ? "K" : "";
	const text = Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(1);
	return `${text}${unit}`;
};

const pad = (value: string, width: number): string =>
	value.length >= width ? value : value + " ".repeat(width - value.length);

const table = (rows: readonly (readonly string[])[]): string => {
	const widths = rows[0]?.map((_, column) =>
		Math.max(...rows.map((row) => (row[column] ?? "").length)),
	);
	return rows
		.map((row) =>
			row
				.map((cell, column) => pad(cell, widths?.[column] ?? cell.length))
				.join("  ")
				.trimEnd(),
		)
		.join("\n");
};

export const renderModels = (
	search: string | undefined,
	models: readonly ModelInfo[],
) =>
	models.length === 0
		? search === undefined
			? "No models available. Configure provider auth and try again.\n"
			: `No models matching "${search}"\n`
		: `${table([
				["provider", "model", "context", "max-out", "thinking", "images"],
				...models.map((m) => [
					m.provider,
					m.model,
					formatTokenCount(m.context),
					formatTokenCount(m.maxOutput),
					m.thinking ? "yes" : "no",
					m.images ? "yes" : "no",
				]),
			])}\n`;

export const renderAuthStatus = (statuses: readonly AuthStatusInfo[]) =>
	statuses.length === 0
		? "No auth providers found.\n"
		: `${table([
				["provider", "configured", "source", "label"],
				...statuses.map((s) => [
					s.provider,
					s.configured ? "yes" : "no",
					s.source ?? "",
					s.label ?? "",
				]),
			])}\n`;

export const shellArgument = (value: string): string =>
	process.platform === "win32"
		? JSON.stringify(value)
		: `'${value.replaceAll("'", `'\\''`)}'`;

const attachCommand = (workflowPath: string): string =>
	`plot ${shellArgument(workflowPath)}`;
const startCommand = (workflowPath: string): string =>
	`plot start ${shellArgument(workflowPath)}`;
const stopCommand = (workflowPath: string): string =>
	`plot stop ${shellArgument(workflowPath)}`;

export const renderStartResult = (result: StartSessionResult): string => {
	const verb = result.started ? "Started" : "Already running";
	return `${verb} ${result.session.workflowName} in the background.\n\nAttach: ${attachCommand(result.session.workflowPath)}\nStop:   ${stopCommand(result.session.workflowPath)}\nFleet:  plot web\n`;
};

export const renderReadiness = (checked: CheckedWorkflow): string => {
	const lines = [
		`OK Workflow ${checked.workflowName}`,
		`   ${checked.workflowPath}`,
		`OK Extension ${checked.source.label}`,
		`OK Agent ${checked.agent.provider}/${checked.agent.model}`,
	];
	let actionRequired = false;
	let unavailable = false;
	for (const requirement of checked.source.requirements) {
		if (requirement.status === "ready") continue;
		const prefix =
			requirement.status === "action-required" ? "NEEDS YOU" : "WAIT";
		const message =
			"message" in requirement ? requirement.message : requirement.status;
		lines.push(`${prefix} ${requirement.label}: ${message}`);
		actionRequired ||= requirement.status === "action-required";
		unavailable ||= requirement.status === "unavailable";
	}
	const readiness = actionRequired
		? "Ready; setup continues in the dashboard."
		: unavailable
			? "Ready; Plot will retry the unavailable Source."
			: "Ready.";
	return `${lines.join("\n")}\n\n${readiness}\nRun: ${attachCommand(checked.workflowPath)}\n`;
};

const formatAge = (atMs: number | undefined, nowMs: number): string => {
	if (atMs === undefined) return "never";
	const seconds = Math.max(0, Math.floor((nowMs - atMs) / 1000));
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
};

const attention = (status: SessionStatus): string =>
	status.needsYou === 0
		? "—"
		: status.needsYou === 1
			? "needs you"
			: `needs you (${status.needsYou})`;

export const renderSessionStatus = (
	status: SessionStatus,
	nowMs = Date.now(),
): string => {
	const session = status.session;
	const heading = `${session.workflowName}  ${session.state.toUpperCase()}${status.needsYou > 0 ? " · NEEDS YOU" : ""}`;
	const activity = `${status.active} active · ${status.waiting} waiting · ${status.pending} pending · last tick ${formatAge(status.lastTickAtMs, nowMs)}`;
	return `${heading}\n${activity}\n\nAttach: ${attachCommand(session.workflowPath)}\nStop:   ${stopCommand(session.workflowPath)}\nFleet:  plot web\n`;
};

export const renderSessionStatuses = (
	statuses: readonly SessionStatus[],
	nowMs = Date.now(),
): string => {
	if (statuses.length === 0)
		return "No active Workflows.\nStart one: plot start WORKFLOW.md\n";
	return `${table([
		[
			"workflow",
			"state",
			"attention",
			"active",
			"waiting",
			"pending",
			"last-tick",
			"path",
		],
		...statuses.map((status) => [
			status.session.workflowName,
			status.session.state,
			attention(status),
			String(status.active),
			String(status.waiting),
			String(status.pending),
			formatAge(status.lastTickAtMs, nowMs),
			status.session.workflowPath,
		]),
	])}\n\nFleet: plot web\n`;
};

export const renderInactiveStatus = (workflowPath: string): string =>
	`${workflowPath} is not running.\nStart: ${startCommand(workflowPath)}\n`;

const errorHint = (error: unknown, usage: boolean): string | undefined => {
	if (usage) return "Run: plot --help";
	if (!(error instanceof BoundaryError)) return;
	if (
		error.code === "provider_not_authenticated" &&
		typeof error.context["provider"] === "string"
	)
		return `Try: plot auth login ${shellArgument(error.context["provider"])}`;
	if (
		error.code === "model_not_found" &&
		typeof error.context["model"] === "string"
	)
		return `Try: plot models ${shellArgument(error.context["model"])}`;
	if (error.code !== "workflow_invalid") return;
	if (error.context["phase"] === "read") return "Read: plot docs quickstart";
	if (error.context["phase"] === "parse") return "Read: plot docs workflows";
	if (error.context["phase"] === "prepare") return "Read: plot docs extensions";
	return;
};

export const renderCliError = (error: unknown, usage = false): string => {
	const hint = errorHint(error, usage);
	return `Error: ${errorMessage(error)}\n${hint === undefined ? "" : `${hint}\n`}`;
};
