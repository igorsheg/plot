# `plot serve` is the Plot Server

Plot will evolve `plot serve` into the long-lived Plot Server that owns and supervises many Plot Sessions. `plot serve` is a foreground process: the command holds the terminal and Ctrl-C stops the server. We chose this over a separate hub supervising multiple `serve` child processes because session lifecycle, roster state, fan-out, auth, and command arbitration need one durable owner instead of being reconstructed from child process discovery.
