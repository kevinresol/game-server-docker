
# docker build --push --platform=linux/amd64 -t kevinresol/base-dedicated-server:latest -f core/Dockerfile core
# docker build --push --platform=linux/amd64 --build-arg=PACKAGES=wine64 -t kevinresol/base-dedicated-server:wine -f core/Dockerfile core

FROM cm2network/steamcmd:latest

ARG PACKAGES=""

# install additional packages as root
USER root
RUN curl -o- https://deb.nodesource.com/setup_24.x | bash
RUN apt-get install -qqy nodejs ${PACKAGES} \
	&& apt-get autoremove -qqy \
	&& rm -rf /var/lib/apt/lists/*

# client-download.steampowered.com currently has no IPv4 A record; SteamCMD needs one.
RUN set -eu; \
	IP="$(getent ahostsv4 media.steampowered.com | awk 'NF && $1 ~ /^[0-9.]+$/ {print $1; exit}')"; \
	test -n "$IP"; \
	printf '%s\tclient-download.steampowered.com\n' "$IP" >> /etc/hosts

USER steam
