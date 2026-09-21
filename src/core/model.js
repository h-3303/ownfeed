// The local "not interested" model. Two layers:
//   hard blocks  — a video, a channel or a topic the user explicitly blocked: never shown anywhere
//   learned load — per-token and per-channel counts from dislikes (neg) and watches (pos); videos
//                  that resemble disliked ones are down-ranked, and held back once the load reaches 1
//                  (see the weights above assess)
// Pure functions over plain objects so the same code runs in the page, the options page and Node.
(function (root) {
  const OF = (root.OwnFeed = root.OwnFeed || {});
  const T = OF.tokens;

  const MAX_TOKENS = 4000;
  const MAX_BLOCKED_VIDEOS = 5000;

  const emptyModel = () => ({ tok: {}, ch: {}, nNeg: 0, nPos: 0 });
  const emptyBlocks = () => ({ videos: {}, channels: [], keywords: [] });

  const chKey = (name) => T.normalise(name).trim();

  // Topic tokens of a video: its title, less the channel's own name — many titles end in
  // "… | Channel Name", and that belongs to the channel signal, not to a topic.
  function topicTokens(video) {
    const own = new Set(T.tokens(video.channel || ''));
    return T.tokens(video.title).filter((t) => !own.has(t));
  }

  function bump(table, key, idx, by) {
    if (!key) return;
    const e = table[key] || (table[key] = [0, 0]);
    e[idx] = Math.max(0, e[idx] + by);
    if (!e[0] && !e[1]) delete table[key];
  }

  // kind: 'neg' (not interested) | 'pos' (watched / "this was fine"). sign −1 undoes it exactly.
  function learn(model, video, kind, sign = 1) {
    const idx = kind === 'neg' ? 0 : 1;
    for (const t of topicTokens(video)) bump(model.tok, t, idx, sign);
    bump(model.ch, chKey(video.channel), idx, sign);
    if (kind === 'neg') model.nNeg = Math.max(0, model.nNeg + sign);
    else model.nPos = Math.max(0, model.nPos + sign);
    prune(model);
    return model;
  }

  function prune(model) {
    const keys = Object.keys(model.tok);
    if (keys.length <= MAX_TOKENS) return;
    // one-off tokens carry the least signal; drop those first
    let left = keys.length;
    for (const k of keys) {
      if (left <= MAX_TOKENS * 0.8) break;
      const [n, p] = model.tok[k];
      if (n + p <= 1) { delete model.tok[k]; left--; }
    }
  }

  // (−1, 1): positive = disliked, negative = liked. The lean of the counts, scaled by how much
  // evidence there is: one event says little (±0.17), three or more speak at full weight.
  function entryScore(e) {
    if (!e) return 0;
    const total = e[0] + e[1];
    return ((e[0] - e[1]) / (total + 1)) * Math.min(1, total / 3);
  }
  const tokenScore = (model, t) => entryScore(model.tok[t]);
  const channelScore = (model, name) => entryScore(model.ch[chKey(name)]);

  // Weights are set so that a single dislike only ranks look-alikes down; holding back takes two
  // dislikes sharing a couple of words, four on one word, or two on one channel.
  const W_TOPIC = 1.3, W_CHANNEL = 2.4, W_TOPIC_FOR = 0.6, W_CHANNEL_FOR = 0.8;

  function assess(model, video) {
    const scored = topicTokens(video).map((t) => [t, tokenScore(model, t)]);
    const neg = scored.filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const pos = scored.filter((x) => x[1] < 0).sort((a, b) => a[1] - b[1]).slice(0, 3);
    const pen = neg.reduce((s, x) => s + x[1], 0);
    const aff = pos.reduce((s, x) => s - x[1], 0);
    const ch = channelScore(model, video.channel);
    const load = W_TOPIC * pen + W_CHANNEL * Math.max(0, ch) - W_TOPIC_FOR * aff - W_CHANNEL_FOR * Math.max(0, -ch);
    const why = neg.map((x) => x[0]);
    if (ch > 0.3) why.unshift(video.channel);
    return { pen, aff, ch, load, hold: load >= 1, why };
  }

  function sameChannel(entry, video) {
    if (entry.id && video.cid && entry.id === video.cid) return true;
    if (entry.handle && video.handle && entry.handle.toLowerCase() === video.handle.toLowerCase()) return true;
    // tiles in YouTube's own lists often expose only the display name
    return !!entry.name && !!video.channel && chKey(entry.name) === chKey(video.channel);
  }

  // → null, or { kind: 'video' | 'channel' | 'keyword', label }
  function blockedBy(blocks, video) {
    if (video.id && blocks.videos[video.id]) return { kind: 'video', label: video.title };
    for (const c of blocks.channels) if (sameChannel(c, video)) return { kind: 'channel', label: c.name };
    for (const k of blocks.keywords) if (T.matchesKeyword(video.title, k.k)) return { kind: 'keyword', label: k.k };
    return null;
  }

  function blockVideo(blocks, video) {
    blocks.videos[video.id] = { t: Date.now(), title: video.title || '', channel: video.channel || '' };
    const ids = Object.keys(blocks.videos);
    if (ids.length > MAX_BLOCKED_VIDEOS) {
      ids.sort((a, b) => blocks.videos[a].t - blocks.videos[b].t)
        .slice(0, ids.length - MAX_BLOCKED_VIDEOS)
        .forEach((id) => delete blocks.videos[id]);
    }
  }
  const unblockVideo = (blocks, id) => { delete blocks.videos[id]; };

  function blockChannel(blocks, video) {
    if (blocks.channels.some((c) => sameChannel(c, video))) return;
    blocks.channels.push({ id: video.cid || '', handle: video.handle || '', name: video.channel || '', t: Date.now() });
  }
  function unblockChannel(blocks, video) {
    blocks.channels = blocks.channels.filter((c) => !sameChannel(c, video));
  }

  function blockKeyword(blocks, k) {
    const key = T.normalise(k).trim();
    if (key && !blocks.keywords.some((x) => x.k === key)) blocks.keywords.push({ k: key, t: Date.now() });
  }
  function unblockKeyword(blocks, k) {
    const key = T.normalise(k).trim();
    blocks.keywords = blocks.keywords.filter((x) => x.k !== key);
  }

  // Topic chips offered after a dislike: the tokens already weighing most against, then the longest
  // (long words are usually the subject, short ones the grammar).
  function suggestTopics(model, video, n = 4) {
    return topicTokens(video)
      .map((t) => [t, tokenScore(model, t)])
      .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
      .slice(0, n)
      .map((x) => x[0]);
  }

  OF.model = {
    emptyModel, emptyBlocks, topicTokens, learn, assess, entryScore, tokenScore, channelScore, chKey, sameChannel,
    blockedBy, blockVideo, unblockVideo, blockChannel, unblockChannel, blockKeyword, unblockKeyword,
    suggestTopics,
  };
})(globalThis);
