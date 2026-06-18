import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import path from 'node:path';
import fs from 'node:fs';

const config: ForgeConfig = {
  packagerConfig: {
    // node-pty is a native module loaded via require() at runtime, so its files
    // (and the .node binary) must be unpacked out of the asar archive.
    asar: {
      unpack: '**/node_modules/node-pty/**',
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  hooks: {
    // The Vite plugin bundles the app and excludes node_modules from the copied
    // package — which drops node-pty (it's intentionally left external/unbundled
    // in vite.main.config.ts). Copy it back in so it can be unpacked + required
    // at runtime. node-pty's only dependency (node-addon-api) is build-time only
    // and is vendored inside node-pty, so copying the folder is self-contained.
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      const src = path.join(__dirname, 'node_modules', 'node-pty');
      const dest = path.join(buildPath, 'node_modules', 'node-pty');
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await fs.promises.cp(src, dest, { recursive: true });
    },
  },
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Fuses harden the packaged app at build time.
    new FusesPlugin({
      version: FuseVersion.V1,
      // node-pty's ConPTY child-process reaping forks the binary as Node
      // (ELECTRON_RUN_AS_NODE) to enumerate + kill the shell's process tree, so
      // this must stay true. The hardening delta is marginal for a terminal that
      // already spawns arbitrary user shells.
      [FuseV1Options.RunAsNode]: true,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
