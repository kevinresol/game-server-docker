# A Collection of Dockerized Dedicated Game Servers

Currently the following games are supported and they can be find in the `games` folder:

- Abiotic Factor ([Docker Hub](https://hub.docker.com/r/kevinresol/abiotic-factor-dedicated-server/tags))
- Project Zomboid ([Docker Hub](https://hub.docker.com/r/kevinresol/project-zomboid-dedicated-server/tags))
- Stationeers ([Docker Hub](https://hub.docker.com/r/kevinresol/stationeers-dedicated-server/tags))

## Philosophy

### Server executable pre-downloaded and stored in the image

The server is ready to run right after the docker image is downloaded. This saves download time as the download speed for Docker service is generally much faster than Steam service.

### Unopinionated entrypoint

Most of the time the server executable is exposed directly in Dockerfile's `ENTRYPOINT`. As a result, any arguments passed to `docker run` or in docker-compose's `command` field will be directly forwarded to the executable. Thus all the functionality of the official exeucutable are preserved.

Sometimes, the game servers are configured via config files instead of cli flags. In that case, a mechamism will be provided, on a best-effort basis, to modify the config file before running the server executable. (See Project Zomboid for an example)

### Expose all Steam branches ("beta")

All the public (non-password protected) branches on Steam will be built as Docker images, with the Docker tag equal to the Steam branch name (with special characters replaced). A cron job is used to make sure the images are up-to-date.

## Development

1. Install Node.js and pnpm
2. Run `pnpm i`
3. Run `pnpm eval build-game-image --game=<name>` to build a game image, where `<name>` is a folder name under the `games` folder

(Run `pnpm eval --help` for more commands in the build tool)
