// Offline-style per-vertex ambient-occlusion bake for static, flat-shaded geometry — the heart of the
// technique. Instead of a UV lightmap, occlusion is integrated at every vertex; but baking at the mesh's own
// vertices can't make contact shadows crisper than the (few) vertices allow. So the mesh is *re-meshed for the
// AO signal*:
//
//   weld → subdivide → bake → attribute-aware QEM decimate
//
// 1. weld by (position, normal): recover shared vertices inside coplanar faces, keep hard creases split.
// 2. conforming adaptive subdivision: split any edge longer than a threshold via red/green templates, so
//    neighbouring triangles always agree on a shared edge — no T-junctions, no cracks.
// 3. bake AO per vertex: cosine-weighted hemisphere visibility with a distance falloff (near occluders darken
//    hard, far ones barely register → contact creases, not flat dimming).
// 4. decimate with QEM extended by the AO scalar (meshopt), original vertices pinned: the result is "the
//    original mesh + only the vertices AO needs", so the silhouette and every hard edge survive exactly and
//    vertices cluster where occlusion actually varies.
//
// The output also records, per surviving vertex, the three ORIGINAL vertices it sits between + barycentric
// weights — that's what the compact "cuts" artifact ships (see ao-format.ts), rebuilding positions from the
// base mesh at load. Normals are recomputed at load; welding stays within coplanar faces, so they come back
// flat for free.

import { BufferAttribute, BufferGeometry, FrontSide, Ray, Vector3 } from 'three'
import { MeshoptSimplifier } from 'meshoptimizer'
import { MeshBVH } from 'three-mesh-bvh'

export type AoBakeOptions = {
  rays?: number // hemisphere samples per vertex
  maxDist?: number // occluders past this don't count (world units) — the AO "reach"
  bias?: number // push the ray origin off the surface to avoid self-hits
  strength?: number // contrast exponent on the result (>1 = deeper creases)
  floor?: number // minimum AO so creases never go fully black
  subdivLevel?: number // max conforming-subdivision passes of the working mesh
  subdivMaxEdge?: number // stop subdividing an edge once it is shorter than this (world units)
  decimateError?: number // QEM target error (world units) — the size/quality knob
  aoWeight?: number // how hard the decimator fights to preserve the AO scalar
}

export const AO_DEFAULTS: Required<AoBakeOptions> = {
  rays: 160, // hemisphere samples per vertex — more is smoother, costs bake time
  maxDist: 4, // AO reach in world units
  bias: 0.03,
  strength: 1.3,
  floor: 0,
  subdivLevel: 6,
  subdivMaxEdge: 0.4,
  decimateError: 0.015,
  aoWeight: 4,
}

export type AoMeshEntry = {
  vertCount: number
  srcVertCount: number
  srcTriCount: number
  positions: Float32Array // refined, 3/vert
  ao: Uint8Array // unorm8, 1/vert
  indices: Uint32Array // 3/tri
  parentVerts: Uint32Array // 3 original-vertex indices per refined vertex
  parentBary: Float32Array // (weight_b, weight_c) within that triangle, 2/vert
}

type Core = {
  position: Float32Array // 3/vert
  normal: Float32Array // 3/vert
  index: Uint32Array // 3/tri
}

const readCore = (geometry: BufferGeometry): Core => {
  const pos = geometry.attributes.position as BufferAttribute
  const nrm = geometry.attributes.normal as BufferAttribute | undefined
  const count = pos.count
  const position = new Float32Array(count * 3)
  const normal = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    position[i * 3] = pos.getX(i)
    position[i * 3 + 1] = pos.getY(i)
    position[i * 3 + 2] = pos.getZ(i)
    if (nrm) {
      normal[i * 3] = nrm.getX(i)
      normal[i * 3 + 1] = nrm.getY(i)
      normal[i * 3 + 2] = nrm.getZ(i)
    } else {
      normal[i * 3 + 2] = 1
    }
  }
  const src = geometry.index
  let index: Uint32Array
  if (src) {
    index = new Uint32Array(src.count)
    for (let i = 0; i < src.count; i++) index[i] = src.getX(i)
  } else {
    index = new Uint32Array(count)
    for (let i = 0; i < count; i++) index[i] = i
  }
  return { position, normal, index }
}

const qp = (v: number) => Math.round(v * 1024) // ~1mm position quantization for the weld key
const qn = (v: number) => Math.round(v * 256) // normal quantization — keeps distinct face normals apart

