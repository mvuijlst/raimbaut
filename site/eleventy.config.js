// Eleventy 3 (ESM) config for the Raimbaut d'Orange web edition.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeMd, collectAuthorSurnames, wrapAuthorNames } from "./lib/render.js";

const md = makeMd();

// author surnames for small-caps in bibliography/abbreviation inline text
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rj = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf-8"));
const _citations = rj("citations.json");
const _surnames = collectAuthorSurnames(
  { bibliography: rj("bibliography.json"), citations: _citations, references: rj("references.json") },
  new Set((_citations.abbreviations || []).map((a) => a.siglum)),
);

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/css": "css" });
  eleventyConfig.addPassthroughCopy({ "src/fonts": "fonts" });
  eleventyConfig.addPassthroughCopy({ "src/js": "js" });
  eleventyConfig.addPassthroughCopy({ "../manuscripts": "manuscrits" });
  eleventyConfig.addPassthroughCopy({ "src/images": "images" });

  // render bibliography/abbreviation text (italics, ^superscripts^, [x]{.underline})
  eleventyConfig.addFilter("mdInline", (s) => wrapAuthorNames(md.renderInline(String(s || "")), _surnames));

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
