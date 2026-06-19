import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Library build of the embeddable <Terminal/> component — SEPARATE from the electron-forge app build.
// Bundles xterm + addons + the local component code; externalizes React so the host (V's Command Hub)
// supplies its own (avoids the duplicate-React crash). Output -> lib/ (NOT dist/, which .gitignore
// excludes) so the prebuilt bundle is committed and the Hub can consume Conduit as a git dependency
// WITHOUT cloning + installing Conduit's devDeps/toolchain (no `prepare` build, no Electron download).
//   build:  npm run build:lib   ->   lib/conduit-terminal.js + lib/conduit-terminal.css
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'lib',
    emptyOutDir: true,
    sourcemap: false, // committed artifact stays lean (~600 KB js + css)
    lib: {
      entry: resolve(__dirname, 'src/renderer/Terminal.tsx'),
      formats: ['es'],
      fileName: () => 'conduit-terminal.js',
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client'],
      output: { assetFileNames: 'conduit-terminal.[ext]' },
    },
  },
});
