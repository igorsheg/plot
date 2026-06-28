# Plot

Plot is a control plane for long-running coding-agent work. Its language distinguishes durable work definitions from live fleet-managed sessions so operators can reason about a fleet clearly.

## Product principle

Plot should make agents cheaper and better by shaping context and ownership, not by micromanaging reasoning. Plot owns the outer loop (`tick -> reconcile -> act`), Sources own domain observation and compact Work Item context, tools own trusted side effects, and Agent Runs own investigation and judgment.

## Language

**Workflow**:
A durable definition of what work to look for and how an agent should handle it. Running a Workflow creates a Plot Session.
_Avoid_: Plot instance, workflow instance, session

**Plot Session**:
A live fleet-managed run of a Workflow. It is the unit operators see and control in fleet views.
_Avoid_: Workflow, plot instance, run

**Work Item**:
A unit of work discovered by a source and selected by Plot for possible agent execution.
_Avoid_: Task, job, issue

**Agent Run**:
One attempt by an agent to handle a Work Item during a Plot Session. It is Plot's only first-class agent execution unit.
_Avoid_: Run, session, task, subagent

**Process Table**:
The per-Plot Session operator view organized around Work Items and their current or most recent Agent Run.
_Avoid_: Run table, log view, vital sign

**Source**:
A participant in a Plot Session that observes part of the world and proposes Work Items.
_Avoid_: Extension, plugin, integration

**Extension**:
Trusted TypeScript code that can provide Sources, tools, and integration behavior for a Workflow.
_Avoid_: Source, plugin

**Needs You**:
An operator attention signal for Work Items that require human input or approval. It is separate from the Plot Session lifecycle.
_Avoid_: Blocked session, error, alert

**Operator Observation**:
Human input or a human decision that becomes part of what a Source can reconcile for a Work Item.
_Avoid_: Button click, command, approval state

**Operator Action**:
A Source-declared choice a human may take on a Work Item. Performing an Operator Action creates an Operator Observation.
_Avoid_: Button, approval, command

**Session Mode**:
Whether a Plot Session is intended to keep watching for work or run to a terminal outcome.
_Avoid_: State, status, command

**Session State**:
Where a Plot Session is in its lifecycle right now, such as watching, reconciling, acting, idle, paused, stopping, stopped, or error.
_Avoid_: Mode, outcome, needs-you

**Session History**:
The record of what happened at Plot's control-plane level during a Plot Session.
_Avoid_: Agent Transcript, provider log, chat history

**Agent Transcript**:
The record of an Agent Run's inner conversation and tool activity.
_Avoid_: Session History, Process Table, roster

**Workflow Bundle**:
The pair of `WORKFLOW.md` and `workflow.extension.ts` files that define a Workflow and its trusted TypeScript extension.
_Avoid_: Dynamic runtime, generated pipeline
