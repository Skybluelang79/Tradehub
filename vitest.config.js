import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    setupFiles: ['./src/test/setup.js'],
    // jsdom setup + parallel workers can push a synchronous render past the
    // 5s default on slower machines, flaking tests that pass in isolation.
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
