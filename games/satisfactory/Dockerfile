FROM kevinresol/base-dedicated-server:latest

ARG BRANCH=public

# internal vars
ENV GAME_BIN_PATH="/home/steam/Steam/steamapps/common/SatisfactoryDedicatedServer"
ENV GAME_DATA_PATH="/data"

# install game
RUN ./steamcmd.sh \
	+force_install_dir ${GAME_BIN_PATH} \
	+login anonymous \
	+app_update 1690800 -beta ${BRANCH} validate \
	+logoff +quit

RUN ln -sf "$GAME_DATA_PATH" "${GAME_BIN_PATH}/FactoryGame/Saved"
RUN ln -sf "$GAME_DATA_PATH" "/home/steam/.config/Epic/FactoryGame/Saved"

COPY --chown=steam:steam entrypoint.sh /home/steam/entrypoint.sh

WORKDIR /home/steam

ENTRYPOINT [ "/home/steam/entrypoint.sh" ]
