import { isRecord } from "@plot/common/primitives";
import { str } from "./helpers.js";
import type { WorkItemProjection, WorkStatus } from "./types.js";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const display = (v: unknown) => (isRecord(v) ? v : {});

export const displayWork = (
	work: Record<string, unknown>,
	previous?: WorkItemProjection,
): WorkItemProjection => {
	const d = display(work["display"]);
	const key = String(work["workKey"] ?? previous?.workKey ?? "work");
	const item: Mutable<WorkItemProjection> = {
		workKey: key,
		sourceId: String(work["sourceId"] ?? previous?.sourceId ?? "source"),
		primary: str(d["primary"]) ?? previous?.primary,
		title: str(d["title"]) ?? str(work["title"]) ?? previous?.title ?? key,
		labels: Array.isArray(d["labels"])
			? d["labels"].filter((x): x is string => typeof x === "string")
			: (previous?.labels ?? []),
		status:
			(str(work["status"]) as WorkStatus | undefined) ??
			previous?.status ??
			"pending",
	};
	const subject = str(work["subject"]);
	const subtitle = str(d["subtitle"]);
	const url = str(d["url"]);
	const version = str(d["version"]);
	const blockedReason = str(work["blockedReason"]);
	const currentRunId = str(work["currentRunId"]) ?? previous?.currentRunId;
	if (subject !== undefined) item.subject = subject;
	if (subtitle !== undefined) item.subtitle = subtitle;
	if (url !== undefined) item.url = url;
	if (version !== undefined) item.version = version;
	if (blockedReason !== undefined) item.blockedReason = blockedReason;
	if (Array.isArray(work["operatorActions"]))
		item.operatorActions = work["operatorActions"];
	else if (previous?.operatorActions !== undefined)
		item.operatorActions = previous.operatorActions;
	if (currentRunId !== undefined) item.currentRunId = currentRunId;
	return item;
};

export const workLabel = (work: {
	readonly primary?: string | undefined;
	readonly title: string;
}) =>
	work.primary === undefined ? work.title : `${work.primary} ${work.title}`;
