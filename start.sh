#!/bin/bash
set -e

# Validate required environment variables
if [ -z "$GH_DATA_DIR" ] || [ -z "$GH_INPUT_FILE" ]; then
    echo "Error: Required environment variables GH_DATA_DIR and GH_INPUT_FILE must be set"
    exit 1
fi

# Create data directory with proper permissions
mkdir -p "$GH_DATA_DIR"
chmod 777 "$GH_DATA_DIR"

# Download PBF file if it doesn't exist
if [ ! -f "$GH_INPUT_FILE" ]; then
    echo "Downloading PBF file from S3..."
    aws s3 cp "s3://$S3_BUCKET/$S3_KEY" "$GH_INPUT_FILE" || {
        echo "Failed to download PBF file from S3"
        exit 1
    }
    echo "Download complete"
fi

# Verify PBF file exists and is readable
if [ ! -f "$GH_INPUT_FILE" ]; then
    echo "Error: PBF file not found at $GH_INPUT_FILE"
    exit 1
fi

# Ensure the data directory is writable
if [ ! -w "$GH_DATA_DIR" ]; then
    echo "Error: Data directory $GH_DATA_DIR is not writable"
    exit 1
fi

# Update config.yml with actual values
sed -i "s|datareader.file:.*|datareader.file: $GH_INPUT_FILE|" /graphhopper/config.yml
sed -i "s|graph.location:.*|graph.location: $GH_DATA_DIR|" /graphhopper/config.yml

# Export environment variables for GraphHopper
export GH_INPUT_FILE
export GH_DATA_DIR

# Start GraphHopper
echo "Starting GraphHopper with input file: $GH_INPUT_FILE"
echo "Using data directory: $GH_DATA_DIR"
exec /graphhopper/graphhopper.sh -c config.yml -i "$GH_INPUT_FILE" -o "$GH_DATA_DIR" 