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
test('real title and authors, wrong year', () => {
  const ev = evaluate(ref('He, K., Zhang, X. (2019). Deep residual learning for image recognition. CVPR.'), RESNET);
  assert.strictEqual(ev.verdict, 'differs');
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
  const r = await check(ref('Smith, J. (2020). A title long enough here. Journal.'), async () => ({ ok: false, status: 0, json: null }));
  assert.strictEqual(r.verdict, 'error');
});
test('check: empty result list is not found', async () => {
  const r = await check(ref('Smith, J. (2020). A title long enough here. Journal.'), async () => json({ message: { items: [] } }));
  assert.strictEqual(r.verdict, 'notfound');
});
