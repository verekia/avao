import { AO_DEFAULTS, bakeAo } from './ao-bake'
import { buildRefinedGeometry, gzipSize, parseAo, serializeAo } from './ao-format'
import { frameDefault, initScene, setIntensity, setShowEdges, setView, setWorld, type ViewMode } from './three-scene'
import { buildWorld } from './world'

let initialized = false

const $ = (id: string) => document.getElementById(id)

const nextPaint = () => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))

export const init = async () => {
  if (initialized) return
  initialized = true

  const container = $('scene')
  const status = $('status')
  if (!container) return

  try {
    await initScene(container)
  } catch {
    if (status) status.textContent = 'This demo needs a WebGPU browser (Chrome, Edge, or Safari Technology Preview).'
    return
  }

  const world = buildWorld()

  if (status) status.textContent = 'Baking ambient occlusion…'
  await nextPaint()

  const t0 = performance.now()
  const entry = await bakeAo(world, AO_DEFAULTS)
  const bakeMs = Math.round(performance.now() - t0)

  // Round-trip through the real cuts artifact: serialize, measure, parse, rebuild from the base mesh.
  const raw = serializeAo(entry)
  const gz = await gzipSize(raw)
  const parsed = parseAo(raw)
  if (!parsed) return
  const refined = buildRefinedGeometry(parsed, world)
  ;(window as unknown as { __dbg?: unknown }).__dbg = { entry, refined, world }

  setWorld(world, refined)
  if (status) status.remove()

  const refinedTris = entry.indices.length / 3
  const set = (id: string, html: string) => {
    const el = $(id)
    if (el) el.innerHTML = html
  }
  set(
    'stat-src',
    `<b>${entry.srcVertCount.toLocaleString()}</b> verts · <b>${entry.srcTriCount.toLocaleString()}</b> tris`,
  )
  set('stat-refined', `<b>${entry.vertCount.toLocaleString()}</b> verts · <b>${refinedTris.toLocaleString()}</b> tris`)
  set('stat-blob', `<b>${(gz / 1024).toFixed(1)} KB</b> gzipped · baked in ${bakeMs} ms`)

  // --- controls ---------------------------------------------------------------------------------------
  const viewButtons = [
    ['view-ao', 'ao'],
    ['view-plain', 'plain'],
    ['view-field', 'field'],
  ] as const
  const selectView = (mode: ViewMode) => {
    setView(mode)
    for (const [id, m] of viewButtons) $(id)?.classList.toggle('is-active', m === mode)
  }
  for (const [id, mode] of viewButtons) $(id)?.addEventListener('click', () => selectView(mode))
  selectView('ao')

  const intensity = $('intensity') as HTMLInputElement | null
  const intensityValue = $('intensity-value')
  const applyIntensity = () => {
    const v = intensity ? Number(intensity.value) : 1.5
    setIntensity(v)
    if (intensityValue) intensityValue.textContent = v.toFixed(1)
  }
  intensity?.addEventListener('input', applyIntensity)
  applyIntensity()

  let edgesOn = false
  const edgesBtn = $('edges')
  edgesBtn?.addEventListener('click', () => {
    edgesOn = !edgesOn
    setShowEdges(edgesOn)
    edgesBtn.classList.toggle('is-active', edgesOn)
    edgesBtn.textContent = edgesOn ? 'Added edges: on' : 'Added edges: off'
  })

  $('reset')?.addEventListener('click', frameDefault)
}
