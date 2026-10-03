// ---------- Storage ----------
const STORAGE_KEY = "albumTracker.library.v1";

function loadLibrary() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return parsed.map(normalizeAlbum);
  } catch (e) {
    console.error("Failed to load library", e);
    return [];
  }
}

// Brings an album saved by any older version (or from an old backup file) up
// to the current shape. Safe to run repeatedly.
function normalizeAlbum(a, idx) {
  // Old single-folder model (folderId) -> multi-folder (folderIds).
  const migrated = a.folderIds ? { ...a } : { ...a, folderIds: a.folderId ? [a.folderId] : [] };
  migrated.order = typeof migrated.order === "number" ? migrated.order : idx;
  // Custom order is kept separately per view: "all", "folder:<id>", "artist:<name>".
  if (!migrated.customOrder || typeof migrated.customOrder !== "object") migrated.customOrder = {};
  if (typeof migrated.customOrder.all !== "number") migrated.customOrder.all = migrated.order;
  migrated.lastListened = migrated.lastListened || null;

  // Ratings used to be whole stars where 0 meant "not rated". Now 0-5 in half
  // steps is allowed (0 is a real rating) and null means "not rated".
  if (migrated.ratingScale !== 2) {
    migrated.rating = migrated.rating > 0 ? migrated.rating : null;
    migrated.ratingScale = 2;
  }
  if (migrated.rating != null) migrated.rating = clampRating(migrated.rating);

  // Genre used to be a single free-text field; now it's a list of tags.
  // `genre` is kept as a comma-joined copy for anything that still reads it.
  if (!Array.isArray(migrated.genres)) {
    migrated.genres = splitTags(migrated.genre || "");
  }
  migrated.genre = migrated.genres.join(", ");
  if (!Array.isArray(migrated.tags)) migrated.tags = [];
  return migrated;
}

function saveLibrary() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
  } catch (e) {
    console.error("Failed to save library", e);
    alert("Couldn't save your library (browser storage is full or blocked). Use Export to download a backup.");
  }
}

// Ask the browser not to evict our data under storage pressure.
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}

// ---------- Ratings (0-5 in half-star steps, null = not rated) ----------
function clampRating(r) {
  return Math.min(5, Math.max(0, Math.round(Number(r) * 2) / 2));
}
function isRated(a) {
  return typeof a.rating === "number";
}
function formatRating(r) {
  return typeof r === "number" ? `${r % 1 ? r.toFixed(1) : r}★` : "Not rated";
}
// Read-only star display that can show halves (CSS paints the filled part).
function starsHtml(r, extraClass = "") {
  const rated = typeof r === "number";
  const pct = rated ? (r / 5) * 100 : 0;
  const label = rated ? `${r} out of 5 stars` : "Not rated";
  return `<span class="stars-display${rated ? "" : " unrated"} ${extraClass}" style="--pct:${pct}%" title="${label}" aria-label="${label}">★★★★★</span>`;
}

// ---------- Tags ----------
const QUICK_TAGS = ["masterpiece", "great", "good", "ok", "meh", "bad", "overrated", "underrated", "grower", "relisten"];

function splitTags(str) {
  return (str || "")
    .split(/[,/;]/)
    .map((t) => t.trim())
    .filter(Boolean);
}
function addUniqueTag(list, tag) {
  const clean = (tag || "").trim().replace(/\s+/g, " ");
  if (!clean) return list;
  if (list.some((t) => t.toLowerCase() === clean.toLowerCase())) return list;
  return [...list, clean];
}

// ---------- Folders ----------
const FOLDERS_KEY = "albumTracker.folders.v1";

const DEFAULT_FOLDER_COLOR = "#7c9cff";

function loadFolders() {
  try {
    const raw = localStorage.getItem(FOLDERS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    // Backfill icon/color for folders created before those existed.
    return parsed.map((f) => ({
      icon: f.icon || "📁",
      color: f.color || DEFAULT_FOLDER_COLOR,
      ...f,
    }));
  } catch (e) {
    console.error("Failed to load folders", e);
    return [];
  }
}

function saveFolders() {
  localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
}

let library = loadLibrary();
let folders = loadFolders();
let editingId = null; // null = adding new album
let currentTracks = []; // working tracklist while modal is open

// ---------- View state ----------
let currentFolderFilter = "all"; // "all" | "unsorted" | folderId
let viewMode = "albums"; // "albums" | "artists"
let activeArtistFilter = null; // set when drilled into a specific artist

// ---------- JSONP helper (avoids CORS issues, works from file://) ----------
let jsonpCounter = 0;
function jsonp(url) {
  return new Promise((resolve, reject) => {
    const callbackName = "__albumTrackerCb" + Date.now() + (jsonpCounter++);
    const script = document.createElement("script");
    const cleanup = () => {
      delete window[callbackName];
      script.remove();
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Request timed out"));
    }, 10000);

    window[callbackName] = (data) => {
      clearTimeout(timeout);
      cleanup();
      resolve(data);
    };

    script.src = url + (url.includes("?") ? "&" : "?") + "callback=" + callbackName;
    script.onerror = () => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error("Network error"));
    };
    document.body.appendChild(script);
  });
}

// ---------- DOM refs ----------
const libraryEl = document.getElementById("library");
const emptyStateEl = document.getElementById("emptyState");
const searchBox = document.getElementById("searchBox");
const sortSelect = document.getElementById("sortSelect");

const modal = document.getElementById("albumModal");
const modalTitle = document.getElementById("modalTitle");
const artistInput = document.getElementById("artistInput");
const titleInput = document.getElementById("titleInput");
const yearInput = document.getElementById("yearInput");
const genreInput = document.getElementById("genreInput");
const notesInput = document.getElementById("notesInput");
const timesListenedInput = document.getElementById("timesListenedInput");
const coverPreview = document.getElementById("coverPreview");
const coverPlaceholder = document.getElementById("coverPlaceholder");
const ratingStarsEl = document.getElementById("ratingStars");
const trackListEl = document.getElementById("trackList");
const newTrackInput = document.getElementById("newTrackInput");
const autofillStatus = document.getElementById("autofillStatus");
const candidateListEl = document.getElementById("candidateList");
const deleteAlbumBtn = document.getElementById("deleteAlbumBtn");
const ratingHistorySection = document.getElementById("ratingHistorySection");
const ratingHistoryListEl = document.getElementById("ratingHistoryList");
const statsModal = document.getElementById("statsModal");
const statsBody = document.getElementById("statsBody");
const forYouModal = document.getElementById("forYouModal");
const forYouBody = document.getElementById("forYouBody");
const folderFilterEl = document.getElementById("folderFilter");
const folderCheckboxListEl = document.getElementById("folderCheckboxList");
const spotifyLinkEl = document.getElementById("spotifyLink");
const foldersModal = document.getElementById("foldersModal");
const foldersListEl = document.getElementById("foldersList");
const newFolderInput = document.getElementById("newFolderInput");
const newFolderIcon = document.getElementById("newFolderIcon");
const newFolderColor = document.getElementById("newFolderColor");
const activeFilterChip = document.getElementById("activeFilterChip");
const activeFilterText = document.getElementById("activeFilterText");
const viewAlbumsBtn = document.getElementById("viewAlbumsBtn");
const viewArtistsBtn = document.getElementById("viewArtistsBtn");
const lastListenedText = document.getElementById("lastListenedText");
const selectModeBtn = document.getElementById("selectModeBtn");
const bulkActionBar = document.getElementById("bulkActionBar");
const bulkSelectedCount = document.getElementById("bulkSelectedCount");
const bulkFolderSelect = document.getElementById("bulkFolderSelect");
const lastfmModal = document.getElementById("lastfmModal");
const lastfmKeyInput = document.getElementById("lastfmKeyInput");
const ratingValueEl = document.getElementById("ratingValue");
const genreChipsEl = document.getElementById("genreChips");
const tagChipsEl = document.getElementById("tagChips");
const tagInput = document.getElementById("tagInput");
const quickTagsEl = document.getElementById("quickTags");
const tagFilterEl = document.getElementById("tagFilter");
const formatInput = document.getElementById("formatInput");
const recommendedByInput = document.getElementById("recommendedByInput");
const firstListenedInput = document.getElementById("firstListenedInput");
const trackSummaryEl = document.getElementById("trackSummary");
const customOrderHintEl = document.getElementById("customOrderHint");

let currentRating = null;
let currentGenres = [];
let genreWasAutoFilled = false; // true while the genre chips came from a search pick
let currentTags = [];
let currentCoverUrl = "";
let selectMode = false;
let selectedIds = new Set();

// ---------- Rendering: library grid ----------
function renderLibrary() {
  updateActiveFilterChip();
  updateCustomOrderHint();

  const tagFilter = tagFilterEl.value;
  const folderScoped = library.filter((a) => {
    if (tagFilter && !albumHasTag(a, tagFilter)) return false;
    if (currentFolderFilter === "all") return true;
    if (currentFolderFilter === "unsorted") return (a.folderIds || []).length === 0;
    return (a.folderIds || []).includes(currentFolderFilter);
  });

  if (activeArtistFilter) {
    renderAlbumCards(sortAlbums(folderScoped.filter((a) => a.artist === activeArtistFilter)));
    return;
  }

  const query = searchBox.value.trim().toLowerCase();

  if (viewMode === "artists") {
    renderArtistCards(folderScoped, query);
    return;
  }

  let items = folderScoped.filter((a) => {
    if (!query) return true;
    return [a.title, a.artist, ...(a.genres || []), ...(a.tags || []), a.recommendedBy]
      .some((field) => (field || "").toLowerCase().includes(query));
  });

  renderAlbumCards(sortAlbums(items));
}

function sortAlbums(items) {
  if (isCustomSort()) return sortByCustomOrder(items, customOrderKey());
  const [sortKey, sortDir] = sortSelect.value.split("-");
  return items.sort((a, b) => {
    // Unrated albums always go to the bottom, whichever direction you sort ratings.
    if (sortKey === "rating" && isRated(a) !== isRated(b)) return isRated(a) ? -1 : 1;
    let va = a[sortKey];
    let vb = b[sortKey];
    if (sortKey === "title" || sortKey === "artist") {
      va = (va || "").toLowerCase();
      vb = (vb || "").toLowerCase();
    } else if (sortKey === "lastListened") {
      // Nulls sort as "" — naturally lands last under "most recent first".
      va = va || "";
      vb = vb || "";
    }
    if (va < vb) return sortDir === "asc" ? -1 : 1;
    if (va > vb) return sortDir === "asc" ? 1 : -1;
    return 0;
  });
}

// ---------- Custom order (per folder / per artist) ----------
// Every view keeps its own arrangement: the whole library, each folder, the
// "Unsorted" view and each artist. Positions live on the album itself
// (album.customOrder[key]) so they're included in Export/Import backups.
function isCustomSort() {
  return sortSelect.value === "order-asc";
}

function customOrderKey() {
  if (activeArtistFilter) return "artist:" + normText(activeArtistFilter);
  if (currentFolderFilter !== "all") return "folder:" + currentFolderFilter;
  return "all";
}

function customOrderLabel() {
  if (activeArtistFilter) return `albums by ${activeArtistFilter}`;
  if (currentFolderFilter === "unsorted") return "the Unsorted view";
  if (currentFolderFilter !== "all") {
    const f = folders.find((x) => x.id === currentFolderFilter);
    return f ? `the "${f.name}" folder` : "this folder";
  }
  return "your whole library";
}

// Albums never arranged in this view go after the arranged ones, following
// the library-wide order, then the date they were added.
function sortByCustomOrder(items, key) {
  const pos = (a) => (a.customOrder && typeof a.customOrder[key] === "number" ? a.customOrder[key] : null);
  const allPos = (a) => (a.customOrder && typeof a.customOrder.all === "number" ? a.customOrder.all : Infinity);
  return items.sort((a, b) => {
    const pa = pos(a);
    const pb = pos(b);
    if ((pa === null) !== (pb === null)) return pa === null ? 1 : -1;
    if (pa !== null && pa !== pb) return pa - pb;
    if (allPos(a) !== allPos(b)) return allPos(a) - allPos(b);
    return (a.dateAdded || "").localeCompare(b.dateAdded || "");
  });
}

