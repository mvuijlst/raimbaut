// Figures the typescript carried as hand-drawn graphs, reconstructed at build
// time from the data the text itself provides.
//
// The troubadour figure (thesis p. 21) plots the "classement par position":
// each troubadour ranked 1..n on each of the three factors of the table on
// pp. 19-20. We redraw it as a slopegraph over the same rank scale — one line
// per troubadour across the three axes, so correlation between the factors
// shows as near-parallel lines and the divergences the text discusses (Jaufre
// Rudel: few chansons, many manuscripts; Marcabru: the inverse) show as
// crossings. Ties share a rank, exactly as in the thesis's cotes.

const TROUBADOURS = [
  // [name, chansons, manuscrits, occurrences] — thesis table, pp. 19-20
  ["Guillaume IX", 11, 9, 34],
  ["Jaufre Rudel", 7, 21, 60],
  ["Marcabru", 41, 15, 198],
  ["Cercamon", 9, 9, 17],
  ["Bernart Marti", 9, 3, 12],
  ["Rigaut de Barbézieux", 15, 30, 149],
  ["Bernard de Ventadour", 44, 34, 488],
  ["Peire d'Auvergne", 19, 20, 93],
  ["Giraut de Bornelh", 79, 28, 764],
  ["Arnaut de Mareuil", 25, 30, 236],
  ["Guilhem de Saint-Didier", 15, 26, 122],
  ["Peire Rogier", 9, 21, 82],
  ["Raimbaut d'Orange", 39, 22, 190],
];

export function troubadourChart() {
  const AXES = [
    { col: 1, label: "chansons" },
    { col: 2, label: "manuscrits" },
    { col: 3, label: "occurrences" },
  ];
  const X = [216, 430, 644];
  const top = 40, plotH = 372;
  const W = 850, H = top + plotH + 18;

  // the thesis's cote: rank of the distinct values, ascending; ties share it
  const cotes = AXES.map((a) => {
    const uniq = [...new Set(TROUBADOURS.map((t) => t[a.col]))].sort((x, y) => x - y);
    return { max: uniq.length, of: (v) => uniq.indexOf(v) + 1 };
  });
  const yOf = (ai, v) => {
    const { max, of } = cotes[ai];
    return top + plotH * (1 - (of(v) - 1) / (max - 1));
  };

  const roIdx = TROUBADOURS.length - 1;
  let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" ` +
    `aria-label="Classement par position des troubadours selon le nombre de chansons, ` +
    `de manuscrits et d'occurrences" style="max-width:100%;height:auto;font-family:var(--sans)">`;

  // axis headers + hairlines
  AXES.forEach((a, ai) => {
    s += `<text x="${X[ai]}" y="16" font-size="11" letter-spacing="1.5" text-anchor="middle" ` +
      `style="fill:var(--muted);text-transform:uppercase">${a.label}</text>`;
    s += `<line x1="${X[ai]}" y1="${top - 8}" x2="${X[ai]}" y2="${top + plotH + 8}" ` +
      `style="stroke:var(--rule);stroke-width:1"/>`;
  });

  // Tied values would collapse several troubadours onto one point, making their
  // lines impossible to follow. So on each axis, members of a tie are fanned out
  // by a small vertical offset, ordered by their value on the neighbouring axis
  // (their approach/departure direction) so the fan doesn't tangle.
  const SPREAD = 15;
  const offsets = AXES.map((a, ai) => {
    const refCol = (AXES[ai + 1] || AXES[ai - 1]).col;
    const byVal = new Map();
    TROUBADOURS.forEach((t, i) => {
      const v = t[a.col];
      if (!byVal.has(v)) byVal.set(v, []);
      byVal.get(v).push(i);
    });
    const off = new Array(TROUBADOURS.length).fill(0);
    for (const members of byVal.values()) {
      if (members.length < 2) continue;
      members.sort((p, q) => TROUBADOURS[q][refCol] - TROUBADOURS[p][refCol]);
      members.forEach((idx, k) => { off[idx] = (k - (members.length - 1) / 2) * SPREAD; });
    }
    return off;
  });
  const yFor = (ai, i) => yOf(ai, TROUBADOURS[i][AXES[ai].col]) + offsets[ai][i];

  // one group per troubadour: polyline + dots (+ hover via <title>)
  TROUBADOURS.forEach((t, i) => {
    const ys = AXES.map((a, ai) => yFor(ai, i));
    const isRO = i === roIdx;
    const stroke = isRO ? "var(--rubric)" : "var(--muted)";
    const points = ys.map((y, ai) => `${X[ai]},${y.toFixed(1)}`).join(" ");
    s += `<g class="tline${isRO ? " ro" : ""}">` +
      `<title>${t[0]} — ${t[1]} chansons, ${t[2]} manuscrits, ${t[3]} occurrences</title>` +
      `<polyline points="${points}" fill="none" style="stroke:${stroke};` +
      `stroke-width:${isRO ? 2.4 : 1.3};opacity:${isRO ? 1 : 0.5}"/>` +
      ys.map((y, ai) => `<circle cx="${X[ai]}" cy="${y.toFixed(1)}" r="3" style="fill:${stroke}"/>`).join("") +
      `</g>`;
  });

  // left labels: names + value, at the (offset) endpoint of each line
  TROUBADOURS.forEach((t, i) => {
    const isRO = i === roIdx;
    const y = yFor(0, i);
    s += `<text x="${X[0] - 12}" y="${(y + 4).toFixed(1)}" font-size="11.5" text-anchor="end" ` +
      `style="fill:var(--${isRO ? "ink" : "ink-soft"});${isRO ? "font-weight:600" : ""}">${t[0]}` +
      `<tspan style="fill:var(--muted)" font-size="10">&#8202; ${t[1]}</tspan></text>`;
  });

  // middle values: one per distinct value, at the tie group's centre (base rank)
  const seenMid = new Set();
  TROUBADOURS.forEach((t) => {
    if (seenMid.has(t[2])) return;
    seenMid.add(t[2]);
    const y = yOf(1, t[2]);
    s += `<text x="${X[1] + 8}" y="${(y + 3.5).toFixed(1)}" font-size="10" style="fill:var(--muted)">${t[2]}</text>`;
  });

  // right labels: value + name (occurrence counts are all distinct)
  TROUBADOURS.forEach((t, i) => {
    const isRO = i === roIdx;
    const y = yFor(2, i);
    s += `<text x="${X[2] + 12}" y="${(y + 4).toFixed(1)}" font-size="11.5" ` +
      `style="fill:var(--${isRO ? "ink" : "ink-soft"});${isRO ? "font-weight:600" : ""}">` +
      `<tspan style="fill:var(--muted)" font-size="10">${t[3]}&#8202;</tspan> ${t[0]}</text>`;
  });

  s += `</svg>`;

  return `<figure class="chart slope">${s}<figcaption>Classement « par position » des ` +
    `treize troubadours selon les trois facteurs du tableau — figure reconstituée ` +
    `d'après les données des pages précédentes. Les lignes parallèles signalent la ` +
    `corrélation entre les facteurs&nbsp;; les croisements, son absence (Jaufre Rudel, ` +
    `Marcabru). Les positions à égalité partagent le même rang, comme dans ` +
    `l'original.</figcaption></figure>`;
}

