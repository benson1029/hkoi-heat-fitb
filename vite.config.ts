import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/hkoi-heat-fitb/',
  build: { target: 'es2022' },
  test: { environment: 'node' }
});
