import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { createFileRoute } from '@tanstack/react-router';
import { AlertTriangle, ArrowUpRight, CalendarClock, ChevronDown, Code2, FileCode2, GitBranch, GitFork, Search, ShieldAlert, Sparkles, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import staticData from '../../public/data/repositories.json';

type RepoResult = {
  fullName: string;
  url: string;
  description: string | null;
  stars: number;
  language: string | null;
  defaultBranch: string;
  pushedAt: string | null;
  updatedAt: string | null;
  files: Array<{ path: string; url: string }>;
};

type StaticData = {
  generatedAt: string | null;
  query: string;
  totalCount: number;
  incompleteResults: boolean;
  retrievedFileCount?: number;
  searchResultLimit?: number | null;
  searchResultLimitReached?: boolean;
  scanMode?: string;
  scanMinutesRequested?: number | null;
  scanElapsedSeconds?: number;
  searchRequestCount?: number;
  shardCount?: number;
  shardTotalCount?: number | null;
  cappedShardCount?: number | null;
  repositoryCount: number;
  repositories: RepoResult[];
};

type SortMode = 'stars-desc' | 'stars-asc' | 'name-asc' | 'updated-desc';

type MetricCardProps = {
  label: string;
  value: string;
  description: string;
  icon: ReactNode;
};

function formatDate(value: string | null) {
  if (!value) return 'unknown';
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(value));
}

function formatNumber(value: number | null | undefined) {
  return value === undefined || value === null ? '-' : value.toLocaleString();
}

function MetricCard({ label, value, description, icon }: MetricCardProps) {
  return (
    <Card className="min-w-0 border-white/10 bg-white/[0.04] shadow-2xl shadow-black/20 backdrop-blur-xl">
      <CardContent className="flex min-w-0 items-start gap-3 p-4 sm:gap-4 sm:p-5">
        <div className="shrink-0 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-3 text-cyan-200">{icon}</div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-400">{label}</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight text-white">{value}</p>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
      </CardContent>
    </Card>
  );
}


type RepositoryCardProps = {
  repo: RepoResult;
};

const RepositoryCard = memo(function RepositoryCard({ repo }: RepositoryCardProps) {
  return (
    <Card className="group flex h-full min-w-0 flex-col overflow-hidden border-white/10 bg-white/[0.035] shadow-lg shadow-black/10">
      <CardHeader className="shrink-0 gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <a className="break-all text-lg font-semibold tracking-tight text-white underline-offset-4 hover:underline sm:text-xl" href={repo.url} target="_blank" rel="noreferrer">
              {repo.fullName}
            </a>
            <ArrowUpRight className="h-4 w-4 text-slate-500 group-hover:text-cyan-200" />
          </div>
          <CardDescription className="line-clamp-2 max-w-4xl text-slate-400">{repo.description || 'No description provided.'}</CardDescription>
        </div>
        <Badge className="w-fit border-amber-300/20 bg-amber-300/10 text-amber-100 hover:bg-amber-300/10">
          <Star className="mr-1 h-3.5 w-3.5 fill-current" /> {repo.stars.toLocaleString()}
        </Badge>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col space-y-3 p-4 pt-0 sm:p-5 sm:pt-0">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
          <div className="min-w-0 rounded-lg border border-white/10 bg-slate-950/50 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Language</div>
            <div className="mt-1 font-medium text-white">{repo.language || 'Unknown'}</div>
          </div>
          <div className="min-w-0 rounded-lg border border-white/10 bg-slate-950/50 p-3">
            <div className="flex min-w-0 items-center gap-1 text-xs uppercase tracking-wide text-slate-500"><GitBranch className="h-3.5 w-3.5 shrink-0" /> Default branch</div>
            <div className="mt-1 break-words font-medium text-white">{repo.defaultBranch}</div>
          </div>
          <div className="min-w-0 rounded-lg border border-white/10 bg-slate-950/50 p-3">
            <div className="flex min-w-0 items-center gap-1 text-xs uppercase tracking-wide text-slate-500"><CalendarClock className="h-3.5 w-3.5 shrink-0" /> Last push</div>
            <div className="mt-1 font-medium text-white">{formatDate(repo.pushedAt)}</div>
          </div>
        </div>
        <details className="h-20 shrink-0 overflow-y-auto rounded-lg border border-white/10 bg-slate-950/40 p-3 text-sm text-slate-300">
          <summary className="cursor-pointer font-medium text-cyan-100">{repo.files.length} matching workflow file{repo.files.length === 1 ? '' : 's'}</summary>
          <ul className="mt-3 grid gap-2">
            {repo.files.map((file) => (
              <li key={file.url}>
                <a className="inline-flex items-center gap-2 break-all text-slate-300 underline-offset-4 hover:text-cyan-100 hover:underline" href={file.url} target="_blank" rel="noreferrer">
                  <FileCode2 className="h-4 w-4 shrink-0 text-slate-500" /> {file.path}
                </a>
              </li>
            ))}
          </ul>
        </details>
      </CardContent>
    </Card>
  );
});

