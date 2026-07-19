#!/bin/bash
# Houdt de perf-server op poort 3700 in leven tijdens lange meetsessies
# (een parallelle sessie op deze machine heeft hem eerder per ongeluk gekild).
# Gebruik: bash .perf/watchdog.sh &  — stopt zodra .perf/watchdog.stop bestaat.
cd /home/user/mzw-perf || exit 1
while [ ! -f .perf/watchdog.stop ]; do
  if ! curl -sf -o /dev/null --max-time 2 http://localhost:3700/robots.txt; then
    echo "$(date -Is) server weg — herstart" >> .perf/raw/watchdog.log
    fuser -k 3700/tcp 2>/dev/null
    (PORT=3700 npm run start >> .perf/raw/server-watchdog.log 2>&1 &)
    for i in $(seq 1 200); do
      curl -sf -o /dev/null http://localhost:3700/robots.txt 2>/dev/null && break
    done
  fi
  sleep 5
done
