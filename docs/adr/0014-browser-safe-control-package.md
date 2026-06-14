# Browser-safe control package

Plot will put shared control-plane protocol types, Session History event types, projection reducers, Plot Session summaries, and Operator Action/Observation shapes in a browser-safe `@plot/control` package. Transport adapters and session runtime code stay outside this package. This prevents web clients from importing Node/runtime-heavy `@plot/session` while keeping TUI, web, server, and automation on one shared model.
