import { Schema } from "effect";

export const PluginId = Schema.String.pipe(Schema.brand("PluginId"));
export type PluginId = typeof PluginId.Type;
export const pluginId = (value: string): PluginId =>
	Schema.decodeUnknownSync(PluginId)(value);

export const CapabilityId = Schema.String.pipe(Schema.brand("CapabilityId"));
export type CapabilityId = typeof CapabilityId.Type;
export const capabilityId = (value: string): CapabilityId =>
	Schema.decodeUnknownSync(CapabilityId)(value);

export const SubjectKey = Schema.String.pipe(Schema.brand("SubjectKey"));
export type SubjectKey = typeof SubjectKey.Type;
export const subjectKey = (value: string): SubjectKey =>
	Schema.decodeUnknownSync(SubjectKey)(value);

export const ActionId = Schema.String.pipe(Schema.brand("ActionId"));
export type ActionId = typeof ActionId.Type;
export const actionId = (value: string): ActionId =>
	Schema.decodeUnknownSync(ActionId)(value);

export const IdempotencyKey = Schema.String.pipe(
	Schema.brand("IdempotencyKey"),
);
export type IdempotencyKey = typeof IdempotencyKey.Type;
export const idempotencyKey = (value: string): IdempotencyKey =>
	Schema.decodeUnknownSync(IdempotencyKey)(value);

export const HookPhase = Schema.Literals([
	"observe",
	"reconcile",
	"plan",
	"capability",
]);
export type HookPhase = typeof HookPhase.Type;

export class PlotLoopError extends Schema.TaggedErrorClass<PlotLoopError>()(
	"PlotLoopError",
	{
		phase: HookPhase,
		message: Schema.String,
		plugin_id: Schema.optionalKey(PluginId),
		capability_id: Schema.optionalKey(CapabilityId),
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

export const ActionRequest = Schema.Struct({
	capability: CapabilityId,
	input: Schema.Unknown,
	subject: Schema.optionalKey(SubjectKey),
	reason: Schema.optionalKey(Schema.String),
	priority: Schema.optionalKey(Schema.Number),
	idempotencyKey: Schema.optionalKey(IdempotencyKey),
});
export type ActionRequest = typeof ActionRequest.Type;

export const AdmittedAction = Schema.Struct({
	...ActionRequest.fields,
	actionId: ActionId,
	pluginId: PluginId,
});
export type AdmittedAction = typeof AdmittedAction.Type;

export const CompletionStatus = Schema.Literals([
	"succeeded",
	"failed",
	"rejected",
]);
export type CompletionStatus = typeof CompletionStatus.Type;

export const Completion = Schema.Struct({
	actionId: ActionId,
	pluginId: PluginId,
	capabilityId: CapabilityId,
	status: CompletionStatus,
	subject: Schema.optionalKey(SubjectKey),
	output: Schema.optionalKey(Schema.Unknown),
	error: Schema.optionalKey(Schema.String),
});
export type Completion = typeof Completion.Type;

export const Diagnostic = Schema.Struct({
	level: Schema.Literals(["info", "warning", "error"]),
	phase: Schema.Union([HookPhase, Schema.Literals(["admit", "policy"])]),
	message: Schema.String,
	pluginId: Schema.optionalKey(PluginId),
	capabilityId: Schema.optionalKey(CapabilityId),
	actionId: Schema.optionalKey(ActionId),
});
export type Diagnostic = typeof Diagnostic.Type;

export const RuntimeSnapshot = Schema.Struct({
	tickId: Schema.Number,
	facts: Schema.ReadonlyMap(Schema.String, Schema.Unknown),
	observations: Schema.Array(Observation),
	completions: Schema.Array(Completion),
	diagnostics: Schema.Array(Diagnostic),
	actionLedger: Schema.ReadonlyMap(IdempotencyKey, ActionId),
});
export type RuntimeSnapshot = typeof RuntimeSnapshot.Type;

export const PluginManifest = Schema.Struct({
	uses: Schema.optionalKey(Schema.Array(CapabilityId)),
});
export type PluginManifest = typeof PluginManifest.Type;

export const TickResult = Schema.Struct({
	tickId: Schema.Number,
	observations: Schema.Array(Observation),
	proposals: Schema.Array(ReconcileProposal),
	planned: Schema.Array(ActionRequest),
	admitted: Schema.Array(AdmittedAction),
	completions: Schema.Array(Completion),
	diagnostics: Schema.Array(Diagnostic),
	snapshot: RuntimeSnapshot,
});
export type TickResult = typeof TickResult.Type;

export const OrchestratorMessage = Schema.Union([
	Schema.Struct({
		type: Schema.Literal("observation"),
		observation: Observation,
	}),
	Schema.Struct({
		type: Schema.Literal("completion"),
		completion: Completion,
	}),
]);
export type OrchestratorMessage = typeof OrchestratorMessage.Type;
