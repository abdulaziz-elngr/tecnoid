# WhatsApp Integration

TecnoID only integrates with the **official Meta WhatsApp Business
Platform (Cloud API)**. Unofficial "WhatsApp Web automation" libraries
are intentionally not used — they violate WhatsApp's terms of service
and get business numbers banned. If credentials are not configured,
every send attempt is honestly refused; the app never pretends a
message went out.

## 1. How it works

1. **Enqueue, never block.** Every code path that wants to send a
   WhatsApp message (attendance/payment notifications, manual sends)
   calls `enqueueWhatsAppMessage()` in `src/lib/whatsapp/queue.ts`,
   which just inserts a `WhatsAppMessage` row with `status: QUEUED`
   and returns immediately. No API request ever blocks on the
   provider.
2. **A worker drains the queue.** `processWhatsAppQueue()` claims up
   to `limit` queued/retryable rows, sends each via the Meta Graph API
   (`src/lib/whatsapp/provider.ts`), and updates status to `SENT` or
   `FAILED`/`QUEUED` (for retry) with exponential backoff.
3. **The worker is triggered externally**, not by a background thread
   inside the Next.js process: `POST /api/whatsapp/worker` (protected
   by `WORKER_SECRET`, a bearer token — not a user session, since no
   human is behind the call). Wire this to a scheduler.
4. **Templates** live in `NotificationTemplate` (seeded from
   `DEFAULT_TEMPLATES` in `src/lib/templates.ts`) and are rendered
   with `renderTemplate()`. A message with a `templateKey` that has a
   `providerTemplateName` set is sent as an approved WhatsApp
   **template** message (required outside the 24-hour customer
   service window); otherwise it's sent as free-form text.

## 2. Configuration

Set in `.env` (see `.env.example`):

| Variable | Purpose |
|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | Your Cloud API phone number ID |
| `WHATSAPP_ACCESS_TOKEN` | A permanent or long-lived system-user access token |
| `WHATSAPP_API_VERSION` | Graph API version, defaults to `v20.0` |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Shared secret for provider status webhooks, if you add one |
| `WORKER_SECRET` | Bearer token required to call `POST /api/whatsapp/worker` |
| `DEFAULT_COUNTRY_CODE` | Used by `normalizePhone()` to expand a locally-formatted number (e.g. `01001234567` → `2010...`) |
| `WHATSAPP_MAX_ATTEMPTS` | Retries before a message is marked `FAILED` (default 5) |
| `WHATSAPP_BACKOFF_SECONDS` | Base for exponential backoff between retries (default 60s) |

`isWhatsAppConfigured()` (used by `/api/whatsapp/status` and the
Settings → Integrations panel) is simply "are `WHATSAPP_PHONE_NUMBER_ID`
and `WHATSAPP_ACCESS_TOKEN` both set" — nothing more. Leave them blank
in dev; the UI clearly shows "Not configured" and queued messages just
sit at `QUEUED` until you configure and start running the worker.

## 3. Scheduling the worker

Any scheduler that can make an authenticated HTTP POST works. Example
with a plain cron entry hitting a deployed instance every minute:

```cron
* * * * * curl -s -X POST \
  -H "Authorization: Bearer $WORKER_SECRET" \
  "https://your-domain.example/api/whatsapp/worker?limit=25" \
  > /var/log/tecnoid-whatsapp-worker.log 2>&1
```

On Vercel, use a Vercel Cron Job pointed at the same route with the
same header. There is deliberately no in-process `setInterval` worker
— serverless deployments don't keep a Node process alive long enough
for that to be reliable, and a single external trigger is the same
code path in every environment.

## 4. Operational notes

- **Idempotent claiming**: the worker claims a row with a conditional
  `updateMany` (`WHERE id = ? AND status = ? AND attempts = ?`) before
  sending, so running two worker instances concurrently cannot
  double-send the same message.
- **Retryable vs. permanent failures**: a `5xx`/`429` from Meta is
  retried with backoff; a `4xx` (bad number, unapproved template) is
  marked `FAILED` immediately — retrying it would just fail again.
- **Manual retry**: the Communication → WhatsApp screen's "Retry"
  button calls `retryWhatsAppMessage()`, which resets `attempts` to 0
  and re-queues a `FAILED` message.
- **Phone numbers** are normalized (E.164-ish, no `+`) before storage
  and before every send — `normalizePhone()` / `isValidPhone()` in
  `provider.ts`.

## 5. Manual click-to-chat (Phase 2 — Payments, Exams, Announcements)

Everything above is the automated, queued path for system-triggered
notifications. It is **separate on purpose** from a second, simpler
path: manual "Send WhatsApp" buttons that a staff member clicks
themselves, which open a `https://wa.me/<phone>?text=<message>` link in
a new tab — no Meta API call, no queue row, nothing stored. This is
what the person means by "click-to-chat", and it is what Phase 2 uses
for every new WhatsApp button (it does **not** touch or extend the
queued system above).

- **Centralized in one place**: `src/lib/whatsapp-link.ts` —
  `normalizeEgyptianPhone`, `buildWhatsAppLink`, `renderWhatsAppTemplate`,
  `resolveParentWhatsApp`. No page builds a `wa.me` URL or normalizes a
  phone number itself.
- **One shared button component**: `src/components/WhatsAppButton.tsx`
  renders either the link or a disabled state with the exact reason
  (no parent on file / invalid number) — never a broken link.
- **Screens with a manual WhatsApp button**: the attendance session
  roster (`ABSENCE`, pre-Phase-2), the Subscriptions and Payments pages
  (`PAYMENT`), the Exam detail roster (`EXAM`), and the new
  Announcements page (`ANNOUNCEMENT`) at
  `/dashboard/communication/announcements`.
- **Multiple recipients never share one link**: a `wa.me` URL always
  opens exactly one conversation. For a Group or multi-student
  announcement, the Announcements page lists every recipient with their
  own button — the staff member opens/sends each one individually. There
  is no bulk-send automation.

