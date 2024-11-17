FROM kevinresol/base-dedicated-server:wine

ARG BRANCH=public

# internal vars
ENV GAME_BIN_PATH="/opt/abiotic-factor-dedicated-server"
ENV GAME_DATA_PATH="/data"

# install game
RUN ./steamcmd.sh \
	+@sSteamCmdForcePlatformType windows \
	+force_install_dir ${GAME_BIN_PATH} \
	+login anonymous \
	+app_update 2857200 -beta ${BRANCH} validate \
	+logoff +quit

RUN ln -sf "$GAME_DATA_PATH" "${GAME_BIN_PATH}/AbioticFactor/Saved"

COPY --chown=steam:steam entrypoint.sh /home/steam/entrypoint.sh

WORKDIR /home/steam

ENTRYPOINT [ "/home/steam/entrypoint.sh" ]
