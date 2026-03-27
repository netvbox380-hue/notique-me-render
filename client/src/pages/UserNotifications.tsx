// client/src/pages/UserNotifications.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import MediaViewer from "@/components/MediaViewer";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogContentScrollable,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooterSticky,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  AlertTriangle,
  Ban,
  Check,
  LogOut,
  MessageCircle,
  RefreshCcw,
  Settings,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Wifi,
} from "lucide-react";
import InstallAppButton from "@/components/InstallAppButton";

async function setBadgeCount(n: number) {
  try {
    // @ts-ignore
    if ("setAppBadge" in navigator) await navigator.setAppBadge(n);
  } catch {}
  try {
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "SET_BADGE", count: n });
    }
  } catch {}
}

async function clearBadgeCount() {
  try {
    // @ts-ignore
    if ("clearAppBadge" in navigator) await navigator.clearAppBadge();
  } catch {}
  try {
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "CLEAR_BADGE" });
    }
  } catch {}
}

function loadPushPrefs() {
  try {
    const raw = localStorage.getItem("nm_push_prefs");
    if (!raw) return { vibrate: true, sound: true };
    const j = JSON.parse(raw);
    return { vibrate: j?.vibrate !== false, sound: j?.sound !== false };
  } catch {
    return { vibrate: true, sound: true };
  }
}

function savePushPrefs(p: { vibrate: boolean; sound: boolean }) {
  try {
    localStorage.setItem("nm_push_prefs", JSON.stringify(p));
  } catch {}
  try {
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "SET_PUSH_PREFS", prefs: p });
    }
  } catch {}
}

function toWhatsAppUrl(phone?: string | null, message?: string) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  const text = message?.trim() ? `?text=${encodeURIComponent(message.trim())}` : "";
  return `https://wa.me/${digits}${text}`;
}

const FEEDBACK_META: Record<string, { icon: React.ReactNode; label: string }> = {
  liked: { icon: <ThumbsUp className="w-4 h-4" />, label: "Gostei" },
  disliked: { icon: <ThumbsDown className="w-4 h-4" />, label: "Não gostei" },
  renew: { icon: <RefreshCcw className="w-4 h-4" />, label: "Vou renovar" },
  no_renew: { icon: <Ban className="w-4 h-4" />, label: "Não vou renovar" },
  problem: { icon: <AlertTriangle className="w-4 h-4" />, label: "Estou tendo problemas" },
};