// Weld by (position, normal): coplanar-adjacent triangles share vertices again, while a hard crease — same
// position, different normal — stays split (that split is what later becomes a locked boundary and keeps the
// flat-shaded look).
const weld = (core: Core): Core => {
  const vcount = core.position.length / 3
  const remap = new Int32Array(vcount).fill(-1)
  const map = new Map<string, number>()
  const position: number[] = []
  const normal: number[] = []
  for (let i = 0; i < vcount; i++) {
    const px = core.position[i * 3]!
    const py = core.position[i * 3 + 1]!
    const pz = core.position[i * 3 + 2]!
    const nx = core.normal[i * 3]!
    const ny = core.normal[i * 3 + 1]!
    const nz = core.normal[i * 3 + 2]!
    const key = `${qp(px)},${qp(py)},${qp(pz)}|${qn(nx)},${qn(ny)},${qn(nz)}`
    let id = map.get(key)
    if (id === undefined) {
      id = position.length / 3
      map.set(key, id)
      position.push(px, py, pz)
      normal.push(nx, ny, nz)
    }
    remap[i] = id
  }
  const index = new Uint32Array(core.index.length)
  for (let i = 0; i < core.index.length; i++) index[i] = remap[core.index[i]!]!
  return { position: new Float32Array(position), normal: new Float32Array(normal), index }
}

// Conforming adaptive subdivision. An edge is split iff it is longer than `maxEdge`; that test depends only on
// the edge, so the two triangles sharing it always agree — no T-junctions. A triangle then emits a red/green
// template from which of its 3 edges split. Up to `level` passes. Midpoints interpolate position and normal.
const subdivide = (core: Core, level: number, maxEdge: number): Core => {
  const position = Array.from(core.position)
  const normal = Array.from(core.normal)
  let index = core.index
  const maxEdgeSq = Math.max(maxEdge, 0) ** 2

  for (let pass = 0; pass < level; pass++) {
    const midCache = new Map<number, number>()
    const splitEdge = (a: number, b: number): number => {
      const key = a < b ? a * 0x4000000 + b : b * 0x4000000 + a
      const cached = midCache.get(key)
      if (cached !== undefined) return cached
      const dx = position[a * 3]! - position[b * 3]!
      const dy = position[a * 3 + 1]! - position[b * 3 + 1]!
      const dz = position[a * 3 + 2]! - position[b * 3 + 2]!
      if (dx * dx + dy * dy + dz * dz <= maxEdgeSq) {
        midCache.set(key, -1)
        return -1
      }
      const id = position.length / 3
      position.push(
        (position[a * 3]! + position[b * 3]!) / 2,
        (position[a * 3 + 1]! + position[b * 3 + 1]!) / 2,
        (position[a * 3 + 2]! + position[b * 3 + 2]!) / 2,
      )
      let nx = (normal[a * 3]! + normal[b * 3]!) / 2
      let ny = (normal[a * 3 + 1]! + normal[b * 3 + 1]!) / 2
      let nz = (normal[a * 3 + 2]! + normal[b * 3 + 2]!) / 2
      const len = Math.hypot(nx, ny, nz) || 1
      nx /= len
      ny /= len
      nz /= len
      normal.push(nx, ny, nz)
      midCache.set(key, id)
      return id
    }

    const next: number[] = []
    let any = false
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t]!
      const b = index[t + 1]!
      const c = index[t + 2]!
      const m0 = splitEdge(a, b)
      const m1 = splitEdge(b, c)
      const m2 = splitEdge(c, a)
      const mask = (m0 >= 0 ? 1 : 0) | (m1 >= 0 ? 2 : 0) | (m2 >= 0 ? 4 : 0)
      if (mask === 0) {
        next.push(a, b, c)
        continue
      }
      any = true
      if (mask === 7) next.push(a, m0, m2, m0, b, m1, m2, m1, c, m0, m1, m2)
      else if (mask === 1) next.push(a, m0, c, m0, b, c)
      else if (mask === 2) next.push(a, b, m1, a, m1, c)
      else if (mask === 4) next.push(a, b, m2, m2, b, c)
      else if (mask === 3) next.push(a, m0, m1, m0, b, m1, a, m1, c)
      else if (mask === 6) next.push(m1, c, m2, a, b, m1, a, m1, m2)
      else next.push(a, m0, m2, m0, b, c, m0, c, m2) // mask === 5
    }
    index = new Uint32Array(next)
    if (!any) break
  }
  return { position: new Float32Array(position), normal: new Float32Array(normal), index }
}

