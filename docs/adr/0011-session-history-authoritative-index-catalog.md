# Session History is authoritative; the server index is a catalog

Plot Session History lives with the Plot Session's resolved session directory and is the authoritative record of control-plane facts. The Local Plot Server may keep a user-level index for fast cross-project roster loading, but that index is only a catalog and cached summary; if it disagrees with Session History, Plot rebuilds from Session History, and if the history is missing the index entry is stale.
