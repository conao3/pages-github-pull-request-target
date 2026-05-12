import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type SearchFile = {
  name: string;
  path: string;
  html_url: string;
  repository: {
    full_name: string;
    html_url: string;
    description: string | null;
    stargazers_count?: number;
    language?: string | null;
    default_branch?: string;
  };
};

type SearchResponse = {
  total_count: number;
  incomplete_results: boolean;
  items: SearchFile[];
};

type RepoApiResponse = {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  default_branch: string;
  pushed_at: string;
  updated_at: string;
};

type RepoResult = {
  fullName: string;
  url: string;
  description: string | null;
  stars: number;
  language: string | null;
  defaultBranch: string;
  pushedAt: string | null;
  files: Array<{ path: string; url: string }>;
};

type SortMode = 'stars-desc' | 'stars-asc' | 'name-asc';

const STORAGE_TOKEN_KEY = 'githubPullRequestTargetFinder.token';
const DEFAULT_QUERY = 'pull_request_target path:.github/workflows in:file';
const PAGE_SIZE = 100;

function buildHeaders(token: string): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token.trim() ? { Authorization: `Bearer ${token.trim()}` } : {}),
  };
}

async function githubJson<T>(url: string, token: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { headers: buildHeaders(token), signal });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status}: ${body || response.statusText}`);
  }
  return (await response.json()) as T;
}

async function fetchRepoDetails(fullName: string, token: string, signal: AbortSignal): Promise<RepoApiResponse> {
  return githubJson<RepoApiResponse>(`https://api.github.com/repos/${fullName}`, token, signal);
}

async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = [];
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

async function searchRepositories(
  query: string,
  maxRepositories: number,
  token: string,
  signal: AbortSignal,
): Promise<{ totalCount: number; incomplete: boolean; repos: RepoResult[] }> {
  const filesByRepo = new Map<string, SearchFile[]>();
  let totalCount = 0;
  let incomplete = false;
  const maxPages = Math.ceil(maxRepositories / PAGE_SIZE);

  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL('https://api.github.com/search/code');
    url.searchParams.set('q', query);
    url.searchParams.set('per_page', String(PAGE_SIZE));
    url.searchParams.set('page', String(page));

    const data = await githubJson<SearchResponse>(url.toString(), token, signal);
    totalCount = data.total_count;
    incomplete = incomplete || data.incomplete_results;

    for (const item of data.items) {
      const repoFiles = filesByRepo.get(item.repository.full_name) ?? [];
      repoFiles.push(item);
      filesByRepo.set(item.repository.full_name, repoFiles);
    }

    if (data.items.length < PAGE_SIZE || filesByRepo.size >= maxRepositories) {
      break;
    }
  }

  const selectedRepoNames = Array.from(filesByRepo.keys()).slice(0, maxRepositories);
  const details = await mapWithConcurrency(selectedRepoNames, 6, (fullName) =>
    fetchRepoDetails(fullName, token, signal),
  );

  const repos = details.map((repo) => ({
    fullName: repo.full_name,
    url: repo.html_url,
    description: repo.description,
    stars: repo.stargazers_count,
    language: repo.language,
    defaultBranch: repo.default_branch,
    pushedAt: repo.pushed_at,
    files: (filesByRepo.get(repo.full_name) ?? []).map((file) => ({
      path: file.path,
      url: file.html_url,
    })),
  }));

  return { totalCount, incomplete, repos };
}

