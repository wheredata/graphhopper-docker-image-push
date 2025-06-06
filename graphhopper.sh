#!/bin/bash

# Check if PBF file exists locally
if [ ! -f "/graphhopper/$PBF_FILE" ]; then
    echo "PBF file not found locally. Downloading from S3..."
    
    # Download from S3
    aws s3 cp "s3://$S3_BUCKET/$S3_KEY" "/graphhopper/$PBF_FILE"
    
    if [ $? -eq 0 ]; then
        echo "Successfully downloaded PBF file from S3"
    else
        echo "Failed to download PBF file from S3"
        exit 1
    fi
else
    echo "PBF file found locally"
fi

(set -o igncr) 2>/dev/null && set -o igncr; # this comment is required for handling Windows cr/lf
# See StackOverflow answer http://stackoverflow.com/a/14607651

GH_HOME=$(dirname "$0")
JAVA=$JAVA_HOME/bin/java
if [ "$JAVA_HOME" = "" ]; then
 JAVA=java
fi

vers=$($JAVA -version 2>&1 | grep "version" | awk '{print $3}' | tr -d \")
bit64=$($JAVA -version 2>&1 | grep "64-Bit")
if [ "$bit64" != "" ]; then
  vers="$vers (64bit)"
fi
echo "## using java $vers from $JAVA_HOME"

function printBashUsage {
  echo "$(basename $0): Start a Gpahhopper server."
  echo "Default user access at 0.0.0.0:8989 and API access at 0.0.0.0:8989/route"
  echo ""
  echo "Usage"
  echo "$(basename $0) [<parameter> ...] "
  echo ""
  echo "parameters:"
  echo "-i | --input <osm-file>   OSM local input file location"
  echo "--url <url>               download input file from a url and save as data.pbf"
  echo "--import                  only create the graph cache, to be used later for faster starts"
  echo "-c | --config <config>    application configuration file location"
  echo "-o | --graph-cache <dir>  directory for graph cache output"
  echo "--port <port>             port for web server [default: 8989]"
  echo "--host <host>             host address of the web server [default: 0.0.0.0]"
  echo "-h | --help               display this message"
}

# one character parameters have one minus character'-'. longer parameters have two minus characters '--'
while [ ! -z $1 ]; do
  case $1 in
    --import) ACTION=import; shift 1;;
    -c|--config) CONFIG="$2"; shift 2;;
    -i|--input) FILE="$2"; shift 2;;
    --url) URL="$2"; shift 2;;
    -o|--graph-cache) GRAPH="$2"; shift 2;;
    --port) GH_WEB_OPTS="$GH_WEB_OPTS -Ddw.server.application_connectors[0].port=$2"; shift 2;;
    --host) GH_WEB_OPTS="$GH_WEB_OPTS -Ddw.server.application_connectors[0].bind_host=$2"; shift 2;;
    -h|--help) printBashUsage
        exit 0;;
    -*) echo "Option unknown: $1"
        echo
        printBashUsage
        exit 2;;
  esac
done

# Defaults
: "${ACTION:=server}"
: "${GRAPH:=/data/default-gh}"
: "${CONFIG:=config.yml}"
: "${JAVA_OPTS:=-Xms4g -Xmx8g}"
: "${JAR:=$(find . -type f -name "*.jar")}"

if [ "$URL" != "" ]; then
  wget -S -nv -O "${FILE:=great-britain-latest.pbf}" "$URL"
fi

# create the directories if needed
mkdir -p $(dirname "${GRAPH}")

echo "## Executing $ACTION. JAVA_OPTS=$JAVA_OPTS"

exec "$JAVA" $JAVA_OPTS ${FILE:+-Ddw.graphhopper.datareader.file="$FILE"} -Ddw.graphhopper.graph.location="$GRAPH" \
        $GH_WEB_OPTS -jar "$JAR" $ACTION $CONFIG
