// Content scripts cannot open the options page themselves.
const api = globalThis.browser || globalThis.chrome;
api.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'open-options') api.runtime.openOptionsPage();
});
