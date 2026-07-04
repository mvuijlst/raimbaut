// Progressive enhancement for the study view: reading modes, verse-marker
// navigation, and the bidirectional (and visibly breakable) scroll-sync
// between the poem and the remarques panel. Without this script the page is
// a complete linear document: markers and lemma heads are plain anchors.
(function () {
  "use strict";

  // ----- theme: auto -> dark -> light, on every page -------------------------
  const themeBtn = document.getElementById("theme-btn");
  if (themeBtn) {
    const GLYPH = { auto: "◐", dark: "☾", light: "☀" };
    const LABEL = { auto: "automatique", dark: "sombre", light: "clair" };
    const apply = (mode) => {
      if (mode === "auto") delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = mode;
      themeBtn.textContent = GLYPH[mode];
      themeBtn.title = "Thème : " + LABEL[mode];
      try {
        if (mode === "auto") localStorage.removeItem("rb-theme");
        else localStorage.setItem("rb-theme", mode);
      } catch {}
    };
    let mode = document.documentElement.dataset.theme || "auto";
    apply(mode);
    themeBtn.addEventListener("click", () => {
      mode = mode === "auto" ? "dark" : mode === "dark" ? "light" : "auto";
      apply(mode);
    });
  }

  // ----- sigla: click to expand the full citation in place -------------------
  const siglumToggle = (s) => {
    let d = s.nextElementSibling;
    while (d && !d.classList.contains("siglum-def")) d = d.nextElementSibling;
    if (!d) return;
    d.hidden = !d.hidden;
    s.setAttribute("aria-expanded", String(!d.hidden));
  };
  document.addEventListener("click", (ev) => {
    const s = ev.target.closest(".siglum");
    if (s) siglumToggle(s);
  });
  document.addEventListener("keydown", (ev) => {
    if ((ev.key === "Enter" || ev.key === " ") && ev.target.classList?.contains("siglum")) {
      ev.preventDefault();
      siglumToggle(ev.target);
    }
  });

  // ----- manuscript lightbox: zoom (wheel / double-click), pan (drag) --------
  const msLinks = document.querySelectorAll(".ms-figures a");
  if (msLinks.length) {
    let dlg, stage, img, cap;
    let scale = 1, tx = 0, ty = 0;
    const apply = () => { img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`; };
    const reset = () => { scale = 1; tx = 0; ty = 0; apply(); };
    const build = () => {
      dlg = document.createElement("dialog");
      dlg.className = "lightbox";
      dlg.innerHTML = '<button class="lb-close" aria-label="Fermer">×</button>' +
        '<div class="lb-stage"><img alt=""></div><div class="lb-caption"></div>';
      document.body.appendChild(dlg);
      stage = dlg.querySelector(".lb-stage");
      img = dlg.querySelector("img");
      cap = dlg.querySelector(".lb-caption");
      dlg.querySelector(".lb-close").addEventListener("click", () => dlg.close());
      dlg.addEventListener("click", (ev) => { if (ev.target === dlg || ev.target === stage) dlg.close(); });
      stage.addEventListener("wheel", (ev) => {
        ev.preventDefault();
        const prev = scale;
        scale = Math.min(9, Math.max(1, scale * Math.pow(1.0016, -ev.deltaY)));
        const r = img.getBoundingClientRect();
        const mx = ev.clientX - (r.left + r.width / 2), my = ev.clientY - (r.top + r.height / 2);
        tx -= mx * (scale / prev - 1);
        ty -= my * (scale / prev - 1);
        if (scale === 1) { tx = 0; ty = 0; }
        apply();
      }, { passive: false });
      stage.addEventListener("dblclick", (ev) => {
        if (scale > 1) reset();
        else {
          scale = 3;
          const r = img.getBoundingClientRect();
          tx = -(ev.clientX - (r.left + r.width / 2)) * 2;
          ty = -(ev.clientY - (r.top + r.height / 2)) * 2;
          apply();
        }
      });
      let panning = null;
      stage.addEventListener("pointerdown", (ev) => {
        if (ev.target !== img) return;
        panning = { x: ev.clientX - tx, y: ev.clientY - ty };
        stage.classList.add("panning");
        stage.setPointerCapture(ev.pointerId);
      });
      stage.addEventListener("pointermove", (ev) => {
        if (!panning) return;
        tx = ev.clientX - panning.x;
        ty = ev.clientY - panning.y;
        apply();
      });
      const endPan = () => { panning = null; stage.classList.remove("panning"); };
      stage.addEventListener("pointerup", endPan);
      stage.addEventListener("pointercancel", endPan);
    };
    msLinks.forEach((a) => {
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        if (!dlg) build();
        reset();
        img.src = a.getAttribute("href");
        const fig = a.closest("figure");
        cap.textContent = fig ? fig.querySelector("figcaption").textContent.replace(/\s+/g, " ").trim() : "";
        dlg.showModal();
      });
    });
  }

  const study = document.getElementById("study");
  if (!study) return;

  const panelScroll = document.getElementById("panel-scroll");
  const resyncBtn = document.getElementById("resync");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ----- reading mode (lecture / étude), remembered per device -------------
  const toggle = study.querySelector(".mode-toggle");
  if (toggle) {
    toggle.hidden = false;
    const buttons = toggle.querySelectorAll("button[data-setmode]");
    const setMode = (mode) => {
      study.dataset.mode = mode;
      buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.setmode === mode)));
      try { localStorage.setItem("rb-mode", mode); } catch {}
    };
    buttons.forEach((b) => b.addEventListener("click", () => setMode(b.dataset.setmode)));
    let saved = null;
    try { saved = localStorage.getItem("rb-mode"); } catch {}
    if (saved === "lecture" || saved === "etude") setMode(saved);
  }

  // ----- pulse helper -------------------------------------------------------
  const pulse = (el) => {
    if (!el) return;
    el.classList.remove("pulse");
    void el.offsetWidth; // restart the animation
    el.classList.add("pulse");
    setTimeout(() => el.classList.remove("pulse"), 2100);
  };
  const pulseVerses = (from, to) => {
    for (let n = from; n <= to; n++) pulse(document.getElementById("v" + n));
  };

  // ----- sync state ---------------------------------------------------------
  let syncOn = true;
  let programmaticPanelScroll = 0;
  const setSync = (on) => {
    syncOn = on;
    if (resyncBtn) resyncBtn.hidden = on;
  };

  const panelIsColumn = () =>
    panelScroll && getComputedStyle(panelScroll).overflowY !== "visible";

  const scrollPanelTo = (el) => {
    if (!panelScroll || !el) return;
    if (panelIsColumn()) {
      programmaticPanelScroll = Date.now();
      panelScroll.scrollTo({
        top: el.offsetTop - panelScroll.offsetTop - 8,
        behavior: reduced ? "auto" : "smooth",
      });
    } else {
      el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    }
  };

  // ----- markers: text -> panel (verse markers and note calls alike) --------
  document.querySelectorAll(".vmark, .study-main .fnref").forEach((mk) => {
    mk.addEventListener("click", (ev) => {
      const target = document.getElementById(mk.hash.slice(1));
      if (!target) return;
      ev.preventDefault();
      history.replaceState(null, "", mk.hash);
      scrollPanelTo(target);
      pulse(target);
      setSync(true);
    });
  });

  // ----- panel note numbers -> back to the reference in the text ------------
  document.querySelectorAll(".fnote-n").forEach((a) => {
    a.addEventListener("click", (ev) => {
      const target = document.getElementById(a.hash.slice(1));
      if (!target) return;
      ev.preventDefault();
      history.replaceState(null, "", a.hash);
      target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
      pulse(target.closest("p") || target);
    });
  });

  // ----- lemma heads: panel -> poem ----------------------------------------
  document.querySelectorAll(".lemma-anchor, .backtov").forEach((a) => {
    a.addEventListener("click", (ev) => {
      const target = document.getElementById(a.hash.slice(1));
      if (!target) return;
      ev.preventDefault();
      history.replaceState(null, "", a.hash);
      target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
      const from = parseInt(a.dataset.from || target.id.slice(1), 10);
      const to = parseInt(a.dataset.to || from, 10);
      pulseVerses(from, isNaN(to) ? from : to);
    });
  });

  // ----- scroll-sync: the text drives the panel ------------------------------
  // anchors: verse lines with a remarque (study view) OR note calls (prose
  // sections) — each knows the panel element it points at.
  const anchors = [
    ...Array.from(document.querySelectorAll(".vline.marked"))
      .map((el) => ({ el, id: el.dataset.rem })),
    ...Array.from(document.querySelectorAll(".study-main .fnref"))
      .map((a) => ({ el: a, id: a.hash.slice(1) })),
  ];
  if (anchors.length && panelScroll) {
    let ticking = false;
    let syncedId = null;
    const follow = () => {
      ticking = false;
      if (!syncOn || study.dataset.mode === "lecture" || !panelIsColumn()) return;
      const fold = window.innerHeight * 0.38;
      let current = null;
      for (const a of anchors) {
        const r = a.el.getBoundingClientRect();
        if (r.top <= fold) current = a;
        else break;
      }
      if (!current) current = anchors[0];
      if (current.id !== syncedId) {
        syncedId = current.id;
        scrollPanelTo(document.getElementById(current.id));
      }
    };
    window.addEventListener("scroll", () => {
      if (!ticking) { ticking = true; requestAnimationFrame(follow); }
    }, { passive: true });

    // manual panel scrolling breaks the coupling — visibly
    const breakSync = () => {
      if (Date.now() - programmaticPanelScroll > 600) setSync(false);
    };
    panelScroll.addEventListener("wheel", breakSync, { passive: true });
    panelScroll.addEventListener("touchmove", breakSync, { passive: true });
    if (resyncBtn) resyncBtn.addEventListener("click", () => { setSync(true); syncedId = null; follow(); });
  }

  // ----- keyboard: n/p next-previous lemma, j/k strophe ---------------------
  const lemmas = Array.from(document.querySelectorAll(".lemma"));
  const strophes = Array.from(document.querySelectorAll(".strophe-row"));
  const nearestIndex = (els) => {
    let best = 0;
    els.forEach((el, i) => { if (el.getBoundingClientRect().top < window.innerHeight * 0.3) best = i; });
    return best;
  };
  document.addEventListener("keydown", (ev) => {
    if (ev.target.closest("input, textarea, select") || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === "j" || ev.key === "k") {
      const i = nearestIndex(strophes) + (ev.key === "j" ? 1 : -1);
      const t = strophes[Math.max(0, Math.min(strophes.length - 1, i))];
      if (t) t.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    }
    if ((ev.key === "n" || ev.key === "p") && lemmas.length) {
      const i = nearestIndex(lemmas.map((l) => l)) + (ev.key === "n" ? 1 : -1);
      const t = lemmas[Math.max(0, Math.min(lemmas.length - 1, i))];
      if (t) {
        scrollPanelTo(t);
        pulse(t);
        const from = parseInt(t.dataset.from, 10), to = parseInt(t.dataset.to, 10);
        if (!isNaN(from)) pulseVerses(from, isNaN(to) ? from : to);
      }
    }
  });

  // ----- arriving on a #fragment: position both panes -----------------------
  const initial = location.hash && document.getElementById(location.hash.slice(1));
  if (initial) {
    if (initial.classList.contains("lemma")) {
      setTimeout(() => { scrollPanelTo(initial); pulse(initial); }, 60);
    } else if (/^v\d+$/.test(initial.id)) {
      pulse(initial);
      const rem = initial.dataset.rem && document.getElementById(initial.dataset.rem);
      if (rem) setTimeout(() => scrollPanelTo(rem), 60);
    }
  }
})();
