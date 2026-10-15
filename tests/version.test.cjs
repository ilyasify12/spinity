const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildSync } = require('esbuild')

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spinity-version-test-'))
// WhatsNew.tsx imports react for JSX — stub it, the test only needs compareVersions.
const stub = path.join(out, 'react-stub.cjs')
fs.writeFileSync(stub, 'module.exports = { useEffect() {}, useState: () => [null, () => {}] }')
buildSync({
  entryPoints: [path.join(__dirname, '../src/renderer/src/components/WhatsNew.tsx')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  alias: { react: stub },
  outfile: path.join(out, 'whatsnew.cjs')
})
const { compareVersions } = require(path.join(out, 'whatsnew.cjs'))

test('compareVersions orders dotted versions numerically', () => {
  assert.equal(compareVersions('1.1.1', '1.1.0'), 1)
  assert.equal(compareVersions('1.1.0', '1.1.1'), -1)
  assert.equal(compareVersions('1.1.10', '1.1.2'), 1)
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0)
  assert.equal(compareVersions('1.1', '1.1.0'), 0)
})

process.on('exit', () => fs.rmSync(out, { recursive: true, force: true }))
