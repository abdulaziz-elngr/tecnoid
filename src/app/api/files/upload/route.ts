import { type NextRequest } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { getAuthContext, UnauthorizedError } from "@/lib/rbac";
import { checkRateLimit } from "@/lib/rate-limit";
import { UploadValidationError, validateUpload } from "@/lib/upload";
import { writeAuditLog } from "@/lib/audit";
import { BusinessRuleError, created, handleApiError } from "@/lib/api";

const SCOPE = "files.upload";

/**
 * Local-disk storage driver.
 *
 * Files are written under STORAGE_LOCAL_DIR (default: ./storage/uploads),
 * which is OUTSIDE the Next.js build/executable path so nothing uploaded
 * can ever be served as code (§46). Swap this one function for an S3 /
 * Vercel Blob / Cloudinary client to move to object storage — nothing
 * else in the codebase touches the filesystem.
 */
const STORAGE_DIR = process.env.STORAGE_LOCAL_DIR || path.join(process.cwd(), "storage", "uploads");
const PUBLIC_PREFIX = process.env.STORAGE_PUBLIC_PREFIX || "/api/files";

async function persist(storageKey: string, bytes: Uint8Array): Promise<string> {
  const target = path.join(STORAGE_DIR, storageKey);
  // storageKey is generated server-side (yyyy-MM/uuid.ext), never user input,
  // but we re-assert containment as defence in depth against path traversal.
  if (!target.startsWith(STORAGE_DIR)) {
    throw new UploadValidationError("Invalid storage path.");
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
  return `${PUBLIC_PREFIX}/${storageKey}`;
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) throw new UnauthorizedError();

    const limit = checkRateLimit(`upload:${ctx.userId}`, 30, 60 * 1000);
    if (!limit.allowed) {
      throw new BusinessRuleError("Too many uploads. Please slow down.", { status: 429 });
    }

    const form = await request.formData();
    const file = form.get("file");
    const kindRaw = String(form.get("kind") ?? "image");

    if (!(file instanceof File)) {
      throw new BusinessRuleError("No file was provided.", { status: 400 });
    }
    if (kindRaw !== "image" && kindRaw !== "document") {
      throw new BusinessRuleError("Unsupported upload kind.", { status: 400 });
    }

    const buffer = new Uint8Array(await file.arrayBuffer());

    const validated = validateUpload({
      originalName: file.name,
      mimeType: file.type,
      sizeBytes: buffer.byteLength,
      head: buffer.subarray(0, 16),
      kind: kindRaw
    });

    const url = await persist(validated.storageKey, buffer);
    const checksum = createHash("sha256").update(buffer).digest("hex");

    const asset = await db.fileAsset.create({
      data: {
        organizationId: ctx.organizationId,
        storageKey: validated.storageKey,
        url,
        originalName: validated.safeName,
        mimeType: validated.mimeType,
        sizeBytes: buffer.byteLength,
        checksum,
        uploadedById: ctx.userId
      }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "UPLOAD_FILE",
      entityType: "FileAsset",
      entityId: asset.id,
      afterValue: { originalName: asset.originalName, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes }
    });

    return created({ id: asset.id, url: asset.url, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes });
  } catch (err) {
    if (err instanceof UploadValidationError) {
      return handleApiError(SCOPE, new BusinessRuleError(err.message, { status: 400 }));
    }
    return handleApiError(SCOPE, err);
  }
}
