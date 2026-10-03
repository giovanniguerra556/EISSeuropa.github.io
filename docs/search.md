# Site search (Pagefind)

How the site-wide search works, and why it looks "broken" locally.

## Architecture

- **UI**: the header search button (`[data-search-trigger]`) and the
  shortcuts Cmd/Ctrl-K and `/` open the modal in
  `src/_includes/search-modal.njk`. Behaviour + result rendering live in
  `src/assets/js/search.js`; styling is in `site.css` under
  `/* site search modal */`.
- **Index**: [Pagefind](https://pagefind.app). The index
  (`/pagefind/pagefind.js` + wasm shards) is generated **at deploy
  time** by `npx pagefind --site _site` in
  `.github/workflows/deploy.yml`, after the Eleventy build. It is **not**
  committed and is **not** produced by the local `eleventy` build.
- **Scope**: site chrome carries `data-pagefind-ignore` (the
  sticky-chrome in `base.njk`, the footer, the search modal), so only
  `<main>` content is indexed.

## Why local search shows "unavailable"

`search.js` lazy-imports `/pagefind/pagefind.js` on first open. That file
only exists on the deployed site, so on a local `eleventy --serve` the
import fails and the modal shows the "available on the published site"
notice instead of erroring. **This is expected.** The modal chrome,
keyboard shortcuts, and open/close still work locally for layout checks;
only results need the deployed index.

## Per-person search (bio stubs)

`/board` is one page, so indexing it whole means a name search returns
the board page, not the person. To make individual people searchable
(NetSec parity), `src/_data/searchBios.js` flattens `board.json`
(members + support) into one record per person per locale, and
`src/search-bios.njk` emits a minimal stub at
`/search/bios/<lang>/<slug>.html` for each. Pagefind indexes the stub's
body (name, role, affiliation, themes); the stub is `noindex` for search
engines and redirects a human click to the canonical board anchor
`/board[.lang].html#<slug>`. The anchor id is rendered by
`person-card.njk` from the same slug (`boardSorted.js`), so the two
always line up — keep the two `slugify` copies identical.

Stubs are `eleventyExcludeFromCollections`, so they never reach
`sitemap.xml` or the visual sitemap.

## Verifying after deploy (issue #359)

The bio-stub indexing can only be confirmed on the deployed site (the
index isn't built locally). After a deploy, check on
<https://eiss-europa.com>:

1. Searching a board member's name (e.g. "Hugo Meijer") returns that
   person as a top result, and clicking it lands on their card on
   `/board`.
2. Searching a narrow research theme (e.g. "peacekeeping") surfaces the
   relevant people. Broad themes do not, see the results below.
3. The same holds on the FR and DE sites (the per-locale stubs).

If results don't appear, confirm the deploy ran `pagefind --site _site`
after the build and that `/search/bios/` is present in the published
output.

### Last checked: 3 October 2026

Checked on the live site in EN, FR and DE. Local builds show no results
by design, since the index only exists on the deployed site (see *Why
local search shows "unavailable"* above).

- **Names.** Ten board members searched in English, all ten returned as
  the top result with photo and role, and the click lands on the right
  card on `/board`. Surname-only searches work. FR and DE behave the
  same. Pagefind does no fuzzy matching, so a misspelling ("Hugo Meier")
  returns nothing.
- **Each person ranks twice.** The bio stub and the profile page
  (`/board/<slug>.html`) both match, so one person takes two of the
  eight results the modal shows (`search.js` keeps the top eight).
- **Themes.** Narrow themes put the right person in the top three
  ("peacekeeping", "disinformation", "neutrality"). Broad ones show no
  people at all, because papers fill the eight slots: "deterrence" has
  72 results with the first person at 27th, "nuclear" 73 with the first
  at 31st.
- **FR and DE themes** find almost nothing ("dissuasion" and
  "Abschreckung" return two pages each). Board themes and papers are in
  English only.

**For the maintainer.** Two gaps are worth a decision: whether the bio
stubs are still needed now that profile pages exist, and whether broad
theme searches should surface people (for example by ranking bio stubs
higher, or showing more than eight results). Neither is fixed here.
