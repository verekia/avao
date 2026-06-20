// A small procedural "courtyard" of flat-shaded boxes: a floor, an L of walls (a strong inside corner), some
// stacked crates, a staircase, and pillars. Lots of contact creases for the bake to find, and big flat faces
// (the floor, box tops) where the adaptive subdivision earns its keep — dense near contacts, sparse on flats.
// Built as a flat triangle soup with per-face normals; the bake's weld step recovers shared vertices.

import { BufferAttribute, BufferGeometry } from 'three'

type Vec3 = [number, number, number]

// 6 unit-cube faces, each a CCW quad (outward normal) given as 4 corner offsets in ±1 units.
const FACES: { n: Vec3; c: [Vec3, Vec3, Vec3, Vec3] }[] = [
  {
    n: [1, 0, 0],
    c: [
      [1, -1, 1],
      [1, -1, -1],
      [1, 1, -1],
      [1, 1, 1],
    ],
  },
  {
    n: [-1, 0, 0],
    c: [
      [-1, -1, -1],
      [-1, -1, 1],
      [-1, 1, 1],
      [-1, 1, -1],
    ],
  },
  {
    n: [0, 1, 0],
    c: [
      [-1, 1, 1],
      [1, 1, 1],
      [1, 1, -1],
      [-1, 1, -1],
    ],
  },
  {
    n: [0, -1, 0],
    c: [
      [-1, -1, -1],
      [1, -1, -1],
      [1, -1, 1],
      [-1, -1, 1],
    ],
  },
  {
    n: [0, 0, 1],
    c: [
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ],
  },
  {
    n: [0, 0, -1],
    c: [
      [1, -1, -1],
      [-1, -1, -1],
      [-1, 1, -1],
      [1, 1, -1],
    ],
  },
]

const addBox = (
  pos: number[],
  nrm: number[],
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
) => {
  const hx = sx / 2
  const hy = sy / 2
  const hz = sz / 2
  for (const { n, c } of FACES) {
    const v = c.map(([ox, oy, oz]) => [cx + ox * hx, cy + oy * hy, cz + oz * hz] as Vec3)
    for (const tri of [[0, 1, 2] as const, [0, 2, 3] as const]) {
      for (const idx of tri) {
        pos.push(v[idx]![0], v[idx]![1], v[idx]![2])
        nrm.push(n[0], n[1], n[2])
      }
    }
  }
}

// A single manifold staircase solid — NOT stacked boxes (those bury a coincident face between every step). It
// climbs toward -z: `steps` treads, each `run` deep and `rise` tall, `width` wide, the bottom riser at `frontZ`,
// sitting on `baseY`. Emitted as flat per-face quads (riser + tread per step, two stepped sides, a back and a
// bottom), so the surface is closed with no internal faces to z-fight or confuse the bake.
const addStairs = (
  pos: number[],
  nrm: number[],
  cx: number,
  frontZ: number,
  baseY: number,
  width: number,
  steps: number,
  run: number,
  rise: number,
) => {
  const x0 = cx - width / 2
  const x1 = cx + width / 2
  const backZ = frontZ - steps * run
  const topY = baseY + steps * rise
  const quad = (c: number[][], n: number[]) => {
    for (const tri of [[0, 1, 2] as const, [0, 2, 3] as const])
      for (const idx of tri) {
        pos.push(c[idx]![0]!, c[idx]![1]!, c[idx]![2]!)
        nrm.push(n[0]!, n[1]!, n[2]!)
      }
  }
  for (let s = 0; s < steps; s++) {
    const zf = frontZ - s * run
    const zb = frontZ - (s + 1) * run
    const yb = baseY + s * rise
    const yt = baseY + (s + 1) * rise
    quad(
      [
        [x0, yb, zf],
        [x1, yb, zf],
        [x1, yt, zf],
        [x0, yt, zf],
      ],
      [0, 0, 1],
    ) // riser
    quad(
      [
        [x0, yt, zf],
        [x1, yt, zf],
        [x1, yt, zb],
        [x0, yt, zb],
      ],
      [0, 1, 0],
    ) // tread
    quad(
      [
        [x1, baseY, zf],
        [x1, baseY, zb],
        [x1, yt, zb],
        [x1, yt, zf],
      ],
      [1, 0, 0],
    ) // right side
    quad(
      [
        [x0, baseY, zb],
        [x0, baseY, zf],
        [x0, yt, zf],
        [x0, yt, zb],
      ],
      [-1, 0, 0],
    ) // left side
  }
  quad(
    [
      [x0, baseY, backZ],
      [x1, baseY, backZ],
      [x1, baseY, frontZ],
      [x0, baseY, frontZ],
    ],
    [0, -1, 0],
  ) // bottom
  quad(
    [
      [x1, baseY, backZ],
      [x0, baseY, backZ],
      [x0, topY, backZ],
      [x1, topY, backZ],
    ],
    [0, 0, -1],
  ) // back
}

export const buildWorld = (): BufferGeometry => {
  const pos: number[] = []
  const nrm: number[] = []
  const box = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number) =>
    addBox(pos, nrm, cx, cy, cz, sx, sy, sz)

  // floor
  box(0, -0.25, 0, 13, 0.5, 13)

  // L of walls (inside corner at back-left), sitting on the floor (base at y=0)
  box(-6, 1.5, 0, 0.5, 3, 13)
  box(0, 1.5, -6, 13, 3, 0.5)

  // crates, including a stacked pair and an adjacent pair (creases between them)
  box(2, 0.6, 2.2, 1.2, 1.2, 1.2)
  box(2, 1.8, 2.2, 1, 1, 1)
  box(3.4, 0.5, 1.1, 1, 1, 1)
  box(-2.5, 0.75, 3, 1.5, 1.5, 1.5)
  box(4.2, 0.4, 4, 0.8, 0.8, 0.8)

  // staircase climbing toward the back wall — one manifold solid (see addStairs), not stacked boxes
  addStairs(pos, nrm, 0, -3, 0, 3.2, 3, 0.8, 0.5)

  // pillars
  box(-4.4, 1.5, -2.2, 0.7, 3, 0.7)
  box(4.4, 1.5, -3.2, 0.7, 3, 0.7)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3))
  return geometry
}
