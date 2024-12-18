# Dockerized Dedicated Game Servers

This repository provides a collection of readily deployable Docker images for dedicated game servers.

- **Abiotic Factor**  
  [README](games/abiotic-factor/README.md) -
  [Docker Hub](https://hub.docker.com/r/kevinresol/abiotic-factor-dedicated-server/tags)
- **Don't Starve Together**  
  [README](games/dont-starve-together/README.md) -
  [Docker Hub](https://hub.docker.com/r/kevinresol/dont-starve-together-dedicated-server/tags)
- **Project Zomboid**  
  [README](games/project-zomboid/README.md) -
  [Docker Hub](https://hub.docker.com/r/kevinresol/project-zomboid-dedicated-server/tags)
- **Stationeers**  
  [README](games/stationeers/README.md) -
  [Docker Hub](https://hub.docker.com/r/kevinresol/stationeers-dedicated-server/tags)
- **Satisfactory**  
  [README](games/satisfactory/README.md) -
  [Docker Hub](https://hub.docker.com/r/kevinresol/satisfactory-dedicated-server/tags)
- **Valheim**  
  [README](games/valheim/README.md) -
  [Docker Hub](https://hub.docker.com/r/kevinresol/valheim-dedicated-server/tags)

## Project Philosophy

- **Pre-downloaded Server Executables:**  
  Images include the server executable, eliminating download delays during startup. Docker often outperforms Steam in download speeds.
- **Mountable Save Folder:**  
  Each image allows mounting a custom folder to persist server save data.
- **Unopinionated Entrypoint:**  
  Most images expose the server executable directly in the Dockerfile entrypoint. This ensures compatibility with all official server executable arguments.
- **Configuration Flexibility:**  
  For games configured via config files, a mechanism is provided (when possible) to modify configurations before server launch (e.g., Project Zomboid).
- **Comprehensive Branch Support:**  
  All public Steam branches ("beta") are built as separate images with tags matching the branch name (special characters replaced). Cron jobs maintain image updates.

## Development Setup

1. **Install Node.js and pnpm:**  
   Follow the official installation guides for your system.
1. **Install Dependencies:**  
   Run `pnpm i` in the project directory.
1. **Build a Game Image:**  
   Use the command `pnpm eval build-game-image --game=<name>` where `<name>` is the folder name of the desired game under the `games` directory.

For a list of available build commands, run `pnpm eval --help`.

> Note: This readme assumes basic familiarity with Docker and Node.js/pnpm.

## License

The Dockerfiles and scripts in this repository are licensed under the MIT License (see the LICENSE file). This license does not extend to the game server binaries included in the Docker images. The use of these binaries is subject to the terms of the game's end-user license agreement (EULA).
