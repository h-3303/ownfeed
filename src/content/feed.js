// The home page. Signed out, YouTube serves an empty home ("Try searching to get started"); Ownfeed
// fills it from followed channels (RSS) and from what YouTube relates to locally watched videos,
// ranked by the local model.
(function (root) {
  const OF = root.OwnFeed;
  const S = OF.store;
  const { h } = OF.tiles;

  const RSS_TTL = 30 * 60e3;
  const RELATED_TTL = 6 * 3600e3;
  const SEEDS = 8;
  const STALE = 5 * 60e3;

  async function pool(items, n, fn) {
    const queue = items.slice();
    await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
      while (queue.length) await fn(queue.shift());
    }));
  }

  // Refresh what is stale, then hand back candidates from the cache. A failed fetch keeps old data.
  async function gather(force) {
    const { subs, history, cache } = S.state;
    const now = Date.now();
    let dirty = false;

    const dueSubs = Object.keys(subs).filter((cid) => force || !cache.rss[cid] || now - cache.rss[cid].t > RSS_TTL);
    await pool(dueSubs, 4, async (cid) => {
      try { cache.rss[cid] = { t: now, items: (await OF.sources.fetchRss(cid)).items }; dirty = true; } catch (_) { /* keep */ }
    });

    const seeds = history.slice(0, SEEDS);
    const dueSeeds = seeds.filter((s) => !cache.related[s.id] || now - cache.related[s.id].t > RELATED_TTL);
    await pool(dueSeeds, 2, async (s) => {
      try { cache.related[s.id] = { t: now, items: (await OF.sources.fetchNext(s.id)).related }; dirty = true; } catch (_) { /* keep */ }
    });

    for (const cid of Object.keys(cache.rss)) if (!subs[cid]) { delete cache.rss[cid]; dirty = true; }
    const keep = new Set(seeds.map((s) => s.id));
    for (const id of Object.keys(cache.related)) if (!keep.has(id)) { delete cache.related[id]; dirty = true; }
    if (dirty) await S.save('cache');

    const subItems = Object.keys(subs).flatMap((cid) => ((cache.rss[cid] || {}).items || []).map((v) => ({ ...v, channel: v.channel || subs[cid].name })));
    const relItems = seeds.flatMap((s) => ((cache.related[s.id] || {}).items || []).map((v) => ({ ...v, seed: { id: s.id, title: s.title, t: s.t } })));
    return { subItems, relItems };
  }

  function card(v, heldBack) {
    const url = (v.short ? '/shorts/' : '/watch?v=') + v.id;
    const reason = heldBack
      ? 'Held back: ' + (v.assess.why.join(', ') || 'similar to hidden videos')
      : v.source === 'sub' ? 'From a channel you follow'
      : v.seeds.length ? 'Because you watched ' + v.seeds[0].title : '';
    const meta = v.meta || [v.views != null ? OF.rank.compact(v.views) + ' views' : '', v.published ? OF.rank.ago(v.published) : ''].filter(Boolean).join(' · ');
    const el = h('div', { class: 'ownfeed-card' + (heldBack ? ' ownfeed-card-held' : '') },
      h('a', { class: 'ownfeed-thumb', href: url },
        h('img', { src: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`, alt: '', loading: 'lazy' }),
        v.duration ? h('span', { class: 'ownfeed-duration' }, v.duration) : null),
      h('a', { class: 'ownfeed-title', href: url, title: v.title }, v.title),
      h('div', { class: 'ownfeed-meta' }, v.cid ? h('a', { href: '/channel/' + v.cid }, v.channel) : v.channel),
      meta ? h('div', { class: 'ownfeed-meta' }, meta) : null,
      reason ? h('div', { class: 'ownfeed-reason', title: reason }, reason) : null
    );
    if (heldBack) {
      el.append(h('button', {
        class: 'ownfeed-link ownfeed-fine', type: 'button', title: 'Count this as a video you do want; its topics and channel recover',
        onclick: async (e) => { e.preventDefault(); await S.thisWasFine(v); render({ user: true }); },
      }, 'This one is fine'));
    }
    OF.tiles.attach(el, v);
    return el;
  }

  let container, rendering = false, renderedAt = 0, showHeld = false;

  // user: the person asked for this render (a button), so it may replace an open follow-up panel.
  // force: refetch every source regardless of cache age.
  async function render({ user = false, force = false } = {}) {
    if (!container || rendering) return;
    if (!user && container.querySelector('.ownfeed-collapsed')) return;
    rendering = true;
    try {
      const { subs, history, blocks, model, settings } = S.state;
      if (!container.childElementCount) container.append(h('div', { class: 'ownfeed-note' }, 'Building your feed…'));
      const cand = await gather(force);
      const { shown, held } = OF.rank.buildFeed({ ...cand, history, blocks, model, settings });

      const head = h('div', { class: 'ownfeed-head' },
        h('div', {},
          h('div', { class: 'ownfeed-h1' }, 'Your feed'),
          h('div', { class: 'ownfeed-sub' },
            `${Object.keys(subs).length} followed channels · ${history.length} watched · built and kept on this device`)),
        h('div', { class: 'ownfeed-actions' },
          h('button', { class: 'ownfeed-btn', type: 'button', onclick: () => render({ user: true, force: true }) }, 'Refresh'),
          h('button', { class: 'ownfeed-btn', type: 'button', onclick: () => (root.browser || root.chrome).runtime.sendMessage({ type: 'open-options' }) }, 'Signals & channels')));

      const body = shown.length
        ? h('div', { class: 'ownfeed-grid' }, shown.map((v) => card(v, false)))
        : h('div', { class: 'ownfeed-note' },
            h('strong', {}, 'Nothing to show yet. '),
            'The feed grows from two things: channels you follow (the Follow button under any video or on a channel page, ',
            'or import a subscription list under “Signals & channels”), and videos you watch, which bring in related ones. ',
            'Search for something to begin.');

      const heldBox = held.length
        ? h('div', { class: 'ownfeed-held' },
            h('button', { class: 'ownfeed-link', type: 'button', onclick: () => { showHeld = !showHeld; render({ user: true }); } },
              `${held.length} held back by your “not interested” signals · ${showHeld ? 'hide' : 'show'}`),
            showHeld ? h('div', { class: 'ownfeed-grid' }, held.map((v) => card(v, true))) : null)
        : null;

      container.replaceChildren(head, body, ...(heldBox ? [heldBox] : []));
    } finally {
      renderedAt = Date.now(); // also after a failure, so a broken source is not retried on every DOM change
      rendering = false;
    }
  }

  // Signed out, YouTube's home is empty until something has been watched in this browser; after
  // that it serves a feed keyed to its cookies. So home has two views: Ownfeed's, and YouTube's with
  // Ownfeed's filtering applied. 'auto' opens on whichever has content, YouTube's first.
  let bar, viewOverride = null;

  function switcher(view) {
    const tab = (id, label, title) => h('button', {
      class: 'ownfeed-tab', type: 'button', title, 'aria-pressed': String(view === id),
      onclick: () => { viewOverride = id; check(); },
    }, label);
    // Floats over the page: YouTube's home has sticky headers of its own that cover anything put
    // in the flow above the grid.
    return h('div', { id: 'ownfeed-bar', 'data-view': view },
      h('div', { class: 'ownfeed-tabs' },
        tab('yt', 'YouTube’s feed', 'Signed-out suggestions from this browser’s cookies. ✕ and your blocks apply here too.'),
        tab('own', 'My feed', 'Followed channels and videos related to what you watched, ranked on this device.')));
  }

  function check() {
    const mode = S.state.settings.replaceHome;
    const browse = location.pathname === '/' && document.querySelector('ytd-browse[page-subtype="home"]');
    if (!browse) { document.documentElement.classList.remove('ownfeed-own-view'); return; }
    if (mode === 'never') {
      document.documentElement.classList.remove('ownfeed-own-view');
      browse.classList.remove('ownfeed-home-active');
      if (bar) bar.remove();
      if (container) container.remove();
      bar = container = null;
      return;
    }
    const empty = !!browse.querySelector('ytd-feed-nudge-renderer');
    const view = empty ? 'own' : viewOverride || (mode === 'always' ? 'own' : 'yt');

    if (empty) { if (bar) bar.remove(); bar = null; }
    else if (!bar || !bar.isConnected || bar.dataset.view !== view) {
      const next = switcher(view);
      if (bar && bar.isConnected) bar.replaceWith(next); else browse.prepend(next);
      bar = next;
    }

    browse.classList.toggle('ownfeed-home-active', view === 'own');
    document.documentElement.classList.toggle('ownfeed-own-view', view === 'own');
    if (view !== 'own') { if (container) container.hidden = true; return; }
    if (!container || !container.isConnected) {
      container = h('div', { id: 'ownfeed-home' });
      browse.prepend(container);
      render();
    } else {
      container.hidden = false;
      if (Date.now() - renderedAt > STALE) render();
    }
  }

  // Signal changes re-rank at once from cached candidates; cache writes are our own and are ignored.
  function refresh(touched) {
    if (!container || !container.isConnected || location.pathname !== '/') return;
    if (touched.some((k) => k !== 'cache')) render();
  }

  OF.home = { check, refresh };
})(globalThis);
