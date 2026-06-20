import { useEffect } from 'react'
import Head from 'next/head'

const REPO = 'https://github.com/verekia/avao'

const SectionHead = ({ num, title }: { num: string; title: string }) => (
  <div className="section-head">
    <span className="section-num">{num}</span>
    <h2 className="section-title">{title}</h2>
    <span aria-hidden="true" className="section-rule" />
  </div>
)

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

      <div className="bg-deep flex h-full flex-col lg:flex-row">
        <aside className="panel m-3 flex shrink-0 flex-col overflow-y-auto lg:w-[368px]">
          {/* Hero header — diagonal cyan stripe motif + Orbitron wordmark, echoing the verekia hero */}
          <header className="bg-deep border-cyan/40 relative overflow-hidden border-b px-5 pt-6 pb-5">
            <div aria-hidden="true" className="panel-stripes pointer-events-none absolute inset-0 opacity-85" />
            <div
              aria-hidden="true"
              className="from-deep via-deep/60 pointer-events-none absolute inset-0 bg-gradient-to-r to-transparent"
            />
            <div className="relative">
              <h1 className="animate-fade-down-left font-display text-text-primary m-0 text-[2.7rem] leading-none font-semibold tracking-[0.1em] uppercase">
                AVAO
              </h1>
              <p className="animate-fade-down-left text-cyan font-display mt-2 text-[0.8rem] font-medium tracking-[0.28em] uppercase">
                Adaptive Vertex AO
              </p>
            </div>
          </header>

          <div className="text-ink-muted flex flex-col gap-6 p-5">
            <p className="text-ink-muted text-sm leading-relaxed">
              Ambient occlusion baked into a mesh that's{' '}
              <b className="text-ink font-semibold">re-meshed for the AO signal</b> — vertices cluster where occlusion
              varies (contact creases) and vanish across flat-lit faces. No lightmap, no UVs: one byte of AO per vertex.
            </p>

            <section>
              <SectionHead num="01" title="View" />
              <div className="flex flex-col gap-3">
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

                <div className="card card-accent px-4 py-3">
                  <div className="ctl">
                    <span className="ctl-label">AO intensity</span>
                    <span className="ctl-value" id="intensity-value">
                      1.4
                    </span>
                  </div>
                  <input id="intensity" className="mt-2.5" type="range" min="0" max="3" step="0.1" defaultValue="1.4" />
                </div>

                <button id="edges" type="button" className="seg-solo">
                  Added edges: off
                </button>
              </div>
            </section>

            <section>
              <SectionHead num="02" title="This Bake" />
              <div className="card card-accent flex flex-col gap-2.5 px-4 py-3.5">
                <div className="stat">
                  <span className="ctl-label">Source mesh</span>
                  <span id="stat-src" className="text-right">
                    —
                  </span>
                </div>
                <div className="stat">
                  <span className="ctl-label">Refined mesh</span>
                  <span id="stat-refined" className="text-right">
                    —
                  </span>
                </div>
                <div className="stat">
                  <span className="ctl-label">Cuts artifact</span>
                  <span id="stat-blob" className="text-right">
                    —
                  </span>
                </div>
              </div>
              <p className="text-ink-muted mt-3 text-sm leading-relaxed">
                The artifact ships, per surviving vertex, the three original vertices it sits between + weights + one AO
                byte. Positions are rebuilt from the base mesh at load — nothing geometric is re-shipped.
              </p>
            </section>
          </div>

          <footer className="border-hair mt-auto flex flex-col gap-3 border-t p-5">
            <a className="pill self-start" href={REPO} target="_blank" rel="noreferrer">
              <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
              </svg>
              github.com/verekia/avao
            </a>
            <p className="text-ink-faint m-0 text-xs leading-relaxed">
              Uses three-mesh-bvh and meshoptimizer (QEM decimation)
            </p>
            <div className="border-hair-soft text-ink-faint font-display mt-1 flex items-center gap-1.5 border-t pt-3 text-[0.62rem] tracking-[0.22em] uppercase">
              <span>A</span>
              <a href="https://verekia.com" target="_blank" rel="noreferrer" className="text-cyan-ink hover:text-cyan">
                verekia
              </a>
              <span>project</span>
            </div>
          </footer>
        </aside>

        <main className="relative flex-1">
          <div id="scene" className="absolute inset-0" />
          <div
            id="status"
            className="animate-status-blink text-cyan font-display absolute inset-0 flex items-center justify-center px-6 text-center text-sm tracking-[0.25em] uppercase"
            aria-live="polite"
          >
            Starting WebGPU…
          </div>
        </main>
      </div>
    </>
  )
}
