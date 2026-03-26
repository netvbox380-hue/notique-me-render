import React, { useEffect, useMemo, useState } from "react";
import { Download, Info, Bell, BellRing, TestTube2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { getOrCreatePushSubscription } from "@/lib/push";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandaloneMode() {
  // iOS Safari standalone
  // @ts-ignore
  const iosStandalone = typeof window !== "undefined" && (navigator as any).standalone;
  // Chrome/Android/desktop installed PWA
  const mqStandalone =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;

  return Boolean(iosStandalone || mqStandalone);
}

export default function InstallAppButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [installed, setInstalled] = useState(false);

  // ✅ Push state
  const [pushReady, setPushReady] = useState(false);
  const [busy, setBusy] = useState(false);

  const utils = trpc.useUtils();
  const publicKeyQuery = trpc.push.publicKey.useQuery(undefined, {
    staleTime: 60_000,
  });

  const subscribeMutation = trpc.push.subscribe.useMutation();
  const testMutation = trpc.push.test.useMutation();

  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    setIsIos(/iphone|ipad|ipod/.test(ua));

    // ✅ se já está instalado/standalone, não mostrar (mantém seu comportamento)
    setInstalled(isStandaloneMode());
    setDeferred(((window as any).__nmBeforeInstallPrompt as BeforeInstallPromptEvent | undefined) || null);

    const handler = (e: Event) => {
      (window as any).__nmBeforeInstallPrompt = e;
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };

    const installedHandler = () => {
      setInstalled(true);
      setDeferred(null);
      try { delete (window as any).__nmBeforeInstallPrompt; } catch {}
    };

    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", installedHandler);

    // ✅ detecta mudança de display-mode
    const mq =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(display-mode: standalone)")
        : null;

    const mqHandler = () => setInstalled(isStandaloneMode());
    // @ts-ignore compat
    mq?.addEventListener?.("change", mqHandler);
    // @ts-ignore compat
    mq?.addListener?.(mqHandler);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
      // @ts-ignore compat
      mq?.removeEventListener?.("change", mqHandler);
      // @ts-ignore compat
      mq?.removeListener?.(mqHandler);
    };
  }, []);

  // ✅ detecta se já existe subscription local
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (!("serviceWorker" in navigator)) return;
        const reg =
          (await navigator.serviceWorker.getRegistration("/")) ||
          (await navigator.serviceWorker.getRegistration());
        if (!reg) return;

        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setPushReady(Boolean(sub));
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const cls = "gap-2 w-full sm:w-auto";

  // ✅ Ativar notificações (cria subscription + salva no backend)
  const enablePush = async () => {
    try {
      setBusy(true);

      const publicKey = publicKeyQuery.data?.publicKey || "";
      if (!publicKey) {
        alert("Push não configurado: VAPID public key vazia.");
        return;
      }

      const sub = await getOrCreatePushSubscription(publicKey);

      const json = sub.toJSON() as any;

      await subscribeMutation.mutateAsync({
        endpoint: String(json.endpoint),
        keys: {
          p256dh: String(json.keys?.p256dh || ""),
          auth: String(json.keys?.auth || ""),
        },
        userAgent: navigator.userAgent,
      });

      setPushReady(true);

      // ✅ sincroniza contador (badge) logo após habilitar
      try {
        await utils.notifications.inboxCount.invalidate();
      } catch {}

      alert("Notificações ativadas ✅");
    } catch (e: any) {
      alert(String(e?.message ?? e ?? "Falha ao ativar notificações"));
    } finally {
      setBusy(false);
    }
  };

  const testPush = async () => {
    try {
      setBusy(true);
      const res = await testMutation.mutateAsync();
      if ((res as any)?.success === false) {
        alert((res as any)?.error || "Falha no teste");
        return;
      }
      alert("Teste enviado ✅ (veja se apareceu notificação e badge)");
    } catch (e: any) {
      alert(String(e?.message ?? e ?? "Falha no teste"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {/* =========================
          BOTÕES DE PUSH (sempre úteis)
         ========================= */}
      {!pushReady ? (
        <Button
          variant="outline"
          className={cls}
          disabled={busy || publicKeyQuery.isLoading}
          onClick={enablePush}
        >
          <Bell className="w-4 h-4" />
          {busy ? "Ativando…" : "Ativar notificações"}
        </Button>
      ) : (
        <Button
          variant="outline"
          className={cls}
          disabled={busy}
          onClick={testPush}
        >
          <BellRing className="w-4 h-4" />
          {busy ? "Enviando…" : "Testar push"}
        </Button>
      )}

      {/* =========================
          INSTALAÇÃO PWA
          - Se já está instalado/standalone, escondemos apenas a parte de instalação.
          - Mantemos Push (ativar/testar) sempre visível.
         ========================= */}
      {!installed ? (
        deferred ? (
          <Button
            variant="outline"
            className={cls}
            onClick={async () => {
              try {
                await deferred.prompt();
                const choice = await deferred.userChoice;
                if (choice.outcome === "accepted") {
                  setDeferred(null);
                  try { delete (window as any).__nmBeforeInstallPrompt; } catch {}
                }
              } catch {
                // se falhar, mantém fallback
                setDeferred(null);
                try { delete (window as any).__nmBeforeInstallPrompt; } catch {}
              }
            }}
          >
            <Download className="w-4 h-4" />
            Instalar app
          </Button>
        ) : isIos ? (
          <Button
            variant="outline"
            className={cls}
            onClick={() =>
              alert(
                "Para instalar no iPhone/iPad:\n\n1) Toque em Compartilhar\n2) 'Adicionar à Tela de Início'"
              )
            }
          >
            <Download className="w-4 h-4" />
            Como instalar
          </Button>
        ) : (
          <Button
            variant="outline"
            className={cls}
            onClick={() =>
              alert(
                "Se o botão 'Instalar app' não aparecer automaticamente:\n\n1) Abra no Chrome\n2) Menu ⋮ → 'Instalar app' / 'Adicionar à tela inicial'\n3) Recarregue a página e navegue um pouco\n\nObs: se você já dispensou o prompt antes, ele pode não aparecer automaticamente."
              )
            }
          >
            <Info className="w-4 h-4" />
            Como instalar
          </Button>
        )
      ) : null}
    </div>
  );
}
