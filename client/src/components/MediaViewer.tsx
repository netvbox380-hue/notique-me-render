import { useEffect, useMemo, useRef, useState } from "react";
import { Play, X } from "lucide-react";
import { trpc } from "@/lib/trpc";

function isVideo(url?: string) {
  if (!url) return false;
  const u = url.toLowerCase();
  return (
    u.includes(".mp4") ||
    u.includes(".webm") ||
    u.includes(".ogg") ||
    u.includes(".mov")
  );
}

export default function MediaViewer({
  url,
  title,
  className,
}: {
  url?: string;
  title?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const inlineVideoRef = useRef<HTMLVideoElement | null>(null);
  const [autoPlayTried, setAutoPlayTried] = useState(false);
  const [inlineControls, setInlineControls] = useState(false);

  // 🔥 Detecta fileKey (uploads/...) e resolve para URL assinada
  const isFileKey = Boolean(url && url.startsWith("uploads/"));
  const fileKey = isFileKey ? (url as string) : undefined;

  const signedUrlQuery = trpc.upload.getFileUrl.useQuery(
    { fileKey: fileKey ?? "uploads/__invalid__" },
    {
      // ✅ DEV + PRODUÇÃO: sempre usar URL assinada direta do storage (inclui vídeos)
      // Evita proxy same-origin que quebra streaming/Range no Netlify Dev.
      enabled: Boolean(fileKey),
      staleTime: 1000 * 60 * 5,
      refetchOnWindowFocus: false,
    }
  );

  const resolvedUrl = useMemo(() => {
    if (isFileKey && fileKey) {
      // ✅ Imagem e vídeo: URL direta assinada (S3 já suporta Range/206)
      return signedUrlQuery.data?.url;
    }
    return url;
  }, [isFileKey, fileKey, signedUrlQuery.data?.url, url]);

  // ✅ Se for proxy (/api/media?...), detecta pelo fileKey para não falhar
  const video = isFileKey && fileKey ? isVideo(fileKey) : isVideo(resolvedUrl);

  // ✅ Vídeo precisa tocar mesmo quando estiver dentro de outro modal.
  // Em alguns cenários (PWA / nested dialog), abrir o fullscreen pode parecer que "não aconteceu nada".
  // Então, no preview, ao clicar, ativamos controls e damos play.
  const playInlineVideo = () => {
    setInlineControls(true);
    const el = inlineVideoRef.current;
    if (!el) return;
    el.play().catch(() => {
      // Se bloquear, pelo menos os controls ficam visíveis para o usuário iniciar.
      setInlineControls(true);
    });
  };

  // ✅ Ao abrir, tenta tocar (muted) para evitar bloqueio de autoplay com som.
  // Se bloquear, controles ficam para o usuário clicar.
  useEffect(() => {
    if (!open || !video) return;
    const el = videoRef.current;
    if (!el) return;
    if (autoPlayTried) return;

    setAutoPlayTried(true);
    el.muted = true;
    const p = el.play();
    if (p && typeof (p as any).catch === "function") {
      (p as Promise<void>).catch(() => {
        // noop
      });
    }
  }, [open, video, autoPlayTried]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // 🔥 Loading/erro somente quando é fileKey
  if (isFileKey && !resolvedUrl) {
    if (signedUrlQuery.isError) {
      return (
        <div className="mt-3 text-sm text-muted-foreground">
          Não foi possível carregar o anexo.
        </div>
      );
    }

    // mantém espaço do preview, sem quebrar layout
    return <div className="h-28 w-28 rounded-md bg-white/5" />;
  }

  if (!resolvedUrl) return null;

  return (
    <>
      {/* preview estilo WhatsApp */}
      <div
        role="button"
        tabIndex={0}
        className={[
          "mt-3 w-full rounded-xl overflow-hidden cursor-zoom-in select-none bg-black/20 flex items-center justify-center relative",
          className ?? "",
        ].join(" ")}
        onClick={(e) => {
          e.stopPropagation();
          if (video) {
            playInlineVideo();
            return;
          }
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            if (video) {
              playInlineVideo();
              return;
            }
            setOpen(true);
          }
        }}
        aria-label={title ? `Abrir mídia: ${title}` : "Abrir mídia"}
      >
        {video ? (
          <div className="w-full flex items-center justify-center">
            <video
              ref={inlineVideoRef}
              src={resolvedUrl}
              className="w-full max-h-[420px] object-contain"
              preload="metadata"
              playsInline
              controls={inlineControls}
              onClick={(e) => {
                // permite play/pause direto no preview
                e.stopPropagation();
                const el = inlineVideoRef.current;
                if (!el) return;
                if (el.paused) playInlineVideo();
                else el.pause();
              }}
            />
            {/* ▶️ indicador de vídeo (preview sem controls) */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="rounded-full bg-black/55 p-3 ring-1 ring-white/30">
                <Play className="w-8 h-8 text-white" />
              </div>
            </div>
          </div>
        ) : (
          <img
            src={resolvedUrl}
            alt={title || "Anexo"}
            className="w-full max-h-[420px] object-contain"
            loading="lazy"
            onClick={(e) => e.stopPropagation()}
          />
        )}
      </div>

      {/* fullscreen (somente imagem) */}
      {open && (
        <div
          className="fixed inset-0 z-[9999] bg-black flex items-center justify-center"
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 text-white bg-black/50 rounded-full p-2"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            aria-label="Fechar"
          >
            <X className="w-6 h-6" />
          </button>

          <div
            className="w-full h-full flex items-center justify-center p-2"
            onClick={(e) => e.stopPropagation()}
          >
            {video ? null : (
              <img
                src={resolvedUrl}
                alt={title || "Anexo"}
                className="max-w-full max-h-full object-contain"
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
