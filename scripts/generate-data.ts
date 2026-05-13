#!/usr/bin/env nix
/*
#! nix shell --inputs-from . nixpkgs#bun -c bun
*/

import { $ } from 'bun';

type RateLimit = {
  limit: number;
  remaining: number;
  resetAt: number;
  resource: string | null;
};

type SearchItem = {
  path: string;
  html_url: string;
  repository: {
    full_name: string;
    node_id: string;
  };
};

type SearchResponse = {
  total_count?: number;
  incomplete_results?: boolean;
  items?: SearchItem[];
};

type FileEntry = { path: string; url: string };

type Scan = {
  filesByRepo: Map<string, FileEntry[]>;
  repoNodes: Map<string, string>;
  totalCount: number;
  incompleteResults: boolean;
  searchRequestCount: number;
  lastRateLimit?: RateLimit | null;
  scanStartedAt?: string;
  scanElapsedSeconds?: number;
  scanDeadlineAt?: string;
  searchDeadlineAt?: string;
};

type ShardStat = {
  label: string;
  query: string;
  pagesFetched: number;
  itemsFetched: number;
  repositoriesAfterShard: number;
  newRepositories?: number;
};

type RepoDetail = {
  fullName: string;
  url: string;
  description: string | null;
  stars: number;
  language: string | null;
  defaultBranch: string;
  pushedAt: string;
  updatedAt: string;
  fork: boolean;
};

const args = new Map<string, string | undefined>();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === '--') continue;
  if (!arg.startsWith('--')) continue;
  const [key, inlineValue] = arg.slice(2).split('=', 2) as [string, string | undefined];
  const value = inlineValue ?? process.argv[index + 1];
  args.set(key, value);
  if (inlineValue === undefined) index += 1;
}

const token = process.env.GITHUB_TOKEN;
const query = process.env.SEARCH_QUERY ?? 'pull_request_target path:.github/workflows in:file -fork:true';
const outputPath = process.env.OUTPUT_PATH ?? 'public/data/repositories.json';
const pageSize = 100;
const maxSearchResults = process.env.MAX_SEARCH_RESULTS === 'all'
  ? Number.POSITIVE_INFINITY
  : Number(process.env.MAX_SEARCH_RESULTS ?? '1000');
const scanMode = args.get('scan-mode') ?? process.env.SCAN_MODE ?? 'limited';
const scanMinutes = Number(args.get('minutes') ?? process.env.SCAN_MINUTES ?? '10');
const retryDelayMs = Number(process.env.RETRY_DELAY_MS ?? '65000');
const retryAttempts = Number(process.env.RETRY_ATTEMPTS ?? '3');
const searchDelayMs = Number(process.env.SEARCH_DELAY_MS ?? '0');
const fetchTimeoutMs = Number(process.env.FETCH_TIMEOUT_MS ?? '30000');
const detailBatchSize = Number(process.env.DETAIL_BATCH_SIZE ?? '100');
const pageBurstSize = Number(process.env.PAGE_BURST_SIZE ?? '5');
const maxSearchResultsPerQuery = 1000;
const rateLimitSafetyMs = Number(process.env.RATE_LIMIT_SAFETY_MS ?? '3500');
const detailReserveSeconds = Number(process.env.DETAIL_RESERVE_SECONDS ?? '240');
const buildReserveSeconds = Number(process.env.BUILD_RESERVE_SECONDS ?? '45');

if (!token) {
  throw new Error('GITHUB_TOKEN is required. In GitHub Actions this is provided automatically.');
}

function headers(): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'pages-github-pull-request-target-generator',
  };
}

