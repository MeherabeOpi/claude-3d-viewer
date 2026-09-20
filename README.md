# 3D Model Viewer

A public, no-login web viewer for 3D models. Drop a file in, or paste a link and
send the resulting URL to anyone — they get the same model in their browser.

Built with Next.js (App Router) and three.js.

## What it does

- **Open a local file** — drag and drop anywhere on the page, or use *Open file*.
  Local files are parsed and rendered entirely in the browser; nothing is
  uploaded anywhere.
- **Open a link** — paste a direct URL to a model. The page URL becomes
  `/?src=<model-url>`, which is the share link. Anyone who opens it sees the
  model immediately.
- **Inspect** — mesh, material, texture, vertex and triangle counts plus the
  model's bounding box.
- **Control the view** — six axis presets, orbit/pan/zoom, auto-rotate,
  wireframe, ground grid, contact shadow, and an exposure slider.
- **Animations** — any clips found in the file are listed and playable.
- **Export** — save the current framing as a PNG.

## Supported formats

`.glb` · `.gltf` · `.obj` · `.fbx` · `.stl` · `.ply` · `.dae` · `.3mf` · `.usdz`

glTF files using Draco compression, Meshopt compression or KTX2/Basis textures
work out of the box — the decoders are self-hosted from `public/`, so no CDN
call is needed.

When you drop a multi-file model (a `.gltf` with its `.bin` and textures, or an
`.obj` with its `.mtl`), select all the files together and their relative
references resolve against each other.

## Sharing a model

Only URL-loaded models produce a share link — a local file never leaves the
viewer's machine, so there is nothing for a recipient to fetch. Put the model
somewhere with a public direct link first, then paste that link:

```
https://your-deployment.vercel.app/?src=https://example.com/model.glb
```

Any direct file link works. GitHub users: use the `raw.githubusercontent.com`
URL, not the repository page URL.

## The proxy

Many hosts serve model files without CORS headers, which the browser blocks.
The viewer therefore tries to fetch a model directly first and, only if that
fails, retries through `/api/proxy`.

The proxy is deliberately narrow:

- `http`/`https` only.
- Refuses loopback, link-local and RFC 1918 hosts, plus cloud metadata
  endpoints, so it cannot be used to reach private infrastructure.
- Caps responses at 200 MB.
- Serves bytes only — responses carry `default-src 'none'; sandbox` and
  `nosniff`, so nothing fetched through it can execute as a page.

## Running locally

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

```bash
npm run build   # production build
npm run lint    # eslint
```

## Project layout

| Path | Purpose |
| --- | --- |
| `src/app/page.tsx` | Route shell; wraps the viewer in `<Suspense>` for `useSearchParams` |
| `src/app/api/proxy/route.ts` | Same-origin CORS proxy with SSRF guards |
| `src/components/ModelViewer.tsx` | All UI — toolbar, control panel, drag-and-drop, state |
| `src/lib/engine.ts` | three.js scene, camera, lighting, controls, render loop |
| `src/lib/loader.ts` | Per-format loader dispatch and multi-file resolution |
| `src/lib/inspect.ts` | Model statistics, normalisation, GPU disposal |
| `public/draco`, `public/basis` | Self-hosted decoders vendored from three.js |

## Deploying

The app is a stock Next.js deployment with no environment variables and no
database. Push to GitHub and import the repository on Vercel, or run
`vercel --prod`.
