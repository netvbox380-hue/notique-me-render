import { z } from "zod";
import webpush from "web-push";
import { router, protectedProcedure } from "../_core/trpc";
import { ENV } from "../_core/env";
import { getDb } from "../db";
import { pushSubscriptions } from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

function ensureVapid() {
  const pub = ENV.vapidPublicKey;
  const priv = ENV.vapidPrivateKey;
  const subj = ENV.vapidSubject || "mailto:admin@notifique-me.local";

  if (!pub || !priv) return false;

  webpush.setVapidDetails(subj, pub, priv);
  return true;
}

async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "DB indisponível",
    });
  }
  return db;
}

// ✅ helper: envia push e remove subscription inválida (best-effort)
async function safeSendAndPrune(db: any, s: any, payload: string) {
  try {
    await webpush.sendNotification(
      {
        endpoint: s.endpoint,
        keys: { p256dh: s.p256dh, auth: s.auth },
      } as any,
      payload
    );
    return { ok: true };
  } catch (e: any) {
    // remove subscriptions inválidas automaticamente
    try {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, s.endpoint));
    } catch {}
    return { ok: false, error: String(e?.message ?? e) };
  }
}

export const pushRouter = router({
  publicKey: protectedProcedure.query(() => {
    return { publicKey: ENV.vapidPublicKey || "" };
  }),

  subscribe: protectedProcedure
    .input(
      z.object({
        endpoint: z.string().min(1),
        keys: z.object({
          p256dh: z.string().min(1),
          auth: z.string().min(1),
        }),
        userAgent: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb(); // ✅ FIX
      const userId = ctx.user.id;

      await db
        .insert(pushSubscriptions)
        .values({
          userId,
          endpoint: input.endpoint,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          userAgent: input.userAgent,
          updatedAt: new Date(),
        } as any)
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: {
            userId,
            p256dh: input.keys.p256dh,
            auth: input.keys.auth,
            userAgent: input.userAgent,
            updatedAt: new Date(),
          } as any,
        });

      return { success: true };
    }),

  unsubscribe: protectedProcedure
    .input(z.object({ endpoint: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb(); // ✅ FIX
      const userId = ctx.user.id;

      await db
        .delete(pushSubscriptions)
        .where(
          and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, input.endpoint))
        );

      return { success: true };
    }),

  /**
   * Teste de push
   */
  test: protectedProcedure.mutation(async ({ ctx }) => {
    if (!ensureVapid()) {
      return { success: false, error: "VAPID não configurado" };
    }

    const db = await requireDb(); // ✅ FIX

    const subs = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, ctx.user.id));

    if (!subs.length) {
      return { success: false, error: "Usuário sem subscription" };
    }

    const payload = JSON.stringify({
      title: "Notifique-me",
      body: "Push funcionando ✅",
      url: "/my-notifications",
      // ✅ ajuda a testar contador no ícone (Android/Chrome)
      badgeCount: 1,
      ts: Date.now(),
    });

    const results = await Promise.all(subs.map((s: any) => safeSendAndPrune(db, s, payload)));

    return {
      success: true,
      sent: results.filter((r) => r.ok).length,
      total: subs.length,
      errors: results.filter((r) => !r.ok),
    };
  }),
});
