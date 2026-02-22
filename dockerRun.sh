#!/bin/bash -ex

# Get the absolute path of the current directory
WORKSPACE_DIR="$(pwd)"

# First, verify the OSM file exists and is a regular file
if [ ! -f "${WORKSPACE_DIR}/great-britain-latest.osm.pbf" ]; then
    echo "Error: OSM file not found at ${WORKSPACE_DIR}/great-britain-latest.osm.pbf"
    exit 1
fi

# Run the container with increased memory
docker run \
-v "${WORKSPACE_DIR}/great-britain-latest.osm.pbf:/data/great-britain-latest.osm.pbf" \
--entrypoint /bin/bash wheredata/graphhopper -c \
'echo "Creating config file..." && \
mkdir -p /tmp && \
cat > /tmp/config.yml << "EOL"
graphhopper:
  datareader.file: ""
  graph.location: graph-cache
  import.osm.ignored_highways: motorway,trunk
  graph.dataaccess.default_type: RAM_STORE

  profiles:
   - name: car
     custom_model_files: [car.json]

   - name: foot
     custom_model_files: [foot.json, foot_elevation.json]

   - name: bike
     custom_model_files: [bike.json, bike_elevation.json]

  profiles_ch:
    - profile: car

  profiles_lm: []

  graph.encoded_values: car_access, car_average_speed, road_access, foot_access, hike_rating, mtb_rating, foot_priority, country, road_class, foot_road_access, foot_average_speed, average_slope, bike_priority, bike_road_access, bike_access, roundabout, bike_average_speed

  prepare.min_network_size: 200
  prepare.subnetworks.threads: 1

  server:
    application_connectors:
    - type: http
      port: 8989
      bind_host: 0.0.0.0
      max_request_header_size: 50k
    request_log:
        appenders: []
    admin_connectors:
    - type: http
      port: 8990
      bind_host: 0.0.0.0
  logging:
    appenders:
      - type: file
        time_zone: UTC
        current_log_filename: logs/graphhopper.log
        log_format: "%d{yyyy-MM-dd HH:mm:ss.SSS} [%thread] %-5level %logger{36} - %msg%n"
        archive: true
        archived_log_filename_pattern: ./logs/graphhopper-%d.log.gz
EOL
echo "Running GraphHopper with increased memory..." && \
java -Xmx8g -Xms4g -Ddw.graphhopper.datareader.file=/data/great-britain-latest.osm.pbf -Ddw.graphhopper.graph.location=great-britain.gh -jar *.jar server /tmp/config.yml'