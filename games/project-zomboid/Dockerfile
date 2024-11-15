FROM cm2network/steamcmd:latest

ARG BRANCH=public

ENV SERVER_NAME="myzomboidserver"

# internal vars
ENV GAME_BIN_PATH="/home/steam/Steam/steamapps/common/Project Zomboid Dedicated Server"
ENV GAME_DATA_PATH="/home/steam/Zomboid"
ENV NVM_DIR="/home/steam/.nvm"

# install nodejs as root
USER root
RUN curl -o- https://deb.nodesource.com/setup_22.x | bash
RUN apt-get install -y nodejs \
	&& apt-get autoremove -y \
	&& rm -rf /var/lib/apt/lists/*

# install game as steam user
USER steam
RUN ./steamcmd.sh +login anonymous +app_update 380870 -beta ${BRANCH} validate +logoff +quit
COPY --chown=steam:steam dist/tool.js /home/steam/tool.js
COPY --chown=steam:steam entrypoint.sh /home/steam/entrypoint.sh
COPY --chown=steam:steam default.ini /home/steam/default.ini

WORKDIR /home/steam

ENTRYPOINT [ "/home/steam/entrypoint.sh" ]
