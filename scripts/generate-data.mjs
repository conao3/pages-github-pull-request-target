import { mkdir, writeFile } from 'node:fs/promises';

const token = process.env.GITHUB_TOKEN;
const query = process.env.SEARCH_QUERY ?? 'pull_request_target path:.github/workflows in:file';
const maxSearchResults = Number(process.env.MAX_SEARCH_RESULTS ?? '1000');
const outputPath = process.env.OUTPUT_PATH ?? 'public/data/repositories.json';
const pageSize = 100;

if (!token) {
  throw new Error('GITHUB_TOKEN is required. In GitHub Actions this is provided automatically.');
}

function headers() {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'pages-github-pull-request-target-generator',
  };
}

async function githubJson(url) {
  const response = await fetch(url, { headers: headers() });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status}: ${body || response.statusText}`);
  }
  return await response.json();
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function main() {
  const filesByRepo = new Map();
  let totalCount = 0;
  let incompleteResults = false;
  const maxPages = Math.min(10, Math.ceil(maxSearchResults / pageSize));

  for (let page = 1; page <= maxPages; page += 1) {
    const remainingResults = maxSearchResults - (page - 1) * pageSize;
    const perPage = Math.min(pageSize, remainingResults);
    const url = new URL('https://api.github.com/search/code');
    url.searchParams.set('q', query);
    url.searchParams.set('per_page', String(perPage));
    url.searchParams.set('page', String(page));

    const data = await githubJson(url.toString());
    totalCount = data.total_count;
    incompleteResults = incompleteResults || data.incomplete_results;

    for (const item of data.items ?? []) {
      const repoName = item.repository.full_name;
      const files = filesByRepo.get(repoName) ?? [];
      files.push({ path: item.path, url: item.html_url });
      filesByRepo.set(repoName, files);
    }

    console.log(`Fetched page ${page}: ${filesByRepo.size} repositories`);

    if ((data.items ?? []).length < pageSize || page * pageSize >= maxSearchResults) {
      break;
    }
  }

  const repoNames = Array.from(filesByRepo.keys());
  const repoDetails = await mapWithConcurrency(repoNames, 8, async (fullName) => {
    const repo = await githubJson(`https://api.github.com/repos/${fullName}`);
    return {
      fullName: repo.full_name,
      url: repo.html_url,
      description: repo.description,
      stars: repo.stargazers_count,
      language: repo.language,
      defaultBranch: repo.default_branch,
      pushedAt: repo.pushed_at,
      updatedAt: repo.updated_at,
      files: filesByRepo.get(repo.full_name) ?? [],
    };
  });

  repoDetails.sort((a, b) => b.stars - a.stars || a.fullName.localeCompare(b.fullName));

  const payload = {
    generatedAt: new Date().toISOString(),
    query,
    totalCount,
    incompleteResults,
    retrievedFileCount: Array.from(filesByRepo.values()).reduce((sum, files) => sum + files.length, 0),
    searchResultLimit: maxSearchResults,
    searchResultLimitReached: totalCount > Array.from(filesByRepo.values()).reduce((sum, files) => sum + files.length, 0),
    repositoryCount: repoDetails.length,
    repositories: repoDetails,
  };

  await mkdir(new URL(`../${outputPath.split('/').slice(0, -1).join('/')}/`, import.meta.url), { recursive: true });
  await writeFile(new URL(`../${outputPath}`, import.meta.url), `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${outputPath} with ${repoDetails.length} repositories`);
}

await main();
