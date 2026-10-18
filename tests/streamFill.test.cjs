const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildSync } = require('esbuild')

/**
 * Background fills: the stream-cache handoff from the click path.
 *
 * Everything external is injected — the downloader, the fresh-URL resolver
 * and the cache — so these tests exercise the real state machine (publish,
 * cleanup, dedupe, expiry retry, concurrency cap) against a temp directory,
 * with the real StreamCache doing the cache side.
 */
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spinity-fill-test-'))
buildSync({
  entryPoints: [
    path.join(__dirname, '../src/main/streamCache.ts'),
    path.join(__dirname, '../src/main/streamFill.ts')
  ],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  outdir: out
})
const { createStreamCache } = require(path.join(out, 'streamCache.js'))
const {
  Aria2Error,
  cacheableStream,
  contentTypeForExt,
  fillStream,
  streamKeyHint
} = require(path.join(out, 'streamFill.js'))

const VID = 'abcdefghijk'
const INFO = {
  url: 'https://rr3---sn-4g5e6nez.googlevideo.com/videoplayback?expire=1&sig=x',
  ext: 'm4a',
  protocol: 'https'
}

function makeDeps(download, extra = {}) {
  const dir = fs.mkdtempSync(path.join(out, 'cache-'))
  const cache = createStreamCache({ dir })
  return {
    deps: {
      cache,
      aria2cPath: () => 'aria2c-fake',
      download,
      downloadViaYtDlp: async () => {
        throw new Error('yt-dlp fallback not configured')
      },
      ...extra
    },
    cache,
    dir
  }
}

function writePayload(options, bytes = 1024, fill = 9) {
  const dest = path.join(options.dir, options.file)
  fs.writeFileSync(dest, Buffer.alloc(bytes, fill))
  return { bytes }
}

// ------------------------------------------------------------ helpers

test('content types follow the container', () => {
  assert.equal(contentTypeForExt('m4a'), 'audio/mp4')
  assert.equal(contentTypeForExt('webm'), 'audio/webm')
  assert.equal(contentTypeForExt('opus'), 'audio/ogg')
  assert.equal(contentTypeForExt(''), 'audio/mpeg')
})

test('only progressive YouTube CDN streams are cacheable', () => {
  assert.equal(cacheableStream(INFO), true)
  assert.equal(cacheableStream({ ...INFO, protocol: 'm3u8_native' }), false)
  assert.equal(cacheableStream({ ...INFO, url: 'file:///tmp/x.m4a' }), false)
  assert.equal(cacheableStream({ ...INFO, url: 'https://preview.example.com/a.m4a' }), false)
})

// -------------------------------------------------------------- fills

test('a finished fill publishes the entry into the cache', async () => {
  const calls = []
  const log = []
  const { deps, cache } = makeDeps(async (options) => {
    calls.push(options)
    return writePayload(options)
  })
  const filled = await fillStream(VID, INFO, { deps, log: (l) => log.push(l) })
  assert.equal(filled, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].file, `${cache.keyFor(streamKeyHint(VID))}.bin`)

  const entry = cache.get(cache.keyFor(streamKeyHint(VID)))
  assert.ok(entry, 'the entry must be visible to the cache')
  assert.equal(entry.done, true)
  assert.equal(entry.total, 1024)
  assert.equal(entry.contentType, 'audio/mp4')
  assert.ok(log.some((l) => l.includes('cached')))
})

test('an already-cached track is left alone', async () => {
  let downloads = 0
  const { deps } = makeDeps(async (options) => {
    downloads++
    return writePayload(options)
  })
  assert.equal(await fillStream(VID, INFO, { deps }), true)
  assert.equal(await fillStream(VID, INFO, { deps }), false, 'second fill must be a no-op')
  assert.equal(downloads, 1)
})

test('a refused direct fetch falls back to the yt-dlp download', async () => {
  let directCalls = 0
  let fallbackCalls = 0
  const { deps, cache, dir } = makeDeps(
    async () => {
      directCalls++
      throw new Aria2Error('connection terminated', { expired: false })
    },
    {
      downloadViaYtDlp: async (videoId, destBase, opts) => {
        fallbackCalls++
        assert.equal(videoId, VID)
        assert.equal(opts.aria2cPath, 'aria2c-fake')
        const file = `${destBase}.webm`
        fs.writeFileSync(file, Buffer.alloc(4096, 4))
        return { file, ext: 'webm', bytes: 4096 }
      }
    }
  )
  const log = []
  assert.equal(await fillStream(VID, INFO, { deps, log: (l) => log.push(l) }), true)
  assert.equal(directCalls, 1)
  assert.equal(fallbackCalls, 1)
  const key = cache.keyFor(streamKeyHint(VID))
  assert.equal(fs.existsSync(path.join(dir, `${key}.webm`)), false, 'the produced file is renamed away')
  const entry = cache.get(key)
  assert.equal(entry.done, true)
  assert.equal(entry.total, 4096)
  assert.equal(entry.contentType, 'audio/webm', 'the sidecar follows the real container')
  assert.ok(log.some((l) => l.includes('via yt-dlp')))
})

