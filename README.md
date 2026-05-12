# GitHub pull_request_target Finder

A static GitHub Pages app that lists public repositories whose workflow files contain the `pull_request_target` trigger.

## Features

- Generates a static repository index in GitHub Actions.
- Searches GitHub workflow files for `pull_request_target`.
- Supports a local time-budget scan that spends the configured number of minutes on GitHub Code Search requests.
- Sorts repositories by star count after repository metadata is fetched.
- Filters by primary language.
- Shows matching workflow files for each repository.
- Does not ask visitors for a GitHub token.

## Data generation

The deploy workflow runs `pnpm generate:data` before building the site. The script uses the built-in GitHub Actions token passed as `GITHUB_TOKEN: ${{ github.token }}` and writes `public/data/repositories.json`.

GitHub's code search REST API reports the total matching file count, but only allows limited paging for a query and the built-in GitHub Actions token has a low search request budget. This site therefore shows an indexed subset of repositories from the retrievable results, not a complete GitHub-wide census.

The workflow also runs on a daily schedule so the GitHub Pages artifact is rebuilt with fresh data.

> Note: GitHub's code search API requires authentication. The workflow is intentionally configured to try the standard GitHub Actions token first, so no PAT secret is needed unless GitHub restricts cross-repository code search for `GITHUB_TOKEN` in practice.

## Local data update

Use the local update script when you want to refresh the static index with your own GitHub CLI token instead of the lower-budget GitHub Actions token. The script defaults to a 10-minute time-budget scan:

```sh
scripts/update-data-local.sh
```

Pass the number of minutes as the first argument when needed:

```sh
scripts/update-data-local.sh 3
scripts/update-data-local.sh 10
```

The time-budget scan first fetches the regular GitHub Code Search best-match results up to GitHub's 1,000-result paging limit, then uses file-size shards only as opportunistic backfill if time remains. GitHub Code Search does not support repository-star sorting before retrieval, so star order is applied after metadata is fetched.

For a quick limited scan, use `SCAN_MODE=limited` and `MAX_SEARCH_RESULTS`:

```sh
SCAN_MODE=limited MAX_SEARCH_RESULTS=500 scripts/update-data-local.sh
```

After reviewing the generated JSON, commit and push the updated data:

```sh
git add public/data/repositories.json
git commit -m "chore: update repository index"
git push origin main
```

## Development

```sh
pnpm install
GITHUB_TOKEN=$(gh auth token) SCAN_MODE=limited MAX_SEARCH_RESULTS=100 pnpm generate:data
pnpm dev
```

## Build

```sh
pnpm build
```

The Vite base path is configured for GitHub Pages at `/pages-github-pull-request-target/`.

## Deployment

The repository includes a GitHub Actions workflow that generates static data, builds the app, and deploys `dist/` to GitHub Pages on pushes to `main`, on a daily schedule, and through manual dispatch.
