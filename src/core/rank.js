// Candidates → the home feed. Pure.
//   score = source base + freshness − learned load, then a greedy pass that taxes channel repeats
// Hard-blocked and already-watched videos never appear; videos whose load reaches 1 are returned
// separately as `held` so the page can say how many were kept back, and why.
(function (root) {
  const OF = (root.OwnFeed = root.OwnFeed || {});
  const M = OF.model;

  const DAY = 864e5;

  // subItems: RSS items. relItems: watch-next items carrying .seed = {id,title,t} of the watched video.
  function buildFeed({ subItems = [], relItems = [], history = [], blocks, model, settings = {}, now = Date.now() }) {
    const watched = new Set(history.map((h) => h.id));
    const byId = new Map();

    for (const v of subItems) {
      if (byId.has(v.id)) continue;
      const age = Math.max(0, now - (v.published || 0)) / DAY;
      byId.set(v.id, { ...v, source: 'sub', base: 1 + 1.5 * Math.pow(0.5, age / 3), seeds: [] });
    }
    for (const v of relItems) {
      const seedAge = Math.max(0, now - ((v.seed && v.seed.t) || 0)) / DAY;
      const w = 0.6 + 0.6 * Math.pow(0.5, seedAge / 7);
      const have = byId.get(v.id);
      if (have) {
        // related to several things you watched, or also from a followed channel: stronger case
        have.base += 0.3;
        if (v.seed && !have.seeds.some((s) => s.id === v.seed.id)) have.seeds.push(v.seed);
        if (!have.duration && v.duration) have.duration = v.duration;
      } else {
        byId.set(v.id, { ...v, source: 'related', base: w, seeds: v.seed ? [v.seed] : [] });
      }
    }

    const pool = [], held = [];
    for (const v of byId.values()) {
      if (watched.has(v.id)) continue;
      if (settings.hideShorts !== false && v.short) continue;
      if (M.blockedBy(blocks, v)) continue;
      const a = M.assess(model, v);
      v.assess = a;
      v.score = v.base - a.load;
      (a.hold ? held : pool).push(v);
    }

    const size = settings.feedSize || 60;
    const perChannel = new Map();
    const shown = [];
    const rest = pool.slice();
    while (shown.length < size && rest.length) {
      let best = 0, bestScore = -Infinity;
      for (let i = 0; i < rest.length; i++) {
        const n = perChannel.get(M.chKey(rest[i].channel)) || 0;
        const s = rest[i].score - 0.4 * n;
        if (s > bestScore) { bestScore = s; best = i; }
      }
      const [v] = rest.splice(best, 1);
      const k = M.chKey(v.channel);
      perChannel.set(k, (perChannel.get(k) || 0) + 1);
      shown.push(v);
    }
    held.sort((a, b) => b.score - a.score);
    return { shown, held: held.slice(0, size) };
  }

  function ago(ts, now = Date.now()) {
    const s = Math.max(0, now - ts) / 1000;
    const steps = [[60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day'], [4.35, 'week'], [12, 'month'], [Infinity, 'year']];
    let n = s;
    for (const [div, unit] of steps) {
      if (n < div) { const r = Math.max(1, Math.floor(n)); return `${r} ${unit}${r === 1 ? '' : 's'} ago`; }
      n /= div;
    }
    return '';
  }

  function compact(n) {
    if (n == null) return '';
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return Math.round(n / 1e3) + 'K';
    return String(n);
  }

  OF.rank = { buildFeed, ago, compact };
})(globalThis);
