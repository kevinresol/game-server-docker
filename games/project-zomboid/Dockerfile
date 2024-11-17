FROM cm2network/steamcmd:latest

ARG BRANCH=public

ENV SERVER_NAME="myserver"

# internal vars
ENV GAME_BIN_PATH="/opt/project-zomboid-dedicated-server"
ENV GAME_DATA_PATH="/data"

# install additional packages as root
USER root
RUN curl -o- https://deb.nodesource.com/setup_22.x | bash
RUN apt-get install -y nodejs \
	&& apt-get autoremove -y \
	&& rm -rf /var/lib/apt/lists/*

# install game as steam user
USER steam
RUN ./steamcmd.sh \
	+force_install_dir ${GAME_BIN_PATH} \
	+login anonymous \
	+app_update 380870 -beta ${BRANCH} validate \
	+logoff +quit

COPY --chown=steam:steam dist/tool.js /home/steam/tool.js
COPY --chown=steam:steam entrypoint.sh /home/steam/entrypoint.sh
COPY --chown=steam:steam default.ini /home/steam/default.ini

WORKDIR /home/steam

ENTRYPOINT [ "/home/steam/entrypoint.sh" ]
