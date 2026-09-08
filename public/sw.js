// Network-first service worker: fresh content always wins while online;
// the cache only covers offline use. A version bump forces every client
// to drop stale caches on the next activation.
const cacheName = 'stigui-v3';

const deleteCache = async (key) => {
    await caches.delete(key);
};

const deleteOldCaches = async () => {
    const keyList = await caches.keys();
    await Promise.all(keyList.filter((key) => key !== cacheName).map(deleteCache));
};

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            await deleteOldCaches();
            await self.clients.claim();
        })()
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET' || !event.request.url.startsWith('https:')) {
        return;
    }

    event.respondWith(
        (async () => {
            try {
                const response = await fetch(event.request);
                const cache = await caches.open(cacheName);
                event.waitUntil(cache.put(event.request, response.clone()));
                return response;
            } catch (error) {
                const cached = await caches.match(event.request);
                if (cached) {
                    return cached;
                }
                throw error;
            }
        })()
    );
});
