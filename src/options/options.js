// The settings page: everything Ownfeed holds, inspectable and removable.
(function (root) {
  const OF = root.OwnFeed;
  const S = OF.store;
  const $ = (id) => document.getElementById(id);

  const el = (tagName, props = {}, ...kids) => {
    const n = document.createElement(tagName);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    n.append(...kids.flat().filter((x) => x != null));
    return n;
  };
  const row = (name, sub, onRemove, label = 'Remove') =>
    el('li', {}, el('span', { class: 'name' }, name), sub ? el('span', { class: 'sub' }, sub) : null, el('button', { type: 'button', onclick: onRemove }, label));
  const fill = (list, items, emptyText) => list.replaceChildren(...(items.length ? items : [el('li', { class: 'empty' }, emptyText)]));
  const day = (t) => new Date(t).toLocaleDateString();

  function render() {
    const { subs, blocks, model, history, settings } = S.state;

    const subIds = Object.keys(subs).sort((a, b) => subs[a].name.localeCompare(subs[b].name));
    $('subs-count').textContent = subIds.length || '';
    fill($('subs'), subIds.map((cid) =>
      row(el('a', { href: 'https://www.youtube.com/channel/' + cid, target: '_blank', rel: 'noreferrer' }, subs[cid].name), '', () => S.unfollow(cid), 'Unfollow')),
      'None yet. Use “Follow locally” under a video or on a channel page, add one above, or import a list.');

    $('channels-count').textContent = blocks.channels.length || '';
    fill($('channels'), blocks.channels.map((c) => row(c.name || c.handle || c.id, day(c.t), () => S.setChannelBlocked({ cid: c.id, handle: c.handle, channel: c.name }, false), 'Unblock')),
      'None. Offered after you mark a video “Not interested”.');

    $('keywords-count').textContent = blocks.keywords.length || '';
    $('keywords').replaceChildren(...blocks.keywords.map((k) =>
      el('li', {}, k.k, el('button', { type: 'button', title: 'Unblock', onclick: () => S.setKeywordBlocked(k.k, false) }, '✕'))));

    const forget = (table, key) => () => { delete model[table][key]; S.save('model'); };
    const learned = (sign) => {
      const items = [];
      for (const [table, label] of [['ch', 'channel'], ['tok', '']]) {
        for (const key of Object.keys(model[table])) {
          const [n, p] = model[table][key];
          const score = OF.model.entryScore(model[table][key]);
          if (score * sign > 0.15) items.push({ table, key, label, n, p, score });
        }
      }
      return items.sort((a, b) => sign * (b.score - a.score)).slice(0, 25)
        .map((x) => row(x.key + (x.label ? ' · ' + x.label : ''), `${x.n} hidden · ${x.p} watched`, forget(x.table, x.key), 'Forget'));
    };
    fill($('learned-neg'), learned(1), 'Nothing yet.');
    fill($('learned-pos'), learned(-1), 'Nothing yet.');

    const vids = Object.entries(blocks.videos).sort((a, b) => b[1].t - a[1].t);
    $('videos-count').textContent = vids.length || '';
    fill($('videos'), vids.slice(0, 200).map(([id, v]) =>
      row(el('a', { href: 'https://www.youtube.com/watch?v=' + id, target: '_blank', rel: 'noreferrer' }, v.title || id), v.channel,
        () => S.undoNotInterested({ id, title: v.title, channel: v.channel }), 'Undo')),
      'None. Hover a video on YouTube and press ✕.');

    for (const k of ['replaceHome', 'surfaces']) $('set-' + k).value = settings[k];
    $('set-hideShorts').checked = !!settings.hideShorts;
    $('history-count').textContent = history.length ? `(${history.length})` : '';
  }

  const readFile = (input) => new Promise((resolve, reject) => {
    const f = input.files[0];
    if (!f) return reject(new Error('no file'));
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(f);
    input.value = '';
  });

  S.ready().then(() => {
    render();
    S.onChange(render);

    $('sub-add').addEventListener('submit', async (e) => {
      e.preventDefault();
      const status = $('sub-status');
      status.textContent = 'Looking up…';
      try {
        const ch = await OF.sources.resolveChannel($('sub-ref').value);
        await S.follow(ch);
        status.textContent = 'Following ' + ch.name;
        $('sub-ref').value = '';
      } catch (err) { status.textContent = err.message; }
    });

    $('subs-file').addEventListener('change', async (e) => {
      try {
        const found = OF.sources.parseSubscriptions(await readFile(e.target));
        let added = 0;
        for (const ch of found) if (!S.state.subs[ch.cid]) { S.state.subs[ch.cid] = { name: ch.name, handle: '', added: Date.now() }; added++; }
        await S.save('subs');
        $('sub-status').textContent = found.length ? `${added} added, ${found.length - added} already followed` : 'No channel ids found in that file';
      } catch (err) { $('sub-status').textContent = err.message; }
    });

    $('kw-add').addEventListener('submit', (e) => {
      e.preventDefault();
      S.setKeywordBlocked($('kw').value, true);
      $('kw').value = '';
    });

    for (const k of ['replaceHome', 'surfaces']) {
      $('set-' + k).addEventListener('change', (e) => { S.state.settings[k] = e.target.value; S.save('settings'); });
    }
    $('set-hideShorts').addEventListener('change', (e) => { S.state.settings.hideShorts = e.target.checked; S.save('settings'); });

    $('export').addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(S.exportAll(), null, 1)], { type: 'application/json' }));
      el('a', { href: url, download: `ownfeed-${new Date().toISOString().slice(0, 10)}.json` }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    $('import-file').addEventListener('change', async (e) => {
      try { await S.importAll(JSON.parse(await readFile(e.target))); $('data-status').textContent = 'Imported.'; }
      catch (err) { $('data-status').textContent = 'Import failed: ' + err.message; }
    });
    $('clear-history').addEventListener('click', () => {
      if (!confirm('Clear the local watch history? Related-video suggestions start over; learned topics stay.')) return;
      S.state.history = []; S.state.cache.related = {};
      S.save('history', 'cache');
    });
    $('reset').addEventListener('click', () => {
      if (confirm('Erase all Ownfeed data in this browser — channels, blocks, learned topics, history?')) S.resetAll();
    });
  });
})(globalThis);