function graphqlHeaders(): Record<string, string> {
  return {
    ...headers(),
    'Content-Type': 'application/json',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function parseRateLimit(response: Response): RateLimit {
  const resetSeconds = Number(response.headers.get('x-ratelimit-reset') ?? '0');
  return {
    limit: Number(response.headers.get('x-ratelimit-limit') ?? '0'),
    remaining: Number(response.headers.get('x-ratelimit-remaining') ?? '0'),
    resetAt: resetSeconds > 0 ? resetSeconds * 1000 : 0,
    resource: response.headers.get('x-ratelimit-resource'),
  };
}

function resetDelayMs(rateLimit: RateLimit | null | undefined): number {
  if (!rateLimit?.resetAt) return retryDelayMs;
  return Math.max(0, rateLimit.resetAt - Date.now() + rateLimitSafetyMs);
}

function isRetryableStatus(status: number): boolean {
  return status === 403 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function githubJson<T = SearchResponse>(
  url: string,
  { retry = retryAttempts }: { retry?: number } = {},
): Promise<{ data: T; rateLimit: RateLimit }> {
  for (let attempt = 1; attempt <= retry; attempt += 1) {
    let response: Response;
    try {
      response = await fetchWithTimeout(url, { headers: headers() });
    } catch (error) {
      if (attempt < retry) {
        console.warn(`GitHub API request failed; retrying in ${Math.ceil(retryDelayMs / 1000)}s (${attempt}/${retry}): ${error}`);
        await sleep(retryDelayMs);
        continue;
      }
      throw error;
    }

    const rateLimit = parseRateLimit(response);
    if (response.ok) return { data: (await response.json()) as T, rateLimit };

    const body = await response.text();
    const delay = resetDelayMs(rateLimit);
    if (isRetryableStatus(response.status) && attempt < retry) {
      console.warn(`GitHub API ${response.status}; retrying in ${Math.ceil(delay / 1000)}s (${attempt}/${retry})`);
      await sleep(delay);
      continue;
    }

    throw new Error(`GitHub API ${response.status}: ${body || response.statusText}`);
  }

  throw new Error(`GitHub API failed: ${url}`);
}

async function githubGraphql<T>(
  document: string,
  variables: Record<string, unknown>,
  { retry = retryAttempts }: { retry?: number } = {},
): Promise<T> {
  for (let attempt = 1; attempt <= retry; attempt += 1) {
    let response: Response;
    try {
      response = await fetchWithTimeout('https://api.github.com/graphql', {
        method: 'POST',
        headers: graphqlHeaders(),
        body: JSON.stringify({ query: document, variables }),
      });
    } catch (error) {
      if (attempt < retry) {
        console.warn(`GitHub GraphQL request failed; retrying in ${Math.ceil(retryDelayMs / 1000)}s (${attempt}/${retry}): ${error}`);
        await sleep(retryDelayMs);
        continue;
      }
      throw error;
    }
    const body = await response.text();

    if (response.ok) {
      const payload = JSON.parse(body) as { data?: T; errors?: unknown };
      if (!payload.errors) return payload.data as T;
      if (attempt >= retry) throw new Error(`GitHub GraphQL errors: ${JSON.stringify(payload.errors)}`);
    } else if (!isRetryableStatus(response.status)) {
      throw new Error(`GitHub GraphQL ${response.status}: ${body || response.statusText}`);
    }

    console.warn(`GitHub GraphQL retrying in ${Math.ceil(retryDelayMs / 1000)}s (${attempt}/${retry})`);
    await sleep(retryDelayMs);
  }

  throw new Error('GitHub GraphQL failed');
}

function searchUrl(searchQuery: string, perPage: number, page = 1): string {
  const url = new URL('https://api.github.com/search/code');
  url.searchParams.set('q', searchQuery);
  url.searchParams.set('per_page', String(perPage));
  url.searchParams.set('page', String(page));
  return url.toString();
}

function addSearchItems(
  filesByRepo: Map<string, FileEntry[]>,
  repoNodes: Map<string, string>,
  items: SearchItem[] | undefined,
): void {
  for (const item of items ?? []) {
    const repoName = item.repository.full_name;
    const files = filesByRepo.get(repoName) ?? [];
    files.push({ path: item.path, url: item.html_url });
    filesByRepo.set(repoName, files);
    repoNodes.set(repoName, item.repository.node_id);
  }
}

function sizeShards(): string[] {
  const ranges: Array<[number, number]> = [
    [769, 896], [897, 1024], [1025, 1280], [1281, 1536], [1537, 2048],
    [2049, 3072], [3073, 4096], [4097, 6144], [6145, 8192],
    [8193, 12288], [12289, 16384], [16385, 32768], [32769, 65536],
    [513, 544], [545, 576], [577, 640], [641, 704], [705, 768],
    [385, 400], [401, 416], [417, 432], [433, 448], [449, 464], [465, 480], [481, 496], [497, 512],
    [0, 128], [129, 192], [193, 224], [225, 256], [257, 272], [273, 288], [289, 304], [305, 320], [321, 336], [337, 352], [353, 368], [369, 384],
    [65537, 131072], [131073, 262144],
  ];
  return ranges.map(([min, max]) => `${query} size:${min}..${max}`).concat(`${query} size:>262144`);
}

async function fetchSearchPages(searchQuery: string, maxResults: number): Promise<Scan> {
  const filesByRepo = new Map<string, FileEntry[]>();
  const repoNodes = new Map<string, string>();
  let totalCount = 0;
  let incompleteResults = false;
  let searchRequestCount = 0;
  const maxPages = Math.min(10, Math.ceil(maxResults / pageSize));

  for (let page = 1; page <= maxPages; page += 1) {
    const remainingResults = maxResults - (page - 1) * pageSize;
    const perPage = Math.min(pageSize, remainingResults);
    const { data } = await githubJson<SearchResponse>(searchUrl(searchQuery, perPage, page));
    searchRequestCount += 1;
    totalCount = data.total_count ?? totalCount;
    incompleteResults = incompleteResults || Boolean(data.incomplete_results);
    addSearchItems(filesByRepo, repoNodes, data.items);

    console.log(`Fetched page ${page}: ${filesByRepo.size} repositories`);
    if ((data.items ?? []).length < perPage || page * pageSize >= maxResults) break;
    if (searchDelayMs > 0) await sleep(searchDelayMs);
  }

  return { filesByRepo, repoNodes, totalCount, incompleteResults, searchRequestCount };
}

async function waitForSearchBudget(
  lastRateLimit: RateLimit | null | undefined,
  neededRequests: number,
  deadline: number,
): Promise<boolean> {
  if (lastRateLimit?.remaining === undefined || lastRateLimit.remaining >= neededRequests) return true;

  const delay = resetDelayMs(lastRateLimit);
  if (Date.now() + delay >= deadline) return false;

  console.log(`Waiting ${Math.ceil(delay / 1000)}s for code search reset`);
  await sleep(delay);
  return true;
}

async function fetchQueryIntoScan(
  scan: Scan,
  searchQuery: string,
  label: string,
  deadline: number,
  maxResults: number = maxSearchResultsPerQuery,
): Promise<ShardStat> {
  const maxPages = Math.min(10, Math.ceil(maxResults / pageSize));
  const stat: ShardStat = {
    label,
    query: searchQuery,
    pagesFetched: 0,
    itemsFetched: 0,
    repositoriesAfterShard: scan.filesByRepo.size,
  };

  for (let page = 1; page <= maxPages;) {
    if (Date.now() >= deadline) break;

    const remainingPages = maxPages - page + 1;
    const burstSize = Math.min(pageBurstSize, remainingPages);
    const canContinue = await waitForSearchBudget(scan.lastRateLimit, burstSize, deadline);
    if (!canContinue) break;

    const burstPages = Array.from({ length: burstSize }, (_, offset) => page + offset)
      .filter(() => Date.now() < deadline);
    if (burstPages.length === 0) break;

    const results = await Promise.all(burstPages.map(async (currentPage) => {
      const remainingResults = maxResults - (currentPage - 1) * pageSize;
      const perPage = Math.min(pageSize, remainingResults);
      const { data, rateLimit } = await githubJson<SearchResponse>(searchUrl(searchQuery, perPage, currentPage));
      return { currentPage, data, rateLimit };
    }));
    scan.searchRequestCount += results.length;

    let shouldStopQuery = false;
    for (const result of results.sort((a, b) => a.currentPage - b.currentPage)) {
      scan.lastRateLimit = result.rateLimit;
      scan.totalCount = Math.max(scan.totalCount, result.data.total_count ?? 0);
      scan.incompleteResults = scan.incompleteResults || Boolean(result.data.incomplete_results);
      addSearchItems(scan.filesByRepo, scan.repoNodes, result.data.items);
      stat.pagesFetched += 1;
      stat.itemsFetched += result.data.items?.length ?? 0;
      if ((result.data.items ?? []).length === 0) shouldStopQuery = true;
    }

    console.log(`${label} pages ${burstPages[0]}-${burstPages.at(-1)}: ${scan.filesByRepo.size} repositories total`);
    page += burstPages.length;
    if (shouldStopQuery) break;
  }

  stat.repositoriesAfterShard = scan.filesByRepo.size;
  return stat;
}

async function fetchTimeBudgetScan(): Promise<Scan & { shards: ShardStat[] }> {
  const startedAt = Date.now();
  const deadline = startedAt + scanMinutes * 60_000;
  const searchDeadline = deadline - (detailReserveSeconds + buildReserveSeconds) * 1000;
  const scan: Scan = {
    filesByRepo: new Map(),
    repoNodes: new Map(),
    totalCount: 0,
    incompleteResults: false,
    searchRequestCount: 0,
    lastRateLimit: null,
  };
  const shardStats: ShardStat[] = [];

  const effectiveSearchDeadline = searchDeadline > startedAt ? searchDeadline : deadline - buildReserveSeconds * 1000;

  // Best-match first: this preserves high-signal candidates that GitHub ranks near the top
  // and avoids the previous failure mode where size shards skipped OpenClaw-like repos.
  const baseStat = await fetchQueryIntoScan(scan, query, 'base-best-match', effectiveSearchDeadline, maxSearchResultsPerQuery);
  shardStats.push(baseStat);

  // After the first 1,000 best-match results, use size shards only as opportunistic
  // backfill. These are ordered around typical workflow sizes first, not tiny files first.
  for (const [shardIndex, shardQuery] of sizeShards().entries()) {
    if (Date.now() >= effectiveSearchDeadline) break;
    const before = scan.filesByRepo.size;
    const stat = await fetchQueryIntoScan(scan, shardQuery, `supplement-size-${shardIndex + 1}`, effectiveSearchDeadline, maxSearchResultsPerQuery);
    stat.newRepositories = scan.filesByRepo.size - before;
    shardStats.push(stat);
  }

  delete scan.lastRateLimit;
  return {
    ...scan,
    shards: shardStats,
    scanStartedAt: new Date(startedAt).toISOString(),
    scanElapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
    scanDeadlineAt: new Date(deadline).toISOString(),
    searchDeadlineAt: new Date(effectiveSearchDeadline).toISOString(),
  };
}

async function fetchLimitedScan(): Promise<Scan & { shards: ShardStat[] }> {
  const result = await fetchSearchPages(query, maxSearchResults);
  return {
    ...result,
    shards: [],
    scanStartedAt: new Date().toISOString(),
    scanElapsedSeconds: 0,
  };
}

function uniqueFiles(files: FileEntry[]): FileEntry[] {
  const seen = new Set<string>();
  return files.filter((file) => {
    const key = `${file.path}\0${file.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type RepoNode = {
  id: string;
  nameWithOwner: string;
  url: string;
  description: string | null;
  stargazerCount: number;
  primaryLanguage: { name: string } | null;
  defaultBranchRef: { name: string } | null;
  pushedAt: string;
  updatedAt: string;
  isFork: boolean;
} | null;

async function fetchRepoDetails(
  repoNodes: Map<string, string>,
  deadline: number = Number.POSITIVE_INFINITY,
): Promise<Map<string, RepoDetail>> {
  const entries = Array.from(repoNodes.entries());
  const details = new Map<string, RepoDetail>();
  const document = `
    query($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Repository {
          id
          nameWithOwner
          url
          description
          stargazerCount
          primaryLanguage { name }
          defaultBranchRef { name }
          pushedAt
          updatedAt
          isFork
        }
      }
    }
  `;

  for (let index = 0; index < entries.length; index += detailBatchSize) {
    if (Date.now() >= deadline) {
      console.warn(`Stopping repository detail fetch at ${index}/${entries.length}; time budget exhausted`);
      break;
    }
    const batch = entries.slice(index, index + detailBatchSize);
    let data: { nodes?: RepoNode[] };
    try {
      data = await githubGraphql<{ nodes?: RepoNode[] }>(document, { ids: batch.map(([, nodeId]) => nodeId) });
    } catch (error) {
      console.warn(`Skipping repository detail batch ${index}-${index + batch.length}: ${error}`);
      continue;
    }
    for (const repo of data.nodes ?? []) {
      if (!repo || repo.isFork) continue;
      details.set(repo.nameWithOwner, {
        fullName: repo.nameWithOwner,
        url: repo.url,
        description: repo.description,
        stars: repo.stargazerCount,
        language: repo.primaryLanguage?.name ?? null,
        defaultBranch: repo.defaultBranchRef?.name ?? 'unknown',
        pushedAt: repo.pushedAt,
        updatedAt: repo.updatedAt,
        fork: repo.isFork,
      });
    }
    console.log(`Fetched repository details ${Math.min(index + batch.length, entries.length)}/${entries.length}`);
    await sleep(500);
  }

  return details;
}

async function main(): Promise<void> {
  const overallStartedAt = Date.now();
  const overallDeadline = scanMode === 'time-budget'
    ? overallStartedAt + scanMinutes * 60_000 - buildReserveSeconds * 1000
    : Number.POSITIVE_INFINITY;
  const scan = scanMode === 'time-budget' ? await fetchTimeBudgetScan() : await fetchLimitedScan();
  const repoDetails = await fetchRepoDetails(scan.repoNodes, overallDeadline);

  const repositories = Array.from(scan.filesByRepo.entries()).flatMap(([fullName, files]) => {
    const repo = repoDetails.get(fullName);
    if (!repo) return [];
    return [{ ...repo, files: uniqueFiles(files).sort((a, b) => a.path.localeCompare(b.path)) }];
  });

  repositories.sort((a, b) => b.stars - a.stars || a.fullName.localeCompare(b.fullName));

  const retrievedFileCount = repositories.reduce((sum, repo) => sum + repo.files.length, 0);
  const payload = {
    generatedAt: new Date().toISOString(),
    query,
    scanMode,
    scanMinutesRequested: scanMode === 'time-budget' ? scanMinutes : null,
    scanStartedAt: scan.scanStartedAt,
    scanElapsedSeconds: Math.round((Date.now() - overallStartedAt) / 1000),
    searchElapsedSeconds: scan.scanElapsedSeconds,
    scanDeadlineAt: scan.scanDeadlineAt,
    searchDeadlineAt: scan.searchDeadlineAt,
    totalCount: scan.totalCount,
    incompleteResults: scan.incompleteResults,
    retrievedFileCount,
    searchResultLimit: scanMode === 'time-budget' ? null : maxSearchResults,
    searchResultLimitReached: scanMode === 'time-budget' ? true : scan.totalCount > retrievedFileCount,
    searchRequestCount: scan.searchRequestCount,
    shardCount: scan.shards.length,
    shardTotalCount: null,
    cappedShardCount: null,
    shards: scan.shards,
    repositoryCount: repositories.length,
    repositories,
  };

  const gitRoot = (await $`git rev-parse --show-toplevel`.text()).trim();
  await Bun.write(`${gitRoot}/${outputPath}`, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${outputPath} with ${repositories.length} repositories`);
}

await main();
