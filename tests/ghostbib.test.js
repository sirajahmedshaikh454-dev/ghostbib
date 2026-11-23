const test = require('node:test');
const assert = require('node:assert');
const { parseReferences, evaluate, check } = require('../src/ghostbib.js');

// A Crossref-shaped record
const rec = (title, authors, year, venue, doi) => ({
  title: [title], author: authors.map((a) => ({ given: 'X', family: a })), issued: { 'date-parts': [[year]] }, 'container-title': [venue || ''], DOI: doi || '10.1/x',
});
const RESNET = rec('Deep Residual Learning for Image Recognition', ['He', 'Zhang', 'Ren', 'Sun'], 2016, 'IEEE Conference on Computer Vision and Pattern Recognition', '10.1109/cvpr.2016.90');
const ref = (raw) => ({ raw, doi: '' });

test('parsing: blank-line separated, numbered, and wrapped lines', () => {
  assert.strictEqual(parseReferences('Smith, J. (2020). A long enough title here. Journal of Things.\n\nLee, K. (2019). Another long enough title. Other Journal.').length, 2);
  assert.strictEqual(parseReferences('[1] Smith, J. (2020). A long enough title here. Journal of Things.\n[2] Lee, K. (2019). Another long enough title. Other Journal.').length, 2);
  const wrapped = parseReferences('Smith, J., & Lee, K. (2020). A long enough title here that wraps\nonto a second line. Journal of Things, 3(2), 1-10.\nBrown, T. (2019). Another long enough title. Other Journal.');
  assert.strictEqual(wrapped.length, 2);
  assert.match(wrapped[0].raw, /wraps onto a second line/);
});
test('parsing: DOIs are extracted and trailing punctuation removed', () => {
  assert.strictEqual(parseReferences('Smith, J. (2020). Title of a paper. J. https://doi.org/10.1000/abc.123.')[0].doi, '10.1000/abc.123');
  assert.strictEqual(parseReferences('Smith, J. (2020). Title of a paper. doi:10.1000/xyz(2)00.')[0].doi, '10.1000/xyz(2)00');
});
test('parsing: BibTeX', () => {
  const r = parseReferences('@article{he2016,\n  author = {He, Kaiming and Zhang, Xiangyu},\n  title = {Deep {Residual} Learning},\n  journal = {CVPR},\n  year = {2016},\n  doi = {10.1109/cvpr.2016.90}\n}');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].doi, '10.1109/cvpr.2016.90');
  assert.match(r[0].raw, /Deep Residual Learning/);
});
test('parsing: empty and junk', () => {
  assert.deepStrictEqual(parseReferences(''), []);
  assert.deepStrictEqual(parseReferences('hi'), []);
});

