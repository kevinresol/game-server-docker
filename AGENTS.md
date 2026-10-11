## Game image READMEs

- Mark optional parts of command examples and optional arguments with square brackets (`[...]`).
- Use concrete, representative example values so readers can infer the expected type and format (for example, a port number or server name). Do not use abstract placeholders such as `<value>` or `<tagname>`. This rule is decisive even if an existing README uses placeholders; do not treat that usage as precedent.
- Common README structure: a game/server title; a **Run Server** section with a `docker run` example; notes on forwarded server arguments and persistent volumes; and, when supported, game-specific configuration or environment-variable guidance. The examples commonly mount persistent data at `/data` and publish the game's required ports.
- Keep ports, arguments, configuration behavior, and any save-path flags specific to the image being documented. Do not infer that one game's settings apply to another; document only behavior supported by that image.

- If README patterns genuinely conflict and resolving the conflict would require choosing a shared convention, ask a human before proceeding rather than silently standardizing one pattern.

## Node.js game-server wrappers

- Some images bundle a Node.js helper (`tool.js`) called from `entrypoint.sh`. Before changing an image's startup, arguments, or configuration behavior, inspect that image's `Dockerfile`, `entrypoint.sh`, and `tool/` sources; wrapper behavior is game-specific.
- Treat the helper as part of the container's startup contract, not necessarily as the game server itself. Depending on the image, it may prepare configuration, install mods, or spawn and manage server processes; other images may use it only for setup before launching the game executable directly.
- Trace how Docker-supplied arguments and environment variables flow through the entrypoint, wrapper, and game process. Preserve the intended startup order, argument forwarding, exit handling, and signal/shutdown behavior when changing this path.

The wrapper adds a layer between the container and the game executable, so bypassing or changing it without tracing that flow can skip setup, misroute server arguments, or break process shutdown.