// Every album that belongs to the current view, ignoring the search box and
// tag filter, so reordering a filtered subset doesn't scramble the rest.
function albumsInOrderContext() {
  if (activeArtistFilter) return library.filter((a) => a.artist === activeArtistFilter);
  if (currentFolderFilter === "unsorted") return library.filter((a) => (a.folderIds || []).length === 0);
  if (currentFolderFilter !== "all") return library.filter((a) => (a.folderIds || []).includes(currentFolderFilter));
  return [...library];
}

function updateCustomOrderHint() {
  const show = isCustomSort() && !selectMode;
  customOrderHintEl.hidden = !show;
  if (!show) return;
  customOrderHintEl.textContent =
    viewMode === "artists" && !activeArtistFilter
      ? "Custom order: open an artist to arrange their albums. Each artist and each folder keeps its own order."
      : `Custom order for ${customOrderLabel()}: drag albums, or use the ◀ ▶ buttons. Each folder and each artist keeps its own order.`;
}

function setEmptyMessage(isEmpty, filteredMessage) {
  if (!isEmpty) {
    emptyStateEl.hidden = true;
    return;
  }
  emptyStateEl.hidden = false;
  emptyStateEl.textContent =
    library.length === 0 ? 'No albums yet. Click "+ Add Album" to log your first one.' : filteredMessage;
}

function renderAlbumCards(items) {
  libraryEl.className = selectMode ? "library-grid select-mode" : "library-grid";
  libraryEl.innerHTML = "";
  setEmptyMessage(items.length === 0, "No albums match the current filters.");

  const dragEnabled = !selectMode && isCustomSort();

  items.forEach((album, idx) => {
    const card = document.createElement("div");
    card.className = "album-card" + (selectedIds.has(album.id) ? " selected" : "");
    card.dataset.id = album.id;

    if (selectMode) {
      card.addEventListener("click", () => toggleCardSelection(album.id));
    } else {
      card.addEventListener("click", () => openModal(album.id));
    }

    const coverHtml = album.coverUrl
      ? `<img src="${escapeAttr(album.coverUrl)}" alt="${escapeAttr(album.title)}">`
      : `<div class="no-cover">🎵</div>`;

    const favTrack = (album.tracklist || []).find((t) => t.favorite);
    const chipsHtml = [
      ...(album.genres || []).map((g) => `<span class="chip genre">${escapeHtml(g)}</span>`),
      ...(album.tags || []).map((t) => `<span class="chip">${escapeHtml(t)}</span>`),
    ].join("");
    const folderObjs = currentFolderFilter === "all" ? (album.folderIds || []).map((id) => folders.find((f) => f.id === id)).filter(Boolean) : [];
    const folderTagsHtml = folderObjs.length
      ? `<div class="folder-tags">${folderObjs
          .map(
            (f) =>
              `<span class="folder-tag" style="border-color:${escapeAttr(f.color)};color:${escapeAttr(f.color)};">${f.icon} ${escapeHtml(f.name)}</span>`
          )
          .join("")}</div>`
      : "";
    const spotifyUrl = `https://open.spotify.com/search/${encodeURIComponent(`${album.artist} ${album.title}`.trim())}`;

    const checkboxHtml = selectMode
      ? `<input type="checkbox" class="card-select-checkbox" ${selectedIds.has(album.id) ? "checked" : ""}>`
      : "";
    const quickListenHtml = selectMode
      ? ""
      : `<button type="button" class="card-quick-listen" title="Log a listen">+1</button>`;

    card.innerHTML = `
      ${coverHtml}
      ${checkboxHtml}
      ${selectMode ? "" : `<a class="card-spotify-link" href="${escapeAttr(spotifyUrl)}" target="_blank" rel="noopener noreferrer" title="Open in Spotify">🎧</a>`}
      ${quickListenHtml}
      <div class="album-card-info">
        <div class="album-card-title">${escapeHtml(album.title)}</div>
        <div class="album-card-artist">${escapeHtml(album.artist)}</div>
        <div class="album-card-meta">
          ${starsHtml(album.rating, "mini-stars")}
          <span>▶ ${album.timesListened || 0}</span>
        </div>
        ${favTrack ? `<div class="card-fav" title="Favorite track">♥ ${escapeHtml(favTrack.name)}</div>` : ""}
        ${chipsHtml ? `<div class="card-chips">${chipsHtml}</div>` : ""}
        ${folderTagsHtml}
        ${
          dragEnabled
            ? `<div class="card-move">
                <button type="button" data-move="-1" title="Move earlier" ${idx === 0 ? "disabled" : ""}>◀</button>
                <span>#${idx + 1}</span>
                <button type="button" data-move="1" title="Move later" ${idx === items.length - 1 ? "disabled" : ""}>▶</button>
              </div>`
            : ""
        }
      </div>
    `;
    const imgEl = card.querySelector("img");
    if (imgEl) {
      imgEl.addEventListener("error", () => {
        const fallback = document.createElement("div");
        fallback.className = "no-cover";
        fallback.textContent = "🎵";
        imgEl.replaceWith(fallback);
      });
    }
    const spotifyEl = card.querySelector(".card-spotify-link");
    if (spotifyEl) {
      spotifyEl.addEventListener("click", (e) => e.stopPropagation());
    }
    const checkboxEl = card.querySelector(".card-select-checkbox");
    if (checkboxEl) {
      checkboxEl.addEventListener("click", (e) => e.stopPropagation());
      checkboxEl.addEventListener("change", () => toggleCardSelection(album.id));
    }
    const quickListenEl = card.querySelector(".card-quick-listen");
    if (quickListenEl) {
      quickListenEl.addEventListener("click", (e) => {
        e.stopPropagation();
        quickIncrementListen(album.id);
      });
    }

    card.querySelectorAll(".card-move button").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const neighbor = items[idx + Number(btn.dataset.move)];
        if (neighbor) reorderAlbums(album.id, neighbor.id);
      });
    });

    if (dragEnabled) {
      card.draggable = true;
      card.addEventListener("dragstart", (e) => {
        card.classList.add("dragging");
        e.dataTransfer.setData("text/plain", album.id);
        e.dataTransfer.effectAllowed = "move";
      });
      card.addEventListener("dragend", () => card.classList.remove("dragging"));
      card.addEventListener("dragover", (e) => {
        e.preventDefault();
        card.classList.add("drag-over");
      });
      card.addEventListener("dragleave", () => card.classList.remove("drag-over"));
      card.addEventListener("drop", (e) => {
        e.preventDefault();
        card.classList.remove("drag-over");
        const draggedId = e.dataTransfer.getData("text/plain");
        if (draggedId && draggedId !== album.id) reorderAlbums(draggedId, album.id);
      });
    }

    libraryEl.appendChild(card);
  });
}

function toggleCardSelection(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  updateBulkBar();
  renderLibrary();
}

function updateBulkBar() {
  bulkActionBar.hidden = !selectMode;
  bulkSelectedCount.textContent = `${selectedIds.size} selected`;
}

function quickIncrementListen(id) {
  const album = library.find((a) => a.id === id);
  if (!album) return;
  album.timesListened = (album.timesListened || 0) + 1;
  album.lastListened = new Date().toISOString();
  const history = album.ratingHistory || [];
  history.push({ date: album.lastListened, rating: album.rating, timesListened: album.timesListened });
  album.ratingHistory = history;
  saveLibrary();
  renderLibrary();
}

// Moves an album to the target's spot in the current view's custom order
// (dropping onto a later album places it after that album, onto an earlier
// one places it before). Only this view's order changes.
function reorderAlbums(draggedId, targetId) {
  const key = customOrderKey();
  const ordered = sortByCustomOrder(albumsInOrderContext(), key);
  const fromIdx = ordered.findIndex((a) => a.id === draggedId);
  const toIdx = ordered.findIndex((a) => a.id === targetId);
  if (fromIdx === -1 || toIdx === -1) return;
  ordered.splice(toIdx, 0, ordered.splice(fromIdx, 1)[0]);
  ordered.forEach((album, i) => {
    album.customOrder = album.customOrder || {};
    album.customOrder[key] = i;
    if (key === "all") album.order = i;
  });
  saveLibrary();
  renderLibrary();
}

function renderArtistCards(albums, query) {
  libraryEl.className = "library-grid";
  libraryEl.innerHTML = "";

  const artistMap = new Map();
  albums.forEach((a) => {
    const name = (a.artist || "Unknown").trim();
    const key = name.toLowerCase();
    if (!artistMap.has(key)) artistMap.set(key, { name, albums: [] });
    artistMap.get(key).albums.push(a);
  });

  let artistList = [...artistMap.values()];
  if (query) {
    artistList = artistList.filter((e) => e.name.toLowerCase().includes(query));
  }
  artistList.sort((a, b) => a.name.localeCompare(b.name));

  setEmptyMessage(artistList.length === 0, "No artists match the current filters.");

  artistList.forEach((entry) => {
    const cover = entry.albums.find((a) => a.coverUrl)?.coverUrl;
    const ratedAlbums = entry.albums.filter(isRated);
    const avgRating = ratedAlbums.length
      ? (ratedAlbums.reduce((s, a) => s + a.rating, 0) / ratedAlbums.length).toFixed(1)
      : null;

    const card = document.createElement("div");
    card.className = "album-card";
    card.addEventListener("click", () => {
      activeArtistFilter = entry.name;
      renderLibrary();
    });

    const coverHtml = cover
      ? `<img src="${escapeAttr(cover)}" alt="${escapeAttr(entry.name)}">`
      : `<div class="no-cover">🎤</div>`;

    card.innerHTML = `
      ${coverHtml}
      <div class="album-card-info">
        <div class="album-card-title">${escapeHtml(entry.name)}</div>
        <div class="album-card-artist">${entry.albums.length} album${entry.albums.length === 1 ? "" : "s"}</div>
        <div class="album-card-meta">
          <span class="mini-stars">${avgRating ? "★ " + avgRating : ""}</span>
        </div>
      </div>
    `;
    const imgEl = card.querySelector("img");
    if (imgEl) {
      imgEl.addEventListener("error", () => {
        const fallback = document.createElement("div");
        fallback.className = "no-cover";
        fallback.textContent = "🎤";
        imgEl.replaceWith(fallback);
      });
    }
    libraryEl.appendChild(card);
  });
}

