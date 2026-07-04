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

  // ----- reading-view sigla: typeset tooltip on hover/focus (no navigation) --
  // The definition rides along in each ref's hidden .siglum-pop; we render a
  // single floating copy positioned with position:fixed so it escapes the
  // notes panel's scroll clipping and never overflows the viewport.
  (function () {
    let float = null, hideTimer = 0, current = null;
    const ensure = () => {
      if (float) return float;
      float = document.createElement("div");
      float.className = "siglum-pop-float";
      document.body.appendChild(float);
      float.addEventListener("pointerenter", () => clearTimeout(hideTimer));
      float.addEventListener("pointerleave", scheduleHide);
      return float;
    };
    const place = (ref) => {
      const src = ref.querySelector(".siglum-pop");
      if (!src) return;
      const f = ensure();
      clearTimeout(hideTimer);
      current = ref;
      f.innerHTML = src.innerHTML;
      f.classList.add("show");
      f.style.left = "0px"; f.style.top = "0px"; // reset before measuring
      const r = ref.getBoundingClientRect();
      const fr = f.getBoundingClientRect();
      const pad = 12;
      let left = r.left + r.width / 2 - fr.width / 2;
      left = Math.max(pad, Math.min(left, window.innerWidth - fr.width - pad));
      let top = r.bottom + 8;
      if (top + fr.height > window.innerHeight - pad) top = r.top - fr.height - 8;
      f.style.left = left + "px";
      f.style.top = Math.max(pad, top) + "px";
    };
    const hideNow = () => { if (float) float.classList.remove("show"); current = null; };
    const scheduleHide = () => { clearTimeout(hideTimer); hideTimer = setTimeout(hideNow, 140); };
    document.addEventListener("pointerover", (ev) => {
      const ref = ev.target.closest(".siglum-ref");
      if (ref) place(ref);
    });
    document.addEventListener("pointerout", (ev) => {
      const ref = ev.target.closest(".siglum-ref");
      if (ref && ref === current) scheduleHide();
    });
    document.addEventListener("focusin", (ev) => {
      const ref = ev.target.closest(".siglum-ref");
      if (ref) place(ref);
    });
    document.addEventListener("focusout", (ev) => {
      if (ev.target.closest(".siglum-ref")) scheduleHide();
    });
    // touch / click: toggle in place; a tap elsewhere dismisses.
    document.addEventListener("click", (ev) => {
      const ref = ev.target.closest(".siglum-ref");
      if (ref) { ev.preventDefault(); (ref === current && float && float.classList.contains("show")) ? hideNow() : place(ref); }
      else if (!ev.target.closest(".siglum-pop-float")) hideNow();
    });
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") hideNow(); });
    window.addEventListener("scroll", hideNow, { passive: true, capture: true });
    window.addEventListener("resize", hideNow);
  })();

  const study = document.getElementById("study");
  if (!study) return;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hashId = (h) => { try { return decodeURIComponent(h.slice(1)); } catch { return h.slice(1); } };

  // ----- pulse helpers ------------------------------------------------------
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

  // ----- scroll a target into its own panel (or the page) -------------------
  // Each view (web / livre) owns its own .panel-scroll; a target knows which by
  // being inside it, so we never depend on a single global panel element.
  let programmaticPanelScroll = 0;
  const isColumn = (ps) => ps && getComputedStyle(ps).overflowY !== "visible";
  const scrollPanelTo = (el) => {
    if (!el) return;
    const ps = el.closest(".panel-scroll");
    if (isColumn(ps)) {
      programmaticPanelScroll = Date.now();
      ps.scrollTo({ top: el.offsetTop - ps.offsetTop - 8, behavior: reduced ? "auto" : "smooth" });
    } else {
      el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    }
  };

  // ----- view control: Version web / Version livre (+ continue / fac-similé) --
  // On a chanson page the three views live in the DOM at once; inactive ones
  // carry [hidden]. Elsewhere (prose sections) there is no control and #study
  // is itself the single view.
  const views = study.querySelectorAll(".cx-view").length
    ? {
        web: study.querySelector(".cx-web"),
        livre: study.querySelector(".cx-livre"),
        facsimile: study.querySelector(".cx-facsimile"),
      }
    : null;

  let onViewChange = () => {};
  // the view control now lives in the sticky sub-bar (outside #study), so look it
  // up globally; it still drives the views inside #study.
  const vc = document.querySelector(".view-control");
  if (vc && views) {
    vc.hidden = false;
    const primary = vc.querySelectorAll("[data-view]");
    const secondary = vc.querySelectorAll("[data-livre]");
    const secWrap = vc.querySelector(".vc-secondary");

    const refresh = () => {
      const v = study.dataset.view;
      const l = study.dataset.livre;
      let active = "web";
      if (v === "livre") active = (l === "facsimile" && views.facsimile) ? "facsimile" : "livre";
      for (const key of ["web", "livre", "facsimile"]) {
        if (views[key]) views[key].hidden = key !== active;
      }
      primary.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === v)));
      secondary.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.livre === l)));
      if (secWrap) secWrap.hidden = v !== "livre";
      onViewChange();
    };
    const setView = (v) => {
      study.dataset.view = v;
      try { localStorage.setItem("rb-view", v); } catch {}
      refresh();
    };
    const setLivre = (m) => {
      study.dataset.livre = m;
      try { localStorage.setItem("rb-livre", m); } catch {}
      refresh();
    };
    primary.forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
    secondary.forEach((b) => b.addEventListener("click", () => setLivre(b.dataset.livre)));

    let sv = null, sl = null;
    try { sv = localStorage.getItem("rb-view"); sl = localStorage.getItem("rb-livre"); } catch {}
    if (sl === "continue" || sl === "facsimile") study.dataset.livre = sl;
    if (sv === "web" || sv === "livre") study.dataset.view = sv;
    // a deep link to a printed-page anchor implies the faithful continuous view
    if (/^#page-/.test(location.hash)) { study.dataset.view = "livre"; study.dataset.livre = "continue"; }
    refresh();

    // a back-ref / cross-ref to a #page-… anchor on THIS page: the target id
    // lives in the Livre body, so switch to it before scrolling.
    document.addEventListener("click", (ev) => {
      const a = ev.target.closest("a.backref, a.xref");
      if (!a) return;
      const url = new URL(a.getAttribute("href"), location.href);
      if (url.pathname !== location.pathname || !/^#page-/.test(url.hash)) return;
      ev.preventDefault();
      study.dataset.view = "livre"; study.dataset.livre = "continue";
      refresh();
      history.replaceState(null, "", url.hash);
      const target = document.getElementById(hashId(url.hash));
      if (target) requestAnimationFrame(() => target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }));
    });
  }

  // ----- panel jumps: markers -> panel, panel -> text -----------------------
  let setSync = () => {};

  document.querySelectorAll(".vmark, .study-main .fnref").forEach((mk) => {
    mk.addEventListener("click", (ev) => {
      const target = document.getElementById(hashId(mk.hash));
      if (!target) return;
      ev.preventDefault();
      history.replaceState(null, "", mk.hash);
      scrollPanelTo(target);
      pulse(target);
      setSync(true);
    });
  });
  document.querySelectorAll(".fnote-n").forEach((a) => {
    a.addEventListener("click", (ev) => {
      const target = document.getElementById(hashId(a.hash));
      if (!target) return;
      ev.preventDefault();
      history.replaceState(null, "", a.hash);
      target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
      pulse(target.closest("p") || target);
    });
  });
  document.querySelectorAll(".lemma-anchor, .backtov").forEach((a) => {
    a.addEventListener("click", (ev) => {
      const target = document.getElementById(hashId(a.hash));
      if (!target) return;
      ev.preventDefault();
      history.replaceState(null, "", a.hash);
      target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
      const from = parseInt(a.dataset.from || target.id.slice(1), 10);
      const to = parseInt(a.dataset.to || from, 10);
      pulseVerses(from, isNaN(to) ? from : to);
    });
  });

  // ----- scroll-sync: the text drives the active view's panel ----------------
  // Precompute anchors + panel per view; on scroll, follow whichever view is
  // visible. anchors: verse lines with a remarque (web) OR note calls (livre).
  const roots = views ? [views.web, views.livre].filter(Boolean) : [study];
  const syncData = roots.map((root) => ({
    root,
    panelScroll: root.querySelector(".panel-scroll"),
    resyncBtn: root.querySelector(".resync"),
    anchors: [
      ...Array.from(root.querySelectorAll(".vline.marked")).map((el) => ({ el, id: el.dataset.rem })),
      ...Array.from(root.querySelectorAll(".study-main .fnref")).map((a) => ({ el: a, id: hashId(a.hash) })),
    ],
  }));
  const activeRoot = () => (views ? (study.dataset.view === "livre" ? views.livre : views.web) : study);
  const curData = () => syncData.find((d) => d.root === activeRoot()) || syncData[0];

  let syncOn = true;
  let ticking = false;
  let syncedId = null;
  setSync = (on) => {
    syncOn = on;
    const d = curData();
    if (d && d.resyncBtn) d.resyncBtn.hidden = on;
  };
  onViewChange = () => { syncedId = null; setSync(true); };

  const follow = () => {
    ticking = false;
    if (!syncOn) return;
    const d = curData();
    if (!d || !d.anchors.length || !isColumn(d.panelScroll)) return;
    const fold = window.innerHeight * 0.38;
    let current = null;
    for (const a of d.anchors) {
      if (a.el.getBoundingClientRect().top <= fold) current = a;
      else break;
    }
    if (!current) current = d.anchors[0];
    if (current.id !== syncedId) {
      syncedId = current.id;
      scrollPanelTo(document.getElementById(current.id));
    }
  };
  if (syncData.some((d) => d.anchors.length && d.panelScroll)) {
    window.addEventListener("scroll", () => {
      if (!ticking) { ticking = true; requestAnimationFrame(follow); }
    }, { passive: true });
    const breakSync = () => { if (Date.now() - programmaticPanelScroll > 600) setSync(false); };
    for (const d of syncData) {
      if (!d.panelScroll) continue;
      d.panelScroll.addEventListener("wheel", breakSync, { passive: true });
      d.panelScroll.addEventListener("touchmove", breakSync, { passive: true });
      if (d.resyncBtn) d.resyncBtn.addEventListener("click", () => { setSync(true); syncedId = null; follow(); });
    }
  }

  // ----- keyboard: n/p next-previous lemma, j/k strophe (web view only) ------
  const lemmas = Array.from(document.querySelectorAll(".lemma"));
  const strophes = Array.from(document.querySelectorAll(".strophe-row"));
  const nearestIndex = (els) => {
    let best = 0;
    els.forEach((el, i) => { if (el.getBoundingClientRect().top < window.innerHeight * 0.3) best = i; });
    return best;
  };
  document.addEventListener("keydown", (ev) => {
    if (ev.target.closest("input, textarea, select") || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (views && study.dataset.view === "livre") return; // poem nav is the web view
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
  const initial = location.hash && document.getElementById(hashId(location.hash));
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
