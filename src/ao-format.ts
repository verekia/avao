// The compact "cuts" artifact. Rather than shipping the refined geometry, it ships — per surviving vertex —
// the three ORIGINAL vertices it sits between, the barycentric weights, and one AO byte, plus the refined
// index buffer. At load, positions are rebuilt by interpolating the base mesh (already in memory), so nothing
// geometric is re-shipped. The per-vertex ref/bary/AO streams also gzip far better than raw positions.
//
//   [magic][vertCount u32][triCount u32]
//   [parentVerts u16×3 ×vert][parentBary u16×2 ×vert (normalized 0..1)][ao u8 ×vert][indices u32×3 ×tri]

import { BufferAttribute, BufferGeometry } from 'three'

import type { AoMeshEntry } from './ao-bake'

export const AO_ATTRIBUTE = 'aoBake'

const AO_MAGIC = 0x41564131 // "AVA1"

export type ParsedAoEntry = {
  parentVerts: Uint16Array
  parentBary: Uint16Array
  ao: Uint8Array
  indices: Uint32Array
}

export const serializeAo = (entry: AoMeshEntry): ArrayBuffer => {
  const verts = entry.vertCount
  const tris = entry.indices.length / 3
  const size = 4 + 4 + 4 + verts * 6 + verts * 4 + verts + tris * 12
  const buffer = new ArrayBuffer(size)
  const view = new DataView(buffer)
  let o = 0
  const u16 = (x: number) => {
    view.setUint16(o, x, true)
    o += 2
  }
  const u32 = (x: number) => {
    view.setUint32(o, x, true)
    o += 4
  }
  u32(AO_MAGIC)
  u32(verts)
  u32(tris)
  for (let i = 0; i < verts * 3; i++) u16(entry.parentVerts[i]!)
  for (let i = 0; i < verts * 2; i++) u16(Math.max(0, Math.min(65535, Math.round(entry.parentBary[i]! * 65535))))
  for (let i = 0; i < verts; i++) {
    view.setUint8(o, entry.ao[i]!)
    o += 1
  }
  for (let i = 0; i < tris * 3; i++) u32(entry.indices[i]!)
  return buffer
}

export const parseAo = (buffer: ArrayBuffer): ParsedAoEntry | null => {
  const view = new DataView(buffer)
  if (view.getUint32(0, true) !== AO_MAGIC) return null
  let o = 4
  const u16 = () => {
    const x = view.getUint16(o, true)
    o += 2
    return x
  }
  const u32 = () => {
    const x = view.getUint32(o, true)
    o += 4
    return x
  }
  const verts = u32()
  const tris = u32()
  const parentVerts = new Uint16Array(verts * 3)
  for (let i = 0; i < verts * 3; i++) parentVerts[i] = u16()
  const parentBary = new Uint16Array(verts * 2)
  for (let i = 0; i < verts * 2; i++) parentBary[i] = u16()
  const ao = new Uint8Array(verts)
  for (let i = 0; i < verts; i++) {
    ao[i] = view.getUint8(o)
    o += 1
  }
  const indices = new Uint32Array(tris * 3)
  for (let i = 0; i < tris * 3; i++) indices[i] = u32()
  return { parentVerts, parentBary, ao, indices }
}

// AO rides as `unorm8x4` (WebGPU has no 1-/2-byte vertex format and demands a 4-byte arrayStride): occlusion
// in .x, y/z/w reserved. Default 255 = no occlusion.
const AO_STRIDE = 4
const aoToInterleaved = (src: Uint8Array): Uint8Array => {
  const out = new Uint8Array(src.length * AO_STRIDE)
  for (let i = 0; i < src.length; i++) out[i * AO_STRIDE] = src[i] ?? 255
  return out
}

// Rebuild the refined render geometry by interpolating the ORIGINAL mesh at each stored cut. Flat normals are
// recomputed — welding stayed within coplanar faces, so computeVertexNormals reproduces the faceted shading.
export const buildRefinedGeometry = (entry: ParsedAoEntry, original: BufferGeometry): BufferGeometry => {
  const verts = entry.ao.length
  const srcPos = original.attributes.position as BufferAttribute
  const positions = new Float32Array(verts * 3)
  for (let i = 0; i < verts; i++) {
    const ia = entry.parentVerts[i * 3]!
    const ib = entry.parentVerts[i * 3 + 1]!
    const ic = entry.parentVerts[i * 3 + 2]!
    const u = entry.parentBary[i * 2]! / 65535
    const v = entry.parentBary[i * 2 + 1]! / 65535
    const w = 1 - u - v
    positions[i * 3] = w * srcPos.getX(ia) + u * srcPos.getX(ib) + v * srcPos.getX(ic)
    positions[i * 3 + 1] = w * srcPos.getY(ia) + u * srcPos.getY(ib) + v * srcPos.getY(ic)
    positions[i * 3 + 2] = w * srcPos.getZ(ia) + u * srcPos.getZ(ib) + v * srcPos.getZ(ic)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute(AO_ATTRIBUTE, new BufferAttribute(aoToInterleaved(entry.ao), AO_STRIDE, true))
  geometry.setIndex(new BufferAttribute(entry.indices, 1))
  geometry.computeVertexNormals()
  return geometry
}

type BytePair = ReadableWritablePair<Uint8Array, Uint8Array>

// Native gzip, just to report the realistic on-the-wire artifact size.
export const gzipSize = async (data: ArrayBuffer): Promise<number> => {
  const body = new Response(data).body
  if (!body) return data.byteLength
  const out = await new Response(body.pipeThrough(new CompressionStream('gzip') as unknown as BytePair)).arrayBuffer()
  return out.byteLength
}
