# AVAO — Adaptive Vertex AO

AVAO is a technique for baking **ambient occlusion into a mesh that has been re-meshed for
the AO signal**: vertices cluster where occlusion actually varies (contact creases, corners) and disappear
across flat-lit faces. No lightmap, no UVs, no second texture — just **one byte of AO per vertex**, folded into
the ambient term in the shader.

**Disclaimer**: This project is vibe coded. The code has not been reviewed. Use as your own risk.

## The problem

Per-vertex AO is cheap and texture-free, but baking it at a mesh's existing vertices can't make a contact
shadow any crisper than those vertices allow — on a big flat floor the darkening just smears across the whole
face. Subdividing everything fixes the crispness but explodes the vertex count (and VRAM, and download).

## The technique

The mesh is re-meshed _for the AO_, so detail lands exactly where occlusion varies and nowhere else:

```
weld → subdivide → bake → attribute-aware QEM decimate
```

1. **Weld** by `(position, normal)` — recover shared vertices inside coplanar faces, keep hard creases split.
2. **Conforming adaptive subdivision** — split any edge longer than a threshold via red/green templates, so
   neighbouring triangles always agree on a shared edge: no T-junctions, no cracks.
3. **Bake** AO per vertex — cosine-weighted hemisphere visibility with a distance falloff, so near occluders
   darken hard and far ones barely register (contact creases, not a flat global dim).
4. **Decimate** with QEM extended by the AO scalar ([Garland & Heckbert 1998][gh98]) — edges collapse freely
   across flat-AO regions, vertices survive only along AO boundaries. The **original vertices are pinned**, so
   the silhouette and every hard edge are preserved exactly and the result is "the original mesh **plus** only
   the vertices AO needs."

Subdivision level only sets bake precision; the **decimation error threshold** is the size/quality knob — so
sharper AO and a small mesh aren't a tradeoff, they're the same objective (fewest vertices that still hold the
signal).

## The artifact

The shipped file doesn't contain geometry. For each surviving vertex it stores the **three original vertices it
sits between**, the barycentric weights, and one AO byte — plus the refined index buffer. At load, positions are
rebuilt by interpolating the base mesh (already in memory), so nothing geometric is re-shipped, and the
ref/bary/AO streams gzip far better than raw positions. Normals are recomputed at load; welding stayed within
coplanar faces, so they come back flat for free.

The same pipeline can instead ship the refined geometry outright — simpler, larger.

## Run it

```bash
bun install
bun dev        # then open the dev URL
bun run build  # static export to ./out
bun run all    # format + lint + typecheck + warden
```

Requires a **WebGPU** browser (recent Chrome/Edge, or Safari Technology Preview).

## How it's built

Plain [three.js](https://threejs.org) (no React Three Fiber) on Next.js + React, WebGPU/TSL for the render.
The bake uses [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) to trace the occlusion rays and
[meshoptimizer](https://github.com/zeux/meshoptimizer)'s `simplifyWithAttributes` for the attribute-aware QEM
decimation. Everything — generate world, bake, serialize, reconstruct, render — runs client-side.

- `src/world.ts` — the procedural courtyard (flat-shaded boxes).
- `src/ao-bake.ts` — weld → subdivide → bake → decimate.
- `src/ao-format.ts` — the compact blueprint artifact (serialize / parse / rebuild from the base mesh).
- `src/three-scene.ts` — the WebGPU/TSL preview and the AO node.
- `src/main-init.ts` — glue: build → bake → wire controls + stats.

## References

- Garland & Heckbert, [_Simplifying Surfaces with Color and Texture using Quadric Error Metrics_][gh98] (1998)
- Garland & Heckbert, _Surface Simplification Using Quadric Error Metrics_ (1997)
- Hoppe, _New Quadric Metric for Simplifying Meshes with Appearance Attributes_ (1999)

[gh98]: https://www.cs.cmu.edu/~garland/Papers/quadric2.pdf

## License

MIT
