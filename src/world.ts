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

export const buildWorld = (): BufferGeometry => {
  const pos: number[] = []
  const nrm: number[] = []
  const box = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number) =>
    addBox(pos, nrm, cx, cy, cz, sx, sy, sz)

  // floor
  box(0, -0.25, 0, 13, 0.5, 13)

  // L of walls (inside corner at back-left)
  box(-6, 1.25, 0, 0.5, 3, 13)
  box(0, 1.25, -6, 13, 3, 0.5)

  // crates, including a stacked pair and an adjacent pair (creases between them)
  box(2, 0.6, 2.2, 1.2, 1.2, 1.2)
  box(2, 1.8, 2.2, 1, 1, 1)
  box(3.4, 0.5, 1.1, 1, 1, 1)
  box(-2.5, 0.75, 3, 1.5, 1.5, 1.5)
  box(4.2, 0.4, 4, 0.8, 0.8, 0.8)

  // staircase climbing toward the back wall
  box(0, 0.25, -3.4, 3.2, 0.5, 0.8)
  box(0, 0.5, -4.2, 3.2, 1, 0.8)
  box(0, 0.75, -5, 3.2, 1.5, 0.8)

  // pillars
  box(-4.4, 1.5, -2.2, 0.7, 3, 0.7)
  box(4.4, 1.5, -3.2, 0.7, 3, 0.7)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3))
  return geometry
}
