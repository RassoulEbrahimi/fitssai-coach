// FitssAI Service Worker - Minimal, safe runtime cache
const STATIC_CACHE = 'static-v3';

// Skip waiting and claim clients immediately
self.addEventListener('install', (event) => {
  console.log('SW: Install event');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('SW: Activate event');
  event.waitUntil(self.clients.claim());
});

// Fetch handler with selective caching
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Skip non-same-origin requests
  if (url.origin !== location.origin) return;

  // API/auth/edge calls - network only (do NOT cache)
  if (url.pathname.includes('/supabase') || 
      url.pathname.includes('/functions/') ||
      url.pathname.includes('/auth/')) {
    return; // Let browser handle normally
  }

  // Videos - bypass cache to avoid large storage
  if (request.destination === 'video') {
    return; // Let browser handle normally
  }

  event.respondWith(handleFetch(request));
});

async function handleFetch(request) {
  const url = new URL(request.url);
  
  // Static assets (CSS, JS, fonts, images) - stale-while-revalidate
  if (['style', 'script', 'font', 'image'].includes(request.destination)) {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request);
    
    // Return cached version immediately, then update in background
    const fetchPromise = fetch(request).then(response => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    }).catch(() => cached); // Fallback to cached on network error
    
    return cached || fetchPromise;
  }

  // Document requests (navigation) - network first, cache fallback
  if (request.mode === 'navigate') {
    try {
      const response = await fetch(request);
      return response;
    } catch {
      // Offline fallback - return cached root if available
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match('/');
      return cached || new Response('Offline', { status: 503 });
    }
  }

  // Default - network first
  return fetch(request);
}