import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Minimal JSON-file persistence.
 *
 * Deliberately avoids native modules (better-sqlite3 & co.) because those
 * require node-gyp + Visual Studio build tools and must be rebuilt against
 * every Electron ABI bump. A local music library is small enough that an
 * in-memory object flushed to disk is the pragmatic choice.
 *
 * Writes are atomic: serialise to a temp file, then rename over the target.
 * On Windows rename-over-existing is atomic, so a crash mid-write cannot
 * leave a truncated database.
 */
export class JsonStore<T extends object> {
  private readonly file: string
  private cache: T
  private flushTimer: NodeJS.Timeout | null = null

  constructor(fileName: string, private readonly defaults: T) {
    this.file = path.join(app.getPath('userData'), fileName)
    this.cache = this.load()
  }

  private load(): T {
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      const parsed = JSON.parse(raw) as Partial<T>
      // Shallow-merge so newly added top-level keys get their defaults
      // instead of being `undefined` after an upgrade.
      return { ...this.defaults, ...parsed }
    } catch {
      // Missing or corrupt file: start clean rather than crashing on boot.
      return { ...this.defaults }
    }
  }

  read(): T {
    return this.cache
  }

  /** Mutate the store in place; changes are flushed to disk (debounced). */
  update(mutator: (draft: T) => void): T {
    mutator(this.cache)
    this.scheduleFlush()
    return this.cache
  }

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => this.flushNow(), 150)
  }

  flushNow(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    const tmp = `${this.file}.tmp`
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(tmp, JSON.stringify(this.cache, null, 2), 'utf8')
      fs.renameSync(tmp, this.file)
    } catch (err) {
      console.error('[store] failed to persist', this.file, err)
    }
  }
}
