// WebGPU preview. The refined mesh carries the baked occlusion in a `aoBake` vertex attribute; the AO node
// folds it into the material's ambient (indirect) term only — `(ao - 1) * intensity + 1` — exactly as a
// shipping renderer would. Direct light is untouched. Three view modes: the lit result, the bare original
// mesh (no AO), and the raw AO field; plus a magenta overlay of the edges the refine pass added.

import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  PerspectiveCamera,
  Scene,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { attribute, uniform, vec3, vec4 } from 'three/tsl'
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial, WebGPURenderer } from 'three/webgpu'

import { AO_ATTRIBUTE } from './ao-format'

export type ViewMode = 'ao' | 'plain' | 'field'

const BASE_COLOR = '#b9b2a6'
const aoIntensity = uniform(1)
const aoNode = vec4(attribute(AO_ATTRIBUTE, 'vec4')).x.sub(1).mul(aoIntensity).add(1)

let renderer: WebGPURenderer | null = null
let scene: Scene
let camera: PerspectiveCamera
let controls: OrbitControls
let mesh: Mesh
let edges: LineSegments | null = null

let originalGeom: BufferGeometry | null = null
let refinedGeom: BufferGeometry | null = null
let view: ViewMode = 'ao'
let showEdges = false

const aoLit = new MeshStandardNodeMaterial({ color: new Color(BASE_COLOR), roughness: 1, metalness: 0 })
aoLit.aoNode = aoNode
const plainLit = new MeshStandardNodeMaterial({ color: new Color(BASE_COLOR), roughness: 1, metalness: 0 })
const aoField = new MeshBasicNodeMaterial()
aoField.colorNode = vec3(vec4(attribute(AO_ATTRIBUTE, 'vec4')).x)

// Magenta overlay of edges the refine pass ADDED: any edge touching a vertex with no original vertex within
// ~`cell` (a 27-cell spatial hash). Lines are lifted along the normal so they don't z-fight the surface.
const buildAddedEdges = (refined: BufferGeometry, original: BufferGeometry): LineSegments | null => {
  const op = original.attributes.position as BufferAttribute
  const rp = refined.attributes.position as BufferAttribute
  const rn = refined.attributes.normal as BufferAttribute | undefined
  const ri = refined.index
  if (!ri) return null
  const cell = 0.05
  const key = (x: number, y: number, z: number) =>
    `${Math.round(x / cell)},${Math.round(y / cell)},${Math.round(z / cell)}`
  const occupied = new Set<string>()
  for (let i = 0; i < op.count; i++) occupied.add(key(op.getX(i), op.getY(i), op.getZ(i)))

  const isNew = new Uint8Array(rp.count)
  for (let i = 0; i < rp.count; i++) {
    const cx = Math.round(rp.getX(i) / cell)
    const cy = Math.round(rp.getY(i) / cell)
    const cz = Math.round(rp.getZ(i) / cell)
    let near = false
    for (let dx = -1; dx <= 1 && !near; dx++)
      for (let dy = -1; dy <= 1 && !near; dy++)
        for (let dz = -1; dz <= 1 && !near; dz++) if (occupied.has(`${cx + dx},${cy + dy},${cz + dz}`)) near = true
    isNew[i] = near ? 0 : 1
  }

  const verts: number[] = []
  const seen = new Set<number>()
  const push = (i: number) => {
    const e = 0.012
    verts.push(
      rp.getX(i) + (rn ? rn.getX(i) : 0) * e,
      rp.getY(i) + (rn ? rn.getY(i) : 0) * e,
      rp.getZ(i) + (rn ? rn.getZ(i) : 0) * e,
    )
  }
  const consider = (i: number, j: number) => {
    if (!isNew[i] && !isNew[j]) return
    const k = i < j ? i * 0x4000000 + j : j * 0x4000000 + i
    if (seen.has(k)) return
    seen.add(k)
    push(i)
    push(j)
  }
  for (let t = 0; t < ri.count; t += 3) {
    const a = ri.getX(t)
    const b = ri.getX(t + 1)
    const c = ri.getX(t + 2)
    consider(a, b)
    consider(b, c)
    consider(c, a)
  }
  if (verts.length === 0) return null
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3))
  const lines = new LineSegments(geometry, new LineBasicMaterial({ color: 0xff2bb0 }))
  lines.frustumCulled = false
  return lines
}

const apply = () => {
  if (!originalGeom || !refinedGeom) return
  mesh.visible = true
  if (view === 'plain') {
    mesh.geometry = originalGeom
    mesh.material = plainLit
  } else if (view === 'field') {
    mesh.geometry = refinedGeom
    mesh.material = aoField
  } else {
    mesh.geometry = refinedGeom
    mesh.material = aoLit
  }
  if (edges) edges.visible = showEdges
}

export const initScene = async (container: HTMLElement) => {
  if (renderer) return
  renderer = new WebGPURenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

  scene = new Scene()
  scene.background = new Color('#15171c')
  camera = new PerspectiveCamera(46, 1, 0.1, 100)
  camera.position.set(9, 13, 10.5)

  scene.add(new AmbientLight(0xffffff, 0.7))
  const sun = new DirectionalLight(0xfff2e0, 1.25)
  sun.position.set(6, 10, 4)
  scene.add(sun)
  const fill = new DirectionalLight(0xbcd0ff, 0.25)
  fill.position.set(-6, 4, -6)
  scene.add(fill)

  mesh = new Mesh(new BufferGeometry(), plainLit)
  mesh.visible = false // nothing to draw until the bake provides geometry (avoids a "no position" warning)
  scene.add(mesh)

  container.appendChild(renderer.domElement)
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.target.set(0, 0.9, -0.5)
  controls.minDistance = 6
  controls.maxDistance = 40

  const resize = () => {
    if (!renderer) return
    const w = container.clientWidth
    const h = container.clientHeight
    if (w === 0 || h === 0) return
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  new ResizeObserver(resize).observe(container)
  resize()

  await renderer.init()
  renderer.setAnimationLoop(() => {
    if (!renderer) return
    controls.update()
    renderer.render(scene, camera)
  })
}

export const setWorld = (original: BufferGeometry, refined: BufferGeometry) => {
  originalGeom = original
  refinedGeom = refined
  if (edges) {
    scene.remove(edges)
    edges.geometry.dispose()
    ;(edges.material as LineBasicMaterial).dispose()
  }
  edges = buildAddedEdges(refined, original)
  if (edges) {
    edges.visible = showEdges
    scene.add(edges)
  }
  apply()
}

export const setView = (mode: ViewMode) => {
  view = mode
  apply()
}

export const setIntensity = (v: number) => {
  aoIntensity.value = v
}

export const setShowEdges = (on: boolean) => {
  showEdges = on
  if (edges) edges.visible = on
}

export const frameDefault = () => {
  if (!controls) return
  camera.position.set(9, 13, 10.5)
  controls.target.set(0, 0.9, -0.5)
  controls.update()
}