function updateActiveFilterChip() {
  if (activeArtistFilter) {
    activeFilterChip.hidden = false;
    activeFilterText.textContent = `Artist: ${activeArtistFilter}`;
  } else {
    activeFilterChip.hidden = true;
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

// ---------- Star rating widget (half stars) ----------
// Each star has an invisible left and right half: clicking the left half of
// star 3 gives 2.5, the right half gives 3. Clicking the current value again
// clears it. Arrow keys step by half a star.
function paintStars(value) {
  const v = typeof value === "number" ? value : 0;
  ratingStarsEl.querySelectorAll(".hs-star").forEach((star, i) => {
    const fill = Math.max(0, Math.min(1, v - i));
    star.querySelector(".hs-fill").style.width = fill * 100 + "%";
  });
}

function setRating(value) {
  currentRating = value == null ? null : clampRating(value);
  renderStars();
}

function renderStars() {
  if (!ratingStarsEl.dataset.built) {
    ratingStarsEl.dataset.built = "1";
    for (let i = 1; i <= 5; i++) {
      const star = document.createElement("span");
      star.className = "hs-star";
      star.innerHTML = `☆<span class="hs-fill">★</span><span class="hs-half left"></span><span class="hs-half right"></span>`;
      [[".left", i - 0.5], [".right", i]].forEach(([sel, val]) => {
        const half = star.querySelector(".hs-half" + sel);
        half.title = `${val} star${val === 1 ? "" : "s"}`;
        half.addEventListener("mouseenter", () => {
          paintStars(val);
          ratingValueEl.textContent = formatRating(val);
        });
        half.addEventListener("click", (e) => {
          e.preventDefault();
          setRating(currentRating === val ? null : val);
        });
      });
      ratingStarsEl.appendChild(star);
    }
    ratingStarsEl.addEventListener("mouseleave", renderStars);
    ratingStarsEl.addEventListener("keydown", (e) => {
      const cur = typeof currentRating === "number" ? currentRating : 0;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") setRating(Math.min(5, cur + 0.5));
      else if (e.key === "ArrowLeft" || e.key === "ArrowDown") setRating(Math.max(0, cur - 0.5));
      else if (e.key === "Home") setRating(0);
      else if (e.key === "End") setRating(5);
      else if (e.key === "Delete" || e.key === "Backspace") setRating(null);
      else return;
      e.preventDefault();
    });
  }
  paintStars(currentRating);
  ratingValueEl.textContent = typeof currentRating === "number" ? `${formatRating(currentRating)} / 5` : "Not rated";
  ratingStarsEl.setAttribute("aria-valuenow", typeof currentRating === "number" ? currentRating : 0);
  ratingStarsEl.setAttribute("aria-valuetext", formatRating(currentRating));
}

document.getElementById("ratingZeroBtn").addEventListener("click", () => setRating(0));
document.getElementById("ratingClearBtn").addEventListener("click", () => setRating(null));

// ---------- Genre + tag chip inputs ----------
function allUsedTags(field) {
  const counts = new Map();
  library.forEach((a) =>
    (a[field] || []).forEach((t) => {
      const key = t.toLowerCase();
      const entry = counts.get(key) || { name: t, count: 0 };
      entry.count++;
      counts.set(key, entry);
    })
  );
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function albumHasTag(album, filterValue) {
  const sep = filterValue.indexOf(":");
  const kind = filterValue.slice(0, sep);
  const name = filterValue.slice(sep + 1);
  const list = kind === "genre" ? album.genres : album.tags;
  return (list || []).some((t) => t.toLowerCase() === name);
}

function renderChips(container, input, list, className, onRemove) {
  container.querySelectorAll(".chip").forEach((c) => c.remove());
  list.forEach((tag, idx) => {
    const chip = document.createElement("span");
    chip.className = "chip " + className;
    chip.textContent = tag;
    const x = document.createElement("button");
    x.type = "button";
    x.textContent = "✕";
    x.title = `Remove "${tag}"`;
    x.addEventListener("click", () => onRemove(idx));
    chip.appendChild(x);
    container.insertBefore(chip, input);
  });
}

function renderGenreChips() {
  renderChips(genreChipsEl, genreInput, currentGenres, "genre", (idx) => {
    genreWasAutoFilled = false;
    currentGenres.splice(idx, 1);
    renderGenreChips();
  });
}

function renderTagChips() {
  // Quick-pick tags show as toggles; anything else shows as a removable chip.
  const quickLower = QUICK_TAGS.map((t) => t.toLowerCase());
  quickTagsEl.innerHTML = "";
  QUICK_TAGS.forEach((tag) => {
    const on = currentTags.some((t) => t.toLowerCase() === tag);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "quick-tag" + (on ? " on" : "");
    btn.textContent = tag;
    btn.addEventListener("click", () => {
      currentTags = on ? currentTags.filter((t) => t.toLowerCase() !== tag) : addUniqueTag(currentTags, tag);
      renderTagChips();
    });
    quickTagsEl.appendChild(btn);
  });
  const custom = currentTags.filter((t) => !quickLower.includes(t.toLowerCase()));
  renderChips(tagChipsEl, tagInput, custom, "", (idx) => {
    const removed = custom[idx];
    currentTags = currentTags.filter((t) => t !== removed);
    renderTagChips();
  });
}

function commitChipInput(input, kind) {
  const parts = splitTags(input.value);
  if (!parts.length) return false;
  parts.forEach((p) => {
    if (kind === "genre") {
      currentGenres = addUniqueTag(currentGenres, p);
      genreWasAutoFilled = false;
    }
    else currentTags = addUniqueTag(currentTags, p);
  });
  input.value = "";
  kind === "genre" ? renderGenreChips() : renderTagChips();
  return true;
}

[[genreInput, "genre"], [tagInput, "tag"]].forEach(([input, kind]) => {
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitChipInput(input, kind);
    } else if (e.key === "Backspace" && !input.value) {
      if (kind === "genre" && currentGenres.length) {
        currentGenres.pop();
        renderGenreChips();
      } else if (kind === "tag" && currentTags.length) {
        currentTags.pop();
        renderTagChips();
      }
    }
  });
  // Picking from the suggestion dropdown fires "input" with the full value.
  input.addEventListener("change", () => commitChipInput(input, kind));
  input.addEventListener("blur", () => commitChipInput(input, kind));
});

function refreshTagSuggestions() {
  document.getElementById("genreSuggestions").innerHTML = allUsedTags("genres")
    .map((t) => `<option value="${escapeAttr(t.name)}">`)
    .join("");
  document.getElementById("tagSuggestions").innerHTML = allUsedTags("tags")
    .filter((t) => !QUICK_TAGS.includes(t.name.toLowerCase()))
    .map((t) => `<option value="${escapeAttr(t.name)}">`)
    .join("");
}

function renderTagFilterOptions() {
  const prev = tagFilterEl.value;
  const genres = allUsedTags("genres");
  const tags = allUsedTags("tags");
  tagFilterEl.innerHTML =
    `<option value="">All genres &amp; tags</option>` +
    (genres.length
      ? `<optgroup label="Genres">${genres
          .map((g) => `<option value="genre:${escapeAttr(g.name.toLowerCase())}">${escapeHtml(g.name)} (${g.count})</option>`)
          .join("")}</optgroup>`
      : "") +
    (tags.length
      ? `<optgroup label="Tags">${tags
          .map((t) => `<option value="tag:${escapeAttr(t.name.toLowerCase())}">${escapeHtml(t.name)} (${t.count})</option>`)
          .join("")}</optgroup>`
      : "");
  tagFilterEl.value = [...tagFilterEl.options].some((o) => o.value === prev) ? prev : "";
}

// ---------- Track list rendering ----------
function renderTrackSummary() {
  const favs = currentTracks.filter((t) => t.favorite);
  const least = currentTracks.filter((t) => t.least);
  const list = (items) => `<ul>${items.map((t) => `<li>${escapeHtml(t.name)}</li>`).join("")}</ul>`;
  trackSummaryEl.innerHTML =
    (favs.length ? `<div><h4>♥ Favorite tracks</h4>${list(favs)}</div>` : "") +
    (least.length ? `<div><h4>👎 Least favorite tracks</h4>${list(least)}</div>` : "");
}

function renderTrackList() {
  renderTrackSummary();
  trackListEl.innerHTML = "";
  if (currentTracks.length === 0) {
    trackListEl.innerHTML = `<li style="color:var(--text-dim); justify-content:center;">No tracks yet</li>`;
    return;
  }
  currentTracks.forEach((track, idx) => {
    const li = document.createElement("li");

    const nameSpan = document.createElement("span");
    nameSpan.className = "track-name";
    nameSpan.textContent = (idx + 1) + ". " + track.name;

    const favBtn = document.createElement("button");
    favBtn.type = "button";
    favBtn.className = "track-toggle" + (track.favorite ? " active-fav" : "");
    favBtn.textContent = "♥";
    favBtn.title = "Mark as favorite track";
    favBtn.addEventListener("click", () => {
      track.favorite = !track.favorite;
      if (track.favorite) track.least = false;
      renderTrackList();
    });

    const leastBtn = document.createElement("button");
    leastBtn.type = "button";
    leastBtn.className = "track-toggle" + (track.least ? " active-least" : "");
    leastBtn.textContent = "👎";
    leastBtn.title = "Mark as least-favorite track";
    leastBtn.addEventListener("click", () => {
      track.least = !track.least;
      if (track.least) track.favorite = false;
      renderTrackList();
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "track-remove";
    removeBtn.textContent = "✕";
    removeBtn.title = "Remove track";
    removeBtn.addEventListener("click", () => {
      currentTracks.splice(idx, 1);
      renderTrackList();
    });

    li.appendChild(nameSpan);
    li.appendChild(favBtn);
    li.appendChild(leastBtn);
    li.appendChild(removeBtn);
    trackListEl.appendChild(li);
  });
}

document.getElementById("addTrackBtn").addEventListener("click", addTrackManually);
newTrackInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addTrackManually();
  }
});
function addTrackManually() {
  const name = newTrackInput.value.trim();
  if (!name) return;
  currentTracks.push({ name, favorite: false, least: false });
  newTrackInput.value = "";
  renderTrackList();
}

// ---------- Modal open/close ----------
function openModal(id) {
  editingId = id || null;
  const album = id ? library.find((a) => a.id === id) : null;

  modalTitle.textContent = album ? "Edit Album" : "Add Album";
  deleteAlbumBtn.hidden = !album;

  artistInput.value = album?.artist || "";
  titleInput.value = album?.title || "";
  yearInput.value = album?.year || "";
  genreInput.value = "";
  tagInput.value = "";
  currentGenres = [...(album?.genres || [])];
  genreWasAutoFilled = false;
  currentTags = [...(album?.tags || [])];
  formatInput.value = album?.format || "";
  recommendedByInput.value = album?.recommendedBy || "";
  firstListenedInput.value = album?.firstListened || (album ? "" : new Date().toISOString().slice(0, 10));
  notesInput.value = album?.notes || "";
  timesListenedInput.value = album?.timesListened || 0;
  currentRating = album && isRated(album) ? album.rating : null;
  currentCoverUrl = album?.coverUrl || "";
  currentTracks = album ? JSON.parse(JSON.stringify(album.tracklist || [])) : [];
  autofillStatus.textContent = "";
  candidateListEl.innerHTML = "";
  coverPlaceholder.textContent = "No cover yet";
  populateAlbumFolderCheckboxes(album?.folderIds || []);
  updateSpotifyLink();
  lastListenedText.textContent = album?.lastListened
    ? `Last listened: ${new Date(album.lastListened).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`
    : "";

  updateCoverPreview();
  renderStars();
  renderGenreChips();
  renderTagChips();
  refreshTagSuggestions();
  renderTrackList();
  renderRatingHistory(album);

  modal.hidden = false;
}

function closeModal() {
  modal.hidden = true;
  editingId = null;
  searchSeq++; // drop any search still in flight for this form
  clearTimeout(autoSearchTimer);
}

function updateCoverPreview() {
  if (currentCoverUrl) {
    coverPreview.onerror = () => {
      currentCoverUrl = "";
      coverPlaceholder.textContent = "Cover art unavailable";
      updateCoverPreview();
    };
    coverPreview.src = currentCoverUrl;
    coverPreview.hidden = false;
    coverPlaceholder.hidden = true;
  } else {
    coverPreview.hidden = true;
    coverPlaceholder.hidden = false;
  }
}

function renderRatingHistory(album) {
  const history = album?.ratingHistory || [];
  if (!history.length) {
    ratingHistorySection.hidden = true;
    return;
  }
  ratingHistorySection.hidden = false;
  ratingHistoryListEl.innerHTML = "";
  [...history].reverse().forEach((entry) => {
    const li = document.createElement("li");
    const dateStr = new Date(entry.date).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    li.innerHTML = `
      <span class="rh-date">${escapeHtml(dateStr)}</span>
      <span class="rh-stars">${starsHtml(entry.rating)} ${typeof entry.rating === "number" ? formatRating(entry.rating) : ""}</span>
      <span class="rh-listens">▶ ${entry.timesListened}</span>
    `;
    ratingHistoryListEl.appendChild(li);
  });
}

