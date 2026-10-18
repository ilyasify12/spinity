const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { buildSync } = require('esbuild')

/**
 * aria2c integration: argument building, progress/expiry parsing, and the
 * download lifecycle against a fake child process (the real binary is
 * optional and not installed in CI, so the fake implements exactly the
 * surface the module touches: stdout/stderr events, close, kill).
 */
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spinity-aria2-test-'))
buildSync({
  entryPoints: [path.join(__dirname, '../src/main/aria2.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  outfile: path.join(out, 'aria2.cjs')
})
const {
  Aria2Error,
  aria2Expired,
  buildAria2Args,
  downloadWithAria2c,
  parseAria2Progress,
  parseAria2Size
} = require(path.join(out, 'aria2.cjs'))

// --------------------------------------------------------------- fakes

function fakeChild() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.killed = false
  child.kill = () => {
    child.killed = true
  }
  return child
}

/** Spawn stub: writes `payload` (when given) then prints `lines` and closes. */
function spawnStub({ lines = [], code = 0, payload = null, delay = 5, hang = false }) {
  const spawnImpl = (bin, args) => {
    const child = fakeChild()
    if (hang) return child
    setTimeout(() => {
      const dest = path.join(args[args.indexOf('-d') + 1], args[args.indexOf('-o') + 1])
      if (payload) fs.writeFileSync(dest, payload)
      for (const line of lines) child.stdout.emit('data', Buffer.from(`${line}\n`))
      child.emit('close', code)
    }, delay)
    return child
  }
  return spawnImpl
}

// ---------------------------------------------------------------- args

test('buildAria2Args pins the destination and the fast multi-connection flags', () => {
  const args = buildAria2Args({ url: 'https://cdn.test/a', dir: 'D:\\cache', file: 'abc.bin' })
  const flag = (name) => args[args.indexOf(name) + 1]
  assert.equal(flag('-d'), 'D:\\cache')
  assert.equal(flag('-o'), 'abc.bin')
  assert.equal(flag('-x'), '16')
  assert.equal(flag('-s'), '16')
  assert.equal(flag('-k'), '1M')
  assert.ok(args.includes('--no-conf=true'), 'user aria2.conf must not leak in')
  assert.ok(args.includes('--file-allocation=none'))
  assert.ok(args.includes('--auto-file-renaming=false'))
  assert.ok(args.includes('--summary-interval=1'), 'progress readout must be on')
  assert.equal(args[args.length - 1], 'https://cdn.test/a', 'the URL is the final argv element')
})

test('buildAria2Args honours explicit connection settings', () => {
  const args = buildAria2Args({ url: 'u', dir: 'd', file: 'f', connections: 4, split: 4, minSplit: '256K' })
  assert.equal(args[args.indexOf('-x') + 1], '4')
  assert.equal(args[args.indexOf('-s') + 1], '4')
  assert.equal(args[args.indexOf('-k') + 1], '256K')
})

// ------------------------------------------------------------ parsing

test('parseAria2Size understands binary and decimal units', () => {
  assert.equal(parseAria2Size('512B'), 512)
  assert.equal(parseAria2Size('4.1MiB'), Math.round(4.1 * 2 ** 20))
  assert.equal(parseAria2Size('1.5GiB'), Math.round(1.5 * 2 ** 30))
  assert.equal(parseAria2Size('2MB'), 2_000_000)
  assert.equal(parseAria2Size('1M'), null)
  assert.equal(parseAria2Size(''), null)
})

test('parseAria2Progress reads real console readout lines', () => {
  const got = parseAria2Progress('[#8d6f1f 15MiB/43MiB(34%) CN:8 DL:5.2MiB ETA:3s]')
  assert.equal(got.pct, 34)
  assert.equal(got.totalBytes, Math.round(43 * 2 ** 20))
  assert.equal(got.speedBps, Math.round(5.2 * 2 ** 20))
  assert.equal(parseAria2Progress('completed 100%'), null)
  assert.equal(parseAria2Progress(''), null)
})

test('aria2Expired only fires on dead-signature output', () => {
  assert.equal(
    aria2Expired(
      '[ERROR] CUID#7 - Download aborted. URI=https://rr3---sn-x.googlevideo.com/videoplayback?expire=1 Exception: [HttpResponseException.cc:84] errorCode=22 The response status is not successful. status=403'
    ),
    true
  )
  assert.equal(aria2Expired('[ERROR] Timeout while connecting'), false)
  assert.equal(aria2Expired('[ERROR] Internal error errorCode=1'), false)
})

// ---------------------------------------------------------- download

test('a successful fill resolves with the file size and reports progress', async () => {
  const dir = fs.mkdtempSync(path.join(out, 'dl-'))
  const dest = path.join(dir, 'key.bin')
  fs.writeFileSync(dest, 'stale partial')
  fs.writeFileSync(`${dest}.aria2`, 'stale control')
  const payload = Buffer.alloc(2048, 7)
  const progress = []
  const result = await downloadWithAria2c({
    url: 'https://cdn.test/a',
    dir,
    file: 'key.bin',
    bin: 'aria2c-fake',
    spawnImpl: spawnStub({
      lines: ['[#g 1.5MiB/2.0MiB(75%) CN:16 DL:5.2MiB ETA:1s]'],
      payload
    }),
    onProgress: (p) => progress.push(p)
  })
  assert.equal(result.bytes, 2048)
  assert.equal(fs.readFileSync(dest).length, 2048, 'the stale partial must be replaced')
  assert.equal(progress.length, 1)
  assert.equal(progress[0].pct, 75)
})

test('an expired URL surfaces as Aria2Error with expired=true', async () => {
  const dir = fs.mkdtempSync(path.join(out, 'dl-'))
  await assert.rejects(
    downloadWithAria2c({
      url: 'https://cdn.test/expired',
      dir,
      file: 'key.bin',
      bin: 'aria2c-fake',
      spawnImpl: spawnStub({
        lines: [
          '[ERROR] CUID#7 - Download aborted. URI=https://cdn.test/expired Exception: [HttpResponseException.cc:84] errorCode=22 The response status is not successful. status=403'
        ],
        code: 22
      })
    }),
    (err) => {
      assert.ok(err instanceof Aria2Error)
      assert.equal(err.expired, true)
      assert.equal(err.code, 22)
      return true
    }
  )
})

test('a generic failure is not marked as expired', async () => {
  const dir = fs.mkdtempSync(path.join(out, 'dl-'))
  await assert.rejects(
    downloadWithAria2c({
      url: 'https://cdn.test/x',
      dir,
      file: 'key.bin',
      bin: 'aria2c-fake',
      spawnImpl: spawnStub({ lines: ['[ERROR] Timeout while connecting'], code: 1 })
    }),
    (err) => {
      assert.ok(err instanceof Aria2Error)
      assert.equal(err.expired, false)
      return true
    }
  )
})

test('exit 0 without a file is a failure', async () => {
  const dir = fs.mkdtempSync(path.join(out, 'dl-'))
  await assert.rejects(
    downloadWithAria2c({
      url: 'https://cdn.test/x',
      dir,
      file: 'key.bin',
      bin: 'aria2c-fake',
      spawnImpl: spawnStub({})
    }),
    /without a file/
  )
})

test('a hung fill is killed by the watchdog', async () => {
  const dir = fs.mkdtempSync(path.join(out, 'dl-'))
  let child = null
  await assert.rejects(
    downloadWithAria2c({
      url: 'https://cdn.test/x',
      dir,
      file: 'key.bin',
      bin: 'aria2c-fake',
      timeoutMs: 60,
      spawnImpl: (bin, args) => {
        child = fakeChild()
        return child
      }
    }),
    /timed out/
  )
  assert.equal(child.killed, true)
})
