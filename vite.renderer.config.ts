import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  base: './',
  build: {
    // Keep renderer output where Electron Forge expects it for both dev and packaged builds.
    outDir: '../.vite/renderer/main_window',
    emptyOutDir: true,
  },
});