document.getElementById("addAlbumBtn").addEventListener("click", () => openModal(null));
document.getElementById("closeModalBtn").addEventListener("click", closeModal);
document.getElementById("cancelBtn").addEventListener("click", closeModal);
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});

// ---------- Times listened counter ----------
document.getElementById("incrementBtn").addEventListener("click", () => {
  timesListenedInput.value = Math.max(0, (parseInt(timesListenedInput.value) || 0) + 1);
});
document.getElementById("decrementBtn").addEventListener("click", () => {
  timesListenedInput.value = Math.max(0, (parseInt(timesListenedInput.value) || 0) - 1);
});

// ---------- Save / Delete ----------
document.getElementById("saveAlbumBtn").addEventListener("click", () => {
  const artist = artistInput.value.trim();
  const title = titleInput.value.trim();
  if (!artist || !title) {
    alert("Please enter both an artist and an album title.");
    return;
  }

  // Anything still typed in the tag boxes counts, even without pressing Enter.
  commitChipInput(genreInput, "genre");
  commitChipInput(tagInput, "tag");

  const prevAlbum = editingId ? library.find((a) => a.id === editingId) : null;
  const prevHistory = prevAlbum?.ratingHistory || [];
  const newRating = currentRating;
  const newListens = Math.max(0, parseInt(timesListenedInput.value) || 0);
  const lastEntry = prevHistory[prevHistory.length - 1];
  const historyChanged = !lastEntry || lastEntry.rating !== newRating || lastEntry.timesListened !== newListens;
  const ratingHistory = historyChanged
    ? [...prevHistory, { date: new Date().toISOString(), rating: newRating, timesListened: newListens }]
    : prevHistory;

  const listensIncreased = !prevAlbum || newListens > (prevAlbum.timesListened || 0);
  const maxOrder = library.reduce((max, a) => Math.max(max, typeof a.order === "number" ? a.order : 0), -1);

  const albumData = {
    id: editingId || crypto.randomUUID(),
    artist,
    title,
    year: yearInput.value.trim(),
    genres: currentGenres,
    genre: currentGenres.join(", "),
    tags: currentTags,
    format: formatInput.value,
    recommendedBy: recommendedByInput.value.trim(),
    firstListened: firstListenedInput.value || null,
    notes: notesInput.value,
    timesListened: newListens,
    rating: currentRating,
    ratingScale: 2,
    coverUrl: currentCoverUrl,
    tracklist: currentTracks,
    folderIds: getSelectedFolderIds(),
    ratingHistory,
    lastListened: listensIncreased ? new Date().toISOString() : prevAlbum?.lastListened || null,
    order: typeof prevAlbum?.order === "number" ? prevAlbum.order : maxOrder + 1,
    customOrder: prevAlbum?.customOrder || { all: maxOrder + 1 },
    dateAdded: editingId
      ? library.find((a) => a.id === editingId).dateAdded
      : new Date().toISOString(),
  };

  if (editingId) {
    const idx = library.findIndex((a) => a.id === editingId);
    library[idx] = albumData;
  } else {
    library.push(albumData);
  }

  saveLibrary();
  renderTagFilterOptions();
  renderLibrary();
  closeModal();
});

deleteAlbumBtn.addEventListener("click", () => {
  if (!editingId) return;
  if (!confirm("Delete this album from your library? This can't be undone.")) return;
  library = library.filter((a) => a.id !== editingId);
  saveLibrary();
  renderTagFilterOptions();
  renderLibrary();
  closeModal();
});

// ---------- Folders ----------
function renderFolderFilterOptions() {
  const prev = folderFilterEl.value || currentFolderFilter;
  folderFilterEl.innerHTML =
    `<option value="all">All Folders</option><option value="unsorted">Unsorted</option>` +
    folders.map((f) => `<option value="${escapeAttr(f.id)}">${f.icon} ${escapeHtml(f.name)}</option>`).join("");
  if ([...folderFilterEl.options].some((o) => o.value === prev)) {
    folderFilterEl.value = prev;
  } else {
    folderFilterEl.value = "all";
    currentFolderFilter = "all";
  }
}

function populateAlbumFolderCheckboxes(selectedFolderIds) {
  if (folders.length === 0) {
    folderCheckboxListEl.innerHTML = `<p class="hint" style="margin:0;">No folders yet — create one from "📁 Folders" in the header.</p>`;
    return;
  }
  folderCheckboxListEl.innerHTML = folders
    .map(
      (f) => `
        <label class="folder-checkbox-row">
          <input type="checkbox" value="${escapeAttr(f.id)}" ${selectedFolderIds.includes(f.id) ? "checked" : ""}>
          <span class="dot" style="background:${escapeAttr(f.color)};width:8px;height:8px;border-radius:50%;display:inline-block;"></span>
          ${f.icon} ${escapeHtml(f.name)}
        </label>
      `
    )
    .join("");
}

function getSelectedFolderIds() {
  return Array.from(folderCheckboxListEl.querySelectorAll('input[type="checkbox"]:checked')).map((cb) => cb.value);
}

function updateSpotifyLink() {
  const artist = artistInput.value.trim();
  const title = titleInput.value.trim();
  if (!artist && !title) {
    spotifyLinkEl.href = "#";
    spotifyLinkEl.classList.add("disabled");
    return;
  }
  spotifyLinkEl.classList.remove("disabled");
  spotifyLinkEl.href = `https://open.spotify.com/search/${encodeURIComponent(`${artist} ${title}`.trim())}`;
}

artistInput.addEventListener("input", updateSpotifyLink);
titleInput.addEventListener("input", updateSpotifyLink);

function renderFoldersList() {
  foldersListEl.innerHTML = "";
  if (folders.length === 0) {
    foldersListEl.innerHTML = `<li class="folders-empty">No folders yet. Add one above.</li>`;
    return;
  }
  folders.forEach((f) => {
    const count = library.filter((a) => (a.folderIds || []).includes(f.id)).length;
    const li = document.createElement("li");
    li.className = "folder-row";
    li.innerHTML = `
      <input class="folder-icon-input" type="text" maxlength="2" value="${escapeAttr(f.icon)}">
      <input class="folder-name-input" type="text" value="${escapeAttr(f.name)}">
      <input class="folder-color-input" type="color" value="${escapeAttr(f.color)}" title="Folder color">
      <span class="folder-count">${count} album${count === 1 ? "" : "s"}</span>
      <button class="folder-delete-btn" type="button" title="Delete folder">🗑</button>
    `;

    const nameInput = li.querySelector(".folder-name-input");
    nameInput.addEventListener("change", () => {
      const newName = nameInput.value.trim();
      if (!newName) {
        nameInput.value = f.name;
        return;
      }
      f.name = newName;
      saveFolders();
      renderFolderFilterOptions();
      renderLibrary();
    });

    const iconInput = li.querySelector(".folder-icon-input");
    iconInput.addEventListener("change", () => {
      f.icon = iconInput.value.trim() || "📁";
      iconInput.value = f.icon;
      saveFolders();
      renderFolderFilterOptions();
      renderLibrary();
    });

    const colorInput = li.querySelector(".folder-color-input");
    colorInput.addEventListener("change", () => {
      f.color = colorInput.value;
      saveFolders();
      renderLibrary();
    });

    li.querySelector(".folder-delete-btn").addEventListener("click", () => {
      if (!confirm(`Delete folder "${f.name}"? Albums inside will just be removed from it — they won't be deleted.`)) return;
      library.forEach((a) => {
        a.folderIds = (a.folderIds || []).filter((id) => id !== f.id);
        if (a.customOrder) delete a.customOrder["folder:" + f.id];
      });
      folders = folders.filter((x) => x.id !== f.id);
      saveFolders();
      saveLibrary();
      if (currentFolderFilter === f.id) currentFolderFilter = "all";
      renderFolderFilterOptions();
      renderFoldersList();
      populateBulkFolderSelect();
      renderLibrary();
    });

    foldersListEl.appendChild(li);
  });
}

function addFolder() {
  const name = newFolderInput.value.trim();
  if (!name) return;
  folders.push({
    id: crypto.randomUUID(),
    name,
    icon: newFolderIcon.value.trim() || "📁",
    color: newFolderColor.value || DEFAULT_FOLDER_COLOR,
  });
  saveFolders();
  newFolderInput.value = "";
  newFolderIcon.value = "";
  newFolderColor.value = DEFAULT_FOLDER_COLOR;
  renderFolderFilterOptions();
  renderFoldersList();
  populateBulkFolderSelect();
}

document.getElementById("addFolderBtn").addEventListener("click", addFolder);
newFolderInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addFolder();
  }
});

document.getElementById("manageFoldersBtn").addEventListener("click", () => {
  renderFoldersList();
  foldersModal.hidden = false;
});
document.getElementById("closeFoldersBtn").addEventListener("click", () => (foldersModal.hidden = true));
foldersModal.addEventListener("click", (e) => {
  if (e.target === foldersModal) foldersModal.hidden = true;
});

folderFilterEl.addEventListener("change", (e) => {
  currentFolderFilter = e.target.value;
  activeArtistFilter = null;
  renderLibrary();
});

// ---------- View mode: Albums / Artists ----------
function updateViewToggleUI() {
  viewAlbumsBtn.classList.toggle("active", viewMode === "albums");
  viewArtistsBtn.classList.toggle("active", viewMode === "artists");
}

viewAlbumsBtn.addEventListener("click", () => {
  viewMode = "albums";
  activeArtistFilter = null;
  updateViewToggleUI();
  renderLibrary();
});
viewArtistsBtn.addEventListener("click", () => {
  viewMode = "artists";
  activeArtistFilter = null;
  updateViewToggleUI();
  renderLibrary();
});

document.getElementById("clearFilterBtn").addEventListener("click", () => {
  activeArtistFilter = null;
  renderLibrary();
});

// ---------- Bulk selection ----------
function populateBulkFolderSelect() {
  bulkFolderSelect.innerHTML =
    `<option value="">Add to folder...</option>` +
    folders.map((f) => `<option value="${escapeAttr(f.id)}">${f.icon} ${escapeHtml(f.name)}</option>`).join("");
}

selectModeBtn.addEventListener("click", () => {
  selectMode = !selectMode;
  selectModeBtn.classList.toggle("active", selectMode);
  if (selectMode) {
    viewMode = "albums";
    activeArtistFilter = null;
    updateViewToggleUI();
    populateBulkFolderSelect();
  } else {
    selectedIds.clear();
  }
  updateBulkBar();
  renderLibrary();
});

document.getElementById("bulkCancelBtn").addEventListener("click", () => {
  selectMode = false;
  selectModeBtn.classList.remove("active");
  selectedIds.clear();
  updateBulkBar();
  renderLibrary();
});

document.getElementById("bulkAddToFolderBtn").addEventListener("click", () => {
  const folderId = bulkFolderSelect.value;
  if (!folderId || selectedIds.size === 0) return;
  library.forEach((a) => {
    if (!selectedIds.has(a.id)) return;
    a.folderIds = a.folderIds || [];
    if (!a.folderIds.includes(folderId)) a.folderIds.push(folderId);
  });
  saveLibrary();
  bulkFolderSelect.value = "";
  renderLibrary();
});

document.getElementById("bulkDeleteBtn").addEventListener("click", () => {
  if (selectedIds.size === 0) return;
  if (!confirm(`Delete ${selectedIds.size} selected album${selectedIds.size === 1 ? "" : "s"}? This can't be undone.`)) return;
  library = library.filter((a) => !selectedIds.has(a.id));
  selectedIds.clear();
  saveLibrary();
  renderTagFilterOptions();
  updateBulkBar();
  renderLibrary();
});

// ---------- Auto-fill: search iTunes + MusicBrainz, let the user pick ----------
document.getElementById("autofillBtn").addEventListener("click", autofillSearch);

