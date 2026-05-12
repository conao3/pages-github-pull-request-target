import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/pages-github-pull-request-target/',
  plugins: [react()],
});
