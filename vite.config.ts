import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // e2e/ は playwright が回す。vitest が拾うと
    // "Playwright Test did not expect test() to be called here" で落ちる
    include: ['src/**/*.test.ts'],
  },
})