function levenshtein(a, b) {
  const m = a.length,
    n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function textSimilarity(a, b) {
  a = (a || "").toLowerCase().trim();
  b = (b || "").toLowerCase().trim();
  if (!a || !b) return 0;
  if (a === b) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

// ---------- Candidate ranking ----------
// Lowercase, strip accents and punctuation, "&" -> "and", so "Sgt. Pepper's"
// and "sgt peppers" compare as equal.
function normText(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const EDITION_WORDS = /deluxe|remaster|edition|expanded|anniversary|bonus|version|reissue|explicit|clean|mono|stereo|special|collector|super/i;
// Title with "(Deluxe Edition)", "[2011 Remaster]", " - Single" etc removed,
// so the plain album name is what gets compared against the query.
function baseTitle(title) {
  return (title || "")
    .replace(/\s*[\(\[]([^\)\]]*)[\)\]]/g, (m, inner) => (EDITION_WORDS.test(inner) ? "" : m))
    .replace(/\s+-\s+(single|ep)\s*$/i, "")
    .replace(/\s+[-–:]\s+([^-–:]*)$/, (m, tail) => (EDITION_WORDS.test(tail) ? "" : m))
    .trim();
}

// Deluxe / remastered / anniversary / expanded etc. Anything that isn't the
// plain studio release. "Deluxe" or "Remastered" anywhere counts, as does an
// edition word in brackets or after a dash ("Abbey Road (Super Deluxe Edition)",
// "Rumours - 35th Anniversary"). Bare words like "Version" only count when
// bracketed, so an album actually titled "...Version..." isn't flagged.
const STRONG_EDITION_RE = /\b(deluxe|remaster(ed)?|expanded|anniversary|collector'?s|super deluxe|bonus tracks?|reissue)\b/i;
function isEditionTitle(title) {
  const t = title || "";
  return STRONG_EDITION_RE.test(t) || baseTitle(t) !== t.replace(/\s+-\s+(single|ep)\s*$/i, "").trim();
}

const JUNK_RE = /karaoke|tribute|made famous|in the style of|lullaby|8[- ]?bit|piano versions?|string quartet|cover versions?|as performed by|instrumental versions/i;
const LIVE_COMP_RE = /\blive\b|greatest hits|best of|anthology|collection|remix(es)?|essentials|b-sides/i;

function tokens(s) {
  return normText(s).split(" ").filter(Boolean);
}

// How well a candidate matches what was typed, 0..~1.1. This decides list
// order, so the album you meant should land at the top instead of somewhere
// under deluxe reissues, singles and karaoke knock-offs.
function scoreCandidate(c, queryArtist, queryTitle) {
  const qTitle = normText(queryTitle);
  const qArtist = normText(queryArtist);
  const qAll = `${qArtist} ${qTitle}`.trim();
  const cTitle = normText(baseTitle(c.title));
  const cArtist = normText(c.artist);

  // 1. Direct field-by-field similarity.
  let match = 0;
  if (qTitle) {
    const titleSim = Math.max(textSimilarity(cTitle, qTitle), textSimilarity(normText(c.title), qTitle));
    match = qArtist ? titleSim * 0.6 + textSimilarity(cArtist, qArtist) * 0.4 : titleSim;
  } else if (qArtist) {
    match = textSimilarity(cArtist, qArtist);
  }

  // 2. Word overlap, which catches "radiohead ok computer" typed into one box,
  // or words typed in a different order. Also checks the album title isn't
  // much longer than what was typed.
  const qTok = tokens(qAll);
  const cTok = new Set([...tokens(cTitle), ...tokens(cArtist)]);
  const titleTok = tokens(cTitle);
  if (qTok.length && titleTok.length) {
    const coverage = qTok.filter((t) => cTok.has(t)).length / qTok.length;
    const titleCovered = titleTok.filter((t) => qTok.includes(t)).length / titleTok.length;
    match = Math.max(match, (coverage * 0.6 + titleCovered * 0.4) * 0.97);
  }

  // 3. Penalties for things that are rarely what you're looking for, unless
  // you actually typed that word (e.g. searching "live at leeds").
  const rawTitle = c.title || "";
  const typed = (re) => re.test(qAll);
  let penalty = 0;
  if (JUNK_RE.test(rawTitle) || JUNK_RE.test(c.artist || "")) penalty += 0.4;
  if (c.kind === "Single" || c.kind === "EP") penalty += 0.15;
  if ((c.kind === "Live" || c.kind === "Compilation" || c.kind === "Other" || LIVE_COMP_RE.test(rawTitle)) && !typed(LIVE_COMP_RE))
    penalty += 0.12;
  // Deluxe/remastered editions sit clearly below the studio album unless you
  // typed an edition word yourself ("in rainbows deluxe").
  if (isEditionTitle(rawTitle) && !typed(EDITION_WORDS)) penalty += 0.25;
  if (c.trackCount && c.trackCount <= 3) penalty += 0.08;

  // 4. Small nudges for signals of "the well-known release": the source's
  // own relevance/popularity order, and both sources agreeing it exists.
  const bonus = (1 - (c.rank ?? 1)) * 0.08 + (c.sources && c.sources.size > 1 ? 0.06 : 0);

  return match - penalty + bonus;
}

function rankCandidates(candidates, queryArtist, queryTitle) {
  candidates.forEach((c) => (c.score = scoreCandidate(c, queryArtist, queryTitle)));
  // Keep every version of the same album together, ranked by the best-scoring
  // one, and always put the plain studio release first within that group, so
  // a deluxe edition can never sit above its own standard album.
  const groupKey = (c) => normText(c.artist) + "|" + normText(baseTitle(c.title));
  const groupBest = new Map();
  candidates.forEach((c) => groupBest.set(groupKey(c), Math.max(groupBest.get(groupKey(c)) ?? -Infinity, c.score)));
  const typedEdition = EDITION_WORDS.test(`${queryArtist} ${queryTitle}`);
  return candidates.sort(
    (a, b) =>
      groupBest.get(groupKey(b)) - groupBest.get(groupKey(a)) ||
      groupKey(a).localeCompare(groupKey(b)) ||
      (typedEdition ? 0 : isEditionTitle(a.title) - isEditionTitle(b.title)) ||
      b.score - a.score
  );
}

async function searchItunes(artist, title) {
  const term = encodeURIComponent(`${artist} ${title}`.trim());
  const data = await jsonp(`https://itunes.apple.com/search?term=${term}&entity=album&media=music&limit=25`);
  return data.results || [];
}

const MB_TYPE_RANK = { Album: 0, EP: 1, Single: 2, Broadcast: 4, Other: 4 };

async function searchMusicBrainz(artist, title) {
  const cleanTitle = title.replace(/"/g, "");
  const cleanArtist = artist.replace(/"/g, "");
  // No AND between title/artist: broadens matches so a mistyped or wrong artist
  // still surfaces the right album (just ranked lower), instead of returning nothing.
  // Restrict to full albums server-side: singles/EPs/bootlegs/promos otherwise
  // flood the relevance ranking and can bury the actual album entirely.
  let query = `releasegroup:"${cleanTitle}" AND primarytype:album`;
  if (cleanArtist) query += ` artist:"${cleanArtist}"`;
  // Even among albums, relevance scoring ties a lot on exact title matches, so
  // re-rank client-side by signals that correlate with "well-known release" —
  // how many pressings/editions exist (a popularity proxy), then community tagging.
  const url = `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query)}&fmt=json&limit=25`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("MusicBrainz search failed");
  const data = await res.json();
  const results = data["release-groups"] || [];

  results.sort((a, b) => {
    const typeRankA = MB_TYPE_RANK[a["primary-type"]] ?? 3;
    const typeRankB = MB_TYPE_RANK[b["primary-type"]] ?? 3;
    if (typeRankA !== typeRankB) return typeRankA - typeRankB;

    const tagsA = (a.tags || []).reduce((s, t) => s + t.count, 0);
    const tagsB = (b.tags || []).reduce((s, t) => s + t.count, 0);
    const popularityA = (a.count || 0) + tagsA;
    const popularityB = (b.count || 0) + tagsB;
    if (popularityA !== popularityB) return popularityB - popularityA;

    return (b.score || 0) - (a.score || 0);
  });

  return results.slice(0, 8);
}

async function fetchMusicBrainzTracklist(releaseGroupId) {
  const url = `https://musicbrainz.org/ws/2/release?release-group=${releaseGroupId}&inc=recordings&fmt=json&limit=15`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  // A release group holds every pressing of the album: the original, plus
  // deluxe/remaster/anniversary reissues with bonus discs. Use the original
  // studio release: official, not an edition, earliest date. Releases with no
  // track data at all (stubs) are skipped.
  const releases = (data.releases || [])
    .map((release) => {
      const tracks = [];
      (release.media || []).forEach((medium) => (medium.tracks || []).forEach((t) => tracks.push(t.title)));
      const editionText = `${release.title || ""} ${release.disambiguation || ""}`;
      return {
        tracks,
        official: release.status === "Official" ? 0 : 1,
        edition: STRONG_EDITION_RE.test(editionText) || EDITION_WORDS.test(release.disambiguation || "") ? 1 : 0,
        date: release.date || "9999",
      };
    })
    .filter((r) => r.tracks.length > 0)
    .sort((a, b) => a.edition - b.edition || a.official - b.official || a.date.localeCompare(b.date));
  return releases.length ? releases[0].tracks : [];
}

async function fetchItunesTracklist(collectionId) {
  const lookupData = await jsonp(`https://itunes.apple.com/lookup?id=${collectionId}&entity=song`);
  const songs = (lookupData.results || []).filter((r) => r.wrapperType === "track");
  songs.sort((a, b) => (a.trackNumber || 0) - (b.trackNumber || 0));
  return songs.map((s) => s.trackName);
}

async function fetchTracklistForCandidate(candidate) {
  if (candidate.source === "itunes") {
    return fetchItunesTracklist(candidate.raw.collectionId);
  }
  return fetchMusicBrainzTracklist(candidate.raw);
}

// Looks up the same album on whichever source the candidate DIDN'T come
// from, using the now-confirmed artist/title, so selectCandidate can compare
// both and keep whichever tracklist is actually more complete.
// Returns { tracks, genre } (genre may be "").
async function fetchTracklistFallback(candidate) {
  const wanted = normText(baseTitle(candidate.title));
  const sameAlbum = (title) => normText(baseTitle(title)) === wanted;
  try {
    if (candidate.source === "itunes") {
      const mbResults = await searchMusicBrainz(candidate.artist, baseTitle(candidate.title));
      const match = mbResults.find((rg) => sameAlbum(rg.title)) || mbResults[0];
      if (match) return { tracks: await fetchMusicBrainzTracklist(match.id), genre: mbTagsToGenre(match.tags) };
    } else {
      const itunesResults = await searchItunes(candidate.artist, candidate.title);
      // Prefer the plain studio release over a deluxe one with the same name.
      const match =
        itunesResults.find((r) => sameAlbum(r.collectionName) && !isEditionTitle(r.collectionName)) ||
        itunesResults.find((r) => sameAlbum(r.collectionName)) ||
        itunesResults[0];
      if (match) return { tracks: await fetchItunesTracklist(match.collectionId), genre: match.primaryGenreName || "" };
    }
  } catch (err) {
    console.error(err);
  }
  return { tracks: [], genre: "" };
}

async function searchMusicBrainzByArtist(artist) {
  const cleanArtist = artist.replace(/"/g, "");
  const artistRes = await fetch(
    `https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(`artist:"${cleanArtist}"`)}&fmt=json&limit=1`
  );
  if (!artistRes.ok) throw new Error("MusicBrainz artist search failed");
  const artistData = await artistRes.json();
  const bestArtist = (artistData.artists || [])[0];
  if (!bestArtist) return [];

  const rgRes = await fetch(
    `https://musicbrainz.org/ws/2/release-group?artist=${bestArtist.id}&type=album&fmt=json&limit=50`
  );
  if (!rgRes.ok) throw new Error("MusicBrainz discography browse failed");
  const rgData = await rgRes.json();
  // Real studio albums have no secondary-type; compilations/live sets/remixes/
  // bootlegs all carry one (Compilation, Live, Remix, etc) — filtering them out
  // is what actually makes an artist's discography readable.
  const groups = (rgData["release-groups"] || []).filter((rg) => (rg["secondary-types"] || []).length === 0);
  // Browse-by-artist responses don't embed artist-credit like search results do,
  // so attach it manually to keep addMusicBrainzCandidates working unchanged.
  groups.forEach((rg) => {
    if (!rg["artist-credit"]) rg["artist-credit"] = [{ name: bestArtist.name }];
  });
  return groups;
}

// Candidates are deduped on exact (normalized) artist+title. Separately, a
// looser key that ignores "(Deluxe Edition)" etc records when BOTH sources
// know about the same album, which is a strong sign it's the real one.
function recordAgreement(candidates, source, artist, title) {
  const loose = normText(artist) + "|" + normText(baseTitle(title));
  candidates.forEach((c) => {
    if (normText(c.artist) + "|" + normText(baseTitle(c.title)) === loose) c.sources.add(source);
  });
}

function pushCandidate(candidates, seenKeys, c) {
  const key = normText(c.artist) + "|" + normText(c.title);
  if (!c.title || seenKeys.has(key)) return;
  seenKeys.add(key);
  c.sources = new Set([c.source]);
  candidates.push(c);
}

function addItunesCandidates(results, candidates, seenKeys) {
  results.forEach((r, i) => {
    if (!r.collectionName) return;
    recordAgreement(candidates, "itunes", r.artistName, r.collectionName);
    const kindMatch = /\s-\s(single|ep)\s*$/i.exec(r.collectionName);
    pushCandidate(candidates, seenKeys, {
      source: "itunes",
      title: r.collectionName,
      artist: r.artistName,
      year: r.releaseDate ? new Date(r.releaseDate).getFullYear() : "",
      genre: r.primaryGenreName || "",
      coverUrl: r.artworkUrl100 ? r.artworkUrl100.replace("100x100bb", "600x600bb") : "",
      trackCount: r.trackCount || 0,
      kind: kindMatch ? (kindMatch[1].toLowerCase() === "ep" ? "EP" : "Single") : "Album",
      rank: results.length > 1 ? i / (results.length - 1) : 0,
      raw: r,
    });
  });
}

function addMusicBrainzCandidates(results, candidates, seenKeys) {
  results.forEach((rg, i) => {
    const artistName = (rg["artist-credit"] || []).map((c) => c.name + (c.joinphrase || "")).join("").trim();
    if (!rg.title) return;
    recordAgreement(candidates, "musicbrainz", artistName, rg.title);
    const secondary = rg["secondary-types"] || [];
    pushCandidate(candidates, seenKeys, {
      source: "musicbrainz",
      title: rg.title,
      artist: artistName,
      year: rg["first-release-date"] ? rg["first-release-date"].slice(0, 4) : "",
      genre: mbTagsToGenre(rg.tags),
      coverUrl: `https://coverartarchive.org/release-group/${rg.id}/front-500`,
      kind: secondary.includes("Live")
        ? "Live"
        : secondary.includes("Compilation")
        ? "Compilation"
        : secondary.length
        ? "Other"
        : rg["primary-type"] || "Album",
      rank: results.length > 1 ? i / (results.length - 1) : 0,
      raw: rg.id,
    });
  });
}

// MusicBrainz has no single "genre" field, but its community tags are mostly
// genres. Take the two most-voted ones, skipping obvious non-genre tags.
const NON_GENRE_TAGS = /^(\d{4}s?|seen live|favorite|favourites?|albums? i own|english|american|british|uk|usa)$/i;
function mbTagsToGenre(tags) {
  return (tags || [])
    .filter((t) => t.count > 0 && t.name && !NON_GENRE_TAGS.test(t.name))
    .sort((a, b) => b.count - a.count)
    .slice(0, 2)
    .map((t) => t.name.replace(/\b\w/g, (ch) => ch.toUpperCase()))
    .join(", ");
}

// ---------- Search-as-you-type ----------
let searchSeq = 0; // bumps on every search so stale results are ignored
let autoSearchTimer = null;
let lastSearchKey = "";

function scheduleAutoSearch() {
  clearTimeout(autoSearchTimer);
  const artist = artistInput.value.trim();
  const title = titleInput.value.trim();
  // Only once there's enough to search on, and not for the same text twice.
  if (title.length < 3 && !(artist.length >= 3 && !title)) return;
  autoSearchTimer = setTimeout(() => {
    if (normText(artist) + "|" + normText(title) === lastSearchKey) return;
    autofillSearch();
  }, 800);
}

[artistInput, titleInput].forEach((input) => {
  input.addEventListener("input", scheduleAutoSearch);
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    clearTimeout(autoSearchTimer);
    // Enter with results already showing picks the top one; otherwise search.
    const top = candidateListEl.querySelector(".candidate-item");
    const key = normText(artistInput.value.trim()) + "|" + normText(titleInput.value.trim());
    if (top && key === lastSearchKey) top.click();
    else autofillSearch();
  });
});

async function autofillSearch() {
  clearTimeout(autoSearchTimer);
  const artist = artistInput.value.trim();
  const title = titleInput.value.trim();
  if (!artist && !title) {
    autofillStatus.textContent = "Enter an artist or album title first.";
    return;
  }
  const seq = ++searchSeq;
  const isStale = () => seq !== searchSeq;
  lastSearchKey = normText(artist) + "|" + normText(title);

  candidateListEl.innerHTML = "";

  // Artist only, no title: browse that artist's whole discography instead of
  // searching for one specific album.
  if (artist && !title) {
    autofillStatus.textContent = `Looking up albums by ${artist}...`;

    const [itunesResult, mbResult] = await Promise.allSettled([
      searchItunes(artist, ""),
      searchMusicBrainzByArtist(artist),
    ]);
    if (isStale()) return;

    const candidates = [];
    const seenKeys = new Set();
    if (itunesResult.status === "fulfilled") addItunesCandidates(itunesResult.value, candidates, seenKeys);
    if (mbResult.status === "fulfilled") addMusicBrainzCandidates(mbResult.value, candidates, seenKeys);

    if (candidates.length === 0) {
      autofillStatus.textContent = `No albums found for "${artist}". Double-check the spelling, or add the album manually.`;
      return;
    }

    // The artist's own full albums first (oldest to newest), then anything by
    // other artists, singles/EPs, live sets and knock-offs.
    candidates.forEach((c) => (c.score = scoreCandidate(c, artist, "")));
    const tier = (c) => (c.score < 0.75 ? 2 : c.kind === "Album" && !JUNK_RE.test(c.title) && !isEditionTitle(c.title) ? 0 : 1);
    candidates.sort((a, b) => tier(a) - tier(b) || (parseInt(a.year) || 9999) - (parseInt(b.year) || 9999));
    autofillStatus.textContent = `Found ${candidates.length} album${candidates.length === 1 ? "" : "s"} by ${artist} — pick one:`;
    renderCandidates(candidates);
    return;
  }

  autofillStatus.textContent = "Searching iTunes and MusicBrainz...";

  // Search with the given artist+title, and ALSO title-only (when an artist was
  // typed) so a wrong/mistyped artist doesn't hide the real album entirely.
  const searches = [searchItunes(artist, title), searchMusicBrainz(artist, title)];
  if (artist) {
    searches.push(searchItunes("", title), searchMusicBrainz("", title));
  }

  const [itunesResult, mbResult, itunesTitleOnly, mbTitleOnly] = await Promise.allSettled(searches);
  if (isStale()) return;

  const candidates = [];
  const seenKeys = new Set();

  if (itunesResult.status === "fulfilled") addItunesCandidates(itunesResult.value, candidates, seenKeys);
  if (mbResult.status === "fulfilled") addMusicBrainzCandidates(mbResult.value, candidates, seenKeys);
  if (itunesTitleOnly?.status === "fulfilled") addItunesCandidates(itunesTitleOnly.value, candidates, seenKeys);
  if (mbTitleOnly?.status === "fulfilled") addMusicBrainzCandidates(mbTitleOnly.value, candidates, seenKeys);

  if (candidates.length === 0) {
    autofillStatus.textContent =
      "No matches found on iTunes or MusicBrainz. Double-check the spelling, or add the album manually.";
    return;
  }

  // Rank by how closely each candidate actually matches what was typed, not
  // by which source's search happened to run first — otherwise the right
  // album can end up buried under less-relevant results from the other source.
  rankCandidates(candidates, artist, title);

  autofillStatus.textContent = `Found ${candidates.length} possible match${candidates.length === 1 ? "" : "es"} — best match first (Enter picks it):`;
  renderCandidates(candidates.slice(0, 20), true);
}

function renderCandidates(candidates, markBest) {
  candidateListEl.innerHTML = "";
  candidates.forEach((c, idx) => {
    const row = document.createElement("div");
    const isBest = markBest && idx === 0;
    row.className = "candidate-item" + (isBest ? " best" : "");

    const thumb = document.createElement("img");
    thumb.className = "candidate-thumb";
    thumb.src = c.coverUrl || "";
    thumb.alt = "";
    thumb.addEventListener("error", () => {
      thumb.style.visibility = "hidden";
    });

    const info = document.createElement("div");
    info.className = "candidate-info";
    info.innerHTML = `
      <div class="candidate-title">${escapeHtml(c.title)}${isBest ? `<span class="best-badge">Best match</span>` : ""}</div>
      <div class="candidate-meta">${escapeHtml(c.artist)}${c.year ? " · " + escapeHtml(String(c.year)) : ""}${
        c.trackCount ? ` · ${c.trackCount} tracks` : ""
      }${c.kind && c.kind !== "Album" ? `<span class="candidate-kind">${escapeHtml(c.kind)}</span>` : ""}${
        findExistingAlbum(c.artist, c.title) ? ` · <strong>already in your library</strong>` : ""
      }</div>
    `;

    const sourceTag = document.createElement("span");
    sourceTag.className = "candidate-source";
    sourceTag.textContent = [...(c.sources || [c.source])].map((s) => (s === "itunes" ? "iTunes" : "MusicBrainz")).join(" + ");

    row.appendChild(thumb);
    row.appendChild(info);
    row.appendChild(sourceTag);
    row.addEventListener("click", () => selectCandidate(c));
    candidateListEl.appendChild(row);
  });
}

function findExistingAlbum(artist, title) {
  const key = normText(artist) + "|" + normText(baseTitle(title));
  return library.find((a) => a.id !== editingId && normText(a.artist) + "|" + normText(baseTitle(a.title)) === key);
}

async function selectCandidate(candidate) {
  const existing = findExistingAlbum(candidate.artist, candidate.title);
  if (existing && confirm(`"${existing.title}" is already in your library. Open that entry instead of adding a duplicate?`)) {
    openModal(existing.id);
    return;
  }
  const seq = ++searchSeq;
  clearTimeout(autoSearchTimer);
  candidateListEl.innerHTML = "";
  artistInput.value = candidate.artist;
  titleInput.value = candidate.title;
  lastSearchKey = normText(candidate.artist) + "|" + normText(candidate.title);
  updateSpotifyLink();
  if (candidate.year) yearInput.value = candidate.year;
  // Genre is filled automatically (unless you've already typed some). This
  // replaces anything auto-filled from a previously picked result.
  const fillGenre = (genre) => {
    if (!genre || (currentGenres.length && !genreWasAutoFilled)) return;
    currentGenres = [];
    splitTags(genre).forEach((g) => (currentGenres = addUniqueTag(currentGenres, g)));
    genreWasAutoFilled = true;
    renderGenreChips();
  };
  fillGenre(candidate.genre);
  currentCoverUrl = candidate.coverUrl || "";
  coverPlaceholder.textContent = "No cover yet";
  updateCoverPreview();

  autofillStatus.textContent = "Fetching the fullest tracklist available...";
  try {
    // Always check both sources rather than stopping at the first one that
    // returns anything — a source can return a real but truncated listing
    // (missing bonus tracks, a partial regional pressing, etc), so compare
    // track counts and keep whichever is actually more complete.
    const [primaryResult, otherResult] = await Promise.allSettled([
      fetchTracklistForCandidate(candidate),
      fetchTracklistFallback(candidate),
    ]);
    if (seq !== searchSeq) return; // user picked something else / closed the form meanwhile
    const primaryTracks = primaryResult.status === "fulfilled" ? primaryResult.value : [];
    const other = otherResult.status === "fulfilled" ? otherResult.value : { tracks: [], genre: "" };
    const otherTracks = other.tracks;
    const otherSourceName = candidate.source === "itunes" ? "MusicBrainz" : "iTunes";
    // iTunes genres are the cleanest; otherwise MusicBrainz tags.
    if (candidate.source === "musicbrainz" && other.genre) fillGenre(other.genre);
    else if (!candidate.genre) fillGenre(other.genre);

    // Stick with the version you picked. The other source only fills in when
    // it found nothing, or (for an iTunes pick) when MusicBrainz's ORIGINAL
    // release has more tracks, which means iTunes is missing some. It never
    // swaps in a longer deluxe tracklist.
    let trackNames = primaryTracks;
    let usedOther = false;
    const otherIsOriginal = candidate.source === "itunes";
    if (primaryTracks.length === 0 || (otherIsOriginal && otherTracks.length > primaryTracks.length)) {
      if (otherTracks.length) {
        trackNames = otherTracks;
        usedOther = true;
      }
    }

    if (trackNames.length > 0) {
      currentTracks = trackNames.map((name) => ({ name, favorite: false, least: false }));
      renderTrackList();
      const sourceNote = usedOther ? ` (via ${otherSourceName})` : "";
      autofillStatus.textContent = `Loaded "${candidate.title}" by ${candidate.artist} — ${trackNames.length} tracks${sourceNote}.`;
    } else {
      autofillStatus.textContent = `Loaded "${candidate.title}" but couldn't find a tracklist on either source. Add tracks manually.`;
    }
  } catch (err) {
    console.error(err);
    autofillStatus.textContent = "Filled in album info, but couldn't load the tracklist. Add tracks manually.";
  }
}

// ---------- Export / Import ----------
document.getElementById("exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(library, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `album-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

const importFileInput = document.getElementById("importFile");
document.getElementById("importBtn").addEventListener("click", () => importFileInput.click());
importFileInput.addEventListener("change", () => {
  const file = importFileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data)) throw new Error("Invalid file format");
      const merge = confirm(
        "Click OK to merge this backup into your current library, or Cancel to replace your current library entirely."
      );
      const incoming = data.map(normalizeAlbum);
      if (merge) {
        // Same album id in both = the backup's copy wins, instead of a duplicate.
        const byId = new Map(library.map((a) => [a.id, a]));
        incoming.forEach((a) => byId.set(a.id, a));
        library = [...byId.values()];
      } else {
        library = incoming;
      }
      saveLibrary();
      renderTagFilterOptions();
      renderLibrary();
      alert("Import complete.");
    } catch (e) {
      alert("Could not import that file: " + e.message);
    } finally {
      importFileInput.value = "";
    }
  };
  reader.readAsText(file);
});

