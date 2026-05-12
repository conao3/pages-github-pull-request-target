# GitHub pull_request_target Finder

A static GitHub Pages app that lists public repositories whose workflow files contain the `pull_request_target` trigger.

## Features

- Searches GitHub workflow files for `pull_request_target`.
- Deduplicates results by repository.
- Sorts repositories by star count.
- Filters by primary language.
- Shows matching workflow files for each repository.
- Supports a GitHub token stored only in the browser's `localStorage` because GitHub requires authentication for code search.

## GitHub token

GitHub's code search REST API returns `401 Requires authentication` without a token. Create a fine-grained token that can read public repositories, paste it into the app, and the app stores it only in your browser's `localStorage`.

## Development

```sh
pnpm install
pnpm dev
```

## Build

```sh
pnpm build
```

The Vite base path is configured for GitHub Pages at `/pages-github-pull-request-target/`.

## Deployment

The repository includes a GitHub Actions workflow that builds the app and deploys `dist/` to GitHub Pages on pushes to `main`.
