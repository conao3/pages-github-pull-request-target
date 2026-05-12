# GitHub pull_request_target Finder

A static GitHub Pages app that lists public repositories whose workflow files contain the `pull_request_target` trigger.

## Features

- Generates a static repository index in GitHub Actions.
- Searches GitHub workflow files for `pull_request_target`.
- Retrieves up to the first 1,000 matching code search results, then deduplicates them by repository.
- Sorts repositories by star count.
- Filters by primary language.
- Shows matching workflow files for each repository.
- Does not ask visitors for a GitHub token.

## Data generation

The deploy workflow runs `pnpm generate:data` before building the site. The script uses the built-in GitHub Actions token passed as `GITHUB_TOKEN: ${{ github.token }}` and writes `public/data/repositories.json`.

GitHub's code search REST API reports the total matching file count, but only allows clients to page through the first 1,000 results for a query. This site therefore shows an indexed subset of repositories from those retrievable results, not a complete GitHub-wide census.

The workflow also runs on a daily schedule so the GitHub Pages artifact is rebuilt with fresh data.

> Note: GitHub's code search API requires authentication. The workflow is intentionally configured to try the standard GitHub Actions token first, so no PAT secret is needed unless GitHub restricts cross-repository code search for `GITHUB_TOKEN` in practice.

## Development

```sh
pnpm install
GITHUB_TOKEN=$(gh auth token) pnpm generate:data
pnpm dev
```

## Build

```sh
pnpm build
```

The Vite base path is configured for GitHub Pages at `/pages-github-pull-request-target/`.

## Deployment

The repository includes a GitHub Actions workflow that generates static data, builds the app, and deploys `dist/` to GitHub Pages on pushes to `main`, on a daily schedule, and through manual dispatch.
