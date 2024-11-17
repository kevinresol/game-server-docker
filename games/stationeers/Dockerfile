FROM kevinresol/base-dedicated-server:latest

ARG BRANCH=public

# internal vars
ENV GAME_BIN_PATH="/home/steam/Steam/steamapps/common/StationeersDedicatedServer"
ENV GAME_DATA_PATH="/data"

# install game
RUN ./steamcmd.sh \
	+force_install_dir ${GAME_BIN_PATH} \
	+login anonymous \
	+app_update 600760 -beta ${BRANCH} validate \
	+logoff +quit

RUN ln -sf "$GAME_DATA_PATH" "${GAME_BIN_PATH}/saves"

COPY --chown=steam:steam entrypoint.sh /home/steam/entrypoint.sh

WORKDIR /home/steam

ENTRYPOINT [ "/home/steam/entrypoint.sh" ]