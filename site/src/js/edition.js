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

  // ----- index links open the target in the reader's remembered version ------
  // A link out of an index (a verse pill or an author page-reference) flags the
  // next page load so it keeps the current version instead of being forced into
  // the faithful "book" view. In-text cross-references are left untouched (they
  // still force book view, where the printed-page anchors live).
  document.addEventListener("click", (ev) => {
    if (ev.target.closest("a.cx-vn, a.idx-page, a.fx-ilink")) {
      try { sessionStorage.setItem("rb-keepview", "1"); } catch {}
    }
  });

  // ----- mobile: hamburger drawer for the main nav ---------------------------
  (function () {
    const btn = document.getElementById("nav-toggle");
    const nav = document.getElementById("main-nav");
    if (!btn || !nav) return;
    const set = (open) => {
      document.body.classList.toggle("nav-open", open);
      btn.setAttribute("aria-expanded", String(open));
    };
    btn.addEventListener("click", () => set(!document.body.classList.contains("nav-open")));
    // a tap on a link, Escape, or a jump to desktop width closes the drawer
    nav.addEventListener("click", (ev) => { if (ev.target.closest("a")) set(false); });
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") set(false); });
    window.matchMedia("(min-width: 701px)").addEventListener("change", (e) => { if (e.matches) set(false); });
  })();

  // ----- mobile: the sub-bar hides on scroll-down, returns on scroll-up, and
  // its overflowing apparatus strip shows honest edge fades (mask toggled by
  // scroll position) with the active section scrolled into view -------------
  (function () {
    const sub = document.querySelector(".subnav");
    const mq = window.matchMedia("(max-width: 700px)");
    if (sub) {
      let lastY = window.scrollY, ticking = false;
      const onScroll = () => {
        ticking = false;
        if (!mq.matches) { sub.classList.remove("subnav--hidden"); lastY = window.scrollY; return; }
        const y = window.scrollY;
        if (y > lastY + 6 && y > 140) sub.classList.add("subnav--hidden");
        else if (y < lastY - 6) sub.classList.remove("subnav--hidden");
        lastY = y;
      };
      window.addEventListener("scroll", () => {
        if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
      }, { passive: true });
    }
    const strip = document.querySelector(".sn-apparatus");
    if (strip) {
      const update = () => {
        const max = strip.scrollWidth - strip.clientWidth;
        strip.classList.toggle("has-start", strip.scrollLeft > 2);
        strip.classList.toggle("has-end", strip.scrollLeft < max - 2);
      };
      strip.addEventListener("scroll", update, { passive: true });
      window.addEventListener("resize", update);
      update();
      const cur = strip.querySelector("[aria-current]");
      if (cur && mq.matches) cur.scrollIntoView({ inline: "center", block: "nearest" });
    }
  })();

  // ----- word-index concordance: filter, A–Z rail, KWIC expand ---------------
  // The list is server-rendered (works with JS off; the reference pills are the
  // core navigation). This adds the type-ahead filter, rail dimming, and the
  // keyboard-accessible expand of the KWIC panel.
  (function () {
    const root = document.querySelector(".concordance");
    if (!root) return;
    const toolbar = root.querySelector(".cx-toolbar");
    const filter = root.querySelector(".cx-filter");
    const clear = root.querySelector(".cx-clear");
    const countEl = root.querySelector(".cx-count");
    const noRes = root.querySelector(".cx-noresults");
    const rail = root.querySelector(".cx-rail");
    const entries = Array.from(root.querySelectorAll(".cx-entry"));
    const heads = Array.from(root.querySelectorAll(".cx-letter"));
    const total = entries.length;
    const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[^a-z0-9]/g, "");

    // keep the sticky letter heads clear of the (sticky) toolbar
    const measure = () => root.style.setProperty("--cx-tb", (toolbar ? toolbar.offsetHeight : 0) + "px");
    measure();
    window.addEventListener("resize", measure);

    // expand / collapse — the <button> is the accessible control; a click
    // anywhere on the row is a convenience, but reference links navigate.
    root.addEventListener("click", (ev) => {
      if (ev.target.closest(".cx-vn")) return;
      const row = ev.target.closest(".cx-row");
      if (!row) return;
      const entry = row.closest(".cx-entry");
      const open = entry.classList.toggle("open");
      const btn = entry.querySelector(".cx-toggle");
      if (btn) btn.setAttribute("aria-expanded", String(open));
    });

    const apply = () => {
      const q = norm(filter ? filter.value : "");
      if (clear) clear.hidden = !(filter && filter.value);
      let shown = 0;
      for (const el of entries) {
        const hit = !q || el.dataset.search.includes(q);
        el.hidden = !hit;
        if (hit) shown++;
      }
      for (const head of heads) {
        let sib = head.nextElementSibling, any = false;
        while (sib && sib.classList.contains("cx-entry")) {
          if (!sib.hidden) { any = true; break; }
          sib = sib.nextElementSibling;
        }
        head.hidden = !any;
      }
      if (rail) for (const a of rail.children) {
        if (a.classList.contains("empty")) continue;
        const head = document.getElementById("L-" + a.dataset.l);
        a.classList.toggle("dim", !(head && !head.hidden));
      }
      if (countEl) countEl.textContent = q ? shown + " / " + total + " mots" : total + " mots";
      if (noRes) noRes.hidden = shown > 0;
    };
    if (filter) filter.addEventListener("input", apply);
    if (clear) clear.addEventListener("click", () => { filter.value = ""; apply(); filter.focus(); });
    apply();
  })();

  // ----- subnav location label: appears only once the page's h1 is gone ------
  // At the top of the page the sticky bar's "Chanson XV — incipit" would sit
  // directly above the identical h1; hold it back until the title has scrolled
  // under the bars, then fade it in as the "you are here" reminder.
  (function () {
    const snHere = document.querySelector(".subnav .sn-here");
    const h1 = document.querySelector("h1");
    if (!snHere || !h1 || !("IntersectionObserver" in window)) return;
    const bar = snHere.closest(".subnav");
    snHere.classList.add("sn-auto");
    const stuckBottom = Math.max(0, Math.ceil(bar.getBoundingClientRect().bottom));
    new IntersectionObserver(([e]) => {
      const above = !e.isIntersecting && e.boundingClientRect.top < stuckBottom;
      snHere.classList.toggle("is-shown", above);
    }, { rootMargin: `-${stuckBottom}px 0px 0px 0px` }).observe(h1);
  })();

  // ----- bibliographie: mark the reader's place in the sticky sommaire -------
  // A quiet wash follows the section in view down the table of contents, with
  // its enclosing branch lit so the hierarchy stays legible. Desktop only —
  // there the TOC is a sticky sidebar; on a phone it's a static header list you
  // scroll straight past, so highlighting "where you are" would say nothing.
  (function () {
    const toc = document.querySelector(".bib-toc");
    if (!toc) return;
    const links = Array.from(toc.querySelectorAll("a[href^='#']"));
    const targets = links
      .map((a) => {
        let id; try { id = decodeURIComponent(a.hash.slice(1)); } catch { id = a.hash.slice(1); }
        const el = id && document.getElementById(id);
        return el ? { a, el } : null;
      })
      .filter(Boolean);
    if (!targets.length) return;

    // the TOC ancestors of a leaf link: walk up the nested <ol>/<li> structure.
    const branch = (a) => {
      const out = [];
      let li = a.closest("li");
      while (li && (li = li.parentElement.closest("li"))) {
        const pa = li.querySelector(":scope > a");
        if (pa) out.push(pa);
      }
      return out;
    };
    // keep the active entry visible without ever scrolling the page itself.
    const keepInView = (a) => {
      const c = toc.getBoundingClientRect(), r = a.getBoundingClientRect();
      if (r.top < c.top + 6) toc.scrollTop -= c.top + 6 - r.top;
      else if (r.bottom > c.bottom - 6) toc.scrollTop += r.bottom - (c.bottom - 6);
    };
    // fold line: the y where an in-page anchor actually lands, so a section you
    // just clicked in the TOC is counted as current. The browser sums the
    // scroller's scroll-padding-top and the target's scroll-margin-top (spec:
    // the target's margin-box start aligns to the scroll-padding start edge), so
    // a heading lands that far down — well below the visible chrome. Match it (+
    // a hair) or the spy would keep selecting the section above the clicked one.
    const px = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
    const fold = () => {
      const pad = px(getComputedStyle(document.documentElement).scrollPaddingTop);
      const mar = px(getComputedStyle(targets[0].el).scrollMarginTop);
      return pad + mar + 4;
    };

    const mq = window.matchMedia("(min-width: 1080px)");
    let curr = null, ticking = false;
    const clear = () => {
      links.forEach((l) => l.classList.remove("is-current", "is-trail"));
      curr = null;
    };
    const spy = () => {
      ticking = false;
      if (!mq.matches) return;
      const line = fold();
      let cur = targets[0];
      for (const t of targets) {
        if (t.el.getBoundingClientRect().top <= line) cur = t;
        else break;
      }
      if (cur.a === curr) return;
      curr = cur.a;
      links.forEach((l) => l.classList.remove("is-current", "is-trail"));
      cur.a.classList.add("is-current");
      branch(cur.a).forEach((l) => l.classList.add("is-trail"));
      keepInView(cur.a);
    };
    window.addEventListener("scroll", () => {
      if (!ticking) { ticking = true; requestAnimationFrame(spy); }
    }, { passive: true });
    mq.addEventListener("change", (e) => { e.matches ? spy() : clear(); });
    spy();
  })();

  // ----- spine keyboard nav: plain ←/→ step through the whole-book pager -----
  (function () {
    const prev = document.querySelector(".book-pager a.bp-prev");
    const next = document.querySelector(".book-pager a.bp-next");
    if (!prev && !next) return;
    document.addEventListener("keydown", (ev) => {
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
      if (ev.target.closest("input, textarea, select, [contenteditable]")) return;
      if (document.querySelector("dialog[open]")) return; // lightbox owns the keys
      const a = ev.key === "ArrowLeft" ? prev : next;
      if (a) location.href = a.href;
    });
  })();

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
  // the currently shown view's root element (for "is the deep-link target here?")
  const activeViewEl = () => {
    if (!views) return study;
    if (study.dataset.view === "livre")
      return (study.dataset.livre === "facsimile" && views.facsimile) ? views.facsimile : views.livre;
    return views.web;
  };
  const activeViewName = () => {
    if (!views) return "single";
    if (study.dataset.view === "livre")
      return (study.dataset.livre === "facsimile" && views.facsimile) ? "facsimile" : "livre";
    return "web";
  };
  // Resolve a deep-link hash to the element to scroll to IN THE ACTIVE VIEW,
  // bridging the views' different anchor systems:
  //   web   → #vK verse lines (no page anchors)
  //   book  → #page-PID printed pages (no verse anchors)
  //   fac.  → #fx-page-PID sheets (no verse anchors)
  // A verse's typescript page rides on its (web) line as data-fxpage, so a verse
  // reference still resolves to the right page in book / facsimile. Returns null
  // when the active view can't place the anchor (then the caller opens at top).
  const resolveDeepLink = (hash) => {
    const id = hashId(hash);
    if (!id) return null;
    const av = activeViewEl();
    const direct = document.getElementById(id);
    if (direct && av && av.contains(direct)) return direct;   // already in the active view
    const name = activeViewName();
    const vm = /^v\d+$/.test(id);
    if (vm) {
      const pid = direct && direct.dataset.fxpage;             // carried on the web verse line
      if (!pid) return null;
      if (name === "facsimile") return document.getElementById("fx-page-" + pid);
      if (name === "livre") return document.getElementById("page-" + pid);
      return null;
    }
    const pm = /^page-(.+)$/.exec(id);
    if (pm && name === "facsimile") return document.getElementById("fx-page-" + pm[1]);
    return null;
  };

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

    // page-number pills in the continuous body → open that sheet in the facsimile
    if (views.facsimile) {
      study.addEventListener("click", (ev) => {
        const pill = ev.target.closest(".page-pill");
        if (!pill) return;
        ev.preventDefault();
        study.dataset.view = "livre"; study.dataset.livre = "facsimile";
        try { localStorage.setItem("rb-view", "livre"); localStorage.setItem("rb-livre", "facsimile"); } catch {}
        refresh();
        const sheet = document.getElementById("fx-page-" + pill.dataset.page);
        if (sheet) requestAnimationFrame(() => sheet.scrollIntoView({ block: "start" }));
      });
    }

    let sv = null, sl = null;
    try { sv = localStorage.getItem("rb-view"); sl = localStorage.getItem("rb-livre"); } catch {}
    if (sl === "continue" || sl === "facsimile") study.dataset.livre = sl;
    if (sv === "web" || sv === "livre") study.dataset.view = sv;
    // A #page- deep link normally implies the faithful continuous view (that body
    // owns the printed-page anchors). But a link out of an index asks to keep the
    // reader's remembered version (flagged on the outgoing click), so honour it.
    let keepView = false;
    try { keepView = sessionStorage.getItem("rb-keepview") === "1"; sessionStorage.removeItem("rb-keepview"); } catch {}
    if (/^#page-/.test(location.hash) && !keepView) { study.dataset.view = "livre"; study.dataset.livre = "continue"; }
    refresh();
    // After the views resolve (inactive ones hidden), scroll to the deep-link
    // target translated into the now-active view (a verse resolves to its page in
    // book / facsimile); if the active view can't place it, open at the top. Verse
    // / lemma targets in the web view are also pulsed by the block further down.
    if (location.hash) {
      requestAnimationFrame(() => {
        const el = resolveDeepLink(location.hash);
        if (el) el.scrollIntoView({ block: "start" });
        else window.scrollTo(0, 0);
      });
    }

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
  if (initial && (!views || activeViewEl().contains(initial))) {
    if (initial.classList.contains("lemma")) {
      setTimeout(() => { scrollPanelTo(initial); pulse(initial); }, 60);
    } else if (/^v\d+$/.test(initial.id)) {
      pulse(initial);
      const rem = initial.dataset.rem && document.getElementById(initial.dataset.rem);
      if (rem) setTimeout(() => scrollPanelTo(rem), 60);
    }
  }
})();
