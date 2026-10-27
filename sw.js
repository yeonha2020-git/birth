// 앱 화면을 저장해 오프라인에서도 열리게 하고, 생일 알림을 대신 띄워 주는 서비스 워커입니다.
// 안드로이드 크롬은 페이지에서 new Notification()을 허용하지 않으므로 알림은 모두 여기서 표시합니다.
const APP_CACHE = "family-birthday-app-v3";
const DATA_CACHE = "family-birthday-data";
const APP_FILES = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "manifest.webmanifest",
  "vendor/manseryeok.mjs",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png"
];

const dataUrl = (name) => new URL(`__data/${name}`, self.registration.scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("family-birthday-app-") && name !== APP_CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

// 최신 화면을 먼저 받아 오고, 인터넷이 안 될 때만 저장해 둔 화면을 보여 줍니다.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(APP_CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) return cached;
      if (request.mode === "navigate") return caches.match("index.html");
      throw error;
    }
  })());
});

async function readData(name, fallback) {
  const cache = await caches.open(DATA_CACHE);
  const response = await cache.match(dataUrl(name));
  if (!response) return fallback;
  try {
    return await response.json();
  } catch {
    return fallback;
  }
}

async function writeData(name, value) {
  const cache = await caches.open(DATA_CACHE);
  await cache.put(dataUrl(name), new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } }));
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function canNotify() {
  return self.Notification?.permission === "granted";
}

function showBirthdayNotification(title, body, tag) {
  return self.registration.showNotification(title, {
    body,
    tag,
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    lang: "ko",
    data: { url: self.registration.scope }
  });
}

// 오늘 보내야 할 알림 중 아직 보내지 않은 것만 표시합니다.
async function checkAlerts() {
  if (!canNotify()) return;
  const alerts = await readData("alerts.json", []);
  const sent = await readData("sent.json", []);
  const today = localDateKey(new Date());
  const due = alerts.filter((alert) => alert.date === today && !sent.includes(alert.key));
  for (const alert of due) await showBirthdayNotification(alert.title, alert.body, alert.key);
  if (due.length) await writeData("sent.json", [...sent, ...due.map((alert) => alert.key)].slice(-300));
}

self.addEventListener("message", (event) => {
  const message = event.data ?? {};
  if (message.type === "schedule" && Array.isArray(message.alerts)) {
    event.waitUntil(writeData("alerts.json", message.alerts).then(checkAlerts));
  } else if (message.type === "test" && canNotify()) {
    event.waitUntil(showBirthdayNotification("🔔 테스트 알림", "생일 알림이 이렇게 표시됩니다 🎂", "test"));
  }
});

// 홈 화면에 설치한 안드로이드 크롬에서는 앱을 닫아 두어도 하루 한두 번 이 이벤트로 알림을 확인합니다.
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "birthday-check") event.waitUntil(checkAlerts());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => client.url.startsWith(self.registration.scope));
    if (existing) return existing.focus();
    return self.clients.openWindow(event.notification.data?.url ?? self.registration.scope);
  })());
});
