# Operator actions become observations

Plot will handle human-in-the-loop choices by recording Operator Observations, not by calling Source code directly from a UI command handler. A Controller may perform a currently declared Operator Action; the Plot Server authorizes it, the Plot Session records it, and the Source interprets it during reconciliation. This preserves the `tick -> reconcile -> act` moat and keeps human input on the same auditable path as other observations.
