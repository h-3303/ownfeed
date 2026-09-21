// Entry point on youtube.com. YouTube is a single-page app that re-renders constantly, so one
// debounced pass re-applies everything; each part is idempotent.
(function (root) {
  const OF = root.OwnFeed;

  OF.store.ready().then(() => {
    let timer = 0;
    const pass = () => {
      timer = 0;
      try { OF.tiles.scan(); OF.home.check(); OF.watch.check(); } catch (e) { console.warn('[Ownfeed]', e); }
    };
    const schedule = () => { if (!timer) timer = setTimeout(pass, 200); };

    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('yt-navigate-finish', schedule);
    OF.store.onChange((touched) => {
      schedule();
      OF.home.refresh(touched);
      if (touched.includes('subs')) OF.watch.refresh();
    });
    pass();
  });
})(globalThis);
