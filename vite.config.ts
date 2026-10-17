import { defineConfig } from 'vite'

export default defineConfig({
    // Encoders may hold report artifacts exclusively on Windows. They are not
    // application modules and should not be watched by the development server.
    server: { watch: { ignored: ['**/docs/**'] } },
    build: {
        target: 'esnext'
    },
    base: process.env.GITHUB_ACTIONS_BASE || undefined
})
