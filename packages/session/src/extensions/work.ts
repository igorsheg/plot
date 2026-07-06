import { isAbsolute } from "node:path";
import type { WorkRecord } from "@plot/agent/model";
import type { OperatorAction, WorkDisplay } from "@plot/sdk";
import { errorMessage, isRecord } from "@plot/common/primitives";
import { Schema } from "effect";
import type { PlotExtension, PlotExtensionWork } from "@plot/sdk";
import type { WorkflowDefinition } from "../workflow.js";
import { PlotExtensionSourceError } from "./errors.js";
import { NonEmptyString, decodeBoundary, optional } from "../schema.js";

const displaySchema = Schema.Struct({
	kind: optional(Schema.String),
	primary: optional(Schema.String),
	title: optional(Schema.String),
	subtitle: optional(Schema.String),
	url: optional(Schema.String),
	version: optional(Schema.String),
	labels: optional(Schema.Array(Schema.String)),
});

const operatorActionSchema = Schema.Struct({
	id: NonEmptyString,
	label: NonEmptyString,
	tone: optional(Schema.Literals(["primary", "secondary", "danger"])),
	disabledReason: optional(Schema.String),
	requiresComment: optional(Schema.Boolean),
	confirm: optional(
		Schema.Struct({ title: NonEmptyString, message: optional(Schema.String) }),
	),
});

export const extensionWorkSchema = Schema.Struct({
	id: NonEmptyString,
	version: optional(Schema.String),
	title: optional(Schema.String),
	url: optional(Schema.String),
	subject: optional(Schema.String),
	status: optional(
		Schema.Literals(["pending", "waiting", "blocked", "cancelled"]),
	),
	blockedReason: optional(Schema.String),
	workspace: optional(NonEmptyString),
	display: optional(displaySchema),
	operatorActions: optional(Schema.Array(operatorActionSchema)),
	context: optional(Schema.Unknown),
});

const extensionWorkListSchema = Schema.Array(extensionWorkSchema);
type ParsedExtensionWork = typeof extensionWorkSchema.Type;
type ParsedDisplay = typeof displaySchema.Type;
type ParsedOperatorAction = typeof operatorActionSchema.Type;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const cleanDisplay = (
	display: ParsedDisplay,
): NonNullable<PlotExtensionWork["display"]> => {
	const clean: Mutable<NonNullable<PlotExtensionWork["display"]>> = {};
	for (const key of [
		"kind",
		"primary",
		"title",
		"subtitle",
		"url",
		"version",
	] as const) {
		const value = display[key];
		if (value !== undefined) clean[key] = value;
	}
	if (display.labels !== undefined) clean.labels = display.labels;
	return clean;
};

const cleanOperatorAction = (
	action: ParsedOperatorAction,
): NonNullable<PlotExtensionWork["operatorActions"]>[number] => {
	const clean: Mutable<
		NonNullable<PlotExtensionWork["operatorActions"]>[number]
	> = {
		id: action.id,
		label: action.label,
	};
	if (action.tone !== undefined) clean.tone = action.tone;
	if (action.disabledReason !== undefined)
		clean.disabledReason = action.disabledReason;
	if (action.requiresComment !== undefined)
		clean.requiresComment = action.requiresComment;
	if (action.confirm !== undefined) {
		const confirm: Mutable<NonNullable<typeof clean.confirm>> = {
			title: action.confirm.title,
		};
		if (action.confirm.message !== undefined)
			confirm.message = action.confirm.message;
		clean.confirm = confirm;
	}
	return clean;
};

export const cleanWork = (work: ParsedExtensionWork): PlotExtensionWork => {
	const clean: Mutable<PlotExtensionWork> = { id: work.id };
	for (const key of [
		"version",
		"title",
		"url",
		"subject",
		"blockedReason",
		"workspace",
	] as const) {
		const value = work[key];
		if (value !== undefined) clean[key] = value;
	}
	if (work.workspace !== undefined && !isAbsolute(work.workspace))
		throw new Error(
			`work ${work.id} workspace must be an absolute path: ${work.workspace}`,
		);
	if (work.status !== undefined) clean.status = work.status;
	if (work.display !== undefined) clean.display = cleanDisplay(work.display);
	if (work.operatorActions !== undefined)
		clean.operatorActions = work.operatorActions.map(cleanOperatorAction);
	if (work.context !== undefined) clean.context = work.context;
	return clean;
};

const sanitizeIdentifier = (value: string): string => {
	const sanitized = value.replace(/[^A-Za-z0-9._:-]/g, "_");
	return sanitized.length === 0 ? "extension" : sanitized;
};

export const sourceIdForExtension = (extension: PlotExtension): string =>
	`extension:${sanitizeIdentifier(extension.id)}`;

