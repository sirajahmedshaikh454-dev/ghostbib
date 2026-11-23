(function () {
  const $ = (id) => document.getElementById(id);
  const src = $('src'), out = $('out'), go = $('go'), stopBtn = $('stop');
  const G = window.Ghostbib;

  // A mix of real and invented references (the invented ones are labelled in the comments below, not in the text).
  const EXAMPLE = [
    'LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521(7553), 436-444.',                                            // real
    'Breiman, L. (2001). Random forests. Machine Learning, 45(1), 5-32.',                                                               // real
    'Khan, A., & Ali, S. (2015). Deep learning. Nature, 521, 436-444.',                                                                 // real title, invented authors
    'Smith, J., & Patel, R. (2021). Quantum attention networks for brain tumour segmentation in low-resource clinics. Journal of Neural Intelligence, 12(3), 45-67.', // invented
    'Hochreiter, S., & Schmidhuber, J. (1999). Long short-term memory. Neural Computation, 9(8), 1735-1780.',                           // real, wrong year
    'Nguyen, T. (2020). Fast federated learning for hospitals. Journal of Things, 3(1), 1-10. https://doi.org/10.1038/nature99999999',   // DOI does not exist
  ].join('\n\n');

  let running = false, cancel = false;

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const CLS = { verified: 'good', probable: 'good', year: 'warn', differs: 'bad', doi_other: 'bad', doi_missing: 'bad', notfound: 'nf', error: 'grey' };
  const FIELD_WORD = { ok: 'matches', partial: 'partly', bad: 'differs', near: 'off by 1', unclear: 'unclear', none: 'n/a' };

  async function getJson(url) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      return { ok: r.ok, status: r.status, json: r.ok ? await r.json() : null };
    } catch (e) { return { ok: false, status: 0, json: null }; } finally { clearTimeout(timer); }
  }

  function updateCount() {
    const n = G.parseReferences(src.value).length;
    $('count').textContent = n ? `${n} reference${n === 1 ? '' : 's'} found` : '';
  }

  function card(r) {
    const li = el('li', 'card ' + CLS[r.verdict]);
    li.dataset.verdict = r.verdict;
    li.appendChild(el('span', 'badge ' + CLS[r.verdict], G.LABELS[r.verdict]));
    li.appendChild(el('p', 'raw', r.raw));
    if (r.fields && r.fields.title) {
      const f = el('div', 'fields');
      for (const k of ['title', 'authors', 'year', 'venue']) f.appendChild(el('span', 'f ' + r.fields[k], `${k[0].toUpperCase() + k.slice(1)} ${FIELD_WORD[r.fields[k]]}`));
      li.appendChild(f);
    }
    if (r.reasons && r.reasons.length) { const ul = el('ul', 'reasons'); for (const t of r.reasons) ul.appendChild(el('li', '', t)); li.appendChild(ul); }
    if (r.match && r.match.title && r.verdict !== 'notfound') {
      const m = el('div', 'rec');
      m.appendChild(el('b', '', r.verdict === 'verified' ? 'Matching record' : 'Closest real record'));
      m.appendChild(el('div', '', r.match.title));
      const authors = r.match.authors.length > 4 ? r.match.authors.slice(0, 4).join(', ') + ' et al.' : r.match.authors.join(', ');
      m.appendChild(el('div', '', [authors, r.match.year, r.match.venue].filter(Boolean).join(' · ')));
      if (r.match.doi) { const a = el('a', '', 'doi.org/' + r.match.doi); a.href = r.match.url; a.target = '_blank'; a.rel = 'noopener'; m.appendChild(a); }
      li.appendChild(m);
    }
    return li;
  }

  function show(results, done, total) {
    out.textContent = '';
    if (!results.length) return;
    const count = (...v) => results.filter((r) => v.includes(r.verdict)).length;
    const groups = [['good', 'verified', count('verified', 'probable')], ['warn', 'year differs', count('year')], ['bad', 'authors or DOI wrong', count('differs', 'doi_other', 'doi_missing')], ['nf', 'not found', count('notfound')], ['grey', 'could not check', count('error')]];
    const problems = results.length - count('verified', 'probable');
    out.appendChild(el('p', 'verdict', done < total ? `Checking... ${done} of ${total}` : problems ? `${problems} of ${total} references need a look.` : `All ${total} references match a real record.`));
    const chips = el('div', 'summary');
    for (const [c, w, n] of groups) if (n) chips.appendChild(el('span', 'chip ' + c, `${n} ${w}`));
    out.appendChild(chips);
    const only = el('label', 'opt');
    const cb = el('input'); cb.type = 'checkbox'; cb.id = 'onlyp';
    only.appendChild(cb); only.appendChild(document.createTextNode(' Show only references that need a look'));
    out.appendChild(only);
    const list = el('ol', 'cards');
    for (const r of results) list.appendChild(card(r));
    out.appendChild(list);
    cb.addEventListener('change', () => { for (const li of list.children) li.hidden = cb.checked && /^(verified|probable)$/.test(li.dataset.verdict); });
    if (done >= total) {
      const copy = el('button', '', 'Copy report'); copy.type = 'button'; copy.style.marginTop = '12px';
      copy.addEventListener('click', () => {
        const body = `Ghostbib: ${total} references, ${problems} need a look.\n\n` + results.map((r) => `[${G.LABELS[r.verdict]}] ${r.raw}\n    ${(r.reasons || []).join(' ')}${r.match && r.match.title ? '\n    Record: ' + r.match.title + ' (' + r.match.year + ') ' + r.match.url : ''}`).join('\n\n');
        (navigator.clipboard ? navigator.clipboard.writeText(body) : Promise.reject()).then(() => { copy.textContent = 'Copied'; }, () => { copy.textContent = 'Copy failed: select the text instead'; });
      });
      out.appendChild(copy);
    }
  }

  async function run() {
    const refs = G.parseReferences(src.value);
    if (!refs.length) { out.textContent = ''; out.appendChild(el('p', 'verdict', 'No references found. Paste one reference per line or per paragraph.')); return; }
    running = true; cancel = false; go.disabled = true; stopBtn.disabled = false;
    const results = new Array(refs.length), bar = $('bar'), fill = $('barfill');
    bar.hidden = false; fill.style.width = '0%';
    let next = 0, done = 0;
    const worker = async () => {
      while (!cancel && next < refs.length) {
        const i = next++;
        results[i] = await G.check(refs[i], getJson);
        done++;
        fill.style.width = (100 * done / refs.length) + '%';
        show(results.filter(Boolean), done, refs.length);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    running = false; go.disabled = false; stopBtn.disabled = true; bar.hidden = true;
    const finished = results.filter(Boolean);
    show(finished, cancel ? finished.length + 1 : refs.length, refs.length);
    if (cancel) out.insertBefore(el('p', 'verdict', `Stopped after ${finished.length} of ${refs.length}.`), out.firstChild);
  }

  src.addEventListener('input', updateCount);
  go.addEventListener('click', () => { if (!running) run(); });
  stopBtn.addEventListener('click', () => { cancel = true; });
  $('demo').addEventListener('click', () => { src.value = EXAMPLE; updateCount(); });
  $('clear').addEventListener('click', () => { src.value = ''; out.textContent = ''; updateCount(); src.focus(); });
  updateCount();
})();
