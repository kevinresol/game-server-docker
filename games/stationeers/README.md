# Stationeers Dedicated Server

## Run Server

```
docker run -d \
  -v $(pwd)/stationeers:/data \
  -p 7777:7777/udp -p 27015:27015/udp \
  kevinresol/stationeers-dedicated-server[:<tagname>]
  [-loadlatest <world_name> <world_type>] \
  [-settings ServerPassword <value> GamePort <value>]
  [...]
```

### Script Arguments

Additional args after the image name (such as `-settings` in the example) will be forwarded to the server executable. See more in the [office doc](https://github.com/rocket2guns/StationeersDedicatedServerGuide#load-latest-game).

If you are using docker-compose or alike, specify the extra args via the `command` field.
