# Don't Starve Together

## Run Server

```sh
docker run -d \
  -v $(pwd)/dont-starve-together:/data \
  -p 11000:11000/udp -p 11001:11001/udp \
  -p 27018:27018/udp -p 27019:27019/udp \
  -p 8768:8768/udp -p 8769:8769/udp \
  -e GAME_CLUSTER_TOKEN=cluster-token-example \
  [-e DST_CLUSTER_NETWORK__cluster_password=survivor123] \
  kevinresol/dont-starve-together-dedicated-server:latest
```

## Script Arguments

The entrypoint passes Docker-supplied arguments to the helper's `run` command. It does not forward arbitrary game arguments such as `-port` to the Don't Starve Together executable; the helper starts the Master and Caves shards with fixed server flags. Use the configuration environment variables below for supported server settings.

## Configuration

The image requires a cluster token. Set `GAME_CLUSTER_TOKEN` as shown above on the first run; the token is then retained in `/data/DoNotStarveTogether/Cluster_1/cluster_token.txt`.

Environment variables prefixed with `DST_CLUSTER_` are written to the cluster's `cluster.ini` before server start. Replace double underscores with dots in a configuration path, so `DST_CLUSTER_NETWORK__cluster_password=survivor123` sets the `NETWORK.cluster_password` value.

`DST_MOD_IDS` accepts a comma-separated list of Steam Workshop IDs, such as `DST_MOD_IDS=123456789,987654321`. The helper creates the dedicated-server mod setup file; enable the generated mods in the shard `modoverrides.lua` files as described in the startup output.

The wrapper also supports `GAME_CONF_DIR` and `GAME_CLUSTER` for a non-default configuration directory or cluster name. If you change either value, the corresponding directory under `/data` must already contain or be able to receive the generated configuration files.

See the [Don't Starve Together dedicated server guide](https://dontstarve.fandom.com/wiki/Guides/Don%E2%80%99t_Starve_Together_Dedicated_Servers) for game-specific setup details.

## Volumes

Mount a persistent volume at `/data` so cluster configuration and save files survive container replacement. The helper passes `/data` to the game as `-persistent_storage_root`. In Docker Compose, use the service's `volumes` field to map a host directory such as `./dont-starve-together` to `/data`.
