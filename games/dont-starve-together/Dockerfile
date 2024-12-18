FROM kevinresol/base-dedicated-server:latest

ARG BRANCH=public

# internal vars
ENV GAME_BIN_PATH="/home/steam/Steam/steamapps/common/DontStarveTogetherDedicatedServer"
ENV GAME_DATA_PATH="/data"

# install game
RUN ./steamcmd.sh \
	+force_install_dir ${GAME_BIN_PATH} \
	+login anonymous \
	+app_update 343050 -beta ${BRANCH} validate \
	+logoff +quit

COPY --chown=steam:steam dist/tool.js /home/steam/tool.js
COPY --chown=steam:steam entrypoint.sh /home/steam/entrypoint.sh
COPY --chown=steam:steam config /home/steam/

WORKDIR /home/steam

ENTRYPOINT [ "/home/steam/entrypoint.sh" ]