test('an expired signed URL is named in the log and still falls back', async () => {
  const { deps } = makeDeps(
    async () => {
      throw new Aria2Error('status=403', { expired: true })
    },
    {
      downloadViaYtDlp: async (videoId, destBase) => {
        const file = `${destBase}.m4a`
        fs.writeFileSync(file, Buffer.alloc(512, 5))
        return { file, ext: 'm4a', bytes: 512 }
      }
    }
  )
  const log = []
  assert.equal(await fillStream(VID, INFO, { deps, log: (l) => log.push(l) }), true)
  assert.ok(log.some((l) => l.includes('signed URL refused')))
})

test('a double failure cleans up every trace and reports false', async () => {
  let fallbackCalls = 0
  const { deps, cache, dir } = makeDeps(
    async (options) => {
      // A partial file lands, then the download dies with a generic error.
      fs.writeFileSync(path.join(options.dir, options.file), Buffer.alloc(256, 1))
      fs.writeFileSync(path.join(options.dir, `${options.file}.aria2`), 'control')
      throw new Error('network died')
    },
    {
      downloadViaYtDlp: async (videoId, destBase) => {
        fallbackCalls++
        // The fallback also fails, after leaving container/part leftovers.
        fs.writeFileSync(`${destBase}.m4a`, 'half a container')
        fs.writeFileSync(`${destBase}.m4a.part`, 'partial')
        throw new Error('yt-dlp also failed')
      }
    }
  )
  const filled = await fillStream(VID, INFO, { deps })
  assert.equal(filled, false)
  assert.equal(fallbackCalls, 1, 'the fallback runs once, then the fill gives up')
  const key = cache.keyFor(streamKeyHint(VID))
  assert.equal(fs.existsSync(path.join(dir, `${key}.bin`)), false)
  assert.equal(fs.existsSync(path.join(dir, `${key}.json`)), false)
  assert.equal(fs.existsSync(path.join(dir, `${key}.bin.aria2`)), false)
  assert.equal(fs.existsSync(path.join(dir, `${key}.m4a`)), false, 'container leftovers are swept')
  assert.equal(fs.existsSync(path.join(dir, `${key}.m4a.part`)), false, 'part leftovers are swept')
})

test('concurrent fills for the same id share one download', async () => {
  let release = null
  let downloads = 0
  const { deps } = makeDeps(async (options) => {
    downloads++
    await new Promise((resolve) => {
      release = resolve
    })
    return writePayload(options)
  })
  const first = fillStream(VID, INFO, { deps })
  const second = fillStream(VID, INFO, { deps })
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(downloads, 1, 'the second call must join the first')
  release()
  assert.deepEqual(await Promise.all([first, second]), [true, true])
})

test('without aria2c and for non-cacheable streams nothing is downloaded', async () => {
  let downloads = 0
  const { deps } = makeDeps(async (options) => {
    downloads++
    return writePayload(options)
  })
  assert.equal(await fillStream(VID, INFO, { deps: { ...deps, aria2cPath: () => null } }), false)
  assert.equal(
    await fillStream(VID, { ...INFO, protocol: 'm3u8_native' }, { deps }),
    false
  )
  assert.equal(downloads, 0)
})

test('fills are capped: at most two downloads run at once, the rest queue', async () => {
  const releases = []
  let live = 0
  let peak = 0
  const { deps } = makeDeps(async (options) => {
    live++
    peak = Math.max(peak, live)
    await new Promise((resolve) => releases.push(resolve))
    live--
    return writePayload(options, 64, 3)
  })
  const ids = ['a'.repeat(11), 'b'.repeat(11), 'c'.repeat(11), 'd'.repeat(11)]
  const results = ids.map((id) => fillStream(id, INFO, { deps }))

  await new Promise((r) => setTimeout(r, 40))
  assert.equal(peak, 2, 'exactly two fills may run concurrently')

  // Drain one at a time; the queued fills must proceed.
  let guard = 0
  while (releases.length > 0 && guard++ < 20) {
    releases.shift()()
    await new Promise((r) => setTimeout(r, 15))
  }
  assert.deepEqual(await Promise.all(results), [true, true, true, true])
  assert.equal(peak, 2)
})