const buildBvh = (positions: Float32Array, index: Uint32Array): MeshBVH => {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setIndex(new BufferAttribute(index, 1))
  return new MeshBVH(geometry)
}

// Cosine-weighted hemisphere directions around +Z (Fibonacci lattice). Cosine weighting means the AO integral
// is just the mean visibility over these rays — no per-ray cosine term needed.
const cosineHemisphere = (n: number): Float32Array => {
  const out = new Float32Array(n * 3)
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n)
    const theta = golden * i
    out[i * 3] = Math.cos(theta) * r
    out[i * 3 + 1] = Math.sin(theta) * r
    out[i * 3 + 2] = Math.sqrt(Math.max(0, 1 - r * r))
  }
  return out
}

const bakeVertexAo = (core: Core, bvh: MeshBVH, dirs: Float32Array, opt: Required<AoBakeOptions>): Float32Array => {
  const count = core.position.length / 3
  const out = new Float32Array(count)
  const ray = new Ray()
  const P = new Vector3()
  const N = new Vector3()
  const T = new Vector3()
  const B = new Vector3()
  const up = new Vector3(0, 0, 1)
  const altUp = new Vector3(1, 0, 0)
  const dir = new Vector3()
  for (let i = 0; i < count; i++) {
    P.set(core.position[i * 3]!, core.position[i * 3 + 1]!, core.position[i * 3 + 2]!)
    N.set(core.normal[i * 3]!, core.normal[i * 3 + 1]!, core.normal[i * 3 + 2]!).normalize()
    T.crossVectors(Math.abs(N.z) < 0.99 ? up : altUp, N).normalize()
    B.crossVectors(N, T)
    let occ = 0
    for (let d = 0; d < opt.rays; d++) {
      const dx = dirs[d * 3]!
      const dy = dirs[d * 3 + 1]!
      const dz = dirs[d * 3 + 2]!
      dir.set(T.x * dx + B.x * dy + N.x * dz, T.y * dx + B.y * dy + N.y * dz, T.z * dx + B.z * dy + N.z * dz)
      ray.origin.copy(P).addScaledVector(N, opt.bias)
      ray.direction.copy(dir)
      // FrontSide only: a biased origin sits outside every closed solid, so a real occluder is always entered
      // through its outward (front) face. Back-faces are seen only when the origin has slipped inside a solid —
      // which happens at y=0 seams where a box base is coincident with the floor (or stairs/walls overlap). With
      // DoubleSide those interior back-walls counted as full occlusion and baked black spikes (the "dents").
      const hit = bvh.raycastFirst(ray, FrontSide, 0, opt.maxDist)
      if (hit) occ += 1 - hit.distance / opt.maxDist
    }
    let val = 1 - occ / opt.rays
    val = opt.floor + (1 - opt.floor) * Math.pow(Math.max(0, val), opt.strength)
    out[i] = Math.max(0, Math.min(1, val))
  }
  return out
}

// Attribute-aware QEM decimation. AO rides as a single attribute channel so collapses that distort occlusion
// are penalized (Garland & Heckbert 1998). The first `lockCount` (original, welded) vertices are pinned via
// vertex_lock, so the refined mesh = "the original mesh + the subdivided vertices AO needs" — silhouette and
// hard edges preserved exactly. ErrorAbsolute makes `decimateError` a world-unit threshold.
const decimate = (
  core: Core,
  ao: Float32Array,
  lockCount: number,
  opt: Required<AoBakeOptions>,
): { position: Float32Array; ao: Uint8Array; index: Uint32Array } => {
  const vcount = core.position.length / 3
  let newIndex = core.index
  if (MeshoptSimplifier.supported) {
    MeshoptSimplifier.useExperimentalFeatures = true
    const lock = new Uint8Array(vcount)
    for (let i = 0; i < lockCount && i < vcount; i++) lock[i] = 1
    const [simplified] = MeshoptSimplifier.simplifyWithAttributes(
      core.index,
      core.position,
      3,
      ao,
      1,
      [opt.aoWeight],
      lock,
      0,
      opt.decimateError,
      ['ErrorAbsolute'],
    )
    newIndex = simplified
  }
  const used = new Int32Array(vcount).fill(-1)
  let n = 0
  for (let i = 0; i < newIndex.length; i++) {
    const v = newIndex[i]!
    if (used[v] === -1) used[v] = n++
  }
  const position = new Float32Array(n * 3)
  const aoOut = new Uint8Array(n)
  for (let i = 0; i < vcount; i++) {
    const j = used[i]!
    if (j === -1) continue
    position[j * 3] = core.position[i * 3]!
    position[j * 3 + 1] = core.position[i * 3 + 1]!
    position[j * 3 + 2] = core.position[i * 3 + 2]!
    aoOut[j] = Math.max(0, Math.min(255, Math.round(ao[i]! * 255)))
  }
  const index = new Uint32Array(newIndex.length)
  for (let i = 0; i < newIndex.length; i++) index[i] = used[newIndex[i]!]!
  return { position, ao: aoOut, index }
}

