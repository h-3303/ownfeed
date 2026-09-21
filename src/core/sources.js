// Where feed candidates come from, with no account and no API key:
//   channel RSS   /feeds/videos.xml?channel_id=UC…   latest 15 uploads of a followed channel
//   watch-next    POST /youtubei/v1/next              what YouTube relates to a video you watched
// Parsers are pure (tested against saved responses); fetchers are same-origin from youtube.com.
(function (root) {
  const OF = (root.OwnFeed = root.OwnFeed || {});

  const FALLBACK_CLIENT_VERSION = '2.20260918.00.00';

  function walk(o, fn) {
    if (Array.isArray(o)) { for (const x of o) walk(x, fn); return; }
    if (o && typeof o === 'object') {
      if (fn(o) === false) return;
      for (const k in o) walk(o[k], fn);
    }
  }
  function findFirst(o, key) {
    let hit;
    walk(o, (n) => { if (hit !== undefined) return false; if (key in n) { hit = n[key]; return false; } });
    return hit;
  }
  const text = (t) => (!t ? '' : t.content || t.simpleText || (t.runs || []).map((r) => r.text).join(''));

  function parseLockup(l) {
    if (l.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO' || !l.contentId) return null;
    const meta = (l.metadata || {}).lockupMetadataViewModel || {};
    const rows = (((meta.metadata || {}).contentMetadataViewModel || {}).metadataRows || [])
      .map((r) => (r.metadataParts || []).map((p) => text(p.text)).filter(Boolean));
    let cid = '', handle = '', duration = '';
    walk(l, (n) => {
      if (!cid && typeof n.browseId === 'string' && n.browseId.startsWith('UC')) {
        cid = n.browseId;
        if (typeof n.canonicalBaseUrl === 'string' && n.canonicalBaseUrl.startsWith('/@')) handle = n.canonicalBaseUrl.slice(2);
      }
      if (!duration && n.thumbnailBadgeViewModel) duration = n.thumbnailBadgeViewModel.text || '';
    });
    return {
      id: l.contentId,
      title: text(meta.title),
      channel: (rows[0] || [])[0] || '',
      cid, handle,
      duration: /^\d/.test(duration) ? duration : '',
      live: /live/i.test(duration),
      meta: (rows[1] || []).join(' · '),
    };
  }

  // Older layout, still served in some experiments.
  function parseCompact(v) {
    if (!v.videoId) return null;
    const by = v.longBylineText || v.shortBylineText;
    const ep = ((by && by.runs && by.runs[0]) || {}).navigationEndpoint || {};
    const base = ((ep.browseEndpoint || {}).canonicalBaseUrl) || '';
    return {
      id: v.videoId,
      title: text(v.title),
      channel: text(by),
      cid: (ep.browseEndpoint || {}).browseId || '',
      handle: base.startsWith('/@') ? base.slice(2) : '',
      duration: text(v.lengthText),
      live: false,
      meta: [text(v.shortViewCountText), text(v.publishedTimeText)].filter(Boolean).join(' · '),
    };
  }

  // → { video: {id,title,channel,cid,handle}, related: [...] }
  function parseNext(json, videoId) {
    const related = [];
    const seen = new Set([videoId]);
    const secondary = findFirst(json, 'secondaryResults') || json;
    walk(secondary, (n) => {
      const v = n.lockupViewModel ? parseLockup(n.lockupViewModel)
        : n.compactVideoRenderer ? parseCompact(n.compactVideoRenderer) : null;
      if (v && v.title && !seen.has(v.id)) { seen.add(v.id); related.push(v); }
    });
    const primary = findFirst(json, 'videoPrimaryInfoRenderer') || {};
    const owner = findFirst(json, 'videoOwnerRenderer') || {};
    const run = ((owner.title || {}).runs || [])[0] || {};
    const be = (run.navigationEndpoint || {}).browseEndpoint || {};
    const base = be.canonicalBaseUrl || '';
    return {
      video: {
        id: videoId,
        title: text(primary.title),
        channel: run.text || '',
        cid: be.browseId || '',
        handle: base.startsWith('/@') ? base.slice(2) : '',
      },
      related,
    };
  }

  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const unescapeXml = (s) =>
    String(s || '').replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ENT[e] || m;
    });
  const tag = (xml, name) => {
    const m = xml.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>'));
    return m ? unescapeXml(m[1].trim()) : '';
  };

  // The Atom feed is machine-written and regular; a regex read keeps this usable outside a browser.
  function parseRss(xml) {
    const head = xml.split('<entry>')[0];
    const channel = { cid: '', name: tag(head, 'title') };
    const cm = head.match(/<yt:channelId>([^<]+)</);
    if (cm) channel.cid = cm[1].startsWith('UC') ? cm[1] : 'UC' + cm[1];
    const items = [];
    for (const e of xml.split('<entry>').slice(1)) {
      const id = tag(e, 'yt:videoId');
      if (!id) continue;
      const link = (e.match(/<link rel="alternate" href="([^"]+)"/) || [])[1] || '';
      const views = (e.match(/<media:statistics views="(\d+)"/) || [])[1];
      items.push({
        id,
        title: tag(e, 'title'),
        channel: tag(e, 'name') || channel.name,
        cid: channel.cid,
        handle: '',
        published: Date.parse(tag(e, 'published')) || 0,
        views: views ? +views : null,
        short: link.includes('/shorts/'),
        duration: '',
        live: false,
      });
    }
    return { channel, items };
  }

  function clientVersion() {
    if (typeof document === 'undefined') return FALLBACK_CLIENT_VERSION;
    for (const s of document.scripts) {
      const m = s.textContent.length < 2e6 && s.textContent.match(/"INNERTUBE_CLIENT_VERSION":"([\d.]+)"/);
      if (m) return m[1];
    }
    return FALLBACK_CLIENT_VERSION;
  }

  let cachedVersion;
  async function fetchNext(videoId) {
    cachedVersion = cachedVersion || clientVersion();
    const hl = (typeof document !== 'undefined' && document.documentElement.lang) || 'en';
    const res = await fetch('https://www.youtube.com/youtubei/v1/next?prettyPrint=false', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: cachedVersion, hl } }, videoId }),
    });
    if (!res.ok) throw new Error('next ' + res.status);
    return parseNext(await res.json(), videoId);
  }

  async function fetchRss(cid) {
    const res = await fetch('https://www.youtube.com/feeds/videos.xml?channel_id=' + encodeURIComponent(cid));
    if (!res.ok) throw new Error('rss ' + res.status);
    return parseRss(await res.text());
  }

  // Any channel reference (UC id, /channel/ URL, @handle, handle URL) → { cid, name, handle }
  async function resolveChannel(ref) {
    ref = String(ref || '').trim();
    const direct = ref.match(/(UC[\w-]{22})/);
    if (direct) {
      const { channel } = await fetchRss(direct[1]);
      return { cid: direct[1], name: channel.name, handle: '' };
    }
    const h = ref.match(/@([\w.-]+)/) || (/^[\w.-]+$/.test(ref) ? [null, ref] : null);
    if (!h) throw new Error('Not a channel id, URL or @handle');
    const res = await fetch('https://www.youtube.com/@' + h[1]);
    if (!res.ok) throw new Error('Channel not found');
    const html = await res.text();
    const m = html.match(/"externalId":"(UC[\w-]{22})"/) || html.match(/channel_id=(UC[\w-]{22})/);
    if (!m) throw new Error('Could not read the channel id');
    const name = (html.match(/<meta property="og:title" content="([^"]*)"/) || [])[1];
    return { cid: m[1], name: unescapeXml(name || h[1]), handle: h[1] };
  }

  // Subscription lists from elsewhere → [{cid, name}]. Takes Google Takeout CSV, OPML, NewPipe JSON
  // and FreeTube's profiles.db; all of them carry UC ids, so nothing needs resolving.
  function parseSubscriptions(textIn) {
    const out = new Map();
    const add = (cid, name) => { if (cid && !out.has(cid)) out.set(cid, { cid, name: name || cid }); };
    const src = String(textIn || '');
    const docs = [];
    if (/^[{[]/.test(src.trim())) {
      try { docs.push(JSON.parse(src)); } catch (_) {
        // FreeTube's .db is one JSON object per line
        for (const line of src.split('\n')) { try { docs.push(JSON.parse(line)); } catch (_) { /* skip */ } }
      }
    }
    for (const d of docs) {
      walk(d, (n) => {
        const id = [n.id, n.url, n.channelId].find((x) => typeof x === 'string' && /UC[\w-]{22}/.test(x));
        if (id) add(id.match(/UC[\w-]{22}/)[0], n.name || n.title);
      });
    }
    if (!docs.length) {
      for (const m of src.matchAll(/<outline\b[^>]*>/g)) {
        const id = m[0].match(/channel_id=(UC[\w-]{22})/);
        const name = m[0].match(/\b(?:title|text)="([^"]*)"/);
        if (id) add(id[1], name && unescapeXml(name[1]));
      }
      for (const line of src.split(/\r?\n/)) {
        const m = line.match(/^(UC[\w-]{22}),[^,]*,(.*)$/);
        if (m) add(m[1], m[2].replace(/^"|"$/g, ''));
      }
    }
    return [...out.values()];
  }

  OF.sources = { parseNext, parseRss, parseSubscriptions, fetchNext, fetchRss, resolveChannel, unescapeXml };
})(globalThis);
