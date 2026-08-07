/* 家計簿：オフラインでも、電波が弱くても即座に開くためのキャッシュ

   方針（キャッシュ優先 / stale-while-revalidate）
   - キャッシュがあれば通信を待たずに即返す（電波が弱くても起動が遅くならない）
   - 同時に裏で更新を取りに行き、取れたら次回起動時に反映される
   - 裏の更新は3秒で打ち切る（弱電波でつかみ続けないため）

   バージョンを上げたら、必ず新しい内容を取り直すこと。
   ブラウザのHTTPキャッシュから古いファイルを拾わないよう cache:'reload' を使う。
*/
const CACHE = 'kakeibo-v3.2';
const REVALIDATE_TIMEOUT = 3000;   // 裏で更新を待つ上限(ms)
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // cache:'reload' でネットワークから確実に最新を取る
      .then(c => Promise.all(
        ASSETS.map(u =>
          fetch(new Request(u, { cache: 'reload' }))
            .then(res => res && res.ok ? c.put(u, res) : null)
            .catch(() => null)
        )
      ))
      .then(() => self.skipWaiting())
      .catch(() => {})
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 指定時間で打ち切る fetch */
function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(req).then(res => { clearTimeout(timer); resolve(res); },
                    err => { clearTimeout(timer); reject(err); });
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith('http')) return;
  // 自分の配信元以外（地名検索などの外部API）は素通しする。キャッシュもしない。
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith((async () => {
    // 今の版のキャッシュだけを見る（古い版のキャッシュを拾わないため）
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);

    // 裏で更新を取りに行く（結果は次回に使う）
    const revalidate = fetchWithTimeout(req, REVALIDATE_TIMEOUT)
      .then(res => {
        if (res && res.status === 200) cache.put(req, res.clone()).catch(() => {});
        return res;
      })
      .catch(() => null);

    // キャッシュがあれば通信を待たずに即返す
    if (cached) return cached;

    // 初回など、キャッシュが無い時だけ通信の結果を待つ
    return (await revalidate) || (await cache.match('./index.html'));
  })());
});
