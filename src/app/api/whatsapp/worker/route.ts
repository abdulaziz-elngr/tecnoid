import { type NextRequest } from "next/server";
import { handleApiError, ok } from "@/lib/api";
import { processWhatsAppQueue } from "@/lib/whatsapp/queue";

/**
 * Background worker trigger.
 *
 * Call it from a cron (Vercel Cron, systemd timer, BullMQ repeatable
 * job...) with the WORKER_SECRET bearer token. It is NOT protected by a
 * user session because no human is behind it — which is exactly why it
 * needs its own shared secret and refuses to run without one.
 */
export async function POST(request: NextRequest) {
  try {
    const secret = process.env.WORKER_SECRET;
    if (!secret) {
      return ok(
        { error: "Worker is disabled: set WORKER_SECRET in the environment." },
        { status: 503 }
      );
    }
    const provided = request.headers.get("authorization")?.replace("Bearer ", "");
    if (provided !== secret) {
      return ok({ error: "Unauthorized." }, { status: 401 });
    }

    const result = await processWhatsAppQueue(
      Number(new URL(request.url).searchParams.get("limit") ?? 25)
    );
    return ok(result);
  } catch (err) {
    return handleApiError("whatsapp.worker", err);
  }
}
