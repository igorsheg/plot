import type {
	AgentSessionEvent as PiAgentSessionEvent,
	CreateAgentSessionOptions as PiCreateAgentSessionOptions,
	CreateAgentSessionResult as PiCreateAgentSessionResult,
	PromptOptions as PiPromptOptions,
} from "@earendil-works/pi-coding-agent";

export type AgentSessionEvent = PiAgentSessionEvent;
export type CreateAgentSessionOptions = PiCreateAgentSessionOptions;
export type CreateAgentSessionResult = PiCreateAgentSessionResult;
export type PromptOptions = PiPromptOptions;

export type CreateAgentSession = (
	options?: CreateAgentSessionOptions,
) => Promise<CreateAgentSessionResult>;
