// Watch and channel pages: keep the local watch history that seeds the feed, and offer a local
// "Follow" in place of the Subscribe button that needs an account.
(function (root) {
  const OF = root.OwnFeed;
  const S = OF.store;
  const { h } = OF.tiles;

  const COUNTS_AFTER = 30; // seconds played before a video counts as watched

  let current = null; // { id, info: Promise<{video, related}>, recorded }
  const tracked = new WeakSet();   // media elements already listened to
  const repainters = new WeakMap(); // follow button → repaint()

  function trackWatch() {
    const id = location.pathname === '/watch' && new URLSearchParams(location.search).get('v');
    if (!id) { current = null; return; }
    if (!current || current.id !== id) {
      current = { id, recorded: false, info: OF.sources.fetchNext(id).catch(() => null) };
    }
    const player = document.querySelector('#movie_player');
    const media = player && player.querySelector('video');
    if (!media || tracked.has(media)) return;
    tracked.add(media);
    media.addEventListener('timeupdate', async () => {
      const c = current;
      if (!c || c.recorded || player.classList.contains('ad-showing')) return;
      const enough = media.currentTime >= COUNTS_AFTER || (media.duration > 0 && media.currentTime >= media.duration * 0.5);
      if (!enough) return;
      c.recorded = true;
      const info = await c.info;
      if (!info || !info.video.title) return;
      if (await S.recordWatch(info.video)) {
        S.state.cache.related[c.id] = { t: Date.now(), items: info.related };
        S.save('cache');
      }
    });
  }

  function followButton(getChannel) {
    const b = h('button', { class: 'ownfeed-follow', type: 'button' });
    const paint = (ch) => {
      const on = !!(ch && ch.cid && S.state.subs[ch.cid]);
      b.textContent = on ? 'Following locally' : 'Follow locally';
      b.setAttribute('aria-pressed', String(on));
      b.title = on ? 'In your Ownfeed channels. Click to remove.' : 'Add to your Ownfeed channels. No account involved.';
    };
    const repaint = () => Promise.resolve(getChannel(false)).then(paint, () => paint(null));
    repainters.set(b, repaint);
    b.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      b.disabled = true;
      try {
        const ch = await getChannel(true);
        if (!ch || !ch.cid) throw new Error('no channel id');
        await (S.state.subs[ch.cid] ? S.unfollow(ch.cid) : S.follow(ch));
        paint(ch);
      } catch (_) {
        b.textContent = 'Could not read channel';
      } finally {
        b.disabled = false;
      }
    });
    repaint();
    return b;
  }

  function placeWatchButton() {
    const owner = document.querySelector('ytd-watch-metadata #owner');
    if (!owner || !current) return;
    let b = owner.querySelector('.ownfeed-follow');
    if (b && b.dataset.vid === current.id) return;
    if (b) b.remove();
    const c = current;
    b = followButton(async () => {
      const info = await c.info;
      return info && { cid: info.video.cid, name: info.video.channel, handle: info.video.handle };
    });
    b.dataset.vid = c.id;
    owner.append(b);
  }

  const channelCache = new Map(); // path root → resolved channel
  function placeChannelButton() {
    const m = location.pathname.match(/^\/(@[^/]+|channel\/UC[\w-]{22})/);
    if (!m) return;
    const host = document.querySelector('#page-header yt-flexible-actions-view-model, #page-header .page-header-view-model-wiz__page-header-headline-info, #page-header');
    if (!host) return;
    let b = host.querySelector(':scope > .ownfeed-follow');
    if (b && b.dataset.ref === m[1]) return;
    if (b) b.remove();
    const ref = m[1];
    b = followButton(async (mayFetch) => {
      if (!channelCache.has(ref) && mayFetch) channelCache.set(ref, await OF.sources.resolveChannel(ref));
      if (channelCache.has(ref)) return channelCache.get(ref);
      // before the first click only a /channel/UC… address tells us the id without a request
      const direct = ref.match(/UC[\w-]{22}/);
      return direct ? { cid: direct[0] } : null;
    });
    b.dataset.ref = ref;
    host.append(b);
  }

  function check() {
    trackWatch();
    placeWatchButton();
    placeChannelButton();
  }
  function refresh() {
    document.querySelectorAll('.ownfeed-follow').forEach((b) => { const r = repainters.get(b); if (r) r(); });
  }

  OF.watch = { check, refresh };
})(globalThis);
