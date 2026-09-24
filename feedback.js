/* フィードバック：画面を3回タップすると、開発者へ声を送れる。
   送り先は Supabase の feedback テーブル（追加だけできて、誰も読めない）。
   失敗してもゲームは止めない。書いた文章は消さずに残して、もう一度送れるようにする。 */
(() => {
  const uuid = () => crypto.randomUUID ? crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{
      const r=Math.random()*16|0;return (c==='x'?r:(r&3|8)).toString(16);
    });

  /* ボタン・手・カードなど「押すと何かが起きる所」は数えない。
     対戦中の操作が、フィードバックの呼び出しに化けないようにするため。 */
  const INTERACTIVE = 'button, a, input, textarea, select, label, summary, [role="button"], ' +
    '.hand, .card, .opt, .seg-btn, .fb, .sheet, .panel, .step-bar';

  /* 3回タップの判定。「同じあたりを、0.6秒以内に3回」だけを拾う。
     押せる物（ボタン・手・カード・3D盤のクリスタル）の上のタップは数えず、
     数えかけていても数え直す。対戦中の操作が呼び出しに化けないようにするため。 */
  function tripleTap({ within = 600, radius = 40 } = {}) {
    let taps = [];
    return {
      feed(x, y, t, interactive) {
        if (interactive) { taps = []; return false; }
        taps = taps.filter(p => t - p.t <= within);
        if (taps.length && Math.hypot(x - taps[0].x, y - taps[0].y) > radius) taps = [];
        taps.push({ x, y, t });
        if (taps.length >= 3) { taps = []; return true; }
        return false;
      },
      reset() { taps = []; }
    };
  }

  /* 送る中身を組み立てる。大きすぎる盤面は落として、本文だけは必ず届ける。 */
  const MAX_MESSAGE = 2000, MAX_CONTEXT = 16000;
  function buildPayload({ message, context, visitorId, isTest, id }) {
    const text = String(message ?? '').replace(/\r\n/g, '\n').trim().slice(0, MAX_MESSAGE);
    if (!text) return null;
    let ctx = context && typeof context === 'object' ? { ...context } : {};
    delete ctx.room;                       // 部屋コードは送らない
    if (JSON.stringify(ctx).length > MAX_CONTEXT) {
      delete ctx.board;                    // 盤面が大きすぎたら盤面だけ諦める
      ctx.board_dropped = true;
    }
    if (JSON.stringify(ctx).length > MAX_CONTEXT) ctx = { board_dropped: true };
    return { id: id || uuid(), visitor_id: visitorId, message: text, context: ctx, is_test: !!isTest };
  }

  /* isInteractive は、画面の要素だけでは分からない「押せる物」を教えてもらう口。
     3D盤ではクリスタルがcanvasの中の物体なので、要素を見ても手だと分からない。 */
  function create({ url, key, visitorId, getContext, onOpen, isInteractive, target = document }) {
    const isTest = location.hostname !== 'finstgame.github.io' ||
      new URLSearchParams(location.search).get('feedback_test') === '1';
    const detector = tripleTap();

    const onDown = e => {
      if (e.isPrimary === false) return;                 // 2本指以上は数えない
      const el = e.target && e.target.closest ? e.target : null;
      let interactive = !!(el && el.closest(INTERACTIVE));
      if (!interactive && isInteractive) { try { interactive = !!isInteractive(e); } catch {} }
      const t = typeof e.timeStamp === 'number' ? e.timeStamp : Date.now();
      if (detector.feed(e.clientX, e.clientY, t, interactive)) onOpen && onOpen();
    };
    target.addEventListener('pointerdown', onDown, { capture: true, passive: true });

    async function send(message, { includeBoard = true } = {}) {
      let context = {};
      try { context = (getContext && getContext({ includeBoard })) || {}; } catch { context = {}; }
      const body = buildPayload({ message, context, visitorId, isTest });
      if (!body) return { ok: false, reason: 'empty' };
      if (!url || !key) return { ok: false, reason: 'offline' };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(`${url}/rest/v1/feedback`, {
          method: 'POST',
          headers: { apikey: key, Authorization: `Bearer ${key}`,
                     'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify(body), signal: controller.signal, keepalive: true
        });
        if (res.ok) return { ok: true, id: body.id };
        return { ok: false, reason: res.status === 404 ? 'not_ready' : 'server', status: res.status };
      } catch {
        return { ok: false, reason: 'network' };
      } finally { clearTimeout(timer); }
    }

    return { send, isTest,
      dispose() { target.removeEventListener('pointerdown', onDown, { capture: true }); } };
  }

  window.FinstFeedback = { create, tripleTap, buildPayload, INTERACTIVE };
})();