const barycentric = (p: Vector3, a: Vector3, b: Vector3, c: Vector3): [number, number] => {
  const v0x = b.x - a.x
  const v0y = b.y - a.y
  const v0z = b.z - a.z
  const v1x = c.x - a.x
  const v1y = c.y - a.y
  const v1z = c.z - a.z
  const v2x = p.x - a.x
  const v2y = p.y - a.y
  const v2z = p.z - a.z
  const d00 = v0x * v0x + v0y * v0y + v0z * v0z
  const d01 = v0x * v1x + v0y * v1y + v0z * v1z
  const d11 = v1x * v1x + v1y * v1y + v1z * v1z
  const d20 = v2x * v0x + v2y * v0y + v2z * v0z
  const d21 = v2x * v1x + v2y * v1y + v2z * v1z
  const denom = d00 * d11 - d01 * d01 || 1
  return [(d11 * d20 - d01 * d21) / denom, (d00 * d21 - d01 * d20) / denom]
}

// For each surviving vertex, the ORIGINAL triangle it sits on + its barycentric coords. The survivor is
// exactly on the original surface; with no uv channel, both sides of a hard edge share the same position, so
// the nearest triangle reconstructs the right position either way (the uv-seam ambiguity only matters when a
// uv channel is shipped). Referencing the 3 vertex INDICES (not the triangle index) keeps reconstruction
// independent of how a loader orders triangles.
const computeParents = (
  positions: Float32Array,
  bvh: MeshBVH,
  originalPos: Float32Array,
  originalIndex: Uint32Array,
): { verts: Uint32Array; bary: Float32Array } => {
  const n = positions.length / 3
  const verts = new Uint32Array(n * 3)
  const bary = new Float32Array(n * 2)
  const target = { point: new Vector3(), faceIndex: 0, distance: 0 }
  const p = new Vector3()
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  for (let i = 0; i < n; i++) {
    p.set(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!)
    const hit = bvh.closestPointToPoint(p, target)
    const face = hit?.faceIndex ?? 0
    const ia = originalIndex[face * 3]!
    const ib = originalIndex[face * 3 + 1]!
    const ic = originalIndex[face * 3 + 2]!
    a.set(originalPos[ia * 3]!, originalPos[ia * 3 + 1]!, originalPos[ia * 3 + 2]!)
    b.set(originalPos[ib * 3]!, originalPos[ib * 3 + 1]!, originalPos[ib * 3 + 2]!)
    c.set(originalPos[ic * 3]!, originalPos[ic * 3 + 1]!, originalPos[ic * 3 + 2]!)
    const [u, v] = barycentric(p, a, b, c)
    verts[i * 3] = ia
    verts[i * 3 + 1] = ib
    verts[i * 3 + 2] = ic
    bary[i * 2] = u
    bary[i * 2 + 1] = v
  }
  return { verts, bary }
}

export const bakeAo = async (geometry: BufferGeometry, options: AoBakeOptions = {}): Promise<AoMeshEntry> => {
  const opt = { ...AO_DEFAULTS, ...options }
  if (MeshoptSimplifier.supported) await MeshoptSimplifier.ready

  const original = readCore(geometry)
  const dirs = cosineHemisphere(opt.rays)
  const bvh = buildBvh(original.position, original.index)

  const welded = weld(original)
  const lockCount = welded.position.length / 3
  const dense = subdivide(welded, opt.subdivLevel, opt.subdivMaxEdge)
  const aoFloat = bakeVertexAo(dense, bvh, dirs, opt)
  const refined = decimate(dense, aoFloat, lockCount, opt)
  const parents = computeParents(refined.position, bvh, original.position, original.index)

  return {
    vertCount: refined.position.length / 3,
    srcVertCount: original.position.length / 3,
    srcTriCount: original.index.length / 3,
    positions: refined.position,
    ao: refined.ao,
    indices: refined.index,
    parentVerts: parents.verts,
    parentBary: parents.bary,
  }
}
