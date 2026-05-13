#!/usr/bin/env nix
/*
#! nix shell --inputs-from .. nixpkgs#bun nixpkgs#gh nixpkgs#pnpm -c bun
*/

import { $ } from 'bun';

const gitRoot = (await $`git rev-parse --show-toplevel`.text()).trim();
$.cwd(gitRoot);

const ghToken = await $`gh auth token`.nothrow().text();
const githubToken = (Bun.env.GITHUB_TOKEN ?? ghToken).trim();
if (!githubToken) {
  console.error("GITHUB_TOKEN is required, or install/login GitHub CLI so 'gh auth token' works.");
  process.exit(1);
}

const minutes = process.argv[2] ?? Bun.env.SCAN_MINUTES ?? '10';
const env = {
  GITHUB_TOKEN: githubToken,
  SCAN_MODE: Bun.env.SCAN_MODE ?? 'time-budget',
  MAX_SEARCH_RESULTS: Bun.env.MAX_SEARCH_RESULTS ?? '1000',
  OUTPUT_PATH: Bun.env.OUTPUT_PATH ?? 'public/data/repositories.json',
  PAGE_BURST_SIZE: Bun.env.PAGE_BURST_SIZE ?? '5',
};
$.env({ ...Bun.env, ...env });

console.log(
  `Generating static data with SCAN_MODE=${env.SCAN_MODE} SCAN_MINUTES=${minutes} MAX_SEARCH_RESULTS=${env.MAX_SEARCH_RESULTS}`,
);

await $`pnpm install --frozen-lockfile`;
await $`bun scripts/generate-data.ts --minutes ${minutes}`;
await $`pnpm build`;
await $`bun scripts/print-summary.ts`;

console.log(`
Review changes with:
  git diff -- ${env.OUTPUT_PATH}
Commit and publish with:
  git add ${env.OUTPUT_PATH} && git commit -m "chore: update repository index" && git push origin main`);
