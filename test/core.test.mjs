import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../src/core/tokens.js';
import '../src/core/model.js';
import '../src/core/sources.js';
import '../src/core/rank.js';

const { tokens: T, model: M, sources: SRC, rank: R } = globalThis.OwnFeed;
const fx = (f) => readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8');

test('tokens drop grammar and filler, keep subjects', () => {
  assert.deepEqual(T.tokens("I Built a Minecraft Castle in 100 Days (FULL VIDEO)"), ['built', 'minecraft', 'castle']);
  assert.deepEqual(T.tokens('Café déjà-vu — Crème'), ['cafe', 'deja', 'creme']);
});

test('keyword blocks match whole words and phrases only', () => {
  assert.ok(T.matchesKeyword('The Art of War', 'art'));
  assert.ok(!T.matchesKeyword('Party tricks', 'art'));
  assert.ok(T.matchesKeyword('Elden Ring speed run world record', 'speed run'));
  assert.ok(!T.matchesKeyword('Run at speed', 'speed run'));
});

test('watch-next response parses into related videos with channel ids', () => {
  const { video, related } = SRC.parseNext(JSON.parse(fx('next.json')), 'jNQXAC9IVRw');
  assert.equal(video.title, 'Me at the zoo');
  assert.equal(video.cid, 'UC4QobU6STFB0P71PMvOGN5A');
  assert.equal(video.handle, 'jawed');
  assert.ok(related.length >= 15);
  for (const r of related) {
    assert.match(r.id, /^[\w-]{11}$/);
    assert.ok(r.title && r.channel, 'title and channel present');
    assert.match(r.cid, /^UC[\w-]{22}$/);
  }
  assert.ok(related.some((r) => /^\d+:\d\d/.test(r.duration)));
});

