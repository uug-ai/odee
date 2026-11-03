import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:8099', trace: 'retain-on-failure' },
  webServer: {
    command:
      'cd .. && GOWORK=off ODEE_AUTH_MODE=token ODEE_DEMO=true ODEE_DEV_MODE=true ODEE_ADDR=127.0.0.1:8099 ODEE_ORIGIN=http://127.0.0.1:8099 go run ./cmd/odee',
    url: 'http://127.0.0.1:8099/healthz',
    reuseExistingServer: false,
    timeout: 120000,
  },
})
