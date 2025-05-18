#!/bin/bash

echo "Buidling and pushing wheredata/graphhopper:latest"
./build.sh --push

TAG=`cd graphhopper; git for-each-ref --sort=committerdate refs/tags | sed -n '$s/.*\///p'`
if docker manifest inspect "wheredata/graphhopper:${TAG}" >/dev/null; then 
    echo "No need to push existing version: ${TAG}";
else
    echo "Buidling and pushing wheredata/graphhopper:${TAG}"
    ./build.sh --push "${TAG}"
fi
