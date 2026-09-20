import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hard ceiling on a shared model. Blob storage is not free. */
const MAX_BYTES = 120 * 1024 * 1024;

export async function POST(request: Request): Promise<NextResponse> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          "Sharing is not configured on this deployment: BLOB_READ_WRITE_TOKEN is missing.",
      },
      { status: 501 },
    );
  }

  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  try {
    // The browser uploads directly to Blob storage with a token minted here,
    // so a large model never passes through the serverless function body.
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.toLowerCase().endsWith(".glb")) {
          throw new Error("Only .glb models can be shared.");
        }
        return {
          allowedContentTypes: [
            "model/gltf-binary",
            "application/octet-stream",
          ],
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: true,
        };
      },
      // Fires only on a publicly reachable deployment; nothing to record here.
      onUploadCompleted: async () => {},
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "That upload was rejected.",
      },
      { status: 400 },
    );
  }
}