function formatDate(value: string | null) {
  if (!value) return 'unknown';
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(value));
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem(STORAGE_TOKEN_KEY) ?? '');
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [maxRepositories, setMaxRepositories] = useState(200);
  const [language, setLanguage] = useState('all');
  const [sortMode, setSortMode] = useState<SortMode>('stars-desc');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [incomplete, setIncomplete] = useState(false);
  const [repos, setRepos] = useState<RepoResult[]>([]);

  const languages = useMemo(() => {
    const values = new Set(repos.map((repo) => repo.language).filter((value): value is string => Boolean(value)));
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [repos]);

  const visibleRepos = useMemo(() => {
    const filtered = language === 'all' ? repos : repos.filter((repo) => repo.language === language);
    return [...filtered].sort((a, b) => {
      if (sortMode === 'stars-asc') return a.stars - b.stars;
      if (sortMode === 'name-asc') return a.fullName.localeCompare(b.fullName);
      return b.stars - a.stars;
    });
  }, [language, repos, sortMode]);

  function saveToken(nextToken: string) {
    setToken(nextToken);
    if (nextToken.trim()) {
      localStorage.setItem(STORAGE_TOKEN_KEY, nextToken.trim());
    } else {
      localStorage.removeItem(STORAGE_TOKEN_KEY);
    }
  }

  async function handleSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setTotalCount(null);
    setIncomplete(false);
    setRepos([]);
    setLanguage('all');

    try {
      const result = await searchRepositories(query, maxRepositories, token, controller.signal);
      setTotalCount(result.totalCount);
      setIncomplete(result.incomplete);
      setRepos(result.repos);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">GitHub Actions security discovery</p>
        <h1>Find repositories using <code>pull_request_target</code></h1>
        <p>
          Search public workflow files, deduplicate repositories, sort by stars, and filter by primary language.
          Add a GitHub token if you need higher API rate limits.
        </p>
      </section>

      <form className="panel search-form" onSubmit={handleSearch}>
        <label>
          GitHub search query
          <input value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <div className="form-grid">
          <label>
            Max repositories
            <input
              type="number"
              min="1"
              max="1000"
              value={maxRepositories}
              onChange={(event) => setMaxRepositories(Number(event.target.value))}
            />
          </label>
          <label>
            Optional GitHub token
            <input
              type="password"
              placeholder="github_pat_..."
              value={token}
              onChange={(event) => saveToken(event.target.value)}
              autoComplete="off"
            />
          </label>
        </div>
        <button type="submit" disabled={loading}>{loading ? 'Searching...' : 'Search repositories'}</button>
      </form>

      {error ? <div className="panel error"><strong>Search failed.</strong><br />{error}</div> : null}

      <section className="panel controls" aria-label="Result controls">
        <div>
          <span className="stat">{repos.length}</span>
          <span className="muted"> repositories loaded</span>
        </div>
        <div>
          <span className="stat">{totalCount ?? '-'}</span>
          <span className="muted"> matching files reported by GitHub</span>
        </div>
        <label>
          Language
          <select value={language} onChange={(event) => setLanguage(event.target.value)}>
            <option value="all">All languages</option>
            {languages.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>
          Sort
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
            <option value="stars-desc">Stars: high to low</option>
            <option value="stars-asc">Stars: low to high</option>
            <option value="name-asc">Name: A to Z</option>
          </select>
        </label>
      </section>

      {incomplete ? (
        <p className="notice">GitHub marked the search as incomplete. Try again or narrow the query if results look sparse.</p>
      ) : null}

      <section className="results" aria-live="polite">
        {visibleRepos.map((repo) => (
          <article className="repo-card" key={repo.fullName}>
            <header>
              <div>
                <a className="repo-name" href={repo.url} target="_blank" rel="noreferrer">{repo.fullName}</a>
                <p>{repo.description || 'No description provided.'}</p>
              </div>
              <div className="stars" title="GitHub stars">★ {repo.stars.toLocaleString()}</div>
            </header>
            <dl className="metadata">
              <div><dt>Language</dt><dd>{repo.language || 'Unknown'}</dd></div>
              <div><dt>Default branch</dt><dd>{repo.defaultBranch}</dd></div>
              <div><dt>Last push</dt><dd>{formatDate(repo.pushedAt)}</dd></div>
            </dl>
            <details>
              <summary>{repo.files.length} matching workflow file{repo.files.length === 1 ? '' : 's'}</summary>
              <ul>
                {repo.files.map((file) => (
                  <li key={file.url}><a href={file.url} target="_blank" rel="noreferrer">{file.path}</a></li>
                ))}
              </ul>
            </details>
          </article>
        ))}
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
