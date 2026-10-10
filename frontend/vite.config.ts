import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Path the site is served from, e.g. "/token/" for https://heleo.space/token.
  // Must start and end with "/". Defaults to the domain root.
  const base = env.VITE_BASE_PATH || '/'
  return {
    base,
    plugins: [react()],
  }
})