// ---------- Stats ----------
function computeStats() {
  const totalAlbums = library.length;
  const totalListens = library.reduce((sum, a) => sum + (a.timesListened || 0), 0);
  const ratedAlbums = library.filter(isRated);
  const avgRating = ratedAlbums.length ? ratedAlbums.reduce((s, a) => s + a.rating, 0) / ratedAlbums.length : 0;

  const mostListened = library.reduce(
    (max, a) => (!max || (a.timesListened || 0) > (max.timesListened || 0) ? a : max),
    null
  );

  const distribution = new Array(11).fill(0); // index = rating * 2 (0, 0.5, ... 5)
  ratedAlbums.forEach((a) => distribution[Math.round(a.rating * 2)]++);

  const artistMap = new Map();
  library.forEach((a) => {
    const key = a.artist || "Unknown";
    if (!artistMap.has(key)) {
      artistMap.set(key, { artist: key, albums: 0, totalListens: 0, ratingSum: 0, ratingCount: 0 });
    }
    const entry = artistMap.get(key);
    entry.albums += 1;
    entry.totalListens += a.timesListened || 0;
    if (isRated(a)) {
      entry.ratingSum += a.rating;
      entry.ratingCount += 1;
    }
  });
  const artistStats = [...artistMap.values()]
    .map((e) => ({
      artist: e.artist,
      albums: e.albums,
      totalListens: e.totalListens,
      avgRating: e.ratingCount ? e.ratingSum / e.ratingCount : null,
    }))
    .sort((a, b) => b.totalListens - a.totalListens);

  const genreMap = new Map();
  // An album with several genre tags counts toward each of them.
  library.flatMap((a) => (a.genres && a.genres.length ? a.genres : ["Unknown"]).map((g) => [g, a])).forEach(([g, a]) => {
    const key = g.toLowerCase();
    if (!genreMap.has(key)) {
      genreMap.set(key, { genre: g, albums: 0, totalListens: 0, ratingSum: 0, ratingCount: 0 });
    }
    const entry = genreMap.get(key);
    entry.albums += 1;
    entry.totalListens += a.timesListened || 0;
    if (isRated(a)) {
      entry.ratingSum += a.rating;
      entry.ratingCount += 1;
    }
  });
  const genreStats = [...genreMap.values()]
    .map((e) => ({
      genre: e.genre,
      albums: e.albums,
      totalListens: e.totalListens,
      avgRating: e.ratingCount ? e.ratingSum / e.ratingCount : null,
    }))
    .sort((a, b) => b.albums - a.albums);

  return { totalAlbums, totalListens, avgRating, mostListened, distribution, artistStats, genreStats };
}

