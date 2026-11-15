import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

/**
 * Optional path to a checkout of timelimit-server (with `npm install` and
 * `npx tsc` done, so that build/ exists). Tests that compare against the
 * server code are skipped when it is not set.
 */
export const serverDir = process.env.TIMELIMIT_SERVER_DIR ? resolve(process.env.TIMELIMIT_SERVER_DIR) : null

export const hasServerBuild = !!serverDir && existsSync(resolve(serverDir, 'build/api/validator.js'))
export const hasServerSchemas = !!serverDir && existsSync(resolve(serverDir, 'docs/schema/SerializedParentAction.schema.json'))

export function requireFromServer<T = any>(path: string): T {
  const require = createRequire(import.meta.url)
  return require(resolve(serverDir!, path)) as T
}
