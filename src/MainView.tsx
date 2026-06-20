import { useEffect } from 'react'
import Head from 'next/head'

const REPO = 'https://github.com/verekia/avao'

export const MainView = () => {
  useEffect(() => {
    let cancelled = false
    void import('./main-init').then(m => {
      if (!cancelled) void m.init()
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      <Head>
        <title>AVAO — Adaptive Vertex AO</title>
        <meta
          name="description"
          content="Adaptive Vertex AO: bake ambient occlusion onto a mesh re-meshed for the AO signal — dense at contacts, sparse on flats."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </Head>

      <div className="flex h-full flex-col lg:flex-row">
        <aside className="panel m-3 flex shrink-0 flex-col gap-5 overflow-y-auto p-5 lg:w-[360px]">
          <header>
            <div className="flex items-center gap-2">
              <span className="bg-accent inline-block size-3 rounded-sm" />
              <h1 className="text-text-bright m-0 text-lg font-semibold tracking-tight">AVAO</h1>
              <span className="text-muted-2 text-sm">Adaptive Vertex AO</span>
            </div>
            <p className="text-muted mt-2 text-sm leading-relaxed">
              Ambient occlusion baked into a mesh that's <b className="text-text">re-meshed for the AO signal</b> —
              vertices cluster where occlusion varies (contact creases) and vanish across flat-lit faces. No lightmap,
              no UVs: one byte of AO per vertex.
            </p>
          </header>

          <section className="flex flex-col gap-3">
            <span className="text-muted-2 text-xs font-medium tracking-wider uppercase">View</span>
            <div className="seg">
              <button id="view-ao" type="button">
                AO
              </button>
              <button id="view-plain" type="button">
                No AO
              </button>
              <button id="view-field" type="button">
                AO field
              </button>
            </div>

            <div>
              <div className="ctl">
                <span className="ctl-label">AO intensity</span>
                <span className="ctl-value" id="intensity-value">
                  2.0
                </span>
              </div>
              <input
                id="intensity"
                className="mt-1.5 w-full"
                type="range"
                min="0"
                max="3"
                step="0.1"
                defaultValue="2"
              />
            </div>

            <button id="edges" type="button" className="seg-solo">
              Added edges: off
            </button>
            <button id="reset" type="button" className="seg-solo">
              Reset view
            </button>
          </section>

          <section className="border-line flex flex-col gap-2 border-t pt-4">
            <span className="text-muted-2 text-xs font-medium tracking-wider uppercase">This bake</span>
            <div className="stat">
              <span className="ctl-label">Source mesh</span>
              <span id="stat-src">—</span>
            </div>
            <div className="stat">
              <span className="ctl-label">Refined mesh</span>
              <span id="stat-refined">—</span>
            </div>
            <div className="stat">
              <span className="ctl-label">Cuts artifact</span>
              <span id="stat-blob">—</span>
            </div>
          </section>

          <section className="text-muted text-sm leading-relaxed">
            <p className="m-0">
              The artifact ships, per surviving vertex, the three original vertices it sits between + weights + one AO
              byte. Positions are rebuilt from the base mesh at load — nothing geometric is re-shipped.
            </p>
          </section>

          <footer className="border-line mt-auto flex flex-col gap-3 border-t pt-4">
            <a className="pill self-start" href={REPO} target="_blank" rel="noreferrer">
              <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
              </svg>
              github.com/verekia/avao
            </a>
            <p className="text-muted-2 m-0 text-xs leading-relaxed">
              Drag to orbit · scroll to zoom. The mesh is a procedural courtyard; AO is baked in your browser with
              three-mesh-bvh (rays) and meshoptimizer (QEM decimation).
            </p>
          </footer>
        </aside>

        <main className="relative flex-1">
          <div id="scene" className="absolute inset-0" />
          <div
            id="status"
            className="text-muted-2 absolute inset-0 flex items-center justify-center text-sm"
            aria-live="polite"
          >
            Starting WebGPU…
          </div>
        </main>
      </div>
    </>
  )
}
