# Plot Context

Plot is a control plane for long-running coding-agent work. This glossary keeps product language short and consistent.

## Language

**Workflow**:
A durable Markdown + TypeScript definition of what work to find and how agents should handle it.
_Avoid_: Plot run, workflow run, session

**Plot Session**:
A live execution of a Workflow that operators can watch, pause, stop, or inspect.
_Avoid_: Workflow, run, job

**Work Item**:
A unit of work discovered by a Source and eligible for agent execution.
_Avoid_: Task, job, issue

**Agent Run**:
One agent attempt to handle one Work Item inside a Plot Session.
_Avoid_: Run, session, task, subagent

**Source**:
Trusted code that observes a domain and proposes or reconciles Work Items.
_Avoid_: Plugin, integration, scraper

**Extension**:
Trusted TypeScript that contributes Sources, tools, and integration behavior to a Workflow.
_Avoid_: Source, plugin

**Process Table**:
The operator view of Work Items and their current or latest Agent Run.
_Avoid_: Run table, log view, transcript

**Needs You**:
A Work Item attention state requiring human input or approval.
_Avoid_: Blocked session, error, alert

**Operator Action**:
A Source-declared choice a human can take on a Work Item.
_Avoid_: Button, command, approval

**Operator Observation**:
A human decision recorded so Sources can reconcile with it.
_Avoid_: Click, approval state, command result

**Session State**:
The current lifecycle position of a Plot Session: watching, reconciling, acting, idle, paused, stopping, stopped, or error.
_Avoid_: Mode, outcome, needs-you

**Agent Transcript**:
The inner conversation and tool activity from one Agent Run.
_Avoid_: Session History, Process Table

**Session History**:
The append-only control-plane record of what happened during a Plot Session.
_Avoid_: Agent Transcript, provider log

**Workflow Bundle**:
The `WORKFLOW.md` plus optional `workflow.extension.ts` that define a Workflow.
_Avoid_: Dynamic runtime, generated pipeline
