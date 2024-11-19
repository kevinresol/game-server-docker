FROM kevinresol/space-engineers-dedicated-server-base:latest

ARG BRANCH=public
ARG WINETRICKS_VERSION=20240105

# internal vars
ENV GAME_BIN_PATH="/home/steam/Steam/steamapps/common/SpaceEngineerDedicatedServer"
ENV GAME_DATA_PATH="/data"

# install game
RUN ./steamcmd.sh \
	+@sSteamCmdForcePlatformType windows \
	+force_install_dir ${GAME_BIN_PATH} \
	+login anonymous \
	+app_update 298740 -beta ${BRANCH} validate \
	+logoff +quit

COPY --chown=steam:steam --chmod=755 entrypoint.sh /home/steam/entrypoint.sh

ENTRYPOINT [ "/home/steam/entrypoint.sh" ]
