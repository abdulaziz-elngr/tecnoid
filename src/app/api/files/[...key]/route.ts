import { type NextRequest } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { getAuthContext, UnauthorizedError } from "@/lib/rbac";
import { NotFoundError, handleApiError } from "@/lib/api";

const SCOPE = "files.serve";

const STORAGE_DIR = process.env.STORAGE_LOCAL_DIR || path.join(process.cwd(), "storage", "uploads");

/**
 * Authenticated file delivery (§62 — student data is never on a public URL).
 * The asset row also scopes the file to the caller's organization, so a
 * leaked key from another tenant is useless.
 */
export async function GET(_request: NextRequest, { params }: { params: { key: string[] } }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) throw new UnauthorizedError();

    const storageKey = params.key.join("/");
    const asset = await db.fileAsset.findFirst({
      where: { storageKey, organizationId: ctx.organizationId }
    });
    if (!asset) throw new NotFoundError("File not found.");

    const target = path.join(STORAGE_DIR, asset.storageKey);
    if (!target.startsWith(STORAGE_DIR)) throw new NotFoundError("File not found.");

    const bytes = await readFile(target);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": asset.mimeType,
        "Content-Length": String(asset.sizeBytes),
        "Content-Disposition": `inline; filename="${asset.originalName}"`,
        "Cache-Control": "private, max-age=0, no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}