export default function UserNotifications() {
  const utils = trpc.useUtils();
  const { logout } = useAuth();

  const [filter, setFilter] = useState<"unread" | "all">("unread");
  const [pageSize, setPageSize] = useState(20);
  const [pushPrefs, setPushPrefs] = useState(() => loadPushPrefs());
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [attachmentsNotificationId, setAttachmentsNotificationId] = useState<number | null>(null);
  const [attachmentsTitle, setAttachmentsTitle] = useState<string>("Anexos");
  const [openingDeliveryId, setOpeningDeliveryId] = useState<number | null>(null);
  const [isMediaPlaying, setIsMediaPlaying] = useState(false);

  const pendingRefreshRef = useRef(false);

  const subscription = trpc.tenant.getSubscription.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const currentGroupsQuery = trpc.tenant.getCurrentUserGroups.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const attachmentsQuery = trpc.files.listByNotificationId.useQuery(
    { notificationId: attachmentsNotificationId ?? 0 },
    { enabled: attachmentsOpen && Boolean(attachmentsNotificationId), refetchOnWindowFocus: false }
  );

  const inbox = trpc.notifications.inboxList.useQuery(
    { limit: pageSize, offset: 0 },
    {
      refetchOnWindowFocus: !isMediaPlaying,
      refetchInterval: isMediaPlaying ? false : 5000,
      staleTime: 2000,
    }
  );

  const inboxCountQuery = trpc.notifications.inboxCount.useQuery(undefined, {
    refetchOnWindowFocus: !isMediaPlaying,
    refetchInterval: isMediaPlaying ? false : 5000,
    staleTime: 2000,
  });

  const invalidateInboxNow = useCallback(async () => {
    await Promise.all([
      utils.notifications.inboxList.invalidate(),
      utils.notifications.inboxCount.invalidate(),
    ]);
  }, [utils]);

  const invalidateInbox = useCallback(async () => {
    if (isMediaPlaying) {
      pendingRefreshRef.current = true;
      return;
    }
    await invalidateInboxNow();
  }, [invalidateInboxNow, isMediaPlaying]);

  useEffect(() => {
    if (!isMediaPlaying && pendingRefreshRef.current) {
      pendingRefreshRef.current = false;
      void invalidateInboxNow();
    }
  }, [isMediaPlaying, invalidateInboxNow]);

  const markAsRead = trpc.notifications.markAsRead.useMutation({
    onSuccess: invalidateInbox,
  });

  const markAllAsRead = trpc.notifications.markAllAsRead.useMutation({
    onSuccess: async () => {
      await invalidateInbox();
      toast.success("Todas as mensagens foram marcadas como lidas.");
    },
  });

  const setFeedback = trpc.notifications.setFeedback.useMutation({
    onSuccess: async () => {
      if (isMediaPlaying) {
        pendingRefreshRef.current = true;
      } else {
        await utils.notifications.inboxList.invalidate();
      }
      toast.success("Resposta enviada.");
    },
  });

  const clearAll = trpc.notifications.clearAll.useMutation({
    onSuccess: async () => {
      await invalidateInbox();
      toast("Mensagens apagadas ✅");
    },
    onError: (err: any) => {
      toast(err?.message || "Falha ao apagar mensagens");
    },
  });

  const brandName = subscription.data?.branding?.brandName || subscription.data?.name || "Admin";
  const brandLogoUrl = subscription.data?.branding?.brandLogoUrl || "";
  const supportPhone = subscription.data?.branding?.supportPhone || "";
  const supportUrl = toWhatsAppUrl(
    supportPhone,
    "Olá! Preciso de ajuda com as notificações do app."
  );

  const currentGroups = currentGroupsQuery.data?.groups ?? [];

  const items = useMemo(() => inbox.data?.data ?? [], [inbox.data]);
  const unreadCount = inboxCountQuery.data?.count ?? items.filter((m: any) => !m.isRead).length;

  const visibleItems = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((m: any) => !m.isRead);
  }, [items, filter]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastTopIdRef = useRef<number | null>(null);
  const [showNewIndicator, setShowNewIndicator] = useState(false);

  const scrollToTop = () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      el.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      el.scrollTop = 0;
    }
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onScroll = () => {
      setShowNewIndicator(el.scrollTop >= 120);
    };

    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const syncPlayingState = () => {
      const anyPlaying = Array.from(root.querySelectorAll("video")).some(
        (v) => !v.paused && !v.ended && v.readyState > 2
      );
      setIsMediaPlaying(anyPlaying);
    };

    const handlePlay = () => setIsMediaPlaying(true);
    const handlePauseLike = () => syncPlayingState();

    root.addEventListener("play", handlePlay, true);
    root.addEventListener("playing", handlePlay, true);
    root.addEventListener("pause", handlePauseLike, true);
    root.addEventListener("ended", handlePauseLike, true);
    root.addEventListener("emptied", handlePauseLike, true);

    return () => {
      root.removeEventListener("play", handlePlay, true);
      root.removeEventListener("playing", handlePlay, true);
      root.removeEventListener("pause", handlePauseLike, true);
      root.removeEventListener("ended", handlePauseLike, true);
      root.removeEventListener("emptied", handlePauseLike, true);
    };
  }, []);

  useEffect(() => {
    const top = items?.[0];
    if (!top) return;

    const topId = Number((top as any).deliveryId);

    if (lastTopIdRef.current === null) {
      lastTopIdRef.current = topId;
      scrollToTop();
      return;
    }

    if (topId !== lastTopIdRef.current) {
      lastTopIdRef.current = topId;
      toast("Nova mensagem recebida");

      try {
        const p = pushPrefs;
        if (p?.vibrate && "vibrate" in navigator) {
          // @ts-ignore
          navigator.vibrate?.([50, 25, 50]);
        }
        if (p?.sound) {
          const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
          if (AudioCtx) {
            const ctx = new AudioCtx();
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = "sine";
            o.frequency.value = 880;
            g.gain.value = 0.03;
            o.connect(g);
            g.connect(ctx.destination);
            o.start();
            setTimeout(() => {
              try {
                o.stop();
                ctx.close?.();
              } catch {}
            }, 120);
          }
        }
      } catch {}

      if (!showNewIndicator && !isMediaPlaying) scrollToTop();
    }
  }, [items, pushPrefs, showNewIndicator, isMediaPlaying]);

  useEffect(() => {
    if (typeof unreadCount !== "number") return;
    if (unreadCount > 0) void setBadgeCount(unreadCount);
    else void clearBadgeCount();
  }, [unreadCount]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const onMsg = (event: MessageEvent) => {
      const data: any = event?.data || {};
      if (data?.type === "PUSH_PING") {
        try {
          localStorage.setItem("nm_push_last_ping", String(data.ts || Date.now()));
        } catch {}
        void invalidateInbox();
      }
    };

    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, [invalidateInbox]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void invalidateInbox();
    };
    const onFocus = () => {
      void invalidateInbox();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [invalidateInbox]);

  useEffect(() => {
    savePushPrefs(pushPrefs);
  }, [pushPrefs]);

  async function handleLogout() {
    try {
      await logout();
    } catch {
    } finally {
      try {
        if ("serviceWorker" in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
        }
      } catch {}

      try {
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
      } catch {}

      window.location.href = "/login";
    }
  }

  async function handleOpenNotification(m: any) {
    if (m.isRead || openingDeliveryId === Number(m.deliveryId) || markAsRead.isPending) return;
    setOpeningDeliveryId(Number(m.deliveryId));
    try {
      await markAsRead.mutateAsync({ deliveryId: Number(m.deliveryId) });
    } catch {
      toast.error("Não foi possível marcar a mensagem como lida.");
    } finally {
      setOpeningDeliveryId(null);
    }
  }

  if (inbox.isLoading && !items.length) return <div className="p-4">Carregando…</div>;

  return (
    <>
      <div className="p-4 sm:p-8 max-w-4xl mx-auto">
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setFilter("unread")}
              className={
                "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition " +
                (filter === "unread" ? "bg-primary text-primary-foreground" : "bg-background")
              }
            >
              Não lidas
              <span className="min-w-[1.5rem] text-center rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground">
                {unreadCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setFilter("all")}
              className={
                "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition " +
                (filter === "all" ? "bg-primary text-primary-foreground" : "bg-background")
              }
            >
              Todas
              <span className="min-w-[1.5rem] text-center rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground">
                {items.length}
              </span>
            </button>

            {unreadCount > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => markAllAsRead.mutate()}
                disabled={markAllAsRead.isPending}
              >
                <Check className="w-4 h-4 mr-2" />
                {markAllAsRead.isPending ? "Marcando..." : "Marcar todas como lidas"}
              </Button>
            ) : null}
          </div>

          <div className="flex items-center justify-end">
            <Button type="button" variant="outline" onClick={() => setPrefsOpen(true)} aria-label="Abrir menu">
              <Settings className="w-4 h-4" />
              <span className="ml-2 hidden sm:inline">Menu</span>
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/40 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {brandLogoUrl ? (
                <img
                  src={brandLogoUrl}
                  alt={brandName}
                  className="h-11 w-11 rounded-xl border object-cover bg-background shrink-0"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <div className="h-11 w-11 rounded-xl border bg-background shrink-0 flex items-center justify-center text-lg font-bold">
                  {String(brandName || "A").slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{brandName}</div>
                <div className="text-xs text-muted-foreground">
                  Toque na mensagem para marcar como lida automaticamente.
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 justify-between sm:justify-end">
              <div className="text-xs text-muted-foreground">
                {filter === "unread" ? `${visibleItems.length} não lidas` : `${visibleItems.length} mensagens`}
              </div>
              {supportUrl ? (
                <a
                  href={supportUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs hover:bg-secondary"
                >
                  <MessageCircle className="w-4 h-4" />
                  WhatsApp
                </a>
              ) : null}
            </div>
          </div>

          <div ref={containerRef} className="p-4 sm:p-6 space-y-3 max-h-[70vh] overflow-y-auto">
            {visibleItems.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                Nenhuma mensagem para mostrar agora.
              </div>
            ) : null}

            {visibleItems.map((m: any) => {
              const dt = new Date(m.createdAt);
              const dateStr = dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
              const timeStr = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
              const when = `${dateStr} às ${timeStr}`;
              const sender = (m.senderName || m.senderEmail || m.senderOpenId || brandName || "Admin").toString();
              const mediaUrl = m.imageUrl ? String(m.imageUrl) : undefined;
              const currentFeedback = m.feedback ? String(m.feedback) : "";
              const hasFeedback = Boolean(currentFeedback);

              return (
                <div key={m.deliveryId} className="flex justify-start">
                  <div className="w-full">
                    <div
                      className={
                        "w-full rounded-2xl px-4 py-4 border shadow-sm transition cursor-pointer " +
                        (!m.isRead
                          ? "border-red-500/40 bg-zinc-900/70 ring-1 ring-red-500/15"
                          : "border-border bg-card")
                      }
                      onClick={() => void handleOpenNotification(m)}
                    >
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="min-w-0 flex items-start gap-3">
                          {brandLogoUrl ? (
                            <img
                              src={brandLogoUrl}
                              alt={brandName}
                              className="h-10 w-10 rounded-full border object-cover bg-background shrink-0"
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.display = "none";
                              }}
                            />
                          ) : (
                            <div className="h-10 w-10 rounded-full border bg-background shrink-0 flex items-center justify-center text-sm font-bold">
                              {String(brandName || "A").slice(0, 1).toUpperCase()}
                            </div>
                          )}

                          <div className="min-w-0">
                            <div className="min-w-0 text-xs text-muted-foreground truncate flex items-center gap-2 flex-wrap">
                              {!m.isRead ? <span className="inline-block w-2 h-2 rounded-full bg-red-500" /> : null}
                              <span className="font-medium text-foreground">{sender}</span>
                              {!m.isRead ? (
                                <span className="inline-flex items-center rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-200">
                                  não lida
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] bg-muted/40">
                                  lida
                                </span>
                              )}
                            </div>
                            <div className="mt-1 text-sm font-semibold break-words">{m.title}</div>
                          </div>
                        </div>
                        <div className="shrink-0 text-xs text-muted-foreground">{when}</div>
                      </div>

                      {m.content ? <div className="text-sm whitespace-pre-wrap break-words">{m.content}</div> : null}

                      {mediaUrl ? (
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleOpenNotification(m);
                          }}
                          className="space-y-2 mt-3"
                        >
                          <MediaViewer url={mediaUrl} title={m.title} />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setAttachmentsTitle(m.title || "Anexos");
                              setAttachmentsNotificationId(Number(m.notificationId));
                              setAttachmentsOpen(true);
                            }}
                          >
                            Ver anexos
                          </Button>
                        </div>
                      ) : null}

                      <div className="mt-4 flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        {(["liked", "disliked", "renew", "no_renew", "problem"] as const).map((fb) => {
                          const active = currentFeedback === fb;
                          return (
                            <button
                              key={fb}
                              type="button"
                              className={
                                "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition " +
                                (active ? "bg-primary text-primary-foreground" : "bg-background")
                              }
                              disabled={setFeedback.isPending || hasFeedback}
                              onClick={() => {
                                setFeedback.mutate({ deliveryId: Number(m.deliveryId), feedback: fb });
                              }}
                              aria-label={`Marcar como ${fb}`}
                            >
                              {FEEDBACK_META[fb]?.icon}
                              {FEEDBACK_META[fb]?.label ?? fb}
                            </button>
                          );
                        })}
                      </div>

                      {hasFeedback ? (
                        <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
                          <Check className="w-3.5 h-3.5" />
                          Resposta enviada: {FEEDBACK_META[currentFeedback]?.label || currentFeedback}
                        </div>
                      ) : null}

                      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span>{when}</span>
                        {supportUrl ? (
                          <a
                            href={supportUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 hover:text-foreground"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                            Falar no WhatsApp
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {items.length >= pageSize ? (
              <div className="pt-2 flex justify-center">
                <Button type="button" variant="outline" onClick={() => setPageSize((v) => v + 20)}>
                  Carregar mais mensagens
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        {showNewIndicator ? (
          <button
            onClick={scrollToTop}
            className="fixed bottom-6 right-6 bg-primary text-white px-4 py-2 rounded-full shadow-lg"
          >
            Novas mensagens ↓
          </button>
        ) : null}
      </div>

      <Dialog open={attachmentsOpen} onOpenChange={setAttachmentsOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{attachmentsTitle}</DialogTitle>
          </DialogHeader>

          {attachmentsQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Carregando anexos...</div>
          ) : attachmentsQuery.data?.success && (attachmentsQuery.data as any).data?.length ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(attachmentsQuery.data as any).data.map((f: any) => (
                <div key={f.id} className="rounded-xl border p-2">
                  <MediaViewer url={String(f.fileKey || f.url)} title={f.filename || attachmentsTitle} />
                  <div className="mt-2 text-xs text-muted-foreground break-all">{f.filename}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Nenhum anexo encontrado.</div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={prefsOpen} onOpenChange={setPrefsOpen}>
        <DialogContentScrollable className="max-w-md p-0 gap-0">
          <DialogHeader className="px-4 pt-4 pb-3 border-b border-border/60">
            <DialogTitle>Menu</DialogTitle>
          </DialogHeader>

          <DialogBody className="px-4 py-4">
            <div className="space-y-4">
              <div className="rounded-xl border p-3 space-y-2">
                <div className="text-sm font-medium">Notificações e instalação</div>
                <div className="text-xs text-muted-foreground mb-2">
                  Ative o push e instale o app (PWA) para não ficar desconectando.
                </div>
                <InstallAppButton />
              </div>

              <div className="rounded-xl border p-3 space-y-2">
                <div className="text-sm font-medium">Canal da empresa</div>
                <div className="text-xs text-muted-foreground">
                  Logo e WhatsApp agora ficam integrados à inbox do usuário final.
                </div>
                <div className="flex items-center gap-3">
                  {brandLogoUrl ? (
                    <img
                      src={brandLogoUrl}
                      alt={brandName}
                      className="h-12 w-12 rounded-xl border object-cover bg-background"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : null}
                  <div className="min-w-0">
                    <div className="font-medium truncate">{brandName}</div>
                    {supportUrl ? (
                      <a href={supportUrl} target="_blank" rel="noreferrer" className="text-sm text-emerald-400 hover:underline">
                        {supportPhone || "WhatsApp"}
                      </a>
                    ) : (
                      <div className="text-xs text-muted-foreground">Sem WhatsApp cadastrado.</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center justify-between gap-3 rounded-xl border p-3">
                  <div>
                    <div className="text-sm font-medium">Som ao receber mensagem</div>
                    <div className="text-xs text-muted-foreground">Apenas quando o app está aberto</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={pushPrefs.sound}
                    onChange={(e) => setPushPrefs((p) => ({ ...p, sound: e.target.checked }))}
                  />
                </label>

                <label className="flex items-center justify-between gap-3 rounded-xl border p-3">
                  <div>
                    <div className="text-sm font-medium">Vibração</div>
                    <div className="text-xs text-muted-foreground">App aberto e (quando possível) no push</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={pushPrefs.vibrate}
                    onChange={(e) => setPushPrefs((p) => ({ ...p, vibrate: e.target.checked }))}
                  />
                </label>
              </div>

              <div className="rounded-xl border p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Wifi className="w-4 h-4" />
                  Monitor de push
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {(() => {
                    try {
                      const ts = Number(localStorage.getItem("nm_push_last_ping") || 0);
                      if (!ts) return "Ainda não recebemos nenhum push nesta instalação.";
                      const d = new Date(ts);
                      return `Último ping: ${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
                    } catch {
                      return "Monitor indisponível.";
                    }
                  })()}
                </div>
              </div>

              <div className="rounded-xl border p-3">
                <div className="text-sm font-medium">Mensagens</div>
                <div className="mt-2 space-y-2">
                  {unreadCount > 0 ? (
                    <Button type="button" variant="outline" className="w-full" onClick={() => markAllAsRead.mutate()}>
                      <Check className="w-4 h-4 mr-2" />
                      Marcar todas como lidas
                    </Button>
                  ) : null}

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button type="button" variant="destructive" className="w-full" disabled={clearAll.isPending}>
                        <Trash2 className="w-4 h-4 mr-2" />
                        {clearAll.isPending ? "Apagando…" : "Apagar todas as mensagens"}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Apagar todas as mensagens?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Esta ação é permanente e não pode ser desfeita.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={async () => {
                            await clearAll.mutateAsync();
                          }}
                        >
                          Apagar tudo
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </div>
          </DialogBody>

          <DialogFooterSticky className="px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full h-9 text-xs font-medium"
              onClick={() => {
                setPrefsOpen(false);
                void handleLogout();
              }}
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sair
            </Button>
          </DialogFooterSticky>
        </DialogContentScrollable>
      </Dialog>
    </>
  );
}
