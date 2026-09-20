# 3D Model Viewer

A public, no-login web viewer for 3D models. Drop a file in, or paste a link and
send the resulting URL to anyone — they get the same model in their browser.

Built with Next.js (App Router) and three.js.

## What it does

- **Open a local file** — drag and drop anywhere on the page, or use *Open file*.
  Viewing is entirely local: the file is parsed and rendered in the browser and
  is not uploaded unless you press **Upload & copy link**.
- **Open a link** — paste a direct URL to a model. The page URL becomes
  `/?src=<model-url>`, which is the share link. Anyone who opens it sees the
  model immediately.
- **Share anything** — one click packs the current model into a single glTF,
  uploads it, and copies a link your recipient can just click.
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

Open any model, press **Upload & copy link**, and paste the link into an email
or a chat. The recipient clicks it and the model loads — no account, no
install, nothing to unzip.

```
https://your-deployment.vercel.app/?src=https://<store>.public.blob.vercel-storage.com/models/gate-xxxx.glb
```

What happens on that button press:

1. **The model is packed into one file.** A model opened from disk may be
   several files — a `.gltf` beside its `.bin` and textures, an `.obj` beside
   its `.mtl` — and formats like `.fbx` or `.stl` are not something a recipient
   can necessarily open. The loaded scene is exported to a binary glTF with its
   textures embedded, so exactly one URL has to be fetched. A model that was
   already a single `.glb` is sent as-is, keeping whatever Draco, Meshopt or
   KTX2 compression it arrived with.
2. **It uploads to Vercel Blob.** The browser uploads straight to storage using
   a short-lived token minted by `/api/upload`, so the file never has to fit
   through the 4.5 MB serverless request body limit. Models up to 120 MB.
3. **The link is copied to your clipboard.** It is also shown in the panel, so
   you can copy it by hand if the browser refuses the clipboard write.

A model loaded from a URL already has a link the recipient can fetch, so that
one is copied directly without uploading anything.

**Uploaded models are public.** The link is unguessable but not authenticated —
anyone holding it can view and download the model. Do not share work you are
not free to publish.

Pasting a direct link to a model hosted elsewhere works too. GitHub users: use
the `raw.githubusercontent.com` URL, not the repository page URL.

### Configuring sharing

Sharing needs a Vercel Blob store. Without one the viewer still opens and
renders models; only the upload fails, with a message saying so.

```bash
vercel blob create-store models --access public --yes
```

That creates the store, links it to the project, and sets
`BLOB_READ_WRITE_TOKEN`. Run `vercel env pull .env.local` to develop locally.

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
| `src/app/api/upload/route.ts` | Mints short-lived Blob upload tokens for the browser |
| `src/lib/pack.ts` | Packs a model to a single glTF and uploads it |
| `src/components/ModelViewer.tsx` | All UI — toolbar, control panel, drag-and-drop, state |
| `src/lib/engine.ts` | three.js scene, camera, lighting, controls, render loop |
| `src/lib/loader.ts` | Per-format loader dispatch and multi-file resolution |
| `src/lib/inspect.ts` | Model statistics, normalisation, GPU disposal |
| `public/draco`, `public/basis` | Self-hosted decoders vendored from three.js |

## Deploying

Push to GitHub and import the repository on Vercel, or run `vercel --prod`.
The only configuration is `BLOB_READ_WRITE_TOKEN`, which `vercel blob
create-store` sets for you; everything else works with no setup and there is no
database.
