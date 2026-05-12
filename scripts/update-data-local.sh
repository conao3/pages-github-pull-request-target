#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  if command -v gh >/dev/null 2>&1; then
    GITHUB_TOKEN="$(gh auth token)"
    export GITHUB_TOKEN
  else
    echo "GITHUB_TOKEN is required, or install/login GitHub CLI so 'gh auth token' works." >&2
    exit 1
  fi
fi

MINUTES="${1:-${SCAN_MINUTES:-10}}"
: "${SCAN_MODE:=time-budget}"
: "${MAX_SEARCH_RESULTS:=1000}"
: "${OUTPUT_PATH:=public/data/repositories.json}"
: "${PAGE_BURST_SIZE:=5}"
export SCAN_MODE
export MAX_SEARCH_RESULTS
export OUTPUT_PATH
export PAGE_BURST_SIZE

echo "Generating static data with SCAN_MODE=${SCAN_MODE} SCAN_MINUTES=${MINUTES} MAX_SEARCH_RESULTS=${MAX_SEARCH_RESULTS}"
pnpm install --frozen-lockfile
pnpm generate:data -- --minutes "$MINUTES"
pnpm build

node <<'NODE'
const fs = require('node:fs');
const path = process.env.OUTPUT_PATH ?? 'public/data/repositories.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
console.log(JSON.stringify({
  generatedAt: data.generatedAt,
  scanMode: data.scanMode,
  scanMinutesRequested: data.scanMinutesRequested,
  scanElapsedSeconds: data.scanElapsedSeconds,
  totalCount: data.totalCount,
  retrievedFileCount: data.retrievedFileCount,
  searchResultLimit: data.searchResultLimit,
  searchResultLimitReached: data.searchResultLimitReached,
  searchRequestCount: data.searchRequestCount,
  shardCount: data.shardCount,
  repositoryCount: data.repositoryCount,
  topRepository: data.repositories?.[0]?.fullName ?? null,
  openClawRepositories: data.repositories
    ?.filter((repo) => repo.fullName.toLowerCase().includes('openclaw'))
    .map((repo) => repo.fullName) ?? [],
}, null, 2));
NODE

echo
printf 'Review changes with:\n  git diff -- public/data/repositories.json\n'
printf 'Commit and publish with:\n  git add public/data/repositories.json && git commit -m "chore: update repository index" && git push origin main\n'
