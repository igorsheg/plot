# Role-based command arbitration

Plot will govern multi-client mutation with roles instead of an exclusive control lock or last-writer-wins. A Session Attachment may be an Observer or Controller; Controllers can send authorized mutating commands, and the Plot Server orders and audits those commands. This fits Plot as a control plane: correctness comes from authorization, ordered events, and reconciliation rather than from pretending one UI owns the session.
