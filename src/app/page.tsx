import { Suspense } from "react";
import ModelViewer from "@/components/ModelViewer";

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="flex h-dvh items-center justify-center bg-[#0b0e14] text-sm text-slate-400">
          Loading viewer…
        </div>
      }
    >
      <ModelViewer />
    </Suspense>
  );
}
