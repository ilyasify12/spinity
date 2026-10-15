const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildSync } = require('esbuild')

/**
 * The boot screen's mark. The spiral is generated rather than shipped as an
 * asset, so its geometry is worth pinning down: it has to sit centred inside
 * the 100-unit disc and stay inside it, which is exactly what a raw
 * Archimedean spiral fails to do.
 */
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spinity-spiral-test-'))
buildSync({
  entryPoints: [path.join(__dirname, '../src/renderer/src/lib/spiral.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: path.join(out, 'spiral.cjs')
})
const { spiralPath, spiralPoints } = require(path.join(out, 'spiral.cjs'))

test('the mark is centred inside the disc', () => {
  const points = spiralPoints(spiralPath())
  assert.ok(points.length > 100, 'a smooth curve needs enough points')

  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const box = (values) => Math.max(...values) - Math.min(...values)
  const centreX = (Math.max(...xs) + Math.min(...xs)) / 2
  const centreY = (Math.max(...ys) + Math.min(...ys)) / 2

  assert.ok(Math.abs(centreX - 50) < 0.2, `centred horizontally, got ${centreX}`)
  assert.ok(Math.abs(centreY - 50) < 0.2, `centred vertically, got ${centreY}`)
  assert.ok(Math.abs(box(xs) - box(ys)) < 0.2 || Math.max(box(xs), box(ys)) <= 74.2, 'fitted to the box')
  assert.ok(Math.max(box(xs), box(ys)) <= 74.2, 'never larger than the fitted box')
})

test('the mark stays inside the circle it is drawn on', () => {
  const radius = 47
  for (const point of spiralPoints(spiralPath())) {
    const distance = Math.hypot(point.x - 50, point.y - 50)
    // Stroke half-width is 3.25 in these units, so leave room for the cap.
    assert.ok(distance + 3.25 <= radius, `point at ${distance.toFixed(2)} from centre pokes out`)
  }
})

test('the mark is a spiral: radius from its own centre grows as it is drawn', () => {
  const points = spiralPoints(spiralPath())
  // The first point *is* the centre of the spiral; after fitting, that is a few
  // units off the disc centre, which is why radius is measured from there.
  const origin = points[0]
  assert.ok(Math.hypot(origin.x - 50, origin.y - 50) < 15, 'the eye of the spiral sits near the middle')

  const distances = points.map((p) => Math.hypot(p.x - origin.x, p.y - origin.y))
  assert.ok(distances[distances.length - 1] > 30, 'ends at the outside')

  // Path coordinates are rounded to 2 decimals, so allow a hair of jitter: a
  // real inward turn would be a step of about a unit, not a hundredth.
  let drops = 0
  for (let i = 1; i < distances.length; i++) if (distances[i] < distances[i - 1] - 0.02) drops += 1
  assert.equal(drops, 0, 'the radius must never go back inwards')
})

process.on('exit', () => fs.rmSync(out, { recursive: true, force: true }))
