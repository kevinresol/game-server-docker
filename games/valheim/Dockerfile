FROM kevinresol/base-dedicated-server:latest

ARG BRANCH=public

# internal vars
ENV GAME_BIN_PATH="/home/steam/Steam/steamapps/common/ValheimDedicatedServer"
ENV GAME_DATA_PATH="/data"
ENV SteamAppId="892970"
ENV LD_LIBRARY_PATH="${GAME_BIN_PATH}/linux64:${LD_LIBRARY_PATH}"

# install game
RUN ./steamcmd.sh \
	+force_install_dir ${GAME_BIN_PATH} \
	+login anonymous \
	+app_update 896660 -beta ${BRANCH} validate \
	+logoff +quit

COPY --chown=steam:steam entrypoint.sh /home/steam/entrypoint.sh

WORKDIR /home/steam

ENTRYPOINT [ "/home/steam/entrypoint.sh" ]