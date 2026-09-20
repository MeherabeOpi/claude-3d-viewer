"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type * as THREE from "three";
import { Viewer, BACKDROPS, type BackdropName } from "@/lib/engine";
import { loadFromFiles, loadFromUrl } from "@/lib/loader";
import { inspect, type ModelStats } from "@/lib/inspect";
import {
  ACCEPT_ATTRIBUTE,
  MODEL_EXTENSIONS,
  baseName,
  formatBytes,
  formatCount,
} from "@/lib/formats";
import { SAMPLES } from "@/lib/samples";
import { packForSharing, uploadModel } from "@/lib/pack";

type Status =
  | { phase: "empty" }
  | { phase: "loading"; note: string; ratio: number }
  | { phase: "ready" }
  | { phase: "error"; message: string };

type Sharing =
  | { phase: "idle" }
  | { phase: "packing" }
  | { phase: "uploading"; percentage: number }
  | { phase: "error"; message: string };

/** What the current model was built from, kept so it can be packed to share. */
type Source = {
  files: File[] | null;
  object: THREE.Object3D;
  animations: THREE.AnimationClip[];
};

type Loaded = {
  name: string;
  stats: ModelStats;
  bytes: number;
  clips: string[];
  shareUrl: string | null;
};

export default function ModelViewer() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const srcParam = searchParams.get("src");

  const mountRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const loadTokenRef = useRef(0);
  const sourceRef = useRef<Source | null>(null);

  const [status, setStatus] = useState<Status>({ phase: "empty" });
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [dragging, setDragging] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState<Sharing>({ phase: "idle" });
  const [copyFailed, setCopyFailed] = useState(false);

  const [autoRotate, setAutoRotate] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [grid, setGrid] = useState(false);
  const [shadow, setShadow] = useState(true);
  const [backdrop, setBackdrop] = useState<BackdropName>("studio");
  const [exposure, setExposure] = useState(1);
  const [activeClip, setActiveClip] = useState<number | null>(null);

  // ---- engine lifecycle -------------------------------------------------
  useEffect(() => {
    if (!mountRef.current) return;
    const viewer = new Viewer(mountRef.current);
    viewerRef.current = viewer;
    return () => {
      viewer.dispose();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => viewerRef.current?.setAutoRotate(autoRotate), [autoRotate]);
  useEffect(() => viewerRef.current?.setWireframe(wireframe), [wireframe]);
  useEffect(() => viewerRef.current?.setGrid(grid), [grid]);
  useEffect(() => viewerRef.current?.setShadow(shadow), [shadow]);
  useEffect(() => viewerRef.current?.setBackdrop(backdrop), [backdrop]);
  useEffect(() => viewerRef.current?.setExposure(exposure), [exposure]);
  useEffect(() => viewerRef.current?.playClip(activeClip), [activeClip]);

  // ---- loading ----------------------------------------------------------
  const present = useCallback(
    (
      object: THREE.Object3D,
      animations: THREE.AnimationClip[],
      name: string,
      bytes: number,
      shareUrl: string | null,
      files: File[] | null,
    ) => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      viewer.setModel(object, animations);
      viewer.setBackdrop(backdrop);
      sourceRef.current = { files, object, animations };
      setSharing({ phase: "idle" });
      setLoaded({
        name,
        stats: inspect(object),
        bytes,
        clips: animations.map((clip, index) => clip.name || `Clip ${index + 1}`),
        shareUrl,
      });
      setActiveClip(animations.length > 0 ? 0 : null);
      setStatus({ phase: "ready" });
    },
    [backdrop],
  );

  const openUrl = useCallback(
    async (url: string) => {
      const token = ++loadTokenRef.current;
      setStatus({ phase: "loading", note: "Fetching model", ratio: 0 });
      try {
        const result = await loadFromUrl(url, viewerRef.current?.renderer ?? null, (ratio, note) => {
          if (token === loadTokenRef.current) {
            setStatus({ phase: "loading", note, ratio });
          }
        });
        if (token !== loadTokenRef.current) return;
        const share = new URL(window.location.href);
        share.searchParams.set("src", url);
        present(
          result.object,
          result.animations,
          baseName(url),
          result.bytes,
          share.toString(),
          null,
        );
      } catch (error) {
        if (token !== loadTokenRef.current) return;
        setStatus({
          phase: "error",
          message:
            error instanceof Error
              ? error.message
              : "That model could not be loaded.",
        });
      }
    },
    [present],
  );

  const openFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const token = ++loadTokenRef.current;
      setStatus({ phase: "loading", note: "Reading file", ratio: 0 });
      try {
        const result = await loadFromFiles(files, viewerRef.current?.renderer ?? null, (ratio, note) => {
          if (token === loadTokenRef.current) {
            setStatus({ phase: "loading", note, ratio });
          }
        });
        if (token !== loadTokenRef.current) return;
        const root =
          files.find((f) =>
            (MODEL_EXTENSIONS as string[]).includes(
              f.name.split(".").pop()?.toLowerCase() ?? "",
            ),
          ) ?? files[0];
        present(result.object, result.animations, root.name, result.bytes, null, files);
      } catch (error) {
        if (token !== loadTokenRef.current) return;
        setStatus({
          phase: "error",
          message:
            error instanceof Error ? error.message : "That file could not be read.",
        });
      }
    },
    [present],
  );

  // Auto-load whatever the shared link points at. The URL bar is uncontrolled
  // and keyed on `srcParam`, so it picks the value up without a state write.
  // The fetch is kicked off off the synchronous effect body and abandons itself
  // if the link changes again before it lands.
  useEffect(() => {
    if (!srcParam) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (!cancelled) await openUrl(srcParam);
    })();
    return () => {
      cancelled = true;
    };
    // openUrl is stable for a given render of `present`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcParam]);

  // ---- drag and drop ----------------------------------------------------
  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const items = Array.from(event.dataTransfer.files);
    if (items.length > 0) {
      await openFiles(items);
      return;
    }
    const text = event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain");
    if (text.startsWith("http")) {
      router.push(`/?src=${encodeURIComponent(text.trim())}`);
    }
  };

  // ---- actions ----------------------------------------------------------
  const submitUrl = (event: React.FormEvent) => {
    event.preventDefault();
    const value = urlInputRef.current?.value.trim() ?? "";
    if (!value) return;
    router.push(`/?src=${encodeURIComponent(value)}`);
    if (value === srcParam) void openUrl(value);
  };

  const copyLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setCopyFailed(false);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Some browsers refuse clipboard writes without a trusted gesture. The
      // link is rendered in the panel, so point at it rather than opening a
      // blocking prompt over the page.
      setCopyFailed(true);
    }
  };

  /**
   * A model already loaded from a URL has a link the recipient can fetch, so
   * it just gets copied. A model opened from disk has no such URL, so it is
   * packed into a single glTF and uploaded first — that upload is what makes
   * the link openable by anyone.
   */
  const share = async () => {
    if (loaded?.shareUrl) {
      await copyLink(loaded.shareUrl);
      return;
    }

    const source = sourceRef.current;
    if (!source) return;

    try {
      setSharing({ phase: "packing" });
      const packed = await packForSharing(
        source.files,
        source.object,
        source.animations,
      );

      setSharing({ phase: "uploading", percentage: 0 });
      const blobUrl = await uploadModel(packed, (percentage) =>
        setSharing({ phase: "uploading", percentage }),
      );

      const link = new URL(window.location.href);
      link.searchParams.set("src", blobUrl);
      const shareUrl = link.toString();

      setSharing({ phase: "idle" });
      setLoaded((prev) => (prev ? { ...prev, shareUrl } : prev));
      await copyLink(shareUrl);
    } catch (error) {
      setSharing({
        phase: "error",
        message:
          error instanceof Error
            ? error.message
            : "That model could not be uploaded.",
      });
    }
  };

  const download = () => {
    const viewer = viewerRef.current;
    if (!viewer || !loaded) return;
    const link = document.createElement("a");
    link.download = `${loaded.name.replace(/\.[^.]+$/, "")}.png`;
    link.href = viewer.snapshot();
    link.click();
  };

  const reset = () => {
    loadTokenRef.current++;
    // The engine owns the scene, so clearing React state alone would leave the
    // old model rendering behind the empty-state overlay.
    viewerRef.current?.clear();
    setLoaded(null);
    setActiveClip(null);
    setStatus({ phase: "empty" });
    router.push("/");
  };

  const backdropStyle = useMemo(() => {
    const { top, bottom } = BACKDROPS[backdrop];
    return { background: `radial-gradient(circle at 50% 18%, ${top} 0%, ${bottom} 78%)` };
  }, [backdrop]);

  const dim = loaded?.stats.size;
  const busySharing =
    sharing.phase === "packing" || sharing.phase === "uploading";
  const shareLabel =
    sharing.phase === "packing"
      ? "Packing model…"
      : sharing.phase === "uploading"
        ? `Uploading ${Math.round(sharing.percentage)}%`
        : copied
          ? "Link copied"
          : loaded?.shareUrl
            ? "Copy share link"
            : "Upload & copy link";

  return (
    <div
      className="relative h-dvh w-full overflow-hidden text-slate-100"
      style={backdropStyle}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={onDrop}
    >
      <div ref={mountRef} className="absolute inset-0" />

      {/* ---------- top bar ---------- */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-center gap-3 p-3 sm:p-4">
        <button
          onClick={reset}
          className="pointer-events-auto flex items-center gap-2 rounded-xl bg-slate-900/75 px-3 py-2 text-sm font-semibold backdrop-blur-md ring-1 ring-white/10 transition hover:bg-slate-800/90"
        >
          <span className="text-base leading-none">◆</span>
          <span className="hidden sm:inline">3D Viewer</span>
        </button>

        <form onSubmit={submitUrl} className="pointer-events-auto order-last flex w-full min-w-0 items-center gap-2 sm:order-none sm:w-auto sm:flex-1">
          <input
            ref={urlInputRef}
            key={srcParam ?? "blank"}
            defaultValue={srcParam ?? ""}
            placeholder="Paste a link to a .glb, .gltf, .obj, .stl, .fbx …"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-xl bg-slate-900/75 px-3 py-2 text-sm outline-none ring-1 ring-white/10 backdrop-blur-md placeholder:text-slate-400 focus:ring-2 focus:ring-sky-400/70"
          />
          <button
            type="submit"
            className="shrink-0 rounded-xl bg-sky-500/90 px-3 py-2 text-sm font-semibold text-white transition hover:bg-sky-400"
          >
            Load
          </button>
        </form>

        <div className="pointer-events-auto flex shrink-0 items-center gap-2">
          <label className="cursor-pointer rounded-xl bg-slate-900/75 px-3 py-2 text-sm font-medium ring-1 ring-white/10 backdrop-blur-md transition hover:bg-slate-800/90">
            Open file
            <input
              type="file"
              multiple
              accept={ACCEPT_ATTRIBUTE}
              className="hidden"
              onChange={(e) => {
                void openFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </label>
          <button
            onClick={() => setPanelOpen((v) => !v)}
            className="rounded-xl bg-slate-900/75 px-3 py-2 text-sm font-medium ring-1 ring-white/10 backdrop-blur-md transition hover:bg-slate-800/90"
            aria-label="Toggle controls"
          >
            {panelOpen ? "Hide panel" : "Controls"}
          </button>
        </div>
      </header>

      {/* ---------- empty state ---------- */}
      {status.phase === "empty" && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
          <div className="pointer-events-auto w-full max-w-xl rounded-3xl bg-slate-900/80 p-7 text-center backdrop-blur-xl ring-1 ring-white/10">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              View any 3D model in your browser
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              Drop a file anywhere on this page, or paste a link above. Viewing
              happens entirely on your device. When you want to send a model on,
              one click uploads it and copies a link your recipient can open —
              they just click it, and the model loads.
            </p>

            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {SAMPLES.map((sample) => (
                <button
                  key={sample.url}
                  onClick={() => router.push(`/?src=${encodeURIComponent(sample.url)}`)}
                  className="rounded-full bg-white/10 px-4 py-2 text-sm font-medium ring-1 ring-white/15 transition hover:bg-white/20"
                >
                  {sample.label}
                </button>
              ))}
            </div>

            <p className="mt-5 text-xs text-slate-400">
              Supports {MODEL_EXTENSIONS.map((e) => `.${e}`).join("  ·  ")}
            </p>
          </div>
        </div>
      )}

      {/* ---------- loading ---------- */}
      {status.phase === "loading" && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm">
          <div className="w-64 text-center">
            <div className="mx-auto h-1.5 w-full overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-sky-400 transition-[width] duration-200"
                style={{ width: `${Math.max(8, status.ratio * 100)}%` }}
              />
            </div>
            <p className="mt-3 text-sm text-slate-300">
              {status.note}
              {status.ratio > 0 ? ` · ${Math.round(status.ratio * 100)}%` : "…"}
            </p>
          </div>
        </div>
      )}

      {/* ---------- error ---------- */}
      {status.phase === "error" && (
        <div className="absolute inset-0 z-30 flex items-center justify-center p-6">
          <div className="max-w-md rounded-2xl bg-red-950/70 p-6 text-center ring-1 ring-red-400/30 backdrop-blur-xl">
            <p className="text-base font-semibold text-red-200">Could not load that model</p>
            <p className="mt-2 text-sm leading-relaxed text-red-100/80">{status.message}</p>
            <button
              onClick={reset}
              className="mt-4 rounded-xl bg-white/10 px-4 py-2 text-sm font-medium ring-1 ring-white/15 transition hover:bg-white/20"
            >
              Start over
            </button>
          </div>
        </div>
      )}

      {/* ---------- drag overlay ---------- */}
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-sky-500/10 backdrop-blur-sm">
          <div className="rounded-3xl border-2 border-dashed border-sky-300/70 px-10 py-8 text-lg font-semibold text-sky-100">
            Drop to open
          </div>
        </div>
      )}

      {/* ---------- control panel ---------- */}
      {panelOpen && status.phase === "ready" && loaded && (
        <aside className="absolute inset-x-3 bottom-3 z-20 max-h-[46dvh] overflow-y-auto rounded-2xl bg-slate-900/80 p-4 text-sm backdrop-blur-xl ring-1 ring-white/10 sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-20 sm:max-h-[calc(100dvh-7rem)] sm:w-[17rem]">
          <p className="truncate font-semibold" title={loaded.name}>
            {loaded.name}
          </p>
          <p className="mt-0.5 text-xs text-slate-400">{formatBytes(loaded.bytes)}</p>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {(["front", "back", "left", "right", "top", "bottom"] as const).map((axis) => (
              <button
                key={axis}
                onClick={() => viewerRef.current?.setView(axis)}
                className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs capitalize ring-1 ring-white/10 transition hover:bg-white/20"
              >
                {axis}
              </button>
            ))}
            <button
              onClick={() => viewerRef.current?.resetView()}
              className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs ring-1 ring-white/10 transition hover:bg-white/20"
            >
              Reset
            </button>
          </div>

          <div className="mt-4 space-y-2">
            <Toggle label="Auto-rotate" on={autoRotate} set={setAutoRotate} />
            <Toggle label="Wireframe" on={wireframe} set={setWireframe} />
            <Toggle label="Grid" on={grid} set={setGrid} />
            <Toggle label="Ground shadow" on={shadow} set={setShadow} />
          </div>

          <div className="mt-4">
            <p className="mb-1.5 text-xs uppercase tracking-wide text-slate-400">Backdrop</p>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(BACKDROPS) as BackdropName[]).map((name) => (
                <button
                  key={name}
                  onClick={() => setBackdrop(name)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs ring-1 transition ${
                    backdrop === name
                      ? "bg-sky-500/80 ring-sky-300/50"
                      : "bg-white/10 ring-white/10 hover:bg-white/20"
                  }`}
                >
                  {BACKDROPS[name].label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <label className="mb-1 flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
              Exposure <span className="normal-case">{exposure.toFixed(2)}</span>
            </label>
            <input
              type="range"
              min={0.2}
              max={2.5}
              step={0.05}
              value={exposure}
              onChange={(e) => setExposure(Number(e.target.value))}
              className="w-full accent-sky-400"
            />
          </div>

          {loaded.clips.length > 0 && (
            <div className="mt-4">
              <p className="mb-1.5 text-xs uppercase tracking-wide text-slate-400">
                Animation
              </p>
              <select
                value={activeClip ?? ""}
                onChange={(e) =>
                  setActiveClip(e.target.value === "" ? null : Number(e.target.value))
                }
                className="w-full rounded-lg bg-white/10 px-2 py-1.5 text-xs ring-1 ring-white/10 outline-none"
              >
                <option value="" className="bg-slate-900">
                  Paused
                </option>
                {loaded.clips.map((clip, index) => (
                  <option key={clip + index} value={index} className="bg-slate-900">
                    {clip}
                  </option>
                ))}
              </select>
            </div>
          )}

          <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-white/10 pt-3 text-xs">
            <Stat label="Meshes" value={formatCount(loaded.stats.meshes)} />
            <Stat label="Materials" value={formatCount(loaded.stats.materials)} />
            <Stat label="Vertices" value={formatCount(loaded.stats.vertices)} />
            <Stat label="Triangles" value={formatCount(loaded.stats.triangles)} />
            <Stat label="Textures" value={formatCount(loaded.stats.textures)} />
            <Stat
              label="Bounds"
              value={
                dim
                  ? `${dim.x.toFixed(2)} × ${dim.y.toFixed(2)} × ${dim.z.toFixed(2)}`
                  : "—"
              }
            />
          </dl>

          <div className="mt-4 flex gap-2">
            <button
              onClick={share}
              disabled={busySharing}
              title={
                loaded.shareUrl
                  ? "Copy a link that opens this model"
                  : "Uploads this model and copies a link anyone can open"
              }
              className="flex-1 rounded-xl bg-sky-500/90 px-3 py-2 text-xs font-semibold text-white transition enabled:hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-sky-500/40"
            >
              {shareLabel}
            </button>
            <button
              onClick={download}
              className="rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold ring-1 ring-white/10 transition hover:bg-white/20"
            >
              PNG
            </button>
          </div>

          {sharing.phase === "uploading" && (
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-sky-400 transition-[width] duration-150"
                style={{ width: `${Math.max(4, sharing.percentage)}%` }}
              />
            </div>
          )}

          {sharing.phase === "error" && (
            <p className="mt-2 text-[11px] leading-relaxed text-red-300">
              {sharing.message}
            </p>
          )}

          {loaded.shareUrl ? (
            <div className="mt-2">
              {copyFailed && (
                <p className="mb-1 text-[11px] text-amber-300">
                  Clipboard blocked — select and copy the link below.
                </p>
              )}
              <p className="break-all text-[11px] leading-relaxed text-slate-400 select-all">
                {loaded.shareUrl}
              </p>
            </div>
          ) : (
            sharing.phase === "idle" && (
              <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                Sharing uploads this model to a public link — anyone with it can
                view and download the model.
              </p>
            )
          )}
        </aside>
      )}

      {/* ---------- hint ---------- */}
      {status.phase === "ready" && (
        <p className="pointer-events-none absolute inset-x-0 bottom-3 z-10 hidden text-center text-[11px] sm:block">
          <span className="rounded-full bg-slate-900/75 px-3 py-1 text-slate-300 ring-1 ring-white/10 backdrop-blur-md">
            Drag to orbit · scroll to zoom · right-drag to pan
          </span>
        </p>
      )}
    </div>
  );
}

function Toggle({
  label,
  on,
  set,
}: {
  label: string;
  on: boolean;
  set: (value: boolean) => void;
}) {
  return (
    <button
      onClick={() => set(!on)}
      className="flex w-full items-center justify-between rounded-lg bg-white/5 px-2.5 py-1.5 text-xs ring-1 ring-white/10 transition hover:bg-white/10"
    >
      <span>{label}</span>
      <span
        className={`relative h-4 w-7 rounded-full transition ${on ? "bg-sky-500" : "bg-white/20"}`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${
            on ? "left-3.5" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-slate-400">{label}</dt>
      <dd className="truncate font-medium text-slate-100">{value}</dd>
    </div>
  );
}
