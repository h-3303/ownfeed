// State lives in extension storage only — nothing leaves the device. One storage key per concern so
// tabs writing at the same moment rarely touch the same value; every tab mirrors changes in memory.
(function (root) {
  const OF = (root.OwnFeed = root.OwnFeed || {});
  const api = root.browser || root.chrome;

  const DEFAULTS = () => ({
    blocks: OF.model.emptyBlocks(),
    model: OF.model.emptyModel(),
    subs: {},        // UCid → { name, handle, added }
    history: [],     // newest first: { id, title, channel, cid, t }
    cache: { rss: {}, related: {} },
    settings: { replaceHome: 'auto', hideShorts: true, surfaces: 'dim', feedSize: 60 },
  });
  const KEYS = Object.keys(DEFAULTS());
  const MAX_HISTORY = 500;

  const state = DEFAULTS();
  const listeners = new Set();
  let readyPromise;

  function ready() {
    if (!readyPromise) {
      readyPromise = api.storage.local.get(KEYS).then((got) => {
        const d = DEFAULTS();
        for (const k of KEYS) state[k] = got[k] === undefined ? d[k] : got[k];
        state.settings = { ...d.settings, ...state.settings };
        api.storage.onChanged.addListener((changes, area) => {
          if (area !== 'local') return;
          const touched = [];
          for (const k of KEYS) {
            if (!changes[k]) continue;
            state[k] = changes[k].newValue === undefined ? DEFAULTS()[k] : changes[k].newValue;
            touched.push(k);
          }
          if (touched.length) for (const fn of listeners) fn(touched);
        });
        return state;
      });
    }
    return readyPromise;
  }

  const save = (...keys) => api.storage.local.set(Object.fromEntries(keys.map((k) => [k, state[k]])));
  const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  // ---- the actions every surface shares ------------------------------------------------------

  function notInterested(video) {
    if (state.blocks.videos[video.id]) return Promise.resolve();
    OF.model.blockVideo(state.blocks, video);
    OF.model.learn(state.model, video, 'neg');
    return save('blocks', 'model');
  }
  function undoNotInterested(video) {
    if (!state.blocks.videos[video.id]) return Promise.resolve();
    OF.model.unblockVideo(state.blocks, video.id);
    OF.model.learn(state.model, video, 'neg', -1);
    return save('blocks', 'model');
  }
  function thisWasFine(video) {
    OF.model.learn(state.model, video, 'pos');
    return save('model');
  }
  function setChannelBlocked(video, on) {
    (on ? OF.model.blockChannel : OF.model.unblockChannel)(state.blocks, video);
    return save('blocks');
  }
  function setKeywordBlocked(k, on) {
    (on ? OF.model.blockKeyword : OF.model.unblockKeyword)(state.blocks, k);
    return save('blocks');
  }

  function recordWatch(video) {
    if (state.history.some((h) => h.id === video.id)) return Promise.resolve(false);
    state.history.unshift({ id: video.id, title: video.title, channel: video.channel, cid: video.cid || '', t: Date.now() });
    state.history.length = Math.min(state.history.length, MAX_HISTORY);
    OF.model.learn(state.model, video, 'pos');
    return save('history', 'model').then(() => true);
  }

  function follow(ch) {
    state.subs[ch.cid] = { name: ch.name || ch.cid, handle: ch.handle || '', added: Date.now() };
    return save('subs');
  }
  function unfollow(cid) {
    delete state.subs[cid];
    delete state.cache.rss[cid];
    return save('subs', 'cache');
  }

  function exportAll() {
    const { cache, ...rest } = state;
    return { ownfeed: 1, exported: new Date().toISOString(), ...rest };
  }
  function importAll(data) {
    if (!data || data.ownfeed !== 1) throw new Error('Not an Ownfeed export');
    const d = DEFAULTS();
    for (const k of KEYS) if (k !== 'cache' && data[k] !== undefined) state[k] = data[k];
    state.settings = { ...d.settings, ...state.settings };
    state.cache = d.cache;
    return save(...KEYS);
  }
  function resetAll() {
    Object.assign(state, DEFAULTS());
    return save(...KEYS);
  }

  OF.store = {
    state, ready, save, onChange,
    notInterested, undoNotInterested, thisWasFine, setChannelBlocked, setKeywordBlocked,
    recordWatch, follow, unfollow, exportAll, importAll, resetAll,
  };
})(globalThis);
