# Dockerized Dedicated Game Servers

This repository provides a collection of readily deployable Docker images for dedicated game servers.

- **Abiotic Factor**  
  [README](games/abiotic-factor/README.md) -
  [Docker Hub](https://hub.docker.com/r/kevinresol/abiotic-factor-dedicated-server/tags)
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
