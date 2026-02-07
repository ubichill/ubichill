#!/bin/bash

# Determine which docker compose command to use
if docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE="docker-compose"
else
  echo "Error: docker compose is not installed."
  exit 1
fi

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

echo "Executing: $DOCKER_COMPOSE $COMPOSE_FILES $@"
$DOCKER_COMPOSE $COMPOSE_FILES "$@"
