/**
 * The Spinity mark, generated as an SVG path.
 *
 * A raw Archimedean spiral is visually off-centre — its mass sits opposite the
 * outer tail — so the drawn points are measured and fitted into a box centred
 * on the disc. That is what keeps the margins even all the way round, exactly
 * like the logo, instead of the tail poking out of one side.
 */

export interface SpiralOptions {
  /** Turns from the centre outwards. */
  turns?: number
  /** Radius at the centre and at the outer end (same units as `box`). */
  r0?: number
  r1?: number
  /** Size of the square the drawn spiral is fitted into, centred at (50, 50). */
  box?: number
  /** Points along the curve; 200 is smooth at any size. */
  steps?: number
}

/**
 * SVG path for the mark, drawn clockwise from the centre.
 *
 * The path is returned in a 100×100 viewBox with the spiral centred at (50, 50)
 * and fitted into `box` units, so `pathLength={1}` normalisation can animate it.
 */
export function spiralPath(options: SpiralOptions = {}): string {
  const { turns = 2.35, r0 = 2.5, r1 = 41, box = 74, steps = 200 } = options

  const points: { x: number; y: number }[] = []
  for (let i = 0; i <= steps; i++) {
    const progress = i / steps
    // Start half a turn in, so the outer tail leaves on the right the way the
    // mark reads in the logo.
    const theta = progress * turns * Math.PI * 2 + Math.PI
    const radius = r0 + (r1 - r0) * progress
    points.push({ x: radius * Math.cos(theta), y: radius * Math.sin(theta) })
  }

  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  const scale = box / Math.max(maxX - minX, maxY - minY)
  const dx = 50 - ((minX + maxX) / 2) * scale
  const dy = 50 - ((minY + maxY) / 2) * scale

  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.x * scale + dx).toFixed(2)} ${(p.y * scale + dy).toFixed(2)}`)
    .join(' ')
}

/** Points of a generated path, for tests and bounds checks. */
export function spiralPoints(path: string): { x: number; y: number }[] {
  return path
    .split(/[ML]/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((pair) => {
      const [x, y] = pair.split(' ').map(Number)
      return { x, y }
    })
}
