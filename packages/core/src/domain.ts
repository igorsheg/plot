import { Schema } from "effect";

const IdentifierText = Schema.NonEmptyString.pipe(
	Schema.check(Schema.isPattern(/^[A-Za-z0-9._:-]+$/)),
);
const NonNegativeInt = Schema.Number.pipe(
	Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
);

export const PositiveInt = Schema.Number.pipe(
	Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
	Schema.brand("PositiveInt"),
);
export type PositiveInt = typeof PositiveInt.Type;
export const positiveInt = (value: number): PositiveInt =>
	Schema.decodeUnknownSync(PositiveInt)(value);

export const TickId = NonNegativeInt.pipe(Schema.brand("TickId"));
export type TickId = typeof TickId.Type;
export const tickId = (value: number): TickId =>
	Schema.decodeUnknownSync(TickId)(value);

export const PluginId = IdentifierText.pipe(Schema.brand("PluginId"));
export type PluginId = typeof PluginId.Type;
export const pluginId = (value: string): PluginId =>
	Schema.decodeUnknownSync(PluginId)(value);

export const SubjectKey = Schema.NonEmptyString.pipe(
	Schema.brand("SubjectKey"),
);
export type SubjectKey = typeof SubjectKey.Type;
export const subjectKey = (value: string): SubjectKey =>
	Schema.decodeUnknownSync(SubjectKey)(value);

export const WorkKey = Schema.NonEmptyString.pipe(Schema.brand("WorkKey"));
export type WorkKey = typeof WorkKey.Type;
export const workKey = (value: string): WorkKey =>
	Schema.decodeUnknownSync(WorkKey)(value);

export const RunId = IdentifierText.pipe(Schema.brand("RunId"));
export type RunId = typeof RunId.Type;
export const runId = (value: string): RunId =>
	Schema.decodeUnknownSync(RunId)(value);

export const LoopPhase = Schema.Literals([
	"setup",
	"observe",
	"reconcile",
	"select",
	"act",
	"policy",
]);
export type LoopPhase = typeof LoopPhase.Type;

export const HookPhase = LoopPhase.pick(["observe", "reconcile", "select"]);
export type HookPhase = typeof HookPhase.Type;

export class PlotLoopError extends Schema.TaggedErrorClass<PlotLoopError>()(
	"PlotLoopError",
	{
		phase: LoopPhase,
		message: Schema.String,
		plugin_id: Schema.optionalKey(PluginId),
	},
) {}

export const Observation = Schema.Struct({
	type: Schema.String,
	subject: Schema.optionalKey(SubjectKey),
	data: Schema.optionalKey(Schema.Unknown),
});
export type Observation = typeof Observation.Type;

export const SetFactProposal = Schema.Struct({
	type: Schema.Literal("set_fact"),
	key: Schema.String,
	value: Schema.Unknown,
});
export type SetFactProposal = typeof SetFactProposal.Type;
export const setFact = (key: string, value: unknown): SetFactProposal => ({
	type: "set_fact",
	key,
	value,
});

export const RemoveFactProposal = Schema.Struct({
	type: Schema.Literal("remove_fact"),
	key: Schema.String,
});
export type RemoveFactProposal = typeof RemoveFactProposal.Type;
export const removeFact = (key: string): RemoveFactProposal => ({
	type: "remove_fact",
	key,
});

export const ReconcileProposal = Schema.Union([
	SetFactProposal,
	RemoveFactProposal,
]);
export type ReconcileProposal = typeof ReconcileProposal.Type;

export const WorkItem = Schema.Struct({
	workKey: WorkKey,
	subject: Schema.optionalKey(SubjectKey),
	templateContext: Schema.optionalKey(Schema.Unknown),
});
export type WorkItem = typeof WorkItem.Type;

export const WorkRun = Schema.Struct({
	runId: RunId,
	pluginId: PluginId,
	workKey: WorkKey,
	subject: Schema.optionalKey(SubjectKey),
});
export type WorkRun = typeof WorkRun.Type;

export const WorkResult = Schema.Struct({
	output: Schema.optionalKey(Schema.Unknown),
});
export type WorkResult = typeof WorkResult.Type;

export const CompletionStatus = Schema.Literals(["succeeded", "failed"]);
export type CompletionStatus = typeof CompletionStatus.Type;

export const Completion = Schema.Struct({
	runId: RunId,
	pluginId: PluginId,
	workKey: WorkKey,
	status: CompletionStatus,
	subject: Schema.optionalKey(SubjectKey),
	output: Schema.optionalKey(Schema.Unknown),
	error: Schema.optionalKey(Schema.String),
});
export type Completion = typeof Completion.Type;

export const Diagnostic = Schema.Struct({
	level: Schema.Literals(["info", "warning", "error"]),
	phase: Schema.Union([HookPhase, Schema.Literals(["act", "policy"])]),
	message: Schema.String,
	pluginId: Schema.optionalKey(PluginId),
	runId: Schema.optionalKey(RunId),
	workKey: Schema.optionalKey(WorkKey),
});
export type Diagnostic = typeof Diagnostic.Type;

export const RuntimeSnapshot = Schema.Struct({
	tickId: TickId,
	facts: Schema.ReadonlyMap(Schema.String, Schema.Unknown),
	observations: Schema.Array(Observation),
	completions: Schema.Array(Completion),
	diagnostics: Schema.Array(Diagnostic),
	running: Schema.ReadonlyMap(WorkKey, WorkRun),
	finished: Schema.ReadonlyMap(WorkKey, Completion),
});
export type RuntimeSnapshot = typeof RuntimeSnapshot.Type;

export const TickResult = Schema.Struct({
	tickId: TickId,
	observations: Schema.Array(Observation),
	proposals: Schema.Array(ReconcileProposal),
	selected: Schema.Array(WorkItem),
	started: Schema.Array(WorkRun),
	completions: Schema.Array(Completion),
	diagnostics: Schema.Array(Diagnostic),
	snapshot: RuntimeSnapshot,
});
export type TickResult = typeof TickResult.Type;

export const OrchestratorMessage = Schema.Union([
	Schema.Struct({
		type: Schema.Literal("tick"),
	}),
	Schema.Struct({
		type: Schema.Literal("observation"),
		observation: Observation,
	}),
	Schema.Struct({
		type: Schema.Literal("shutdown"),
	}),
]);
export type OrchestratorMessage = typeof OrchestratorMessage.Type;