function renderTagStats() {
  const tags = allUsedTags("tags");
  if (!tags.length) return "";
  const rows = tags
    .map((t) => {
      const albums = library.filter((a) => (a.tags || []).some((x) => x.toLowerCase() === t.name.toLowerCase()));
      const rated = albums.filter(isRated);
      const avg = rated.length ? rated.reduce((s, a) => s + a.rating, 0) / rated.length : null;
      return `<tr><td>${escapeHtml(t.name)}</td><td>${albums.length}</td><td>${avg != null ? avg.toFixed(1) + " ★" : "—"}</td></tr>`;
    })
    .join("");
  return `
    <h3>By tag</h3>
    <table class="stats-table">
      <thead><tr><th>Tag</th><th>Albums</th><th>Avg rating</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// Every rating-history entry is a timestamped "you touched this album" event
// (created whenever rating or listen count changes) — aggregate those by day
// to approximate a listening-activity calendar.
function computeActivityByDate() {
  const counts = {};
  library.forEach((a) => {
    (a.ratingHistory || []).forEach((entry) => {
      const day = entry.date.slice(0, 10);
      counts[day] = (counts[day] || 0) + 1;
    });
  });
  return counts;
}

function buildHeatmapCells(weeks) {
  const counts = computeActivityByDate();
  const days = weeks * 7;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - (days - 1));
  const startDow = startDate.getDay();

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let i = 0; i < days; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    cells.push({ date: key, count: counts[key] || 0 });
  }
  return cells;
}

const HEAT_COLORS = ["var(--surface-2)", "rgba(124,156,255,0.35)", "rgba(124,156,255,0.65)", "rgba(124,156,255,1)"];
function heatLevel(count) {
  if (!count) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  return 3;
}

function openStatsModal() {
  const stats = computeStats();

  if (stats.totalAlbums === 0) {
    statsBody.innerHTML = `<p class="empty-state">Log a few albums first to see stats here.</p>`;
    statsModal.hidden = false;
    return;
  }

  const maxDist = Math.max(...stats.distribution, 1);
  const distRows = stats.distribution
    .map((count, i) => {
      const stars = i / 2;
      return `
        <div class="bar-row">
          <span class="bar-label">${formatRating(stars)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${(count / maxDist) * 100}%"></div></div>
          <span class="bar-count">${count}</span>
        </div>
      `;
    })
    .reverse()
    .join("");

  const artistRows = stats.artistStats
    .map(
      (e) => `
        <tr>
          <td>${escapeHtml(e.artist)}</td>
          <td>${e.albums}</td>
          <td>${e.totalListens}</td>
          <td>${e.avgRating ? e.avgRating.toFixed(1) + " ★" : "—"}</td>
        </tr>
      `
    )
    .join("");

  const genreRows = stats.genreStats
    .map(
      (e) => `
        <tr>
          <td>${escapeHtml(e.genre)}</td>
          <td>${e.albums}</td>
          <td>${e.totalListens}</td>
          <td>${e.avgRating ? e.avgRating.toFixed(1) + " ★" : "—"}</td>
        </tr>
      `
    )
    .join("");

  const heatCells = buildHeatmapCells(20);
  const heatmapHtml = heatCells
    .map((c) => {
      if (!c) return `<div class="heatmap-cell" style="background:transparent;"></div>`;
      const level = heatLevel(c.count);
      const title = `${c.date}: ${c.count} update${c.count === 1 ? "" : "s"}`;
      return `<div class="heatmap-cell" style="background:${HEAT_COLORS[level]}" title="${escapeAttr(title)}"></div>`;
    })
    .join("");
  const legendHtml = HEAT_COLORS.map((c) => `<span class="heatmap-cell" style="background:${c}"></span>`).join("");

  statsBody.innerHTML = `
    <div class="stats-cards">
      <div class="stats-card">
        <div class="stats-card-value">${stats.totalAlbums}</div>
        <div class="stats-card-label">Albums logged</div>
      </div>
      <div class="stats-card">
        <div class="stats-card-value">${stats.totalListens}</div>
        <div class="stats-card-label">Total listens</div>
      </div>
      <div class="stats-card">
        <div class="stats-card-value">${stats.avgRating ? stats.avgRating.toFixed(1) : "—"}</div>
        <div class="stats-card-label">Avg rating</div>
      </div>
      <div class="stats-card">
        <div class="stats-card-value">${stats.mostListened ? escapeHtml(stats.mostListened.title) : "—"}</div>
        <div class="stats-card-label">Most listened${stats.mostListened ? " (" + stats.mostListened.timesListened + "x)" : ""}</div>
      </div>
    </div>

    <h3>Rating distribution</h3>
    <div class="bar-chart">${distRows}</div>

    <h3>Listening activity</h3>
    <div class="heatmap-wrap"><div class="heatmap-grid">${heatmapHtml}</div></div>
    <div class="heatmap-legend">Less ${legendHtml} More</div>

    <h3>By artist</h3>
    <table class="stats-table">
      <thead><tr><th>Artist</th><th>Albums</th><th>Listens</th><th>Avg rating</th></tr></thead>
      <tbody>${artistRows}</tbody>
    </table>

    ${renderTagStats()}

    <h3>By genre</h3>
    <table class="stats-table">
      <thead><tr><th>Genre</th><th>Albums</th><th>Listens</th><th>Avg rating</th></tr></thead>
      <tbody>${genreRows}</tbody>
    </table>
  `;

  statsModal.hidden = false;
}

document.getElementById("statsBtn").addEventListener("click", openStatsModal);
document.getElementById("closeStatsBtn").addEventListener("click", () => (statsModal.hidden = true));
statsModal.addEventListener("click", (e) => {
  if (e.target === statsModal) statsModal.hidden = true;
});

// ---------- For You (recommendations from the influence map) ----------
function normalizeArtistName(name) {
  return (name || "").trim().toLowerCase();
}

function stripYearSuffix(title) {
  return (title || "").replace(/\s*\(\d{4}\)\s*$/, "").trim();
}

function computeRecommendations() {
  const data = window.INFLUENCE_DATA;
  if (!data) return [];
  const RAW = data.RAW;

  const nameToId = {};
  for (const id in RAW) {
    nameToId[normalizeArtistName(RAW[id][0])] = id;
  }

  // Reverse the "influenced by" edges so we also know who each artist went on to influence.
  const influenced = {};
  for (const id in RAW) {
    (RAW[id][4] || []).forEach((parentId) => {
      if (!influenced[parentId]) influenced[parentId] = [];
      influenced[parentId].push(id);
    });
  }

  const loggedNames = new Set(library.map((a) => normalizeArtistName(a.artist)));

  const ratedMapArtists = library
    .filter((a) => a.rating >= 4)
    .map((a) => ({ artist: a.artist, id: nameToId[normalizeArtistName(a.artist)] }))
    .filter((x) => x.id);

  const recs = new Map();
  ratedMapArtists.forEach(({ artist, id }) => {
    const relatedIds = [...(RAW[id][4] || []), ...(influenced[id] || [])];
    relatedIds.forEach((relId) => {
      if (relId === id) return;
      if (loggedNames.has(normalizeArtistName(RAW[relId][0]))) return;
      if (!recs.has(relId)) recs.set(relId, { id: relId, reasons: [] });
      recs.get(relId).reasons.push(artist);
    });
  });

  return [...recs.values()]
    .map((r) => ({
      id: r.id,
      name: RAW[r.id][0],
      note: RAW[r.id][3],
      albums: RAW[r.id][6] || [],
      reasons: [...new Set(r.reasons)],
      source: "map",
    }))
    .sort((a, b) => b.reasons.length - a.reasons.length);
}

// ---------- Last.fm (optional, covers genres outside the influence map) ----------
const LASTFM_KEY_STORAGE = "albumTracker.lastfmKey";
function getLastfmKey() {
  return localStorage.getItem(LASTFM_KEY_STORAGE) || "";
}

async function fetchLastfmSimilar(artist, key) {
  const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&artist=${encodeURIComponent(artist)}&api_key=${encodeURIComponent(key)}&format=json&limit=8&autocorrect=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Last.fm request failed");
  const data = await res.json();
  if (data.error) throw new Error(data.message || "Last.fm error");
  return (data.similarartists && data.similarartists.artist) || [];
}

async function fetchLastfmTopAlbum(artist, key) {
  try {
    const url = `https://ws.audioscrobbler.com/2.0/?method=artist.gettopalbums&artist=${encodeURIComponent(artist)}&api_key=${encodeURIComponent(key)}&format=json&limit=1&autocorrect=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const album = data.topalbums && data.topalbums.album && data.topalbums.album[0];
    return album ? album.name : null;
  } catch (err) {
    return null;
  }
}

