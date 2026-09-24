import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { handleApiError, ok, readQuery, paginationSchema } from "@/lib/api";

const listSchema = paginationSchema.extend({
  status: z.enum(["QUEUED", "SENDING", "SENT", "DELIVERED", "READ", "FAILED"]).optional(),
  studentId: z.string().uuid().optional(),
  search: z.string().trim().max(60).optional()
});

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("whatsapp.view");
    const query = readQuery(request, listSchema);

    const where = {
      organizationId: ctx.organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.search ? { toNumber: { contains: query.search } } : {})
    };

    const [total, rows, counts] = await Promise.all([
      db.whatsAppMessage.count({ where }),
      db.whatsAppMessage.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          toNumber: true,
          body: true,
          status: true,
          templateKey: true,
          attempts: true,
          errorMessage: true,
          sentAt: true,
          createdAt: true
        }
      }),
      db.whatsAppMessage.groupBy({
        by: ["status"],
        where: { organizationId: ctx.organizationId },
        _count: { _all: true }
      })
    ]);

    return ok({
      messages: rows,
      statusCounts: counts.map((c) => ({ status: c.status, count: c._count._all })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize))
      }
    });
  } catch (err) {
    return handleApiError("whatsapp.messages", err);
  }
}
