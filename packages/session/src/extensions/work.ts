import {
	sourceId,
	subjectKey,
	workKey,
	type SourceId,
	type WorkKey,
	type WorkRecord,
} from "@plot/agent/model";
import { errorMessage, isRecord } from "@plot/common/primitives";
import { z } from "zod";
import type { PlotExtension, PlotExtensionWork } from "../sdk.js";
import type { WorkflowDefinition } from "../workflow.js";
import { PlotExtensionSourceError } from "./errors.js";

const displaySchema = z
	.object({
		kind: z.string().optional(),
		primary: z.string().optional(),
		title: z.string().optional(),
		subtitle: z.string().optional(),
		url: z.string().optional(),
		version: z.string().optional(),
		labels: z.array(z.string()).optional(),
	})
	.strict();

const operatorActionSchema = z
	.object({
		id: z.string().min(1),
		label: z.string().min(1),
		tone: z.enum(["primary", "secondary", "danger"]).optional(),
		disabledReason: z.string().optional(),
		requiresComment: z.boolean().optional(),
		confirm: z
			.object({ title: z.string().min(1), message: z.string().optional() })
			.strict()
			.optional(),
	})
	.strict();

export const extensionWorkSchema = z
	.object({
		id: z.string().min(1),
		version: z.string().optional(),
		title: z.string().optional(),
		url: z.string().optional(),
		subject: z.string().optional(),
		status: z.enum(["pending", "blocked"]).optional(),
		blockedReason: z.string().optional(),
		display: displaySchema.optional(),
		operatorActions: z.array(operatorActionSchema).optional(),
		context: z.unknown().optional(),
	})
	.strict();

const extensionWorkListSchema = z.array(extensionWorkSchema);
type ParsedExtensionWork = z.infer<typeof extensionWorkSchema>;
type ParsedDisplay = z.infer<typeof displaySchema>;
type ParsedOperatorAction = z.infer<typeof operatorActionSchema>;
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
	] as const) {
		const value = work[key];
		if (value !== undefined) clean[key] = value;
	}
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

export const sourceIdForExtension = (extension: PlotExtension): SourceId =>
	sourceId(`extension:${sanitizeIdentifier(extension.id)}`);

export const workKeyForExtensionWork = (
	extension: PlotExtension,
	work: PlotExtensionWork,
): WorkKey =>
	workKey(
		`extension:${extension.id}:${work.id}:${work.version ?? "unversioned"}`,
	);

export const discoveredFactKey = (source: SourceId) =>
	`extension.discovered:${source}`;
export const releasedReason = (source: SourceId) =>
	`work is no longer discovered by source ${source}`;
export const isBlocked = (work: PlotExtensionWork) => work.status === "blocked";
export const toSubject = (work: PlotExtensionWork) =>
	subjectKey(work.subject ?? work.id);

export const decodeDiscoveredWorks = (
	value: unknown,
	source: string | undefined,
): readonly PlotExtensionWork[] => {
	try {
		return extensionWorkListSchema.parse(value).map(cleanWork);
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

export const workRecordFor = (
	extension: PlotExtension,
	source: SourceId,
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
	if (work.display !== undefined) record.display = work.display;
	if (work.blockedReason !== undefined)
		record.blockedReason = work.blockedReason;
	if (work.operatorActions !== undefined)
		record.operatorActions = work.operatorActions;
	if (currentRunId !== undefined) record.currentRunId = currentRunId;
	return record;
};

export const currentWorkKeys = (
	extension: PlotExtension,
	works: readonly PlotExtensionWork[],
): ReadonlySet<WorkKey> =>
	new Set(works.map((work) => workKeyForExtensionWork(extension, work)));

export const templateContextForWork = (
	workflow: WorkflowDefinition,
	work: PlotExtensionWork,
) => {
	const metadata: Record<string, unknown> & { readonly id: string } = {
		id: work.id,
	};
	for (const key of ["version", "title", "url", "subject"] as const) {
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
