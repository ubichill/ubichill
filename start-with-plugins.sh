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

COMPOSE_FILES="-f docker-compose.yml"

# Find all docker-compose.yml in plugins directory
for file in plugins/*/docker-compose.yml; do
  if [ -f "$file" ]; then
    COMPOSE_FILES="$COMPOSE_FILES -f $file"
    echo "Found plugin definition: $file"
  fi
done

echo "Starting with: $DOCKER_COMPOSE $COMPOSE_FILES up --build"
$DOCKER_COMPOSE $COMPOSE_FILES up --build