export const workKeyForExtensionWork = (
	extension: PlotExtension,
	work: PlotExtensionWork,
): string =>
	`extension:${extension.id}:${work.id}:${work.version ?? "unversioned"}`;

export const discoveredFactKey = (source: string) =>
	`extension.discovered:${source}`;
export const releasedReason = (source: string) =>
	`work is no longer discovered by source ${source}`;
export const cancelledReason = (source: string) =>
	`work was cancelled by source ${source}`;
export const isBlocked = (work: PlotExtensionWork) => work.status === "blocked";
export const isWaiting = (work: PlotExtensionWork) => work.status === "waiting";
export const isHeld = (work: PlotExtensionWork) =>
	isBlocked(work) || isWaiting(work);
export const isCancelled = (work: PlotExtensionWork) =>
	work.status === "cancelled";
export const toSubject = (work: PlotExtensionWork) => work.subject ?? work.id;

export const decodeDiscoveredWorks = (
	value: unknown,
	source: string | undefined,
): readonly PlotExtensionWork[] => {
	try {
		return decodeBoundary(extensionWorkListSchema, value).map(cleanWork);
	} catch (error) {
		throw new PlotExtensionSourceError({
			phase: "discover",
			message: errorMessage(error),
			...(source === undefined ? {} : { source }),
		});
	}
};

export const decodeStoredWorks = (
	value: unknown,
): readonly PlotExtensionWork[] =>
	value === undefined ? [] : decodeDiscoveredWorks(value, undefined);

export const agentDisplayFor = (
	display: NonNullable<PlotExtensionWork["display"]>,
): WorkDisplay => {
	const clean: Mutable<WorkDisplay> = {};
	if (display.kind !== undefined) clean.kind = display.kind;
	if (display.primary !== undefined) clean.primary = display.primary;
	if (display.title !== undefined) clean.title = display.title;
	if (display.subtitle !== undefined) clean.subtitle = display.subtitle;
	if (display.url !== undefined) clean.url = display.url;
	if (display.version !== undefined) clean.version = display.version;
	if (display.labels !== undefined) clean.labels = [...display.labels];
	return clean;
};

export const agentOperatorActionsFor = (
	actions: NonNullable<PlotExtensionWork["operatorActions"]>,
): OperatorAction[] =>
	actions.map((action) => {
		const clean: Mutable<OperatorAction> = {
			id: action.id,
			label: action.label,
		};
		if (action.tone !== undefined) clean.tone = action.tone;
		if (action.disabledReason !== undefined)
			clean.disabledReason = action.disabledReason;
		if (action.requiresComment !== undefined)
			clean.requiresComment = action.requiresComment;
		if (action.confirm !== undefined) {
			const confirm: Mutable<NonNullable<OperatorAction["confirm"]>> = {
				title: action.confirm.title,
			};
			if (action.confirm.message !== undefined)
				confirm.message = action.confirm.message;
			clean.confirm = confirm;
		}
		return clean;
	});

export const workRecordFor = (
	extension: PlotExtension,
	source: string,
	work: PlotExtensionWork,
	status: WorkRecord["status"],
	currentRunId?: string,
): WorkRecord => {
	const record: Mutable<WorkRecord> = {
		workKey: workKeyForExtensionWork(extension, work),
		sourceId: source,
		status,
		subject: toSubject(work),
	};
	if (work.display !== undefined)
		record.display = agentDisplayFor(work.display);
	if (work.blockedReason !== undefined)
		record.blockedReason = work.blockedReason;
	if (work.operatorActions !== undefined)
		record.operatorActions = agentOperatorActionsFor(work.operatorActions);
	if (currentRunId !== undefined) record.currentRunId = currentRunId;
	return record;
};

export const currentWorkKeys = (
	extension: PlotExtension,
	works: readonly PlotExtensionWork[],
): ReadonlySet<string> =>
	new Set(works.map((work) => workKeyForExtensionWork(extension, work)));

export const templateContextForWork = (
	workflow: WorkflowDefinition,
	work: PlotExtensionWork,
) => {
	const metadata: Record<string, unknown> & { readonly id: string } = {
		id: work.id,
	};
	for (const key of [
		"version",
		"title",
		"url",
		"subject",
		"workspace",
	] as const) {
		const value = work[key];
		if (value !== undefined) metadata[key] = value;
	}
	if (work.display !== undefined) metadata["display"] = work.display;
	if (work.operatorActions !== undefined)
		metadata["operatorActions"] = work.operatorActions;
	const base = { workflow: workflow.config, work: metadata };
	if (work.context === undefined) return base;
	if (isRecord(work.context)) return { ...base, ...work.context };
	return { ...base, value: work.context };
};