type VirtualRepositoryListProps = {
  repositories: RepoResult[];
};

const VIRTUAL_OVERSCAN = 12;

function getEstimatedRowHeight(width: number) {
  if (width < 640) return 438;
  if (width < 1024) return 336;
  return 300;
}

function useViewportWidth() {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1024 : window.innerWidth));

  useEffect(() => {
    let animationFrame = 0;

    const updateWidth = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => setWidth(window.innerWidth));
    };

    window.addEventListener('resize', updateWidth);
    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', updateWidth);
    };
  }, []);

  return width;
}

function VirtualRepositoryList({ repositories }: VirtualRepositoryListProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const viewportWidth = useViewportWidth();
  const rowHeight = getEstimatedRowHeight(viewportWidth);
  const rowVirtualizer = useWindowVirtualizer({
    count: repositories.length,
    estimateSize: () => rowHeight,
    overscan: VIRTUAL_OVERSCAN,
    scrollMargin: listRef.current?.offsetTop ?? 0,
    getItemKey: (index) => repositories[index]?.fullName ?? index,
  });

  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowHeight, rowVirtualizer]);

  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <div
      ref={listRef}
      className="relative min-w-0"
      style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
    >
      {virtualItems.map((virtualItem) => {
        const repo = repositories[virtualItem.index];
        if (!repo) return null;

        return (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            className="absolute inset-x-0 top-0 will-change-transform [contain:layout_paint_style]"
            style={{
              height: `${rowHeight - 16}px`,
              transform: `translate3d(0, ${virtualItem.start - rowVirtualizer.options.scrollMargin}px, 0)`,
            }}
          >
            <RepositoryCard repo={repo} />
          </div>
        );
      })}
    </div>
  );
}

