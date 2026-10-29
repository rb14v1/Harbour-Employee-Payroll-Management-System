import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  webServer: [
    { command: 'npx tsx scripts/e2e-server.ts', cwd: '../backend', url: 'http://localhost:4000/health', stdout: 'pipe', timeout: 180_000, reuseExistingServer: false },
    { command: 'npx vite --port 5173 --strictPort', url: 'http://localhost:5173', timeout: 60_000, reuseExistingServer: false },
  ],
});
