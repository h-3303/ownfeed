// Title → topic tokens. Pure; shared by the content scripts, the options page and the Node tests.
(function (root) {
  const OF = (root.OwnFeed = root.OwnFeed || {});

  const STOP = new Set(
    (
      'a about after again all also am an and any are as at be been before being but by can could did do does ' +
      'doing dont for from get gets got had has have he her here him his how i if im in into is it its just ' +
      'like me more most my no not now of off on one only or our out over own she so some such than that the ' +
      'their them then there these they this those to too under up us very was we were what when where which ' +
      'who why will with without would you your ' +
      // YouTube title filler: says nothing about the subject
      'video videos official full new hd uhd ft feat vs part episode ep live shorts short best top ever ' +
      'watch watching channel subscribe trailer clip clips compilation reaction reacts edition ' +
      'vol day days year years time first last every thing things make makes making made'
    ).split(/\s+/)
  );

  function normalise(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[’']/g, '');
  }

  // Unique topic tokens of a title, in order of appearance.
  function tokens(title, limit = 14) {
    const words = normalise(title).match(/[\p{L}\p{N}]+/gu) || [];
    const out = [];
    for (const w of words) {
      if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue;
      if (!out.includes(w)) out.push(w);
      if (out.length >= limit) break;
    }
    return out;
  }

  // Does a blocked topic apply to this title? Single words match whole tokens ("art" does not hit
  // "party"); phrases match as a run of whole words.
  function matchesKeyword(title, keyword) {
    const k = normalise(keyword).trim();
    if (!k) return false;
    const words = normalise(title).match(/[\p{L}\p{N}]+/gu) || [];
    const kw = k.match(/[\p{L}\p{N}]+/gu) || [];
    if (!kw.length) return false;
    for (let i = 0; i + kw.length <= words.length; i++) {
      let ok = true;
      for (let j = 0; j < kw.length; j++) if (words[i + j] !== kw[j]) { ok = false; break; }
      if (ok) return true;
    }
    return false;
  }

  OF.tokens = { tokens, normalise, matchesKeyword, STOP };
})(globalThis);
