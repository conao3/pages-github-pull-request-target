import { $ } from 'bun';

/**
 * Resolve the repository root.
 *
 * Inside GitHub Actions this comes from $GITHUB_WORKSPACE, which avoids
 * spawning git. For local runs we fall back to `git rev-parse`.
 */
export async function getGitRoot(): Promise<string> {
  return Bun.env.GITHUB_WORKSPACE ?? (await $`git rev-parse --show-toplevel`.text()).trim();
}
