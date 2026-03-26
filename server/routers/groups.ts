import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { groups, userGroups, users, deliveries } from "../../drizzle/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

function requireTenantAdmin(ctx: any): number {
  if (ctx.user?.role === "owner") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Owner usa superadmin",
    });
  }

  const t = ctx.user?.tenantId;
  if (!t) throw new TRPCError({ code: "FORBIDDEN", message: "Sem tenant" });

  return t;
}

export const groupsRouter = router({
  list: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(100) }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const tenantId = requireTenantAdmin(ctx);

      const data = await db
        .select()
        .from(groups)
        .where(eq(groups.tenantId, tenantId))
        .orderBy(sql`${groups.id} DESC`)
        .limit(input?.limit ?? 100);

      const totalRows = await db
        .select({ count: sql<number>`count(*)` })
        .from(groups)
        .where(eq(groups.tenantId, tenantId));

      return { data, total: Number(totalRows?.[0]?.count ?? 0) };
    }),

  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const tenantId = requireTenantAdmin(ctx);

      const inserted = await db
        .insert(groups)
        .values({
          tenantId,
          name: input.name,
          description: input.description ?? null,
          createdByAdminId: ctx.user.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any)
        .returning();

      return { success: true, group: inserted[0] };
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(255).optional(),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const tenantId = requireTenantAdmin(ctx);

      const found = await db
        .select({ id: groups.id })
        .from(groups)
        .where(and(eq(groups.id, input.id), eq(groups.tenantId, tenantId)))
        .limit(1);

      if (!found.length)
        throw new TRPCError({ code: "NOT_FOUND", message: "Grupo não encontrado" });

      const patch: any = { updatedAt: new Date() };
      if (input.name !== undefined) patch.name = input.name;
      if (input.description !== undefined) patch.description = input.description;

      const updated = await db
        .update(groups)
        .set(patch)
        .where(and(eq(groups.id, input.id), eq(groups.tenantId, tenantId)))
        .returning();

      return { success: true, group: updated[0] };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const tenantId = requireTenantAdmin(ctx);

      const found = await db
        .select({ id: groups.id })
        .from(groups)
        .where(and(eq(groups.id, input.id), eq(groups.tenantId, tenantId)))
        .limit(1);

      if (!found.length)
        throw new TRPCError({ code: "NOT_FOUND", message: "Grupo não encontrado" });

      await db.transaction(async (tx) => {
        await tx.delete(userGroups).where(eq(userGroups.groupId, input.id));
        await tx.delete(groups).where(and(eq(groups.id, input.id), eq(groups.tenantId, tenantId)));
      });

      return { success: true };
    }),

  getMembers: adminProcedure
    .input(z.object({ groupId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const tenantId = requireTenantAdmin(ctx);

      const found = await db
        .select({ id: groups.id })
        .from(groups)
        .where(and(eq(groups.id, input.groupId), eq(groups.tenantId, tenantId)))
        .limit(1);

      if (!found.length)
        throw new TRPCError({ code: "NOT_FOUND", message: "Grupo não encontrado" });

      const rows = await db
        .select({ userId: userGroups.userId })
        .from(userGroups)
        .where(eq(userGroups.groupId, input.groupId));

      return { userIds: rows.map((r) => r.userId) };
    }),

  /**
   * 🔥 Atualização segura + sincronização futura
   */
  setMembers: adminProcedure
    .input(
      z.object({
        groupId: z.number(),
        memberUserIds: z.array(z.number()).default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const tenantId = requireTenantAdmin(ctx);

      const found = await db
        .select({ id: groups.id })
        .from(groups)
        .where(and(eq(groups.id, input.groupId), eq(groups.tenantId, tenantId)))
        .limit(1);

      if (!found.length)
        throw new TRPCError({ code: "NOT_FOUND", message: "Grupo não encontrado" });

      const uniqueUserIds = Array.from(new Set(input.memberUserIds));

      if (uniqueUserIds.length) {
        const validUsers = await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.tenantId, tenantId), eq(users.role, "user"), inArray(users.id, uniqueUserIds)));

        const validIds = new Set(validUsers.map((u) => u.id));
        const bad = uniqueUserIds.filter((id) => !validIds.has(id));

        if (bad.length)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Usuários inválidos",
          });
      }

      await db.transaction(async (tx) => {
        await tx.delete(userGroups).where(eq(userGroups.groupId, input.groupId));

        if (uniqueUserIds.length) {
          await tx.insert(userGroups).values(
            uniqueUserIds.map((userId) => ({
              groupId: input.groupId,
              userId,
              createdAt: new Date(),
            }))
          );
        }
      });

      return { success: true };
    }),

  /**
   * 🔥 Estatísticas do grupo (feedback e leitura)
   */
  stats: adminProcedure
    .input(z.object({ groupId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const tenantId = requireTenantAdmin(ctx);

      const found = await db
        .select({ id: groups.id })
        .from(groups)
        .where(and(eq(groups.id, input.groupId), eq(groups.tenantId, tenantId)))
        .limit(1);

      if (!found.length)
        throw new TRPCError({ code: "NOT_FOUND", message: "Grupo não encontrado" });

      const members = await db
        .select({ userId: userGroups.userId })
        .from(userGroups)
        .where(eq(userGroups.groupId, input.groupId));

      const userIds = members.map((m) => m.userId);

      if (!userIds.length) {
        return {
          members: 0,
          reads: 0,
          feedback: {
            liked: 0,
            renew: 0,
            disliked: 0,
          },
        };
      }

      const rows = await db
        .select({
          isRead: deliveries.isRead,
          feedback: deliveries.feedback,
        })
        .from(deliveries)
        .where(inArray(deliveries.userId, userIds));

      let reads = 0;
      const fb = { liked: 0, renew: 0, disliked: 0 };

      for (const r of rows) {
        if (r.isRead) reads++;
        if (r.feedback) fb[r.feedback]++;
      }

      return {
        members: userIds.length,
        reads,
        feedback: fb,
      };
    }),
});
