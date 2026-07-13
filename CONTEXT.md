# Plot Context

Plot is a control plane for long-running coding-agent work. This glossary keeps product language short and consistent.

## Language

**Workflow**:
A durable, configured use of an Extension: what work to find, which integration configuration and runtime policy to use, and how agents should handle it. Multiple Workflows may reuse the same Extension with different configuration and prompts.
_Avoid_: Plot run, workflow run, session, Extension instance

**Plot Session**:
A durable execution of a Workflow that operators can watch, pause, stop, or inspect. A Workflow may have many historical Plot Sessions but at most one Active Plot Session.
_Avoid_: Workflow, run, job

**Active Plot Session**:
A Plot Session that is starting, operating, paused, or stopping and therefore owns its Workflow's single active-session claim. Stopped and errored Plot Sessions are historical.
_Avoid_: Live run, active run, process

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
Reusable trusted TypeScript that contributes Sources, tools, and integration behavior to one or more Workflows. It does not own a runtime lifecycle independently of a Workflow.
_Avoid_: Source, plugin, Workflow

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
The `WORKFLOW.md` and referenced Extension module that define a Workflow.
_Avoid_: Dynamic runtime, generated pipeline
