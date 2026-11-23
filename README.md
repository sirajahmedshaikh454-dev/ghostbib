# Ghostbib

**Paste a reference list. Ghostbib checks every reference against Crossref and shows *which fields* match a real paper: title, authors, year and DOI.**

It exists for one problem: references that look real and are not. Chat assistants and rushed writers produce citations with a real title and invented authors, a real DOI attached to the wrong paper, or a plausible paper that never existed. A reviewer or examiner who looks one up finds out in seconds. Ghostbib lets you find out first.

It is a single static page with no dependencies and no build step. Double-click `index.html`.

```text
Khan, A., & Ali, S. (2015). Deep learning. Nature, 521, 436-444.
  -> AUTHORS DIFFER: a paper with this title exists, but your first author is not one of its authors.
     Closest real record: "Deep learning", LeCun, Bengio, Hinton, 2015, Nature

Hochreiter, S., & Schmidhuber, J. (1999). Long short-term memory. Neural Computation, 9(8).
  -> YEAR DIFFERS: title and authors match, but the record is dated 1997.

Smith, J., & Patel, R. (2021). Quantum attention networks for brain tumour segmentation...
  -> NOT FOUND: no record matches this title. It may be invented, or a book/thesis/report Crossref does not index.
```

## What makes it different

Most checkers answer "does it exist?". Ghostbib compares **field by field** against the best real record, because the dangerous fakes are partial:

| Verdict | Meaning |
|---|---|
| **Verified** | A real record matches the title, the first author and the year |
| **Probable match** | Title is close but reworded; authors and year agree |
| **Authors differ** | A paper with this title exists, but your first author is not on it (the classic fake) |
| **Year differs** | Title and authors match, the date does not: a typo, or a preprint or republication |
| **DOI is a different paper** | The DOI exists but belongs to another paper |
| **DOI does not exist** | The DOI resolves to nothing |
| **Not found** | No record matches. Possibly invented, possibly not indexed |
| **Could not check** | Network or rate-limit problem; never reported as "not found" |

Input formats: APA, IEEE, Harvard, numbered lists (`[1]`, `1.`), blank-line separated, wrapped lines, and BibTeX.

## Does it work? (measured on the live API)

`npm run live` sends known cases to the real Crossref API and checks the verdicts. Current result: **all 11 cases as expected**: five famous real papers verified (LeCun/Bengio/Hinton *Deep learning*, Hochreiter & Schmidhuber *LSTM*, Breiman *Random forests*, Kapoor & Narayanan on leakage, He et al. ResNet), an invented paper not found, a real title with invented authors flagged, a wrong year flagged, a non-existent DOI flagged, and a real DOI attached to the wrong title flagged.

The live run also taught me something. Crossref holds a *2025 republication* of "Attention Is All You Need", so a correct 2017 citation was first reported as wrong. I split "year only" mismatches into their own softer verdict (**Year differs**) instead of treating them like wrong authors. Transient network failures are retried (rate limits and blips) and a 404 is never retried.

`npm test` runs 19 offline unit tests with recorded-shape Crossref responses: parsing, accents and plurals, the Frankenstein fake, wrong year, off-by-one year, DOI cases, retry behaviour, empty results.

## Honest limits

- **Existence is not support.** A verified reference proves the paper exists, not that it says what you claim. Read what you cite.
- **Crossref does not index everything.** Books, theses, standards, many conference proceedings, reports and web pages often return *Not found*. That verdict means "go look yourself", not "fake". Preprints may match a later republication (*Year differs*).
- **The first author must match.** A reference that lists authors in an unusual order, or only an organisation as author, can show *Authors differ*.
- **Each reference is sent to Crossref** (a public database, no key, no account). If a reference itself is confidential, do not paste it.
- Matching is heuristic (word overlap with light stemming, not a language model). Thresholds: 90% of title words for a firm match, 65% for a probable one.

## Layout

```
index.html         the page
src/ghostbib.js    parsing, field-by-field evaluation, lookup with retry (usable from Node)
src/app.js         page logic; every string from the web is inserted as a text node, never as HTML
tests/             offline unit tests (node:test)
tools/live-check.js  validation against the real API (npm run live)
tools/serve.js     tiny static server (npm run serve)
```

## Skills & methodology

**Method.** Research first: a search showed that reference checking exists mostly as academic prototypes, and that the keyless OpenAlex API is now budget-limited, so I used Crossref alone (public, CORS-enabled). I dropped an earlier idea (subscription detection from bank statements) because that space was already crowded. Build order: the matcher and parser against offline fixtures, then **validation on the live API with cases whose truth is known**, then the page, then an independent review. The live run changed the design (the *Year differs* verdict, the retry), which an offline-only test would not have shown.

**Skills and tools.** Claude Code with web search for prior art and API facts; the live Crossref API as the oracle; the built-in browser to verify the real page end to end on desktop and phone widths, light and dark, and a script-injection attempt in pasted text; an independent read-only review subagent that tried 15 or more real references, fakes, and parser edge cases; the `ponytail` style (no dependencies, no build, smallest working design).

**Choices worth defending.** Field-level verdicts instead of a single score. "Could not check" kept separate from "not found". The privacy cost (references go to Crossref) is stated on the page before use. No email or key is sent to Crossref.

## License

MIT.
