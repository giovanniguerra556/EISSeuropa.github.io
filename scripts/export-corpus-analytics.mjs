#!/usr/bin/env node
/**
 * Emit the analytical layer of the Anthology corpus as JSON (#1227).
 *
 * export-corpus-json.mjs writes the corpus as records: papers, authors,
 * themes. This writes what is derived from them, the figures someone
 * analysing the corpus would otherwise rebuild by hand:
 *
 *   themesByEdition  per edition, how many papers carry each theme
 *   coauthorship     authors as nodes, shared papers as weighted edges
 *
 *   node scripts/export-corpus-analytics.mjs [outfile]
 *
 * Default outfile: data/anthology-analytics.json, which .gitignore excludes,
 * for the same reason as data/anthology-corpus.json: it is derived from data
 * already in the repo, so regenerate it rather than commit it.
 *
 * Affiliation shares by country, the third part of #1227, are deliberately
 * absent. They need affiliations resolved to ROR identifiers (#1248), and that
 * mapping is unreviewed: two wrong matches scored above 0.97, so a country
 * figure built on it would be confidently wrong. Add them once #1248 lands.
 *
 * ponytail: not wired into the Eleventy build, like export-corpus-json.mjs.
 * Both are cut by hand for the deposit. Full notes in
 * docs/corpus-archiving.md.
 */

import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);
const corpus = require("../src/_data/corpus.js");
const paperIndex = require("../src/_data/paperIndex.js");

const OUT = process.argv[2] || "data/anthology-analytics.json";
const { canonicalKey } = corpus;

// paperIndex holds English theme labels. Map them back to the stable keys that
// export-corpus-json.mjs and the SKOS vocabulary use, so the two exports join.
const keyByLabel = new Map(corpus.themes.map((t) => [t.label.en, t.key]));
const themeOrder = corpus.themes.map((t) => t.key);
const papers = paperIndex.papers.map((p) => ({
  ...p,
  themeKeys: (p.theme || []).map((l) => keyByLabel.get(l) ?? l),
}));

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

// ── Themes by edition ───────────────────────────────────────────────────
// Keyed on the edition URL, the same key paperIndex.editions uses, so the
// joint events that share a year with the annual conference stay separate.
const themesByEdition = paperIndex.editions.map((e) => {
  const inEdition = papers.filter((p) => p.conferenceUrl === e.key);
  const tagged = inEdition.filter((p) => p.themeKeys.length);
  const themes = themeOrder
    .map((key) => {
      const n = inEdition.filter((p) => p.themeKeys.includes(key)).length;
      return { key, papers: n, percentOfTagged: pct(n, tagged.length) };
    })
    .filter((t) => t.papers > 0);
  return {
    edition: e.key,
    label: e.label,
    year: e.year,
    papers: inEdition.length,
    tagged: tagged.length,
    untagged: inEdition.length - tagged.length,
    themes,
  };
});

// ── Co-authorship network ───────────────────────────────────────────────
// Nodes use the same canonical name key as the by-person index, so a node
// joins to `authors[].key` in the corpus export.
const speakerByKey = new Map(corpus.speakers.map((s) => [s.key, s]));
const nodes = new Map();
const edges = new Map();
const unmatched = new Set();

for (const p of papers) {
  const keys = [...new Set((p.authors || []).map(canonicalKey).filter(Boolean))];
  for (const k of keys) {
    if (!speakerByKey.has(k)) unmatched.add(k);
    const n = nodes.get(k) || {
      key: k,
      name: speakerByKey.get(k)?.display || speakerByKey.get(k)?.name || k,
      papers: 0,
      coauthoredPapers: 0,
    };
    n.papers += 1;
    if (keys.length > 1) n.coauthoredPapers += 1;
    nodes.set(k, n);
  }
  // Every pair on the paper, in a stable order so A–B and B–A are one edge.
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const [a, b] = [keys[i], keys[j]].sort();
      const id = `${a}\u0000${b}`;
      const edge = edges.get(id) || { source: a, target: b, papers: 0, years: new Set() };
      edge.papers += 1;
      if (p.year) edge.years.add(p.year);
      edges.set(id, edge);
    }
  }
}

const edgeList = [...edges.values()]
  .map((e) => ({ ...e, years: [...e.years].sort() }))
  .sort((x, y) => y.papers - x.papers || x.source.localeCompare(y.source) || x.target.localeCompare(y.target));
const nodeList = [...nodes.values()].sort((x, y) => x.key.localeCompare(y.key));
const multiAuthor = papers.filter((p) => new Set((p.authors || []).map(canonicalKey)).size > 1).length;

const payload = {
  meta: {
    title: "The European Security Studies Anthology: analytical layer",
    publisher: "European Initiative for Security Studies",
    source: "https://eiss-europa.com/anthology.html",
    doi: "10.5281/zenodo.21776209",
    licence: "CC BY 4.0",
    attribution: "European Initiative for Security Studies, eiss-europa.com",
    generated: new Date().toISOString().slice(0, 10),
    companion: "anthology-corpus.json (scripts/export-corpus-json.mjs). Theme keys and author keys join to it.",
    counts: {
      papers: papers.length,
      editions: themesByEdition.length,
      themes: themeOrder.length,
      authors: nodeList.length,
      multiAuthorPapers: multiAuthor,
      coauthorshipEdges: edgeList.length,
    },
    caveats: [
      "Themes are inferred from the panel a paper sat in, and a paper can carry more than one, so theme counts within an edition can sum to more than its tagged papers.",
      "percentOfTagged is measured against the edition's tagged papers, not all its papers. Untagged papers are counted separately.",
      "Authors are matched on the same conservative normalised name key as the site's by-person index, so one person under noticeably different spellings may appear as two nodes.",
      "Affiliation shares by country are not included. They wait on affiliations being resolved to ROR identifiers and reviewed (issue #1248).",
    ],
  },
  themesByEdition,
  coauthorship: { nodes: nodeList, edges: edgeList },
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");

const { counts } = payload.meta;
console.log(
  `wrote ${OUT}: ${counts.editions} editions, ${counts.themes} themes, ` +
    `${counts.authors} authors, ${counts.coauthorshipEdges} co-authorship edges ` +
    `from ${counts.multiAuthorPapers} multi-author papers`
);
if (unmatched.size) {
  console.warn(`warning: ${unmatched.size} author key(s) not in the by-person index: ${[...unmatched].slice(0, 10).join(", ")}`);
}
