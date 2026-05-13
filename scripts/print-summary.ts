#!/usr/bin/env nix
/*
#! nix shell --inputs-from .. nixpkgs#bun -c bun
*/

import { $ } from 'bun';

type FileEntry = { path: string; url: string };

type Repository = {
  fullName: string;
  files: FileEntry[];
};

type RepositoryIndex = {
  generatedAt: string;
  scanMode: string;
  scanMinutesRequested: number | null;
  scanElapsedSeconds: number;
  totalCount: number;
  retrievedFileCount: number;
  repositoryCount: number;
  searchRequestCount: number;
  searchResultLimit: number | null;
  searchResultLimitReached: boolean;
  shardCount?: number;
  repositories?: Repository[];
};

const gitRoot = (await $`git rev-parse --show-toplevel`.text()).trim();
const relativePath = process.env.OUTPUT_PATH ?? 'public/data/repositories.json';
const data = (await Bun.file(`${gitRoot}/${relativePath}`).json()) as RepositoryIndex;

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
