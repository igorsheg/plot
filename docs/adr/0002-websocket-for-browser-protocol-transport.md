# WebSocket for browser protocol transport

Plot will use WebSocket for browser access to the Plot Server protocol. We chose this over HTTP POST plus SSE because `plot.v1` is already a duplex request/response and event stream; splitting commands and events across separate transports would add correlation, lifecycle, and backpressure complexity without improving the domain model.