function PullRequestTargetPage() {
  const data = Route.useLoaderData();
  const [language, setLanguage] = useState('all');
  const [sortMode, setSortMode] = useState<SortMode>('stars-desc');
  const [textFilter, setTextFilter] = useState('');
  const repositories = data?.repositories ?? [];

  const languages = useMemo(() => {
    const values = new Set(repositories.map((repo) => repo.language).filter((value): value is string => Boolean(value)));
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [repositories]);

  const visibleRepos = useMemo(() => {
    const normalizedFilter = textFilter.trim().toLowerCase();
    const filtered = repositories.filter((repo) => {
      const languageMatches = language === 'all' || repo.language === language;
      const textMatches =
        !normalizedFilter ||
        repo.fullName.toLowerCase().includes(normalizedFilter) ||
        (repo.description ?? '').toLowerCase().includes(normalizedFilter);
      return languageMatches && textMatches;
    });

    return [...filtered].sort((a, b) => {
      if (sortMode === 'stars-asc') return a.stars - b.stars;
      if (sortMode === 'name-asc') return a.fullName.localeCompare(b.fullName);
      if (sortMode === 'updated-desc') {
        return new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime();
      }
      return b.stars - a.stars;
    });
  }, [language, repositories, sortMode, textFilter]);

  return (
    <main className="min-h-screen w-full overflow-x-clip bg-slate-950 text-slate-50">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute left-[-10%] top-[-15%] h-80 w-80 rounded-full bg-cyan-500/20 blur-3xl sm:h-96 sm:w-96" />
        <div className="absolute right-[-35%] top-24 h-80 w-80 rounded-full bg-violet-500/20 blur-3xl sm:right-[-5%] sm:h-[28rem] sm:w-[28rem]" />
        <div className="absolute bottom-[-20%] left-1/3 h-80 w-80 rounded-full bg-blue-500/10 blur-3xl sm:h-[30rem] sm:w-[30rem]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.08)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
      </div>

      <section className="mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-8 px-4 py-7 sm:gap-10 sm:px-6 lg:px-8 lg:py-14">
        <header className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-end">
          <div className="min-w-0 space-y-6">
            <Badge className="w-fit border-cyan-300/20 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/10">
              <Sparkles className="mr-1 h-3.5 w-3.5" /> GitHub Actions security discovery
            </Badge>
            <div className="space-y-4">
              <h1 className="max-w-5xl text-balance text-3xl font-semibold leading-tight tracking-tight text-white sm:text-6xl lg:text-7xl">
                Repositories using <span className="block bg-gradient-to-r from-cyan-200 via-blue-200 to-violet-200 bg-clip-text text-transparent sm:inline">pull_request_target</span>
              </h1>
              <p className="max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
                A static index generated from GitHub code search. Explore workflow matches, compare repositories by stars, and narrow the set by language without asking visitors for a token.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild className="rounded-full bg-white text-slate-950 hover:bg-slate-200">
                <a href="https://github.com/conao3/pages-github-pull-request-target" target="_blank" rel="noreferrer">
                  View on GitHub <ArrowUpRight className="h-4 w-4" />
                </a>
              </Button>
              <Button asChild variant="outline" className="rounded-full border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white">
                <a href={`${import.meta.env.BASE_URL}data/repositories.json`} target="_blank" rel="noreferrer">
                  <FileCode2 className="h-4 w-4" /> Open JSON
                </a>
              </Button>
            </div>
          </div>

          <Card className="w-full min-w-0 border-white/10 bg-white/[0.04] shadow-2xl shadow-cyan-950/40 backdrop-blur-xl">
            <CardHeader className="p-5 sm:p-6">
              <CardTitle className="flex items-center gap-2 text-white">
                <ShieldAlert className="h-5 w-5 text-cyan-200" /> Index status
              </CardTitle>
              <CardDescription className="text-slate-400">Generated data and search boundaries for this snapshot.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-5 pt-0 text-sm text-slate-300 sm:p-6 sm:pt-0">
              <div className="rounded-lg border border-white/10 bg-slate-950/60 p-3">
                <div className="text-slate-500">Generated</div>
                <div className="mt-1 font-medium text-white">{data?.generatedAt ? formatDate(data.generatedAt) : 'not generated yet'}</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-slate-950/60 p-3">
                <div className="text-slate-500">Query</div>
                <code className="mt-1 block break-all rounded-md bg-cyan-300/10 px-2 py-1 text-cyan-100">{data?.query ?? 'loading...'}</code>
              </div>
              <div className="rounded-lg border border-white/10 bg-slate-950/60 p-3">
                <div className="text-slate-500">Scan mode</div>
                <div className="mt-1 font-medium text-white">
                  {data?.scanMode === 'time-budget'
                    ? `Time budget: ${formatNumber(data.scanMinutesRequested)} min / ${formatNumber(data.searchRequestCount)} search requests`
                    : data?.scanMode ?? 'loading...'}
                </div>
              </div>
              {data?.searchResultLimitReached ? (
                <div className="flex gap-3 rounded-lg border border-amber-300/20 bg-amber-300/10 p-3 text-amber-100">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>GitHub reports more matches than this snapshot retrieves. Treat the list as an indexed subset, not a complete census.</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </header>

        <details className="group min-w-0 border-y border-white/10 py-6 sm:py-8">
          <summary className="grid cursor-pointer list-none gap-5 marker:hidden lg:grid-cols-[minmax(0,0.35fr)_minmax(0,0.65fr)] lg:gap-10 [&::-webkit-details-marker]:hidden">
            <div className="min-w-0">
              <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">Why?</h2>
              <p className="mt-2 max-w-sm text-sm leading-6 text-slate-400">
                <code>pull_request_target</code> is useful, but it crosses a dangerous trust boundary.
              </p>
            </div>
            <div className="flex min-w-0 items-start justify-between gap-4 text-sm font-medium text-cyan-100 lg:justify-end">
              <span className="group-open:hidden">Expand context</span>
              <span className="hidden group-open:inline">Collapse context</span>
              <ChevronDown className="mt-0.5 h-4 w-4 transition-transform group-open:rotate-180" />
            </div>
          </summary>
          <div className="mt-5 grid min-w-0 gap-5 lg:grid-cols-[minmax(0,0.35fr)_minmax(0,0.65fr)] lg:gap-10">
            <div className="hidden lg:block" />
            <div className="grid min-w-0 gap-4 text-base leading-7 text-slate-300">
              <p>
                The trigger lets workflows respond to pull requests with permissions from the base repository. That can be convenient for labeling, commenting, or trusted automation, but it becomes risky when a workflow checks out or executes code influenced by an untrusted pull request.
              </p>
              <p>
                This risk is not theoretical. StepSecurity documented the{' '}
                <a className="font-medium text-cyan-100 underline-offset-4 hover:underline" href="https://www.stepsecurity.io/blog/hackerbot-claw-github-actions-exploitation" target="_blank" rel="noreferrer">
                  hackerbot-claw GitHub Actions exploitation campaign
                </a>
                , including <code>pull_request_target</code> Pwn Request patterns. In{' '}
                <a className="font-medium text-cyan-100 underline-offset-4 hover:underline" href="https://tanstack.com/blog/npm-supply-chain-compromise-postmortem" target="_blank" rel="noreferrer">
                  TanStack&apos;s postmortem
                </a>{' '}
                of the npm supply-chain compromise, the team described an attack chain that included <code>pull_request_target</code>, cache poisoning, and OIDC token extraction.
              </p>
              <p>
                This index exists to make that risk visible. Appearing here does not prove that a repository is exploitable, but it is a signal that the workflow deserves careful review. If you maintain one of these repositories, consider safer GitHub Actions designs that avoid <code>pull_request_target</code> or keep untrusted code away from privileged credentials.
              </p>
            </div>
          </div>
        </details>

        <section className="grid min-w-0 gap-4 md:grid-cols-3">
          <MetricCard icon={<GitFork className="h-5 w-5" />} label="Repositories indexed" value={formatNumber(repositories.length)} description="Unique repos in this snapshot" />
          <MetricCard icon={<Code2 className="h-5 w-5" />} label="Matching files reported" value={formatNumber(data?.totalCount)} description="GitHub code search total_count" />
          <MetricCard icon={<FileCode2 className="h-5 w-5" />} label="Files retrieved" value={formatNumber(data?.retrievedFileCount)} description={data?.scanMode === 'time-budget' ? `${formatNumber(data.searchRequestCount)} search requests in ${formatNumber(data.scanElapsedSeconds)}s` : `Configured limit: ${formatNumber(data?.searchResultLimit)}`} />
        </section>

        <Card className="min-w-0 border-white/10 bg-white/[0.04] shadow-2xl shadow-black/20 backdrop-blur-xl">
          <CardContent className="grid min-w-0 gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.8fr)]">
            <label className="grid gap-2 text-sm font-medium text-slate-300">
              Search repositories
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <Input className="border-white/10 bg-slate-950/60 pl-9 text-white placeholder:text-slate-500" placeholder="owner/name or description" value={textFilter} onChange={(event) => setTextFilter(event.target.value)} />
              </div>
            </label>
            <label className="grid gap-2 text-sm font-medium text-slate-300">
              Language
              <Select className="border-white/10 bg-slate-950/60 text-white" value={language} onChange={(event) => setLanguage(event.target.value)}>
                <option value="all">All languages</option>
                {languages.map((value) => <option key={value} value={value}>{value}</option>)}
              </Select>
            </label>
            <label className="grid gap-2 text-sm font-medium text-slate-300">
              Sort
              <Select className="border-white/10 bg-slate-950/60 text-white" value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
                <option value="stars-desc">Stars: high to low</option>
                <option value="stars-asc">Stars: low to high</option>
                <option value="name-asc">Name: A to Z</option>
                <option value="updated-desc">Recently updated</option>
              </Select>
            </label>
          </CardContent>
        </Card>

        <section className="grid gap-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold tracking-tight text-white" aria-live="polite">{visibleRepos.length.toLocaleString()} repositories</h2>
            <Badge variant="outline" className="border-white/15 bg-white/5 text-slate-300">Live static data</Badge>
          </div>

          <VirtualRepositoryList repositories={visibleRepos} />
        </section>
      </section>
    </main>
  );
}

export const Route = createFileRoute('/')({
  loader: () => staticData as StaticData,
  component: PullRequestTargetPage,
});
