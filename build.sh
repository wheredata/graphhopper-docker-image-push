#!/bin/bash

usage() (
cat <<USAGE
Build a docker image for GraphHopper and optionally push it to ECR

Usage:
  ./build.sh [[--push] <registry> <repository> <tag>]
  ./build.sh --help

Arguments:
  <registry>    ECR registry URL (e.g., 123456789012.dkr.ecr.region.amazonaws.com)
  <repository>  ECR repository name
  <tag>         Image tag [default: latest]

Option:
  --push        Push the image to ECR
  --help        Print this message
USAGE
)

if [ "$1" == "--push" ]; then
  push="true"
  shift
else
  push="false"
fi

if [ $# -lt 2 ] || [ "$1" == "--help" ]; then
  usage
  exit 1
fi

registry="$1"
repository="$2"
tag="${3:-latest}"
imagename="${registry}/${repository}:${tag}"

if [ ! -d graphhopper ]; then
  echo "Cloning graphhopper"
  git clone https://github.com/graphhopper/graphhopper.git
else
  echo "Pulling graphhopper"
  (cd graphhopper; git checkout master; git pull)
fi

echo "Creating new builder instance for multi-platform (linux/amd64, linux/arm64/v8) builds to use for building Graphhopper"
docker buildx create --use --name graphhopperbuilder

if [ "${push}" == "true" ]; then
  echo "Building docker image ${imagename} for linux/amd64 and linux/arm64/v8 and pushing to ECR"
  docker buildx build --platform linux/amd64,linux/arm64/v8 -t "${imagename}" --push .
else
  echo "Building docker image ${imagename} for linux/amd64 and linux/arm64/v8"
  docker buildx build --platform linux/amd64,linux/arm64/v8 -t "${imagename}" .
  echo "Use \"docker push ${imagename}\" to publish the image on ECR"
fi

# Remove the builder instance after use
docker buildx rm graphhopperbuilder