// ---------------------------------------------------------------------------
// The three tables the typescript set out but that survived the OCR/reflow only
// as running text. Each is rebuilt from its own printed data.
// ---------------------------------------------------------------------------

const RO = "Raimbaut d'Orange";
const roMark = (s) =>
  s.replace(/\bRO\b/, '<span class="ro-cell">RO</span>');

// Table 1 (thesis p. 20): the three per-factor rankings ("classement par
// facteur"), each troubadour ranked ascending. Rendered as three columns with
// full troubadour names, the printed cote kept as the row rank; ties share a
// rank exactly as in print. [names…, value] per cell.
const NAME = {
  Gu: "Guillaume IX", JR: "Jaufre Rudel", Ma: "Marcabru", Ce: "Cercamon",
  BM: "Bernart Marti", RB: "Rigaut de Barbézieux", BV: "Bernard de Ventadour",
  PA: "Peire d'Auvergne", GB: "Giraut de Bornelh", AM: "Arnaut de Mareuil",
  GD: "Guilhem de Saint-Didier", PR: "Peire Rogier", RO: "Raimbaut d'Orange",
};
const RANKING = {
  chansons: [["JR", 7], ["Ce", "BM", "PR", 9], ["Gu", 11], ["RB", "GD", 15],
    ["PA", 19], ["AM", 25], ["RO", 39], ["Ma", 41], ["BV", 44], ["GB", 79]],
  manuscrits: [["BM", 3], ["Gu", "Ce", 9], ["Ma", 15], ["PA", 20], ["JR", "PR", 21],
    ["RO", 22], ["GD", 26], ["GB", 28], ["AM", "RB", 30], ["BV", 34]],
  occurrences: [["BM", 12], ["Ce", 17], ["Gu", 34], ["JR", 60], ["PR", 82],
    ["PA", 93], ["GD", 122], ["RB", 149], ["RO", 190], ["Ma", 198], ["AM", 236],
    ["BV", 488], ["GB", 764]],
};

