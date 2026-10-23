# Valheim Dedicated Server

## Run Server

```sh
docker run -d \
  -v $(pwd)/valheim:/data \
  -p 2456:2456/udp -p 2457:2457/udp \
  kevinresol/valheim-dedicated-server:latest \
  [-name ValheimExample] \
  [-port 2456] \
  [-world Dedicated] \
  [-password change-this-password] \
  [-public 1] \
  [...]
```

## Script Arguments

Arguments after the image name are forwarded to the Valheim server executable. The entrypoint always passes `-savedir /data` before those arguments. The example shows common optional server arguments; omit any that you do not need. The server uses the port given to `-port` and the next port. The defaults are UDP `2456` and `2457`.

See the [Valheim dedicated server guide](https://www.valheimgame.com/support/a-guide-to-dedicated-servers/) and the [Valheim dedicated servers wiki](https://valheim.fandom.com/wiki/Dedicated_servers) for supported game arguments.

With Docker Compose, put the same optional server arguments in the service's `command` list.

## Volumes

Mount a persistent volume at `/data` so world saves survive container replacement. The entrypoint passes `/data` to the server as `-savedir`. World files and the permission lists `adminlist.txt`, `bannedlist.txt`, and `permittedlist.txt` are stored there. In Docker Compose, use the service's `volumes` field to map a host directory such as `./valheim` to `/data`.
