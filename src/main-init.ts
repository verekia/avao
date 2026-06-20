import { AO_DEFAULTS, bakeAo, type AoBakeOptions } from './ao-bake'
import { buildRefinedGeometry, gzipSize, parseAo, serializeAo } from './ao-format'
import { initScene, setBaseMesh, setIntensity, setShowEdges, setView, setWorld } from './three-scene'
import { buildWorld } from './world'

let initialized = false

const $ = (id: string) => document.getElementById(id)

const nextPaint = () => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))

// Keys mirror AoBakeOptions; the markup exposes a range input `p-<key>` + readout `p-<key>-value` per key.
const PARAM_KEYS = ['rays', 'maxDist', 'strength', 'floor', 'subdivLevel', 'decimateError', 'aoWeight'] as const

// AO and Edges views need a bake first; No AO (the plain mesh) renders immediately.
const BAKE_ONLY_VIEWS = ['view-ao', 'view-edges']

export const init = async () => {
  if (initialized) return
  initialized = true

  const container = $('scene')
  const status = $('status')
  if (!container) return

  // The status overlay also carries the `flex` class, which beats the [hidden] UA rule — toggle display directly.
  const showStatus = (text: string) => {
    if (!status) return
    status.style.display = 'flex'
    status.textContent = text
  }
  const hideStatus = () => {
    if (status) status.style.display = 'none'
  }

  try {
    await initScene(container)
  } catch {
    showStatus('This demo needs a WebGPU browser (Chrome, Edge, or Safari Technology Preview).')
    return
  }

  // The procedural courtyard is built once; every bake re-runs against it with whatever parameters are set.
  const world = buildWorld()

  // --- bake parameters --------------------------------------------------------
  const paramInput = (key: string) => $(`p-${key}`) as HTMLInputElement | null
  const readParam = (key: string): number => {
    const fallback = (AO_DEFAULTS as Record<string, number>)[key]!
    const el = paramInput(key)
    const v = el ? Number(el.value) : fallback
    return Number.isFinite(v) ? v : fallback
  }
  const readOptions = (): AoBakeOptions => ({
    rays: Math.round(readParam('rays')),
    maxDist: readParam('maxDist'),
    strength: readParam('strength'),
    floor: readParam('floor'),
    subdivLevel: Math.round(readParam('subdivLevel')),
    decimateError: readParam('decimateError'),
    aoWeight: readParam('aoWeight'),
  })
  for (const key of PARAM_KEYS) {
    const el = paramInput(key)
    const out = $(`p-${key}-value`)
    if (!el || !out) continue
    const sync = () => {
      out.textContent = el.value
    }
    el.addEventListener('input', sync)
    sync()
  }

  const set = (id: string, html: string) => {
    const el = $(id)
    if (el) el.innerHTML = html
  }

  // --- view controls (defined before the bake so the bake can switch to AO) ----
  // Segments: No AO (plain mesh), AO (refined mesh), Edges (refined mesh + the added-edge overlay).
  const viewButtons = [
    ['view-plain', 'plain'],
    ['view-ao', 'ao'],
    ['view-edges', 'edges'],
  ] as const
  const selectView = (seg: 'plain' | 'ao' | 'edges') => {
    setView(seg === 'plain' ? 'plain' : 'ao')
    setShowEdges(seg === 'edges')
    for (const [id, s] of viewButtons) $(id)?.classList.toggle('is-active', s === seg)
  }
  for (const [id, seg] of viewButtons) $(id)?.addEventListener('click', () => selectView(seg))

  const intensity = $('intensity') as HTMLInputElement | null
  const intensityValue = $('intensity-value')
  const applyIntensity = () => {
    const v = intensity ? Number(intensity.value) : 2
    setIntensity(v)
    if (intensityValue) intensityValue.textContent = v.toFixed(1)
  }
  intensity?.addEventListener('input', applyIntensity)
  applyIntensity()

  const setBakeViewsEnabled = (enabled: boolean) => {
    for (const id of BAKE_ONLY_VIEWS) {
      const b = $(id) as HTMLButtonElement | null
      if (b) b.disabled = !enabled
    }
  }

  // --- bake -------------------------------------------------------------------
  const bakeBtn = $('bake') as HTMLButtonElement | null
  let baking = false
  let hasBaked = false
  const runBake = async () => {
    if (baking) return
    baking = true
    if (bakeBtn) {
      bakeBtn.disabled = true
      bakeBtn.textContent = 'Baking…'
    }
    showStatus('Baking ambient occlusion…')
    await nextPaint()

    const t0 = performance.now()
    const entry = await bakeAo(world, readOptions())
    const bakeMs = Math.round(performance.now() - t0)

    // Round-trip through the real cuts artifact: serialize, measure, parse, rebuild from the base mesh.
    const raw = serializeAo(entry)
    const gz = await gzipSize(raw)
    const parsed = parseAo(raw)
    if (parsed) {
      const refined = buildRefinedGeometry(parsed, world)
      ;(window as unknown as { __dbg?: unknown }).__dbg = { entry, refined, world }
      setWorld(world, refined)
      hideStatus()

      // AO views are now available; show the AO result.
      setBakeViewsEnabled(true)
      selectView('ao')

      const refinedTris = entry.indices.length / 3
      set(
        'stat-src',
        `<b>${entry.srcVertCount.toLocaleString()}</b> verts · <b>${entry.srcTriCount.toLocaleString()}</b> tris`,
      )
      set(
        'stat-refined',
        `<b>${entry.vertCount.toLocaleString()}</b> verts · <b>${refinedTris.toLocaleString()}</b> tris`,
      )
      set('stat-blob', `<b>${(gz / 1024).toFixed(1)} KB</b> gzipped · baked in ${bakeMs} ms`)
      hasBaked = true
    }

    if (bakeBtn) {
      bakeBtn.disabled = false
      bakeBtn.textContent = hasBaked ? 'Re-bake' : 'Bake'
    }
    baking = false
  }
  bakeBtn?.addEventListener('click', () => void runBake())

  // --- initial state: render the No AO (plain) scene; AO views await the first bake ---
  setBaseMesh(world)
  setBakeViewsEnabled(false)
  selectView('plain')
  hideStatus()
}