export function factorRankingTable() {
  const cols = [
    ["Nombre de chansons", RANKING.chansons],
    ["Nombre de manuscrits", RANKING.manuscrits],
    ["Occurrences de chansons", RANKING.occurrences],
  ];
  const cell = (entry) => {
    const value = entry[entry.length - 1];
    const names = entry.slice(0, -1);
    const hasRO = names.includes("RO");
    const label = names
      .map((k) => (k === "RO" ? `<span class="ro-cell">${NAME[k]}</span>` : NAME[k]))
      .join(", ");
    return { hasRO, html: `${label} <span class="val">(${value})</span>` };
  };
  const rows = Math.max(...cols.map(([, l]) => l.length));
  let body = "";
  for (let r = 0; r < rows; r++) {
    body += "<tr>";
    for (const [, list] of cols) {
      if (!list[r]) { body += "<td></td>"; continue; }
      const c = cell(list[r]);
      body += `<td${c.hasRO ? ' class="ro-cell"' : ""}>` +
        `<span class="cote">${r + 1}.</span><span class="lbl">${c.html}</span></td>`;
    }
    body += "</tr>";
  }
  const head = cols.map(([h]) => `<th>${h}</th>`).join("");
  return `<figure class="chart"><table class="cote-table">` +
    `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>` +
    `<figcaption>Classement des treize troubadours pour chacun des trois ` +
    `facteurs, par ordre croissant&nbsp;; le rang est la « cote » attribuée dans ` +
    `la thèse (les valeurs identiques partagent une cote).</figcaption></figure>`;
}

// Table 2 (thesis p. 27): mean frequency of apparition (occurrences per
// chanson), troubadours in descending order.
const FREQUENCY = [
  ["Bernard de Ventadour", "11,09"], ["Rigaut de Barbézieux", "9,93"],
  ["Giraut de Bornelh", "9,67"], ["Arnaut de Mareuil", "9,44"],
  ["Peire Rogier", "9,11"], ["Jaufré Rudel", "8,57"],
  ["Guilhem de Saint-Didier", "8,13"], ["Peire d'Auvergne", "4,89"],
  [RO, "4,87"], ["Marcabru", "4,82"], ["Guillaume IX", "3,09"],
  ["Cercamon", "1,88"], ["Bernart Marti", "1,33"],
];

export function frequencyTable() {
  const body = FREQUENCY.map(([name, f]) => {
    const ro = name === RO;
    return `<tr${ro ? ' class="ro-cell"' : ""}><td>${ro ? `<em>${name}</em>` : name}</td>` +
      `<td class="num">${f}</td></tr>`;
  }).join("");
  return `<figure class="chart"><table class="freq-table">` +
    `<thead><tr><th>Troubadour</th><th class="num">Fréquence d'apparition</th></tr></thead>` +
    `<tbody>${body}</tbody></table><figcaption>Fréquence moyenne d'apparition des ` +
    `poèmes (occurrences par chanson), par ordre décroissant.</figcaption></figure>`;
}

// Table 3 (thesis p. 29): the "Classement / Regroupements" comparison, set as a
// two-column banded table with the arrow that carries Giraut de Bornelh from
// group I to group B (rendered as an underline in both places plus a note).
const moved = (n) => `<span class="moved">${n}</span>`;
export function groupingTable() {
  const grpI = ["Rigaud de Barbézieux", moved("Giraut de Bornelh"), "Arnaut de Mareuil",
    "Peire Rogier", "Jaufre Rudel", "Guilhem de Saint-Didier"];
  const grpA = ["Rigaud de Barbézieux", "Arnaut de Mareuil", "Peire Rogier",
    "Jaufre Rudel", "Guilhem de Saint-Didier"];
  const grpII = [`<span class="ro-cell">${RO}</span>`, "Marcabru"];
  const grpB = [moved("Giraut de Bornelh"), `<span class="ro-cell">${RO}</span>`, "Marcabru"];
  const cell = (label, names) =>
    `<td><span class="grp-l">${label}</span><ul>` +
    names.map((n) => `<li>${n}</li>`).join("") + `</ul></td>`;
  return `<figure class="chart"><table class="grouping-table">` +
    `<thead><tr><th>Classement d'après la fréquence d'apparition</th>` +
    `<th>Regroupements d'après <i>x</i>&lt;<i>y</i>,<i>z</i> (A) et <i>y</i>&lt;<i>z</i>,<i>x</i> (B)</th></tr></thead>` +
    `<tbody><tr class="band">${cell("I", grpI)}${cell("A", grpA)}</tr>` +
    `<tr class="band">${cell("II", grpII)}${cell("B", grpB)}</tr></tbody></table>` +
    `<figcaption>Rapprochement du classement par fréquence et du regroupement en ` +
    `tendances. Giraut de Bornelh (souligné) passe du groupe I au groupe B, ` +
    `seul troubadour à changer de groupe.</figcaption></figure>`;
}
