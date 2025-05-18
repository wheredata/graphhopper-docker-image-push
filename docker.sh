#!/bin/bash -ex

# docker run --entrypoint /bin/bash wheredata/graphhopper -c "wget https://download.geofabrik.de/europe/great-britain-latest.osm.pbf -O /data/great-britain-latest.osm.pbf && java -Ddw.graphhopper.datareader.file=/data/great-britain-latest.osm.pbf -Ddw.graphhopper.graph.location=great-britain.gh -jar *.jar server config-example.yml"

# docker run \
# -v /Users/davidclarke/projects/d3/graphhopper-docker-image-push/great-britain-latest.osm.pbf:/data/great-britain-latest.osm.pbf \
# -v /Users/davidclarke/projects/d3/graphhopper-docker-image-push/config.yml:/config.yml \
# --entrypoint /bin/bash wheredata/graphhopper -c \
# "java -Ddw.graphhopper.datareader.file=/data/great-britain-latest.osm.pbf -Ddw.graphhopper.graph.location=great-britain.gh -jar *.jar server /config.yml"


docker run \
-v /Users/davidclarke/projects/d3/graphhopper-docker-image-push/great-britain-latest.osm.pbf:/data/great-britain-latest.osm.pbf \
-v /Users/davidclarke/projects/d3/graphhopper-docker-image-push/config.yml:/config.yml \
--entrypoint /bin/bash wheredata/graphhopper -c \
"java -Ddw.graphhopper.datareader.file=/data/great-britain-latest.osm.pbf -Ddw.graphhopper.graph.location=great-britain.gh -jar *.jar server /config.yml"