test('verified: APA and IEEE formats of a real reference', () => {
  assert.strictEqual(evaluate(ref('He, K., Zhang, X., Ren, S., & Sun, J. (2016). Deep residual learning for image recognition. In CVPR (pp. 770-778).'), RESNET).verdict, 'verified');
  assert.strictEqual(evaluate(ref('K. He, X. Zhang, S. Ren and J. Sun, "Deep Residual Learning for Image Recognition," IEEE Conference on Computer Vision and Pattern Recognition, 2016.'), RESNET).verdict, 'verified');
});
test('the Frankenstein fake: real title, wrong authors', () => {
  const ev = evaluate(ref('Patel, R., & Nguyen, T. (2016). Deep residual learning for image recognition. CVPR.'), RESNET);
  assert.strictEqual(ev.verdict, 'differs');
  assert.strictEqual(ev.fields.authors, 'bad');
  assert.match(ev.reasons.join(' '), /first author/);
});
test('wrong authors AND wrong year says both', () => {
  const ev = evaluate(ref('Patel, R. (2012). Deep residual learning for image recognition. CVPR.'), RESNET);
  assert.strictEqual(ev.verdict, 'differs');
  assert.match(ev.reasons.join(' '), /2016/);
});
test('real title and authors, wrong year', () => {
  const ev = evaluate(ref('He, K., Zhang, X. (2019). Deep residual learning for image recognition. CVPR.'), RESNET);
  assert.strictEqual(ev.verdict, 'year');
  assert.match(ev.reasons.join(' '), /2016/);
});
test('off by one year stays verified with a note', () => {
  const ev = evaluate(ref('He, K., Zhang, X. (2015). Deep residual learning for image recognition. CVPR.'), RESNET);
  assert.strictEqual(ev.verdict, 'verified');
  assert.match(ev.reasons.join(' '), /differs by one/);
});
test('a slightly reworded title is only probable', () => {
  assert.strictEqual(evaluate(ref('He, K., Zhang, X. (2016). Residual learning for recognition of images. CVPR.'), RESNET).verdict, 'probable');
});
test('an unrelated candidate is not found', () => {
  assert.strictEqual(evaluate(ref('Smith, J. (2021). Quantum attention networks for brain tumour segmentation. Journal of Neural AI.'), RESNET).verdict, 'notfound');
});
test('accents, plurals and case do not matter', () => {
  const c = rec('Réseaux de neurones: apprentissage profond', ['Müller'], 2020, 'Revue');
  assert.strictEqual(evaluate(ref('Muller, A. (2020). Reseaux de neurone: apprentissage profonds. Revue.'), c).verdict, 'verified');
});

const json = (j, status = 200) => ({ ok: status < 400, status, json: j });
test('check by DOI: missing DOI', async () => {
  const r = await check({ raw: 'x', doi: '10.1/none' }, async () => json({}, 404));
  assert.strictEqual(r.verdict, 'doi_missing');
});
test('check by DOI: DOI of a different paper', async () => {
  const r = await check({ raw: 'Patel, R. (2020). Quantum attention for tumours. J. https://doi.org/10.1109/cvpr.2016.90', doi: '10.1109/cvpr.2016.90' }, async () => json({ message: RESNET }));
  assert.strictEqual(r.verdict, 'doi_other');
  assert.strictEqual(r.match.title, 'Deep Residual Learning for Image Recognition');
});
test('check by search: picks the best of several candidates', async () => {
  const other = rec('Residual networks behave like ensembles', ['Veit'], 2016);
  let url = '';
  const r = await check(ref('He, K., Zhang, X., Ren, S., & Sun, J. (2016). Deep residual learning for image recognition. CVPR.'), async (u) => { url = u; return json({ message: { items: [other, RESNET] } }); });
  assert.strictEqual(r.verdict, 'verified');
  assert.match(url, /query\.bibliographic=/);
  assert.ok(!/mailto/.test(url));
});
test('check: network failure is "could not check", never "not found"', async () => {
  let calls = 0;
  const r = await check(ref('Smith, J. (2020). A title long enough here. Journal.'), async () => { calls++; return { ok: false, status: 0, json: null }; }, { retryMs: 1 });
  assert.strictEqual(r.verdict, 'error');
  assert.strictEqual(calls, 3);
});
test('check: a transient failure is retried and then succeeds', async () => {
  let n = 0;
  const r = await check(ref('He, K., Zhang, X. (2016). Deep residual learning for image recognition. CVPR.'), async () => (++n < 2 ? { ok: false, status: 429, json: null } : json({ message: { items: [RESNET] } })), { retryMs: 1 });
  assert.strictEqual(r.verdict, 'verified');
});
test('check: a 404 is not retried', async () => {
  let n = 0;
  await check({ raw: 'x', doi: '10.1/none' }, async () => { n++; return json({}, 404); }, { retryMs: 1 });
  assert.strictEqual(n, 1);
});
test('check: empty result list is not found', async () => {
  const r = await check(ref('Smith, J. (2020). A title long enough here. Journal.'), async () => json({ message: { items: [] } }));
  assert.strictEqual(r.verdict, 'notfound');
});

