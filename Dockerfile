FROM maven:3.9.5-eclipse-temurin-21 as build

WORKDIR /graphhopper

COPY graphhopper .

RUN mvn clean install -DskipTests

FROM eclipse-temurin:21.0.1_12-jre

ENV JAVA_OPTS "-Xmx1g -Xms1g"

RUN mkdir -p /data

WORKDIR /graphhopper

COPY --from=build /graphhopper/web/target/graphhopper*.jar ./

COPY graphhopper.sh config.yml ./

# Install AWS CLI
RUN apt-get update && apt-get install -y \
    awscli \
    && rm -rf /var/lib/apt/lists/*

# Copy start script
COPY start.sh /graphhopper/
RUN chmod +x /graphhopper/start.sh

# Set environment variables
ENV PBF_FILE=great-britain-latest.pbf
ENV S3_BUCKET=example.wheredata.co
ENV S3_KEY=great-britain-latest.osm.pbf

# Enable connections from outside of the container
RUN sed -i '/^ *bind_host/s/^ */&# /p' config.yml

VOLUME [ "/data" ]

EXPOSE 8989 8990

HEALTHCHECK --interval=5s --timeout=3s CMD curl --fail http://localhost:8989/health || exit 1

ENTRYPOINT ["/graphhopper/start.sh"]

