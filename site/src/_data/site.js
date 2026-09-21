// Site-wide metadata: the canonical origin, the bibliographic identity of the thesis
// (every fact here is printed on its title page, corpus/v1p000.md, or stated in the
// colophon), and the revision the site was built from.
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const git = (args) => {
  try { return execSync(`git ${args}`, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return ""; }
};

// revision = last commit (not build time), so rebuilding the same source gives the
// same stamp; "+" marks a build that includes uncommitted changes
const hash = git("rev-parse --short HEAD");
const iso = git("log -1 --format=%cs");                  // YYYY-MM-DD
const dirty = hash && git("status --porcelain") !== "";
const dateFr = iso
  ? new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
      .format(new Date(iso + "T00:00:00Z"))
  : "";

export default {
  url: "https://raimbaut.yusupov.cloud",
  name: "Raimbaut d'Orange, édition électronique",
  description: "Édition électronique du chansonnier de Raimbaut d'Orange, troubadour provençal du XIIe siècle : texte occitan, traduction française, remarques et apparat critique.",
  repo: "https://github.com/mvuijlst/raimbaut",
  thesis: {
    title: 'Interprétation "philologique" et "poétique" du Chansonnier de Raimbaut d\'Orange',
    author: { given: "Marc", family: "Vuijlsteke" },
    institution: "Rijksuniversiteit Gent",
    year: "1981",
    language: "fr",
  },
  edition: { editor: { given: "Michel", family: "Vuijlsteke" }, year: "2026" },
  // text only — manuscript images and the portrait are excluded (see colophon)
  license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/deed.fr" },
  revision: { hash, iso, dateFr, dirty },
};