test('channel RSS parses, flags Shorts, decodes entities', () => {
  const { channel, items } = SRC.parseRss(fx('feed.xml'));
  assert.match(channel.cid, /^UC[\w-]{22}$/);
  assert.equal(items.length, 15);
  assert.ok(items.some((i) => i.short) && items.some((i) => !i.short));
  assert.ok(items.every((i) => i.published > 0 && i.views > 0 && !/&amp;|&quot;|&#/.test(i.title)));
  assert.equal(SRC.unescapeXml('Tom &amp; Jerry &#39;s &quot;x&quot;'), 'Tom & Jerry \'s "x"');
});

test('subscription imports: Takeout CSV, OPML, NewPipe JSON, FreeTube db', () => {
  const a = 'UC' + 'a'.repeat(22), b = 'UC' + 'b'.repeat(22);
  assert.deepEqual(SRC.parseSubscriptions(`Channel Id,Channel Url,Channel Title\n${a},http://x/${a},Alpha\n${b},http://x/${b},Beta\n`).map((x) => x.name), ['Alpha', 'Beta']);
  assert.equal(SRC.parseSubscriptions(`<opml><outline text="Alpha &amp; co" xmlUrl="https://www.youtube.com/feeds/videos.xml?channel_id=${a}"/></opml>`)[0].name, 'Alpha & co');
  assert.equal(SRC.parseSubscriptions(JSON.stringify({ subscriptions: [{ service_id: 0, url: `https://www.youtube.com/channel/${a}`, name: 'Alpha' }] }))[0].cid, a);
  const ft = [{ name: 'All', subscriptions: [{ id: a, name: 'Alpha' }] }, { name: 'Two', subscriptions: [{ id: b, name: 'Beta' }] }].map((x) => JSON.stringify(x)).join('\n');
  assert.equal(SRC.parseSubscriptions(ft).length, 2);
});

test('one dislike only ranks look-alikes down; repeated dislikes hold them back; undo is exact', () => {
  const m = M.emptyModel();
  const v = (title, channel = 'Someone') => ({ id: 'x', title, channel });
  M.learn(m, v('Minecraft hardcore survival'), 'neg');
  const one = M.assess(m, v('Minecraft hardcore survival again', 'Other'));
  assert.ok(one.load > 0.5 && !one.hold, 'even a near-identical title is only ranked down after one dislike');
  M.learn(m, v('Minecraft hardcore world tour', 'Third'), 'neg');
  assert.ok(M.assess(m, v('Another minecraft hardcore run', 'Other')).hold, 'two dislikes sharing two words hold back');
  assert.ok(!M.assess(m, v('Minecraft building tips', 'Other')).hold, 'one shared word is not yet enough');
  for (const t of ['Minecraft mods', 'Minecraft speedrun']) M.learn(m, v(t, 'Other' + t), 'neg');
  assert.ok(M.assess(m, v('Minecraft building tips', 'Fresh')).hold, 'four dislikes of one word hold it back');
  assert.ok(!M.assess(m, v('Sourdough bread at home', 'Fresh')).hold);

  const m2 = M.emptyModel();
  M.learn(m2, v('Minecraft hardcore survival'), 'neg');
  M.learn(m2, v('Minecraft hardcore survival'), 'neg', -1);
  assert.deepEqual(m2, M.emptyModel());
});

test('watching a topic offsets dislikes of it', () => {
  const m = M.emptyModel();
  const v = (title) => ({ id: 'x', title, channel: '' });
  for (let i = 0; i < 4; i++) M.learn(m, v('Chess blunder ' + i), 'neg');
  assert.ok(M.assess(m, v('Chess opening theory')).hold);
  for (let i = 0; i < 6; i++) M.learn(m, v('Chess endgame study ' + i), 'pos');
  assert.ok(!M.assess(m, v('Chess opening theory')).hold);
});

test('two dislikes of one channel hold the channel back', () => {
  const m = M.emptyModel();
  M.learn(m, { title: 'Alpha beta', channel: 'Loud Channel' }, 'neg');
  assert.ok(!M.assess(m, { title: 'Unrelated words here', channel: 'Loud Channel' }).hold);
  M.learn(m, { title: 'Gamma delta', channel: 'Loud Channel' }, 'neg');
  assert.ok(M.assess(m, { title: 'Unrelated words here', channel: 'loud channel' }).hold);
});

test('hard blocks: video, channel by id / handle / name, keyword', () => {
  const b = M.emptyBlocks();
  M.blockVideo(b, { id: 'vid00000001', title: 'T', channel: 'C' });
  M.blockChannel(b, { cid: 'UC' + 'c'.repeat(22), handle: 'Loud', channel: 'Loud Channel' });
  M.blockKeyword(b, '  Crypto ');
  assert.equal(M.blockedBy(b, { id: 'vid00000001', title: 'T' }).kind, 'video');
  assert.equal(M.blockedBy(b, { id: 'a', title: 'x', cid: 'UC' + 'c'.repeat(22) }).kind, 'channel');
  assert.equal(M.blockedBy(b, { id: 'a', title: 'x', handle: 'loud' }).kind, 'channel');
  assert.equal(M.blockedBy(b, { id: 'a', title: 'x', channel: 'LOUD CHANNEL' }).kind, 'channel');
  assert.equal(M.blockedBy(b, { id: 'a', title: 'Why CRYPTO crashed', channel: 'Z' }).kind, 'keyword');
  assert.equal(M.blockedBy(b, { id: 'a', title: 'Cryptography 101', channel: 'Z' }), null);
  M.unblockChannel(b, { channel: 'Loud Channel' });
  assert.equal(M.blockedBy(b, { id: 'a', title: 'x', channel: 'Loud Channel' }), null);
});

test('feed: fresh followed uploads lead, watched and blocked vanish, held are set aside, channels spread', () => {
  const now = Date.now();
  const mk = (id, title, channel, extra = {}) => ({ id, title, channel, cid: '', ...extra });
  const subItems = [
    mk('s1', 'Fresh upload about woodworking', 'Wood', { published: now - 3600e3 }),
    mk('s2', 'Old upload about joinery', 'Wood', { published: now - 40 * 864e5 }),
    mk('s3', 'A short', 'Wood', { published: now, short: true }),
    mk('s4', 'Already seen', 'Wood', { published: now }),
  ];
  const seed = { id: 'h1', title: 'Seed', t: now };
  const relItems = [
    mk('r1', 'Hand planes explained', 'Planes', { seed }),
    mk('r2', 'Crypto trading secrets', 'Coins', { seed }),
    mk('r3', 'Minecraft hardcore survival world', 'Blocks', { seed }),
    ...Array.from({ length: 6 }, (_, i) => mk('m' + i, 'Lathe project number ' + i, 'Mono', { seed })),
    mk('r4', 'Dovetail basics', 'Tails', { seed }),
  ];
  const blocks = M.emptyBlocks(); M.blockKeyword(blocks, 'crypto');
  const model = M.emptyModel();
  for (const c of ['X', 'Y']) M.learn(model, { title: 'Minecraft hardcore survival', channel: c }, 'neg');
  const { shown, held } = R.buildFeed({ subItems, relItems, history: [{ id: 's4' }], blocks, model, settings: { feedSize: 6, hideShorts: true }, now });
  const ids = shown.map((v) => v.id);
  assert.equal(ids[0], 's1');
  assert.ok(!ids.includes('s3') && !ids.includes('s4') && !ids.includes('r2'));
  assert.deepEqual(held.map((v) => v.id), ['r3']);
  assert.ok(ids.includes('r1') && ids.includes('r4'), 'one prolific channel does not crowd out the rest');
  assert.equal(shown.length, 6);
});

test('the channel name inside a title is not treated as a topic', () => {
  const v = { title: 'Restoring the Bench Plane | Paul Sellers', channel: 'Paul Sellers' };
  assert.deepEqual(M.topicTokens(v), ['restoring', 'bench', 'plane']);
  assert.ok(!M.suggestTopics(M.emptyModel(), v).includes('sellers'));
});
