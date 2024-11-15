FROM cm2network/steamcmd:latest

ARG BRANCH=public

ENV SERVER_NAME="myzomboidserver"

# internal vars
ENV GAME_BIN_PATH="/home/steam/Steam/steamapps/common/Project Zomboid Dedicated Server"
ENV GAME_DATA_PATH="/home/steam/Zomboid"

RUN ./steamcmd.sh +login anonymous +app_update 380870 -beta ${BRANCH} validate +quit
COPY dist/tool /home/steam/tool
COPY entrypoint.sh /home/steam/entrypoint.sh
COPY default.ini /home/steam/default.ini

WORKDIR /home/steam

ENTRYPOINT [ "/home/steam/entrypoint.sh" ]
