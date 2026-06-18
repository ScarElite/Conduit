import { defineConfig } from 'vite';

// node-pty is a native module; it must stay external so its runtime `require`
// of the compiled .node binary keeps working (and so it can be unpacked from
// asar at package time). Everything else (electron-store, etc.) is bundled.
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['node-pty'],
    },
  },
});
