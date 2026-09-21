(function (root) {
  const S = root.OwnFeed.store;
  const set = (id, n) => { document.getElementById(id).textContent = n; };
  S.ready().then((st) => {
    set('subs', Object.keys(st.subs).length);
    set('videos', Object.keys(st.blocks.videos).length);
    set('channels', st.blocks.channels.length);
    set('keywords', st.blocks.keywords.length);
    set('history', st.history.length);
  });
  document.getElementById('open').addEventListener('click', () => {
    (root.browser || root.chrome).runtime.openOptionsPage();
    window.close();
  });
})(globalThis);
