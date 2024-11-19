#!/bin/bash

set -ex

Xvfb :5 -screen 0 1024x768x16 &
env WINEARCH=win64 WINEDEBUG=-all WINEDLLOVERRIDES="mscoree=d" WINEPREFIX=/wineprefix wineboot --init /nogui 
env WINEARCH=win64 WINEDEBUG=-all WINEPREFIX=/wineprefix /scripts/winetricks corefonts 
env DISPLAY=:5.0 WINEARCH=win64 WINEDEBUG=-all WINEPREFIX=/wineprefix /scripts/winetricks -q vcrun2017 
env DISPLAY=:5.0 WINEARCH=win64 WINEDEBUG=-all WINEPREFIX=/wineprefix /scripts/winetricks -q --force dotnet48 
env WINEARCH=win64 WINEDEBUG=-all WINEPREFIX=/wineprefix /scripts/winetricks sound=disabled 
env DISPLAY=:5.0 WINEARCH=win64 WINEDEBUG=-all WINEPREFIX=/wineprefix /scripts/winetricks -q vcrun2013
rm -rf ~/.cache