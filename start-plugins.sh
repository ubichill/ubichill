#!/bin/bash
COMPOSE_FILES=""

# Find all docker-compose.yml in plugins directory
for file in plugins/*/docker-compose.yml; do
  if [ -f "$file" ]; then
    COMPOSE_FILES="$COMPOSE_FILES -f $file"
    echo "Found plugin definition: $file"
  fi
done

if [ -z "$COMPOSE_FILES" ]; then
  echo "No plugin docker-compose configuration files found."
  exit 0
fi

# Ensure the shared network exists
docker network inspect ubichill-network >/dev/null 2>&1 || docker network create ubichill-network

echo "Executing: docker-compose $COMPOSE_FILES $@"
docker-compose $COMPOSE_FILES "$@"
