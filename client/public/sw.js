// client/public/sw.js

const STATIC_CACHE = "notifique-me-static-v7";
const RUNTIME_CACHE = "notifique-me-runtime-v7";

// ⚠️ NÃO cachear "/" (pode redirect /login e quebrar install)
const PRECACHE_URLS = [
  "/index.html",
  "/manifest.json", // ✅ mesmo que o index.html usa
  "/icon-192.png",
  "/icon-512.png",
];

/* ============================
   ✅ BADGE helpers (Android/Chrome)
============================ */
async function setBadge(count) {
  try {
    if (self.registration && "setAppBadge" in self.registration) {
      await self.registration.setAppBadge(Number(count) || 0);
    }
  } catch {}
}

async function clearBadge() {
  try {
    if (self.registration && "clearAppBadge" in self.registration) {
      await self.registration.clearAppBadge();
    }
  } catch {}
}

/* ============================
   ✅ Push prefs (persistente via Cache)
   - Mantém preferências acessíveis no SW mesmo após restart.
============================ */
const PREFS_URL = "/__sw_prefs.json";

async function readPrefs() {
  try {
    const cache = await caches.open(RUNTIME_CACHE);
    const res = await cache.match(PREFS_URL);
    if (!res) return { vibrate: true, sound: true };
    const json = await res.json();
    return {
      vibrate: json?.vibrate !== false,
      sound: json?.sound !== false,
    };
  } catch {
    return { vibrate: true, sound: true };
  }
}

async function writePrefs(prefs) {
  try {
    const cache = await caches.open(RUNTIME_CACHE);
    const body = JSON.stringify({
      vibrate: prefs?.vibrate !== false,
      sound: prefs?.sound !== false,
      updatedAt: Date.now(),
    });
    await cache.put(PREFS_URL, new Response(body, { headers: { "Content-Type": "application/json" } }));
  } catch {}
}

/* ============================
   ✅ MESSAGES from app
============================ */
self.addEventListener("message", (event) => {
  const data = event?.data || {};

  if (data.type === "SKIP_WAITING") self.skipWaiting();

  // ✅ Atualiza badge vindo do app (ex: inboxCount)
  if (data.type === "SET_BADGE") void setBadge(data.count);

  if (data.type === "CLEAR_BADGE") void clearBadge();

  // ✅ Preferências para o SW (vibração/som)
  if (data.type === "SET_PUSH_PREFS") void writePrefs(data.prefs || {});
});

/* ============================
   ✅ INSTALL / ACTIVATE (seu código)
============================ */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(async (cache) => {
      // ✅ não deixa o install falhar se algum arquivo não existir
      try {
        await cache.addAll(PRECACHE_URLS);
      } catch (e) {
        // continua mesmo assim
      }
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => n !== STATIC_CACHE && n !== RUNTIME_CACHE)
          .map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

/* ============================
   ✅ PUSH: mostra notificação + atualiza badge
============================ */
self.addEventListener("push", (event) => {
  const payload = (() => {
    try {
      return event.data ? event.data.json() : {};
    } catch {
      return {};
    }
  })();

  const title = payload.title || "Notifique-me";
  const body = payload.body || payload.content || "Você recebeu uma nova mensagem";
  const url = payload.url || "/my-notifications";

  // ✅ suporte a push "silencioso" (atualiza badge/estado sem notificação)
  const silent = Boolean(payload.silent);

  // backend vai mandar badgeCount (ideal). fallback: badge
  const badgeCount = Number(payload.badgeCount ?? payload.badge ?? 0) || 0;

  event.waitUntil(
    (async () => {
      if (badgeCount > 0) await setBadge(badgeCount);

      // ✅ Ping/monitor: avisa clientes abertos
      try {
        const allClients = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
        for (const client of allClients) {
          client.postMessage({
            type: "PUSH_PING",
            ts: Date.now(),
            badgeCount,
            silent,
            title,
            body,
            url,
          });
        }
      } catch {}

      if (silent) return;

      const prefs = await readPrefs();

      await self.registration.showNotification(title, {
        body,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: { url },
        // vibração é best-effort e respeita configurações do sistema
        vibrate: prefs.vibrate ? [80, 40, 80] : undefined,
      });
    })()
  );
});

/* ============================
   ✅ Clique na notificação abre o app
============================ */
self.addEventListener("notificationclick", (event) => {
  const url = event?.notification?.data?.url || "/";
  event.notification.close();

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Se já tiver o app/aba aberta, foca e navega
      for (const client of allClients) {
        if ("focus" in client) {
          await client.focus();
          // para SPA: manda mensagem para o client navegar
          client.postMessage({ type: "NAVIGATE", url });
          return;
        }
      }

      // senão, abre nova janela
      await self.clients.openWindow(url);
    })()
  );
});

/* ============================
   ✅ FETCH (seu código)
============================ */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (!url.protocol.startsWith("http")) return;

  // API nunca cacheia
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(req));
    return;
  }

  // Navegação SPA
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(async () => {
        const cachedIndex = await caches.match("/index.html");
        return cachedIndex || new Response("Offline", { status: 503 });
      })
    );
    return;
  }

  if (req.method !== "GET") {
    event.respondWith(fetch(req));
    return;
  }

  // Assets: stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