// Only looks at rated artists NOT already covered by the free influence-map
// source — that's the whole point of adding Last.fm on top of it.
// Runs for every rated artist (whether or not the influence map also covers
// them) — the point is a second opinion, not just a gap-filler. Merging with
// the map results happens in openForYouModal: agreement collapses into one
// card, disagreement just means both sources' picks show up separately.
async function computeLastfmRecommendations() {
  const key = getLastfmKey();
  if (!key) return { recs: [], note: null };

  const loggedNames = new Set(library.map((a) => normalizeArtistName(a.artist)));

  const ratedArtists = library.filter((a) => a.rating >= 4).map((a) => a.artist);
  const uniqueArtists = [...new Set(ratedArtists)].slice(0, 8);
  if (uniqueArtists.length === 0) {
    return { recs: [], note: null };
  }

  // Validate the key/connection via the first lookup OUTSIDE allSettled, so a
  // bad key throws and reaches the caller's error handling — otherwise every
  // per-artist call fails identically and allSettled silently returns zero
  // results with no indication anything was wrong.
  const firstSimilar = await fetchLastfmSimilar(uniqueArtists[0], key);
  const restResults = await Promise.allSettled(
    uniqueArtists.slice(1).map(async (artist) => ({ artist, similar: await fetchLastfmSimilar(artist, key) }))
  );
  const results = [{ status: "fulfilled", value: { artist: uniqueArtists[0], similar: firstSimilar } }, ...restResults];

  const recs = new Map();
  results.forEach((r) => {
    if (r.status !== "fulfilled") return;
    const { artist, similar } = r.value;
    similar.forEach((s) => {
      const name = s.name;
      if (!name || loggedNames.has(normalizeArtistName(name))) return;
      const mapKey = normalizeArtistName(name);
      if (!recs.has(mapKey)) recs.set(mapKey, { name, reasons: [], match: parseFloat(s.match) || 0 });
      const entry = recs.get(mapKey);
      entry.reasons.push(artist);
      entry.match = Math.max(entry.match, parseFloat(s.match) || 0);
    });
  });

  const topRecs = [...recs.values()]
    .sort((a, b) => b.reasons.length - a.reasons.length || b.match - a.match)
    .slice(0, 15);

  await Promise.allSettled(
    topRecs.map(async (r) => {
      r.topAlbum = await fetchLastfmTopAlbum(r.name, key);
    })
  );

  const mapped = topRecs.map((r) => ({
    id: "lastfm:" + normalizeArtistName(r.name),
    name: r.name,
    note: `${Math.round(r.match * 100)}% similarity match on Last.fm.`,
    albums: r.topAlbum ? [["Try", r.topAlbum]] : [],
    reasons: [...new Set(r.reasons)],
    source: "lastfm",
  }));

  return {
    recs: mapped,
    note:
      mapped.length === 0
        ? `Checked Last.fm for ${uniqueArtists.join(", ")} but didn't find any new suggestions (similar artists may already be in your library).`
        : null,
  };
}

// Combine the two sources: when both suggest the same artist, fold them into
// one card (keeping the map's richer description/album pick, but noting both
// agree). When they disagree, each source's pick stands on its own.
function mergeRecommendations(mapRecs, lastfmRecs) {
  const merged = new Map();
  mapRecs.forEach((r) => {
    merged.set(normalizeArtistName(r.name), { ...r, sources: ["map"] });
  });
  lastfmRecs.forEach((r) => {
    const key = normalizeArtistName(r.name);
    if (merged.has(key)) {
      const existing = merged.get(key);
      existing.reasons = [...new Set([...existing.reasons, ...r.reasons])];
      existing.sources = [...existing.sources, "lastfm"];
    } else {
      merged.set(key, { ...r, sources: ["lastfm"] });
    }
  });
  return [...merged.values()].sort((a, b) => b.reasons.length - a.reasons.length);
}

function renderRecommendationCards(recs, statusNote) {
  const noteHtml = statusNote ? `<p class="hint" id="forYouStatusNote">${escapeHtml(statusNote)}</p>` : "";
  if (recs.length === 0) {
    forYouBody.innerHTML =
      noteHtml ||
      `<p class="empty-state">Rate a few albums 4★ or higher to get recommendations here.</p>`;
    return;
  }

  forYouBody.innerHTML =
    noteHtml +
    `<div class="rec-list">${recs
      .slice(0, 25)
      .map((r) => {
        const topAlbum = r.albums[0];
        const reasonNames = r.reasons.slice(0, 2).join(", ");
        const extra = r.reasons.length > 2 ? ` +${r.reasons.length - 2} more` : "";
        const sourceList = r.sources || [r.source === "lastfm" ? "lastfm" : "map"];
        const sourceTag = sourceList
          .map((s) => (s === "lastfm" ? "Last.fm" : "Influence Map"))
          .join(" + ");
        return `
          <div class="rec-card">
            <div class="rec-header">
              <span class="rec-name">${escapeHtml(r.name)}</span>
              <span class="rec-reason">Because you liked ${escapeHtml(reasonNames)}${escapeHtml(extra)}</span>
            </div>
            <p class="rec-note"><span class="candidate-source" style="margin-right:6px;">${sourceTag}</span>${escapeHtml(r.note)}</p>
            <div class="rec-footer">
              <span class="rec-album">${
                topAlbum
                  ? `<span class="rec-album-tag">${escapeHtml(topAlbum[0])}</span>${escapeHtml(topAlbum[1])}`
                  : ""
              }</span>
              <button type="button" class="rec-add-btn primary-btn" data-artist="${escapeAttr(r.name)}" data-title="${escapeAttr(
          topAlbum ? stripYearSuffix(topAlbum[1]) : ""
        )}">+ Add</button>
            </div>
          </div>
        `;
      })
      .join("")}</div>`;

  forYouBody.querySelectorAll(".rec-add-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      forYouModal.hidden = true;
      openModal(null);
      artistInput.value = btn.dataset.artist;
      titleInput.value = btn.dataset.title;
      updateSpotifyLink();
      autofillSearch();
    });
  });
}

async function openForYouModal() {
  if (!window.INFLUENCE_DATA) {
    forYouBody.innerHTML = `<p class="empty-state">Influence map data isn't loaded.</p>`;
    forYouModal.hidden = false;
    return;
  }

  const mapRecs = computeRecommendations();
  const hasLastfmKey = !!getLastfmKey();

  renderRecommendationCards(mergeRecommendations(mapRecs, []), hasLastfmKey ? "Checking Last.fm for more recommendations..." : "");
  forYouModal.hidden = false;

  if (!hasLastfmKey) return;

  try {
    const { recs: lastfmRecs, note } = await computeLastfmRecommendations();
    renderRecommendationCards(mergeRecommendations(mapRecs, lastfmRecs), note);
  } catch (err) {
    console.error(err);
    renderRecommendationCards(mergeRecommendations(mapRecs, []), "Couldn't reach Last.fm — check your API key or connection.");
  }
}

document.getElementById("forYouBtn").addEventListener("click", openForYouModal);
document.getElementById("closeForYouBtn").addEventListener("click", () => (forYouModal.hidden = true));
forYouModal.addEventListener("click", (e) => {
  if (e.target === forYouModal) forYouModal.hidden = true;
});

// ---------- Last.fm settings ----------
document.getElementById("lastfmSettingsBtn").addEventListener("click", () => {
  lastfmKeyInput.value = getLastfmKey();
  lastfmModal.hidden = false;
});
document.getElementById("closeLastfmBtn").addEventListener("click", () => (lastfmModal.hidden = true));
lastfmModal.addEventListener("click", (e) => {
  if (e.target === lastfmModal) lastfmModal.hidden = true;
});
document.getElementById("saveLastfmKeyBtn").addEventListener("click", () => {
  const key = lastfmKeyInput.value.trim();
  if (key) localStorage.setItem(LASTFM_KEY_STORAGE, key);
  else localStorage.removeItem(LASTFM_KEY_STORAGE);
  lastfmModal.hidden = true;
});
document.getElementById("clearLastfmKeyBtn").addEventListener("click", () => {
  localStorage.removeItem(LASTFM_KEY_STORAGE);
  lastfmKeyInput.value = "";
  lastfmModal.hidden = true;
});

// ---------- Search / sort listeners ----------
searchBox.addEventListener("input", renderLibrary);
sortSelect.addEventListener("change", renderLibrary);
tagFilterEl.addEventListener("change", () => {
  activeArtistFilter = null;
  renderLibrary();
});

// ---------- Init ----------
renderFolderFilterOptions();
renderTagFilterOptions();
renderLibrary();

// Deep link from explore.html's "+ Add to library" links (?addArtist=Name)
(function handleAddArtistParam() {
  const params = new URLSearchParams(location.search);
  const addArtist = params.get("addArtist");
  if (!addArtist) return;
  history.replaceState({}, "", location.pathname);
  openModal(null);
  artistInput.value = addArtist;
  titleInput.value = "";
  updateSpotifyLink();
  autofillSearch();
})();

// ---------- PWA install support ----------
if ("serviceWorker" in navigator && (location.protocol === "http:" || location.protocol === "https:")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("sw.js")
      // Check for a newer sw.js on every load so updated app files get picked up.
      .then((reg) => reg.update())
      .catch((err) => console.error("SW registration failed", err));
  });
}
