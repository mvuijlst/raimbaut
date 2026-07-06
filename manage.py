#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
manage.py — management TUI for the Raimbaut d'Orange web edition.

A dependency-aware console dashboard over the whole pipeline documented in
WORKFLOW.md. It computes, from file mtimes, which artifacts are stale, rebuilds
only what changed (in the correct order, with cascade), builds and serves the
Eleventy site, and deploys to production. Standard library only — it does NOT
need ./venv; it runs the stdlib build scripts with whatever Python launched it.

    python manage.py           # interactive TUI
    python manage.py stale     # rebuild stale data, non-interactively
    python manage.py all       # force-rebuild all data
    python manage.py site      # build the site
    python manage.py deploy     # build + deploy
    python manage.py publish    # rebuild stale -> site -> deploy
    python manage.py status     # print the dashboard and exit
"""
import glob
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)  # every build script assumes cwd == repo root

BUILD_PY = sys.executable or "python"          # stdlib scripts: reuse our interpreter
VENV_PY = ROOT / "venv" / "Scripts" / "python.exe"
NPM = shutil.which("npm") or "npm"
PWSH = shutil.which("pwsh") or shutil.which("powershell") or "powershell"
REMOTE_URL = "https://raimbaut.yusupov.cloud"

# ── ANSI ────────────────────────────────────────────────────────────────────
def _enable_ansi():
    if os.name == "nt":
        try:
            import ctypes
            k = ctypes.windll.kernel32
            k.SetConsoleMode(k.GetStdHandle(-11), 7)  # ENABLE_VIRTUAL_TERMINAL_PROCESSING
        except Exception:
            pass

_enable_ansi()
for _s in (sys.stdout, sys.stderr):      # box glyphs die on Windows' cp1252 default
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
def c(code, s): return f"\033[{code}m{s}\033[0m"
BOLD = lambda s: c("1", s); DIM = lambda s: c("2", s)
RED = lambda s: c("31", s); GREEN = lambda s: c("32", s)
YELLOW = lambda s: c("33", s); BLUE = lambda s: c("36", s)
def clear(): print("\033[2J\033[3J\033[H", end="")

# ── pipeline definition ───────────────────────────────────────────────────────
class Stage:
    def __init__(self, key, title, script, out, deps, note=""):
        self.key, self.title, self.script = key, title, script
        self.out, self.deps, self.note = out, deps, note

# Stage 3 — derived data, in dependency order. `normalize` modifies its own inputs
# in place (idempotent) so it has no computable staleness; it's an on-demand action.
DATA = [
    Stage("manifest",     "manifest.json",              "build_manifest.py",
          ["manifest.json"], ["corpus/*.md", "page_numbers.csv"]),
    Stage("book",         "book.md",                    "assemble_book.py",
          ["book.md"], ["corpus/*.md", "manifest.json"]),
    Stage("bibliography", "bibliography.json",          "build_bibliography.py",
          ["bibliography.json"], ["corpus/*.md", "manifest.json"]),
    Stage("catalogue",    "chansons.json",              "build_catalogue.py",
          ["chansons.json"], ["corpus/*.md", "manifest.json"]),
    Stage("citations",    "citations.json",             "build_citations.py",
          ["citations.json"], ["corpus/*.md", "manifest.json",
                               "bibliography.json", "sigla-overrides.json"]),
    Stage("references",   "references.json",            "build_references.py",
          ["references.json"], ["corpus/*.md", "manifest.json",
                                "citations.json", "bibliography.json"]),
    Stage("footnotes",    "footnote-normalization.json", "build_footnote_norm.py",
          ["footnote-normalization.json"], ["book.md", "references.json",
                                            "bibliography.json", "citations.json"]),
]
SITE = Stage("site", "site/_site", None,
             ["site/_site"],
             ["book.md", "manifest.json", "bibliography.json", "chansons.json",
              "citations.json", "references.json", "footnote-normalization.json",
              "manuscripts.json", "site/src", "site/lib", "site/eleventy.config.js"])

# ── mtime / staleness ─────────────────────────────────────────────────────────
def _expand(pattern):
    p = ROOT / pattern
    if any(ch in pattern for ch in "*?["):
        return [Path(x) for x in glob.glob(str(ROOT / pattern), recursive=True)
                if os.path.isfile(x)]
    if p.is_dir():
        return [Path(x) for x in glob.glob(str(p / "**" / "*"), recursive=True)
                if os.path.isfile(x)]
    return [p] if p.is_file() else []

def _newest(patterns):
    files = [f for pat in patterns for f in _expand(pat)]
    return max((f.stat().st_mtime for f in files), default=None)

def status(stage):
    """FRESH / STALE / MISSING / NODEPS.

    Compares the *newest* output against the *newest* input: an input touched
    after the last build makes the target stale. (Using newest — not oldest —
    output matters for the site dir, where Eleventy's passthrough copies keep
    their old source mtimes and would otherwise read as perpetually stale.)"""
    if not all(_expand(o) for o in stage.out):
        return "MISSING"
    out = _newest(stage.out)
    din = _newest(stage.deps)
    if din is None:
        return "NODEPS"
    return "STALE" if din > out else "FRESH"

GLYPH = {"FRESH": GREEN("●"), "STALE": YELLOW("●"), "MISSING": RED("✗"),
         "NODEPS": DIM("·"), "MANUAL": DIM("·")}

# ── running commands ──────────────────────────────────────────────────────────
def run(argv, cwd=ROOT, label=None):
    label = label or " ".join(str(a) for a in argv)
    print(BLUE(f"\n▶ {label}"))
    # child scripts print box glyphs / accents: force UTF-8 so they don't die on
    # (or mojibake through) Windows' cp1252 default when output is a pipe.
    env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
    t0 = time.time()
    try:
        rc = subprocess.run(argv, cwd=str(cwd), env=env).returncode
    except FileNotFoundError as e:
        print(RED(f"  ✗ cannot run: {e}"))
        return 127
    dt = time.time() - t0
    print((GREEN(f"  ✓ ok") if rc == 0 else RED(f"  ✗ exit {rc}")) + DIM(f"  ({dt:.1f}s)"))
    return rc

def run_py(script, label=None):
    return run([BUILD_PY, script], label=label or f"python {script}")

def run_stage(stage):
    return run_py(stage.script, label=f"{stage.script}  →  {stage.title}")

# ── high-level actions ────────────────────────────────────────────────────────
def rebuild_stale():
    """Ordered pass; re-evaluate before each stage so rebuilds cascade downstream."""
    ran = 0
    for st in DATA:
        if status(st) != "FRESH":
            if run_stage(st) != 0:
                print(RED("  stopping — fix the error above and retry.")); return
            ran += 1
    print(("\n" + GREEN(f"{ran} stage(s) rebuilt.")) if ran else
          ("\n" + GREEN("Everything already fresh — nothing to do.")))

def rebuild_all():
    for st in DATA:
        if run_stage(st) != 0:
            print(RED("  stopping — fix the error above and retry.")); return
    print("\n" + GREEN("All data rebuilt."))

def normalize():
    print(DIM("Reflow + punctuation normalisation of corpus/*.md (idempotent)."))
    run_py("normalize_typography.py")

def page_numbers():
    ok = _venv_ok()
    if not ok:
        print(RED("The vision step needs a working venv with pymupdf/openai/pillow/"
                  "python-dotenv + OPENAI_API_KEY."))
        print(DIM("The committed ./venv is broken (its base Python is gone). Rebuild:"))
        print(DIM("  python -m venv venv"))
        print(DIM("  venv\\Scripts\\pip install pymupdf openai pillow python-dotenv"))
        if input("Try anyway with the current interpreter? [y/N] ").strip().lower() != "y":
            return
        py = BUILD_PY
    else:
        py = str(VENV_PY)
    run([py, "ocr_page_numbers.py"], label="ocr_page_numbers.py  →  page_numbers.csv")

def build_site():
    return run([NPM, "run", "build"], cwd=ROOT / "site", label="npm run build  →  site/_site")

def serve_site():
    print(DIM("Live-reload dev server. Ctrl-C to stop and return to the menu."))
    try:
        run([NPM, "run", "serve"], cwd=ROOT / "site", label="npm run serve")
    except KeyboardInterrupt:
        print(YELLOW("\n  server stopped."))

def deploy():
    print(DIM(f"Build + ship static site to {REMOTE_URL} (ssh alias 'yusupov', :2708)."))
    if input(f"Deploy to production? [y/N] ").strip().lower() != "y":
        print(DIM("  cancelled.")); return
    run([PWSH, "-NoProfile", "-File", str(ROOT / "deploy.ps1")], label="deploy.ps1")

def publish():
    rebuild_stale()
    if build_site() == 0:
        deploy()

# ── configuration inspector ────────────────────────────────────────────────────
def _venv_ok():
    if not VENV_PY.exists():
        return False
    try:
        r = subprocess.run([str(VENV_PY), "-c",
                            "import fitz,openai,PIL,dotenv"],
                           capture_output=True, timeout=30)
        return r.returncode == 0
    except Exception:
        return False

def _env_keys():
    env = ROOT / ".env"
    if not env.exists():
        return []
    keys = []
    for line in env.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            keys.append((k.strip(), bool(v.strip())))
    return keys

def _grep(path, needle):
    try:
        for line in (ROOT / path).read_text(encoding="utf-8").splitlines():
            if needle in line:
                return line.strip()
    except Exception:
        pass
    return ""

def config_view():
    clear()
    print(BOLD("Configuration\n" + "─" * 60))
    def row(k, v): print(f"  {k:<22}{v}")
    row("repo root", ROOT)
    row("build Python", f"{BUILD_PY}  ({sys.version.split()[0]})")
    row("venv (vision)", GREEN("ok") if _venv_ok() else RED("broken / missing"))
    row("node / npm", f"{shutil.which('node') or '?'}  |  {NPM}")
    row("powershell", PWSH)
    row("remote", f"{REMOTE_URL}   " + DIM(_grep('deploy.ps1', '$Remote =')))
    row("remote dest", DIM(_grep("deploy.ps1", "$Dest")))
    keys = _env_keys()
    if keys:
        row(".env", ", ".join(f"{k}={'set' if v else GREEN('') + RED('empty')}" for k, v in keys))
    else:
        row(".env", RED("missing — vision steps need OPENAI_API_KEY"))
    print("\n  " + BOLD("Open in editor:"))
    print("   [1] .env      [2] deploy.ps1      [3] site/eleventy.config.js")
    print("   [4] .claude/launch.json           [enter] back")
    choice = input("\n  > ").strip()
    targets = {"1": ".env", "2": "deploy.ps1", "3": "site/eleventy.config.js",
               "4": ".claude/launch.json"}
    if choice in targets:
        _open(ROOT / targets[choice])

def _open(path):
    try:
        if os.name == "nt":
            os.startfile(str(path))            # noqa: type
        else:
            subprocess.run(["xdg-open" if sys.platform.startswith("linux") else "open", str(path)])
    except Exception as e:
        print(RED(f"  couldn't open {path}: {e}"))
        time.sleep(1)

# ── dashboard ─────────────────────────────────────────────────────────────────
def dashboard():
    clear()
    print(BOLD("  RAIMBAUT D'ORANGE — edition manager") +
          DIM(f"    {REMOTE_URL}"))
    print("  " + "─" * 64)
    n_pages = len(_expand("corpus/*.md"))
    print(DIM(f"  corpus: {n_pages} pages") +
          DIM("    (edit a page → Normalize → Rebuild stale → Build site → Deploy)"))
    print()
    print(BOLD("  Derived data") + DIM("   (Stage 3 — deterministic, stdlib)"))
    any_stale = False
    for st in DATA:
        s = status(st)
        any_stale |= s in ("STALE", "MISSING")
        print(f"    {GLYPH[s]}  {st.title:<30}{DIM(s.lower())}")
    print()
    ss = status(SITE)
    print(BOLD("  Site"))
    print(f"    {GLYPH[ss]}  {'site/_site (build output)':<30}{DIM(ss.lower())}")
    print("  " + "─" * 64)
    if any_stale:
        print("  " + YELLOW("data is stale — [1] rebuilds only what changed"))
    else:
        print("  " + GREEN("data is fresh"))

MENU = [
    ("1", "Rebuild stale data      (only what changed, in order)", rebuild_stale),
    ("2", "Rebuild ALL data        (force full Stage 3)", rebuild_all),
    ("3", "Run one data stage…", None),  # submenu
    ("4", "Normalize corpus        (after editing corpus pages)", normalize),
    ("5", "Regenerate page numbers (vision · OpenAI · needs venv)", page_numbers),
    ("6", "Build site              (Eleventy → _site)", build_site),
    ("7", "Serve site locally      (npm run serve, Ctrl-C to stop)", serve_site),
    ("8", "Deploy to production     (deploy.ps1)", deploy),
    ("9", "Full publish            (rebuild stale → site → deploy)", publish),
    ("c", "Configuration", config_view),
]

def run_one_stage():
    clear()
    print(BOLD("Run one data stage\n") + "─" * 40)
    for i, st in enumerate(DATA, 1):
        print(f"  [{i}] {GLYPH[status(st)]}  {st.script:<26} → {st.title}")
    print("  [enter] back")
    ch = input("\n  > ").strip()
    if ch.isdigit() and 1 <= int(ch) <= len(DATA):
        run_stage(DATA[int(ch) - 1])
        input(DIM("\nPress Enter…"))

def menu_loop():
    while True:
        dashboard()
        print()
        for key, label, _ in MENU:
            print(f"    [{key}] {label}")
        print(f"    [r] Refresh    [q] Quit")
        ch = input("\n  > ").strip().lower()
        if ch in ("q", "quit", "exit"):
            return
        if ch in ("r", ""):
            continue
        if ch == "3":
            run_one_stage(); continue
        action = next((fn for k, _, fn in MENU if k == ch), None)
        if action:
            print()
            try:
                action()
            except KeyboardInterrupt:
                print(YELLOW("\n  interrupted."))
            input(DIM("\nPress Enter to return to the menu…"))
        else:
            print(RED("  ?")); time.sleep(0.4)

# ── non-interactive entry points ───────────────────────────────────────────────
def _print_status():
    for st in DATA + [SITE]:
        s = status(st)
        print(f"{s:<8} {st.title}")

def main():
    if len(sys.argv) > 1:
        cmd = sys.argv[1].lower()
        return {
            "stale": rebuild_stale, "all": rebuild_all, "normalize": normalize,
            "site": build_site, "serve": serve_site, "deploy": deploy,
            "publish": publish, "status": _print_status,
            "pagenumbers": page_numbers,
        }.get(cmd, lambda: print(RED(f"unknown command: {cmd}")) or print(__doc__))()
    try:
        menu_loop()
    except (KeyboardInterrupt, EOFError):
        print()

if __name__ == "__main__":
    main()
