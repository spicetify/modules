#!/bin/env sh

if [ $# -eq 0 ]; then
   set -- modules/*
fi

for DIR; do
   echo "Installing ${DIR}"
   ID="/official/$(basename "$1")@0.2.0"
   spicetify pkg delete "${ID}"
   spicetify pkg install "${ID}" "${DIR}"
   spicetify pkg enable "${ID}"
done
