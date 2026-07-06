/**
 * Dev orchestration: run the Engine proxy server + the Vite client together, with
 * zero extra dependencies. Vite proxies `/api/wcp` to the server (see vite.config.ts).
 *
 * Vite auto-loads `.env.local` for the client (VITE_-prefixed vars only). The Node
 * proxy server doesn't, so we read `.env.local` here and pass the server-side vars
 * (WCP_API_URL / WCP_WALLET_API_KEY) into the server child's environment.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

/** Parse a minimal KEY=VALUE `.env` file (ignores blanks/comments). Missing file → {}. */
function loadEnvFile(path) {
  try {
    const out = {}
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) {
        continue
      }
      const eq = trimmed.indexOf('=')
      if (eq === -1) {
        continue
      }
      out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
    }

    return out
  } catch {
    return {}
  }
}

const fileEnv = loadEnvFile(new URL('../.env.local', import.meta.url).pathname)
const serverEnv = { ...fileEnv, ...process.env }

const procs = [
  spawn('node', ['server/index.mjs'], { stdio: 'inherit', env: serverEnv }),
  spawn('vite', [], { stdio: 'inherit', env: process.env, shell: true })
]

// If either child exits, tear down the other and mirror the exit code.
for (const proc of procs) {
  proc.on('exit', code => {
    for (const other of procs) {
      if (other !== proc && other.exitCode === null) {
        other.kill()
      }
    }
    process.exit(code ?? 0)
  })
}

// Forward Ctrl-C to children.
process.on('SIGINT', () => procs.forEach(p => p.kill('SIGINT')))
