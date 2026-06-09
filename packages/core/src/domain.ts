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

export const RunId = IdentifierText.pipe(Schema.brand("RunId"));
export type RunId = typeof RunId.Type;
export const runId = (value: string): RunId =>
	Schema.decodeUnknownSync(RunId)(value);

export const LoopPhase = Schema.Literals([
	"setup",
	"observe",
	"reconcile",
	"act",
	"policy",
]);
export type LoopPhase = typeof LoopPhase.Type;

export const HookPhase = LoopPhase.pick(["observe", "reconcile", "act"]);
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

export const RemoveFactProposal = Schema.Struct({
	type: Schema.Literal("remove_fact"),
	key: Schema.String,
});
export type RemoveFactProposal = typeof RemoveFactProposal.Type;

export const ReconcileProposal = Schema.Union([
	SetFactProposal,
	RemoveFactProposal,
]);
export type ReconcileProposal = typeof ReconcileProposal.Type;

export const PluginRun = Schema.Struct({
	runId: RunId,
	pluginId: PluginId,
});
export type PluginRun = typeof PluginRun.Type;

export const PluginActResult = Schema.Union([
	Schema.Struct({
		type: Schema.Literal("idle"),
	}),
	Schema.Struct({
		type: Schema.Literal("completed"),
		subject: Schema.optionalKey(SubjectKey),
		output: Schema.optionalKey(Schema.Unknown),
	}),
]);
export type PluginActResult = typeof PluginActResult.Type;

export const CompletionStatus = Schema.Literals(["succeeded", "failed"]);
export type CompletionStatus = typeof CompletionStatus.Type;

export const Completion = Schema.Struct({
	runId: RunId,
	pluginId: PluginId,
	status: CompletionStatus,
	subject: Schema.optionalKey(SubjectKey),
	output: Schema.optionalKey(Schema.Unknown),
	error: Schema.optionalKey(Schema.String),
});
export type Completion = typeof Completion.Type;

export const Diagnostic = Schema.Struct({
	level: Schema.Literals(["info", "warning", "error"]),
	phase: Schema.Union([HookPhase, Schema.Literals(["policy"])]),
	message: Schema.String,
	pluginId: Schema.optionalKey(PluginId),
	runId: Schema.optionalKey(RunId),
});
export type Diagnostic = typeof Diagnostic.Type;

export const RuntimeSnapshot = Schema.Struct({
	tickId: TickId,
	facts: Schema.ReadonlyMap(Schema.String, Schema.Unknown),
	observations: Schema.Array(Observation),
	completions: Schema.Array(Completion),
	diagnostics: Schema.Array(Diagnostic),
	running: Schema.ReadonlyMap(PluginId, RunId),
});
export type RuntimeSnapshot = typeof RuntimeSnapshot.Type;

export const TickResult = Schema.Struct({
	tickId: TickId,
	observations: Schema.Array(Observation),
	proposals: Schema.Array(ReconcileProposal),
	started: Schema.Array(PluginRun),
	completions: Schema.Array(Completion),
	diagnostics: Schema.Array(Diagnostic),
	snapshot: RuntimeSnapshot,
});
export type TickResult = typeof TickResult.Type;

const RunFinished = Schema.Struct({
	type: Schema.Literal("run_finished"),
	run: PluginRun,
	completion: Schema.optionalKey(Completion),
});

export const OrchestratorMessage = Schema.Union([
	Schema.Struct({
		type: Schema.Literal("tick"),
	}),
	Schema.Struct({
		type: Schema.Literal("observation"),
		observation: Observation,
	}),
	Schema.Struct({
		type: Schema.Literal("completion"),
		completion: Completion,
	}),
	RunFinished,
	Schema.Struct({
		type: Schema.Literal("shutdown"),
	}),
]);
export type OrchestratorMessage = typeof OrchestratorMessage.Type;
