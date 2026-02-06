#!/bin/bash

# Kill existing processes on ports 3000 and 3001
echo "🧹 Checking for existing processes on ports 3000 and 3001..."
PIDS=$(lsof -ti :3000 -ti :3001 2>/dev/null)
if [ ! -z "$PIDS" ]; then
  echo "Killing processes: $PIDS"
  echo "$PIDS" | xargs kill -9
  echo "Waiting for ports to be released..."
  sleep 2
fi

# Define cleanup function
cleanup() {
  echo ""
  echo "🛑 Stopping Docker plugins..."
  ./start-plugins.sh down
  # Kill docker-compose logs process if running
  if [ ! -z "$LOGS_PID" ]; then
    kill $LOGS_PID 2>/dev/null
  fi
}

# Ensure cleanup runs when the script exits (successfully or due to error/signal)
trap cleanup EXIT INT TERM

# Start plugins
echo "🚀 Starting Docker plugins..."
./start-plugins.sh up -d

# Run dev server
echo "💻 Starting development server..."
pnpm --filter "./packages/*" --parallel dev
