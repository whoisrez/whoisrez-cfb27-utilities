import type { ForgeConfig } from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { copyRuntimeDependencyTree } from './scripts/copy-runtime-deps';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'CFB 27 Utilities',
    executableName: 'CFB 27 Utilities',
    icon: 'assets/app-icon',
    afterPrune: [
      (buildPath, _electronVersion, _platform, _arch, callback) => {
        try {
          copyRuntimeDependencyTree(['madden-franchise'], buildPath);
          callback();
        } catch (error) {
          callback(error as Error);
        }
      },
    ],
  },
  rebuildConfig: {},
  makers: [],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main.ts', config: 'vite.main.config.ts', target: 'main' },
        { entry: 'src/preload.ts', config: 'vite.preload.config.ts', target: 'preload' },
        { entry: 'src/save-reader-worker.ts', config: 'vite.worker.config.ts', target: 'preload' },
        { entry: 'src/team-needs-worker.ts', config: 'vite.worker.config.ts', target: 'preload' },
        { entry: 'src/conference-writer-worker.ts', config: 'vite.worker.config.ts', target: 'preload' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
export default config;
