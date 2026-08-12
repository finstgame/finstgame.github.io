/* フィンストのサービスワーカー
   ねらいは2つだけ。
     ・電波が無くてもホーム画面から起動して、CPU戦と1台版が遊べること
     ・直したものがちゃんと届くこと（古い版を握り続けないこと）

   本体（index.html）はネットワーク優先。届かなかった時だけ手元の写しを出す。
   これを逆にすると、直してデプロイしても古い画面が出続ける。
   画像や音のような変わらないものは手元優先で、起動を速くする。

   Supabase への通信は絶対に触らない。対戦は常に生の通信でやる。 */

const VERSION = "finst-v3";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/supabase.min.js",
  "./assets/logo.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icon-maskable-512.png",
  "./assets/apple-touch-icon.png",
  "./assets/favicon-32.png"
];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    /* 1つでも失敗すると全部入らないので、個別に入れて取りこぼしを許す */
    await Promise.all(SHELL.map(u => c.add(u).catch(() => {})));
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* 画面側から「もう切り替えていい」と言われたら待たずに交代する */
self.addEventListener("message", e => {
  if(e.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if(req.method !== "GET") return;

  const url = new URL(req.url);
  /* 対戦の通信には一切手を出さない（Supabase・WebSocket・別ドメイン全部） */
  if(url.origin !== self.location.origin) return;

  const isDoc = req.mode === "navigate" || url.pathname.endsWith("/") ||
                url.pathname.endsWith("index.html");

  if(isDoc){
    /* 本体はネットワーク優先。落ちた時だけ手元の写し */
    e.respondWith((async () => {
      try{
        const fresh = await fetch(req);
        const c = await caches.open(VERSION);
        c.put("./index.html", fresh.clone());
        return fresh;
      }catch(err){
        const c = await caches.open(VERSION);
        return (await c.match("./index.html")) || (await c.match("./")) ||
               new Response("オフラインです", { status: 503, headers: {"content-type":"text/plain; charset=utf-8"} });
      }
    })());
    return;
  }

  /* それ以外は手元優先。無ければ取りに行って、ついでに覚える */
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const hit = await c.match(req);
    if(hit) return hit;
    try{
      const res = await fetch(req);
      if(res && res.status === 200 && res.type === "basic") c.put(req, res.clone());
      return res;
    }catch(err){
      return new Response("", { status: 504 });
    }
  })());
});