// ---- found by an independent review against the live API ----
const SENET = rec('Squeeze-and-Excitation Networks', ['Hu', 'Shen', 'Sun'], 2018, 'IEEE Conference on Computer Vision and Pattern Recognition');
test('a real title with invented words added does not verify', () => {
  const ev = evaluate(ref('Hu, J., Shen, L., & Sun, G. (2018). Squeeze-and-excitation networks for graph quantum chemistry. CVPR.'), SENET);
  assert.strictEqual(ev.verdict, 'title');
  assert.match(ev.reasons.join(' '), /extra words/);
});
test('a real title followed by its venue still verifies', () => {
  assert.strictEqual(evaluate(ref('Hu, J., Shen, L., & Sun, G. (2018). Squeeze-and-excitation networks. In Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition (pp. 7132-7141).'), SENET).verdict, 'verified');
  assert.strictEqual(evaluate(ref('J. Hu, L. Shen and G. Sun, Squeeze-and-excitation networks, in CVPR, 2018.'), SENET).verdict, 'verified');
});
test('a short real title padded out is caught', () => {
  const dl = rec('Deep learning', ['LeCun', 'Bengio', 'Hinton'], 2015, 'Nature');
  assert.strictEqual(evaluate(ref('LeCun, Y. (2015). Deep learning for brain tumour segmentation. Nature.'), dl).verdict, 'title');
  assert.strictEqual(evaluate(ref('LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521, 436-444.'), dl).verdict, 'verified');
});
test('errata are skipped and more candidates are examined', async () => {
  const real = rec('Initial sequencing and analysis of the human genome', ['Lander'], 2001, 'Nature');
  const erratum = rec('Correction: Initial sequencing and analysis of the human genome', ['Lander'], 2001, 'Nature');
  let url = '';
  const r = await check(ref('Lander ES, Linton LM, et al. Initial sequencing and analysis of the human genome. Nature. 2001;409:860-921.'), async (u) => { url = u; return json({ message: { items: [erratum, real] } }); });
  assert.strictEqual(r.verdict, 'verified');
  assert.match(url, /rows=15/);
});
test('parsing: Vancouver lines without blank lines or numbers', () => {
  const r = parseReferences('Esteva A, Kuprel B, et al. Dermatologist-level classification. Nature. 2017;542:115-8.\nGulshan V, Peng L, et al. Development and validation of a deep learning algorithm. JAMA. 2016;316:2402-10.\nLander ES, Linton LM, et al. Initial sequencing and analysis of the human genome. Nature. 2001;409:860-921.');
  assert.strictEqual(r.length, 3);
});
test('parsing: surname particles and non-ASCII capitals start a new reference', () => {
  const r = parseReferences('Smith, J. (2010). A reasonably long title here. Journal.\nvan der Berg, A. (2011). Another reasonably long title. Journal.\nde la Cruz, M. (2012). Yet another long title here. Journal.\n\u00C5kesson, B. (2013). A fourth long title here. Journal.\n\u0141ukasiewicz, J. (2013). A fifth long title here. Journal.');
  assert.strictEqual(r.length, 5);
});
test('parsing: a References heading is dropped', () => {
  assert.strictEqual(parseReferences('References\nLeCun, Y., Bengio, Y. (2015). Deep learning. Nature.\nBreiman, L. (2001). Random forests. Machine Learning.').length, 2);
  assert.strictEqual(parseReferences('Smith, J. (2010). A reasonably long title here. Journal.\n\nReferences and Notes\n\nDoe, J. (2011). Another reasonably long title. Journal.').length, 2);
});
test('parsing: consecutive bare URLs are separate references', () => {
  assert.strictEqual(parseReferences('https://doi.org/10.1038/nature14539\nhttps://www.nature.com/articles/nature14539').length, 2);
});
