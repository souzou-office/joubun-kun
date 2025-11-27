import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/joubun-kun/',  // リポジトリ名に合わせて変更してください
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  }
});
