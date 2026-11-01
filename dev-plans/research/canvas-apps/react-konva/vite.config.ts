import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // React Compiler (stable since 1.0): auto-memoizes components and callbacks.
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  server: { port: 5180 },
  preview: { port: 4180 },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
