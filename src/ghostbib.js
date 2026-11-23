// Ghostbib: split a pasted reference list, look each reference up on Crossref, and compare it FIELD BY FIELD with the real record.
// The classic AI-made fake is a real title with the wrong authors or year, so the verdict says which field disagrees.
// No dependencies. `check` takes an injected fetch function so everything is testable offline.
(function (root) {
  const STOP = new Set('a an the of and or for in on to with by from at as is are via using use based its into over under between towards toward their our new'.split(' '));
  const norm = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const words = (s) => norm(s).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const stem = (w) => (w.length > 3 ? w.replace(/ies$/, 'y').replace(/([^s])s$/, '$1') : w);       // networks->network, images->image, studies->study
  const content = (s) => words(s).filter((w) => !STOP.has(w) && w.length > 1).map(stem);

  const DOI_RE = /\b(10\.\d{4,9}\/[^\s"<>]+)/i;
  const URL_RE = /https?:\/\/\S+/gi;
  const cleanDoi = (d) => d.replace(/[.,;:)\]}>]+$/, '');

  // ---- parsing -------------------------------------------------------------------------------------------------
  function parseBibtex(text) {
    const out = [];
    for (const block of text.split(/@\w+\s*\{/).slice(1)) {
      const field = (name) => {
        const m = new RegExp('\\b' + name + '\\s*=\\s*(?:\\{((?:[^{}]|\\{[^{}]*\\})*)\\}|"([^"]*)")', 'i').exec(block);
        return m ? (m[1] || m[2] || '').replace(/\s+/g, ' ').replace(/[{}]/g, '').trim() : '';
      };
      const title = field('title'), author = field('author'), year = field('year'), journal = field('journal') || field('booktitle'), doi = field('doi');
      if (!title) continue;
      const authors = author.split(/\s+and\s+/i).map((a) => a.trim()).filter(Boolean).join(', ');
      out.push(makeRef([authors, year ? '(' + year + ').' : '', title + '.', journal ? journal + '.' : '', doi ? 'https://doi.org/' + doi : ''].filter(Boolean).join(' ')));
    }
    return out;
  }

  function makeRef(raw) {
    raw = raw.replace(/\s+/g, ' ').trim();
    const m = DOI_RE.exec(raw);
    return { raw, doi: m ? cleanDoi(m[1]) : '' };
  }

  const STARTS = /^\s*(?:\[\d+\]|\d{1,3}[.)]\s|•|-\s)/;
  const AUTHORISH = /^[A-ZÀ-Þ][\w'’\-À-ſ]+,\s+(?:[A-Z]\.|[A-Z][a-z]+)/;

  function parseReferences(text) {
    text = String(text || '').replace(/\r\n?/g, '\n').trim();
    if (!text) return [];
    if (/@\w+\s*\{/.test(text)) { const b = parseBibtex(text); if (b.length) return b; }
    const chunks = [];
    const hasBlank = /\n\s*\n/.test(text);
    if (hasBlank) {
      for (const c of text.split(/\n\s*\n/)) if (c.trim()) chunks.push(c);
    } else {
      let cur = '';
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        const startsNew = STARTS.test(line) || (cur && /\b(19|20)\d{2}\b/.test(cur) && AUTHORISH.test(line.trim()));
        if (cur && startsNew) { chunks.push(cur); cur = ''; }
        cur += (cur ? ' ' : '') + line.trim();
      }
      if (cur) chunks.push(cur);
    }
    return chunks.map((c) => makeRef(c.replace(STARTS, ''))).filter((r) => r.raw.length >= 15);
  }

  // ---- comparing one reference with one Crossref record --------------------------------------------------------
  const yearOf = (c) => {
    const p = (c.issued || c['published-print'] || c['published-online'] || c.published || {})['date-parts'];
    return p && p[0] && p[0][0] ? p[0][0] : null;
  };

  function evaluate(ref, cand) {
    const text = ref.raw.replace(URL_RE, ' ').replace(DOI_RE, ' ');
    const refWords = new Set(words(text).map(stem));
    const title = (cand.title && cand.title[0]) || '';
    const tt = content(title);
    const cov = tt.length ? tt.filter((w) => refWords.has(w)).length / tt.length : 0;
    const flat = (s) => norm(s).replace(/[^a-z0-9]/g, '');
    const exact = flat(title).length >= 12 && flat(text).includes(flat(title));
    const fams = (cand.author || []).map((a) => norm(a.family || a.name || '')).filter(Boolean);
    const famHit = (f) => f.split(/[^a-z0-9]+/).filter(Boolean).every((p) => new Set(words(text)).has(p));
    const firstOk = fams.length ? famHit(fams[0]) : false;
    const hits = fams.slice(0, 3).filter(famHit).length;
    const years = (text.match(/\b(?:19|20)\d{2}\b/g) || []).map(Number);
    const y = yearOf(cand);
    const year = !years.length || !y ? 'none' : years.includes(y) ? 'ok' : years.some((x) => Math.abs(x - y) === 1) ? 'near' : 'bad';
    const venueTokens = content((cand['container-title'] && cand['container-title'][0]) || '');
    const venue = venueTokens.length ? (venueTokens.filter((w) => refWords.has(w)).length / venueTokens.length >= 0.5 ? 'ok' : 'unclear') : 'none';
    const strong = cov >= 0.9 || exact;
    const reasons = [];
    let verdict;
    if (strong && firstOk && year !== 'bad') verdict = 'verified';
    else if (strong) {
      verdict = 'differs';
      if (!firstOk) reasons.push('The first author in your reference is not an author of the paper with this title.');
      if (year === 'bad') reasons.push(`The paper with this title was published in ${y}, not ${years.join(' / ')}.`);
    } else if (cov >= 0.65 && firstOk && year !== 'bad') verdict = 'probable';
    else verdict = 'notfound';
    if (verdict === 'verified' && year === 'near') reasons.push(`Year differs by one (record says ${y}): online and print dates often differ.`);
    if (verdict === 'verified' && venue === 'unclear') reasons.push('The journal or conference name in your reference does not obviously match the record.');
    return {
      verdict, reasons, titleCoverage: cov, score: cov * 2 + (firstOk ? 1 : 0) + (year === 'ok' ? 0.5 : year === 'near' ? 0.25 : 0),
      fields: { title: cov >= 0.9 || exact ? 'ok' : cov >= 0.65 ? 'partial' : 'bad', authors: firstOk ? (hits >= Math.min(fams.length, 2) ? 'ok' : 'partial') : 'bad', year, venue },
      match: { title, authors: (cand.author || []).map((a) => [a.given, a.family || a.name].filter(Boolean).join(' ')), year: y, venue: (cand['container-title'] && cand['container-title'][0]) || '', doi: cand.DOI || '', url: cand.DOI ? 'https://doi.org/' + cand.DOI : '' },
    };
  }

  // ---- looking a reference up ---------------------------------------------------------------------------------
  const API = 'https://api.crossref.org/works';
  const FIELDS = 'title,author,issued,published,DOI,container-title';
  const doiPath = (d) => d.split('/').map(encodeURIComponent).join('/');

  async function check(ref, getJson) {
    if (ref.doi) {
      const r = await getJson(`${API}/${doiPath(ref.doi)}`);
      if (r.status === 404) return { raw: ref.raw, verdict: 'doi_missing', reasons: [`The DOI ${ref.doi} does not exist.`], fields: {}, match: null };
      if (!r.ok) return { raw: ref.raw, verdict: 'error', reasons: ['Could not reach Crossref for this reference.'], fields: {}, match: null };
      const ev = evaluate(ref, r.json.message);
      if (ev.titleCoverage < 0.5) return Object.assign({ raw: ref.raw }, ev, { verdict: 'doi_other', reasons: ['This DOI exists but belongs to a different paper, shown on the right.'] });
      return Object.assign({ raw: ref.raw }, ev);
    }
    const q = ref.raw.replace(URL_RE, ' ').replace(/\s+/g, ' ').slice(0, 300);
    const r = await getJson(`${API}?query.bibliographic=${encodeURIComponent(q)}&rows=5&select=${FIELDS}`);
    if (!r.ok) return { raw: ref.raw, verdict: 'error', reasons: ['Could not reach Crossref for this reference.'], fields: {}, match: null };
    const items = (r.json.message && r.json.message.items) || [];
    if (!items.length) return { raw: ref.raw, verdict: 'notfound', reasons: ['Crossref returned nothing.'], fields: {}, match: null };
    let best = null;
    for (const it of items) { const ev = evaluate(ref, it); if (!best || ev.score > best.score) best = ev; }
    if (best.verdict === 'notfound') best.reasons = ['No record matches this title. It may be invented, or it may be a book, thesis, report or web page that Crossref does not index.'];
    return Object.assign({ raw: ref.raw }, best);
  }

  const LABELS = { verified: 'Verified', probable: 'Probable match', differs: 'Details differ', doi_other: 'DOI is a different paper', doi_missing: 'DOI does not exist', notfound: 'Not found', error: 'Could not check' };
  const api = { parseReferences, evaluate, check, LABELS, words, content };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Ghostbib = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
