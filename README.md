# Ownfeed

**https://ownfeed-sable.vercel.app** · GPL-3.0

A browser extension that gives signed-out YouTube a home feed you can shape, and a "Not interested"
that sticks — with no Google account. Everything it knows is kept in the extension's storage in this
browser; the only network traffic is ordinary signed-out requests to youtube.com.

## What it does

- **✕ on every video tile** (home, search, sidebar, channel pages, and Ownfeed's own cards). The video
  is hidden for good, and the tile turns into a small panel: *Undo*, *Block channel*, and *Block
  topic* chips drawn from the title.
- **Learns from it.** Title words and the channel of hidden videos count against; videos you watch
  count for. Look-alikes are ranked down in *My feed* and dimmed in YouTube's own lists. One ✕ only
  nudges; holding a video back takes two dislikes sharing a couple of words, four on one word, or two
  on one channel. Held-back videos are listed under the feed with the reason and a *This one is fine*
  button that corrects the model.
- **My feed** on the home page, built from channels you *Follow locally* (their public RSS) and from
  what YouTube relates to videos you watched (the signed-out watch-next endpoint), ranked on-device.
- **Two home views.** Signed out, YouTube's home is empty until you have watched something in this
  browser; after that it serves suggestions keyed to its cookies. A switcher at the bottom of the home
  page moves between *YouTube's feed* (with your blocks applied) and *My feed*.
- **Local follow** button under videos and on channel pages; import of subscription lists from Google
  Takeout CSV, OPML, NewPipe JSON and FreeTube `profiles.db`.
- **Settings page**: every hidden video, blocked channel, blocked topic and learned word, each
  removable; export / import as one JSON file; erase everything.

## Install (unpacked)

- **Firefox 140+**: `about:debugging` → This Firefox → Load Temporary Add-on → pick `manifest.json`.
  Or `npm run firefox` (needs `web-ext`). A temporary add-on is removed when Firefox closes; for a
  permanent install, sign the build from `npm run build` at addons.mozilla.org (unlisted).
- **Chromium browsers**: `chrome://extensions` → Developer mode → Load unpacked → this folder.
  Chrome logs a harmless warning about `background.scripts`, which is there for Firefox.

## Layout

```
src/core/      pure logic, shared by page, settings and tests
  tokens.js    title → topic words; whole-word keyword matching
  model.js     hard blocks + the learned model (weights documented above assess())
  sources.js   parsers and fetchers: channel RSS, watch-next, channel lookup, subscription imports
  rank.js      candidates → feed (freshness, learned load, channel spread)
  store.js     extension storage, one key per concern, mirrored across tabs
src/content/   what runs on youtube.com: tiles.js (✕ + panel), feed.js (home), watch.js (history, follow)
src/options/   settings page      src/popup/   toolbar popup
test/          node --test units against saved YouTube responses; e2e/flow.mjs drives a real browser
```

`npm test` runs the units. `npm run e2e` runs the live flow (after `npm i --no-save puppeteer`).

## Limits worth knowing

- YouTube's tiles show a channel's display name, not its id, so a channel block made from a tile
  matches by name (blocks made from *My feed* also carry the id). Two channels with the same name
  are blocked together.
- Topics are learned from titles only. It is a word model, not a semantic one: hiding "Minecraft"
  videos teaches it "minecraft", not "games like Minecraft".
- The selectors in `tiles.js` and the response shapes in `sources.js` follow YouTube's markup as of
  September 2026. When YouTube changes them, `npm run e2e` shows which step broke.
- This does not block ads or touch playback.

## Licence

GPL-3.0. The page in `site/` (deployed by Vercel from `vercel.json`) uses the Death to the World
design system's stylesheet and fonts, copied in from its `dist/`.
