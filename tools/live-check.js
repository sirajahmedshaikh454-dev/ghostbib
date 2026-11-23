// npm run live: run the matcher against the real Crossref API with references whose truth is known. Needs internet.
const { parseReferences, check } = require('../src/ghostbib.js');

async function getJson(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    return { ok: r.ok, status: r.status, json: r.ok ? await r.json() : null };
  } catch { return { ok: false, status: 0, json: null }; }
}

// [expected verdicts (any of), reference text]
const CASES = [
  [['verified'], 'LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521(7553), 436-444.'],
  [['verified'], 'Hochreiter, S., & Schmidhuber, J. (1997). Long short-term memory. Neural Computation, 9(8), 1735-1780.'],
  [['verified'], 'Breiman, L. (2001). Random forests. Machine Learning, 45(1), 5-32.'],
  [['verified'], 'Kapoor, S., & Narayanan, A. (2023). Leakage and the reproducibility crisis in machine-learning-based science. Patterns, 4(9), 100804.'],
  [['verified'], 'He, K., Zhang, X., Ren, S., & Sun, J. (2016). Deep residual learning for image recognition. In Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition (pp. 770-778).'],
  [['verified', 'probable', 'notfound', 'year'], 'Vaswani, A., Shazeer, N., Parmar, N., et al. (2017). Attention is all you need. Advances in Neural Information Processing Systems, 30.'],
  [['notfound'], 'Smith, J., & Patel, R. (2021). Quantum attention networks for brain tumour segmentation in low-resource clinics. Journal of Neural Intelligence, 12(3), 45-67.'],
  [['differs', 'notfound'], 'Khan, A., & Ali, S. (2015). Deep learning. Nature, 521, 436-444.'],
  [['year'], 'LeCun, Y., Bengio, Y., & Hinton, G. (2009). Deep learning. Nature, 521(7553), 436-444.'],
  [['doi_missing'], 'Smith, J. (2020). A made up paper about models. Journal of Things. https://doi.org/10.1038/nature99999999'],
  [['doi_other'], 'LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature. https://doi.org/10.1109/cvpr.2016.90'],
];

(async () => {
  let bad = 0;
  for (const [expect, text] of CASES) {
    const ref = parseReferences(text)[0];
    const res = await check(ref, getJson);
    const ok = expect.includes(res.verdict);
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${res.verdict.padEnd(12)} (want ${expect.join('|')})  ${text.slice(0, 70)}`);
    if (!ok || res.verdict === 'differs' || res.verdict === 'year') console.log('     ', (res.reasons || []).join(' '), res.match ? '-> ' + res.match.title + ' ' + res.match.year : '');
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log(bad ? `${bad} unexpected` : 'all as expected');
  process.exit(bad ? 1 : 0);
})();
