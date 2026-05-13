import { defineConfig } from 'oxfmt';

export default defineConfig({
  singleQuote: true,
  ignorePatterns: [
    'dist',
    'node_modules',
    'coverage',
    '.git',
    '**/pnpm-lock.yaml',
    'public/data/repositories.json',
  ],
});
