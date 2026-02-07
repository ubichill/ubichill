#!/bin/bash
COMPOSE_FILES="-f docker-compose.yml"

# Find all docker-compose.yml in plugins directory
for file in plugins/*/docker-compose.yml; do
  if [ -f "$file" ]; then
    COMPOSE_FILES="$COMPOSE_FILES -f $file"
    echo "Found plugin definition: $file"
  fi
done

echo "Starting with: docker-compose $COMPOSE_FILES up --build"
docker-compose $COMPOSE_FILES up --build
