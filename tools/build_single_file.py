#!/usr/bin/env python3
"""Build one self-contained "Album Tracker.html" that opens with a double-click.

Usage: python3 tools/build_single_file.py [backup.json] [output.html]

Everything (app, styles, influence data, the Explore map and the icon) is
inlined. If a backup JSON (from the Export button) is given, those albums are
baked in and loaded the first time the file is opened; after that the file
keeps using whatever is saved in the browser.
"""
import base64, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
read = lambda name: open(os.path.join(ROOT, name), encoding="utf-8").read()


def js_safe(code):
    # Keep inlined code from closing its own <script> tag early.
    return code.replace("</script", "<\\/script").replace("<!--", "<\\!--")


def sub_once(pattern, repl, text):
    new, n = re.subn(pattern, lambda m: repl, text, count=1)
    assert n == 1, pattern
    return new


backup_path = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] else None
out_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "Album Tracker.html")
backup = json.load(open(backup_path, encoding="utf-8-sig")) if backup_path else None

html = read("index.html")
app = read("app.js").replace('"albumTracker.', '"albumTrackerFile.')
# ^ its own storage names: an older copy opened from disk in the same browser
#   can't override (or be overwritten by) this one.
explore = read("explore.html")
icon = "data:image/png;base64," + base64.b64encode(open(os.path.join(ROOT, "icon-192.png"), "rb").read()).decode()

# Explore map: runs in a full-page frame on top of the tracker. It reads the
# library and influence data from this page instead of loading files.
# d3 (vendor/d3.min.js, same 7.9.0 build explore.html loads from cdnjs) is
# inlined so the map also works offline.
explore = sub_once(r'<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>',
                   "<script>" + js_safe(read("vendor/d3.min.js")) + "</script>", explore)
explore = sub_once(r'<script src="influence-data.js"></script>',
                   "<script>window.INFLUENCE_DATA = parent.INFLUENCE_DATA;</script>", explore)
explore = sub_once(r'var lib=JSON.parse\(localStorage.getItem\("albumTracker.library.v1"\)\|\|"\[\]"\);',
                   "var lib=(parent.__albumTrackerLibrary&&parent.__albumTrackerLibrary())||[];", explore)
explore = explore.replace("</body>", """<script>
// Links back to the tracker (and "+ Add to library") close the map instead of navigating.
document.addEventListener("click", function (e) {
  var a = e.target.closest && e.target.closest('a[href^="index.html"]');
  if (!a) return;
  e.preventDefault();
  var artist = new URL(a.getAttribute("href"), "http://x/").searchParams.get("addArtist");
  parent.__closeExplore();
  if (artist) parent.__albumTrackerAddArtist(artist);
});
</script>
</body>""")

html = sub_once(r'<link rel="stylesheet" href="styles.css">', "<style>\n" + read("styles.css") + "\n</style>", html)
html = sub_once(r'<link rel="manifest" href="manifest.json">\n', "", html)
html = sub_once(r'<link rel="icon" href="icon-192.png">', f'<link rel="icon" href="{icon}">', html)
html = sub_once(r'<link rel="apple-touch-icon" href="icon-192.png">', f'<link rel="apple-touch-icon" href="{icon}">', html)
html = sub_once(r'<a href="explore.html" class="btn-link"[^>]*>🌳 Explore</a>',
                '<button id="exploreBtn" type="button" title="Browse the rock influence map">🌳 Explore</button>', html)

boot = f"""<div id="exploreOverlay" hidden style="position:fixed;inset:0;z-index:100;background:#12131a;">
    <button type="button" onclick="__closeExplore()" style="position:fixed;top:12px;right:16px;z-index:101;">✕ Close map</button>
    <iframe id="exploreFrame" title="Rock family tree" style="border:0;width:100%;height:100%;"></iframe>
  </div>
  <script>window.EMBEDDED_BACKUP = {js_safe(json.dumps(backup, ensure_ascii=False)) if backup is not None else "null"};</script>
  <script>
{js_safe(read("influence-data.js"))}
  </script>
  <script>
{js_safe(app)}
  </script>
  <script>
  (function () {{
    var EXPLORE_HTML = {js_safe(json.dumps(explore, ensure_ascii=False))};
    var overlay = document.getElementById("exploreOverlay");
    var frame = document.getElementById("exploreFrame");
    document.getElementById("exploreBtn").addEventListener("click", function () {{
      frame.srcdoc = EXPLORE_HTML; // rebuilt each time so "in your library" marks are current
      overlay.hidden = false;
      document.body.style.overflow = "hidden";
    }});
    window.__closeExplore = function () {{
      overlay.hidden = true;
      frame.srcdoc = "";
      document.body.style.overflow = "";
    }};
  }})();
  </script>"""
html = sub_once(r'  <script src="influence-data.js"></script>\n  <script src="app.js[^"]*"></script>', boot, html)

open(out_path, "w", encoding="utf-8").write(html)
n = len(backup if isinstance(backup, list) else (backup or {}).get("albums", [])) if backup is not None else 0
print(f"wrote {out_path} ({os.path.getsize(out_path) // 1024} KB, {n} albums baked in)")
