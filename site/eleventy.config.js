// Eleventy 3 (ESM) config for the Raimbaut d'Orange web edition.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  makeMd, collectAuthorSurnames, wrapAuthorNames, makeSiglumIndex, renderBibInline,
} from "./lib/render.js";
import { publishAll } from "./lib/msimages.js";

const md = makeMd();

// author surnames for small-caps in bibliography/abbreviation inline text
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rj = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf-8"));
const _citations = rj("citations.json");
const _surnames = collectAuthorSurnames(
  { bibliography: rj("bibliography.json"), citations: _citations, references: rj("references.json") },
  new Set((_citations.abbreviations || []).map((a) => a.siglum)),
);
// sigla index + context so bibliography citations get the same hover-card sigla
// (and underline-journal → italic) treatment as the reading views.
const _bibCtx = {
  md,
  sigla: makeSiglumIndex(_citations, md),
  siglaCodes: new Set((_citations.abbreviations || []).map((a) => a.siglum)),
  surnames: _surnames,
};

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/css": "css" });
  eleventyConfig.addPassthroughCopy({ "src/fonts": "fonts" });
  eleventyConfig.addPassthroughCopy({ "src/js": "js" });
  // manuscript photos: renditions made by lib/msimages.js, before passthrough copy runs
  eleventyConfig.on("eleventy.before", () => publishAll());
  eleventyConfig.addPassthroughCopy({ ".cache/ms": "manuscrits" });
  eleventyConfig.addPassthroughCopy({ "src/images": "images" });
  eleventyConfig.addPassthroughCopy({ "src/favicon.svg": "favicon.svg" });

  // render bibliography/abbreviation text (italics, ^superscripts^, [x]{.underline})
  eleventyConfig.addFilter("mdInline", (s) => wrapAuthorNames(md.renderInline(String(s || "")), _surnames));
  // bibliography citations: sigla → hover cards, underlined journals → italics
  eleventyConfig.addFilter("bibCite", (s) => renderBibInline(s, _bibCtx));

  // Table des manuscrits prose: catalogue references name Jeanroy/Brunel/Avalle
  // (catalogue authors → small caps; not in the bibliography surname index, so
  // spelled out here) and sigla like P.-C. (Pillet-Carstens). Sigla go through the
  // SAME inline renderer as the bibliography and reading views (renderBibInline),
  // so P.-C. and any journal siglum become hover-card references, not flat links,
  // and underlined titles italicise consistently.
  eleventyConfig.addFilter("msRef", (s) => {
    const t = String(s || "").replace(/\b(Jeanroy|Brunel|Avalle)\b/g, '<span class="sc">$1</span>');
    return renderBibInline(t, _bibCtx);
  });

  // cache-busting: /css/raimbaut.css → /css/raimbaut.css?v=<content hash>, so the
  // server can cache CSS/JS for a year (see server/nginx-raimbaut.conf) and a
  // deploy still reaches every reader at once.
  const _bust = new Map();
  eleventyConfig.addFilter("bust", (url) => {
    if (!_bust.has(url) || process.env.ELEVENTY_RUN_MODE !== "build") {
      const buf = fs.readFileSync(path.join(ROOT, "site", "src", url));
      _bust.set(url, crypto.createHash("md5").update(buf).digest("hex").slice(0, 8));
    }
    return `${url}?v=${_bust.get(url)}`;
  });

  // small helpers used in templates
  eleventyConfig.addFilter("printedLabel", (printed) => {
    if (!printed) return "";
    return printed[0] === printed[1] ? `p. ${printed[0]}` : `pp. ${printed[0]}–${printed[1]}`;
  });
  eleventyConfig.addFilter("romanChansons", (sections) =>
    sections.filter((s) => s.kind === "chanson"));

  return {
    dir: { input: "src", output: "_site", includes: "_includes", data: "_data" },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    templateFormats: ["njk", "md"],
  };
}
