#!/bin/bash
# Meetronde voor één fix: productiebuild, verse serverstart, coldwarm- en
# databaseprofiel, en archivering van de ruwe resultaten onder raw/<label>/.
# Gebruik: bash .perf/meet-ronde.sh <label> [--met-api]
set -e
cd /home/user/mzw-perf
LABEL="$1"
[ -n "$LABEL" ] || { echo "gebruik: meet-ronde.sh <label> [--met-api]"; exit 1; }

echo "== build ($LABEL) =="
npm run build > ".perf/raw/build-$LABEL.log" 2>&1

echo "== verse start =="
touch .perf/watchdog.stop
fuser -k 3700/tcp 2>/dev/null || true
for i in $(seq 1 100); do fuser 3700/tcp >/dev/null 2>&1 || break; done
T0=$(date +%s%3N)
(PORT=3700 npm run start > .perf/raw/server-cold.log 2>&1 &)
for i in $(seq 1 500); do curl -sf -o /dev/null http://localhost:3700/robots.txt 2>/dev/null && break; done
T1=$(date +%s%3N)
echo "koude start tot eerste 200: $((T1-T0)) ms" > .perf/raw/coldstart.txt
grep "Ready in" .perf/raw/server-cold.log >> .perf/raw/coldstart.txt || true
cat .perf/raw/coldstart.txt
rm -f .perf/watchdog.stop
(bash .perf/watchdog.sh >/dev/null 2>&1 &)

echo "== coldwarm =="
node .perf/measure-coldwarm.mjs
echo "== db-profiel =="
node .perf/measure-db.mjs
if [ "$2" = "--met-api" ]; then
  echo "== api =="
  node .perf/measure-api.mjs
fi

mkdir -p ".perf/raw/$LABEL"
cp .perf/raw/coldstart.txt .perf/raw/coldwarm-server.json .perf/raw/db-routes.json ".perf/raw/$LABEL/" 2>/dev/null || true
[ "$2" = "--met-api" ] && cp .perf/raw/api-latency.json ".perf/raw/$LABEL/" 2>/dev/null || true
echo "== klaar: resultaten in .perf/raw/$LABEL =="
