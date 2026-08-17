import { defineConfig, devices } from '@playwright/test'

// E2E は **本番ビルド (vite preview)** に対して回す。dev の StrictMode 二重発火を避ける。
// canvas / video / MediaRecorder を使うので、キャッシュ済みのフル chromium を使う
// (channel 未指定だと headless shell を要求され、環境によって欠けている)。
const PORT = Number(process.env.E2E_PORT ?? 5178)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: process.env.CI ? [['list']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium' } }],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
