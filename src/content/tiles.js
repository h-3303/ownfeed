// Every video tile on youtube.com — YouTube's own lists and Ownfeed's cards — gets the same
// treatment: hard-blocked tiles disappear, held-back ones are dimmed, and each carries a
// "Not interested" button that collapses the tile into a small panel with follow-up choices.
(function (root) {
  const OF = root.OwnFeed;
  const S = OF.store;

  const TILE_SEL = [
    'ytd-rich-item-renderer', 'ytd-video-renderer', 'ytd-compact-video-renderer', 'ytd-grid-video-renderer',
    'ytd-playlist-panel-video-renderer', 'yt-lockup-view-model', 'ytd-reel-item-renderer',
    'ytm-shorts-lockup-view-model', 'ytm-shorts-lockup-view-model-v2',
  ].join(',');

  const tileState = new WeakMap(); // el → { video, open }

  const h = (tagName, props = {}, ...kids) => {
    const el = document.createElement(tagName);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid);
    return el;
  };

  // Read what a YouTube tile shows. Only the display name of the channel is reliably present, so
  // channel blocks match on id, handle or name (see model.sameChannel).
  function extract(el) {
    const a = el.querySelector('a[href*="/watch?v="], a[href^="/shorts/"]');
    if (!a) return null;
    const href = a.getAttribute('href');
    const m = href.match(/[?&]v=([\w-]{11})/) || href.match(/^\/shorts\/([\w-]{11})/);
    if (!m) return null;
    const titleEl = el.querySelector(
      '#video-title, h3 a, h3, [class*="lockup-metadata-view-model"][class*="title"]'
    );
    const title = ((titleEl && (titleEl.getAttribute('title') || titleEl.textContent)) || a.getAttribute('title') || '').trim();
    const chLink = el.querySelector('a[href^="/@"], a[href^="/channel/UC"]');
    const chEl =
      el.querySelector('ytd-channel-name #text') ||
      // YouTube's newer tiles: the first metadata text is the channel. Class names have been both
      // kebab-case and camelCase across rollouts.
      el.querySelector('[class*="ContentMetadataViewModelMetadataText"], [class*="content-metadata-view-model"][class*="metadata-text"]') ||
      chLink;
    const chHref = (chLink && chLink.getAttribute('href')) || '';
    return {
      id: m[1],
      title,
      channel: ((chEl && chEl.textContent) || '').trim(),
      handle: chHref.startsWith('/@') ? chHref.slice(2).split('/')[0] : '',
      cid: (chHref.match(/\/channel\/(UC[\w-]{22})/) || [])[1] || '',
      short: href.startsWith('/shorts/'),
    };
  }

  function panel(el, video) {
    const st = tileState.get(el);
    const pressed = { channel: false, keywords: new Set() };
    const dislikes = (S.state.model.ch[OF.model.chKey(video.channel)] || [0])[0];

    const chip = (label, onToggle, strong) => {
      const b = h('button', { class: 'ownfeed-chip' + (strong ? ' ownfeed-chip-strong' : ''), type: 'button', 'aria-pressed': 'false' }, label);
      b.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const on = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', String(on));
        onToggle(on);
      });
      return b;
    };

    const undo = h('button', { class: 'ownfeed-link', type: 'button' }, 'Undo');
    undo.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      if (pressed.channel) await S.setChannelBlocked(video, false);
      for (const k of pressed.keywords) await S.setKeywordBlocked(k, false);
      await S.undoNotInterested(video);
      st.open = false;
      box.remove();
      el.classList.remove('ownfeed-collapsed');
      apply(el, video);
    });

    const topics = OF.model.suggestTopics(S.state.model, video);
    const box = h('div', { class: 'ownfeed-panel' },
      h('div', { class: 'ownfeed-panel-head' }, h('span', {}, 'Hidden. Similar videos will rank lower.'), undo),
      h('div', { class: 'ownfeed-panel-title' }, video.title),
      video.channel
        ? h('div', { class: 'ownfeed-panel-row' },
            chip(`Block channel: ${video.channel}`, (on) => { pressed.channel = on; S.setChannelBlocked(video, on); }, dislikes >= 2))
        : null,
      topics.length
        ? h('div', { class: 'ownfeed-panel-row' }, h('span', { class: 'ownfeed-panel-label' }, 'Block topic'),
            topics.map((t) => chip(t, (on) => { pressed.keywords[on ? 'add' : 'delete'](t); S.setKeywordBlocked(t, on); })))
        : null
    );
    // a click anywhere else in the panel must not open the video underneath
    box.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
    return box;
  }

  async function onNotInterested(el, e) {
    e.preventDefault(); e.stopPropagation();
    const st = tileState.get(el);
    if (!st || st.open) return;
    st.open = true;
    el.classList.add('ownfeed-collapsed');
    el.classList.remove('ownfeed-dim');
    el.append(panel(el, st.video));
    await S.notInterested(st.video);
  }

  function apply(el, video) {
    const st = tileState.get(el);
    if (st && st.open) return; // the follow-up panel stays until the user leaves or undoes
    const { blocks, model, settings } = S.state;
    const blocked = OF.model.blockedBy(blocks, video) || (settings.hideShorts && video.short);
    let hold = false, why = '';
    if (!blocked && settings.surfaces !== 'off' && !el.classList.contains('ownfeed-card')) {
      const a = OF.model.assess(model, video);
      hold = a.hold;
      why = a.why.join(', ');
    }
    el.classList.toggle('ownfeed-hidden', !!blocked || (hold && settings.surfaces === 'hide'));
    el.classList.toggle('ownfeed-dim', hold && settings.surfaces === 'dim');
    if (hold) el.setAttribute('data-ownfeed-why', why); else el.removeAttribute('data-ownfeed-why');
  }

  // Give an element tile behaviour. YouTube recycles tile elements for new videos, so a changed id
  // resets everything.
  function attach(el, video) {
    let st = tileState.get(el);
    if (!st || st.video.id !== video.id) {
      el.querySelectorAll(':scope > .ownfeed-panel').forEach((n) => n.remove());
      el.classList.remove('ownfeed-collapsed', 'ownfeed-hidden', 'ownfeed-dim');
      st = { video, open: false };
      tileState.set(el, st);
    } else {
      st.video = { ...st.video, ...video };
    }
    el.classList.add('ownfeed-tile');
    if (!el.querySelector(':scope > .ownfeed-ni')) {
      el.append(h('button', {
        class: 'ownfeed-ni', type: 'button', title: 'Not interested', 'aria-label': 'Not interested',
        onclick: (e) => onNotInterested(el, e),
      }, '✕'));
    }
    apply(el, st.video);
  }

  function scan() {
    document.documentElement.classList.toggle('ownfeed-hide-shorts', !!S.state.settings.hideShorts);
    for (const el of document.querySelectorAll(TILE_SEL)) {
      if (el.parentElement && el.parentElement.closest(TILE_SEL)) continue; // inner half of a nested pair
      const video = extract(el);
      if (video && video.title) attach(el, video);
    }
  }

  OF.tiles = { scan, attach, apply, extract, h, TILE_SEL };
})(globalThis);
