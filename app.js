// ---------- Storage ----------
const STORAGE_KEY = "albumTracker.library.v1";

function loadLibrary() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    // Migrate from the old single-folder model (folderId) to multi-folder (folderIds),
    // and backfill order/lastListened for albums saved before those existed.
    return parsed.map((a, idx) => {
      const migrated = a.folderIds ? a : { ...a, folderIds: a.folderId ? [a.folderId] : [] };
      return {
        ...migrated,
        order: typeof migrated.order === "number" ? migrated.order : idx,
        lastListened: migrated.lastListened || null,
      };
    });
  } catch (e) {
    console.error("Failed to load library", e);
    return [];
  }
}

function saveLibrary() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
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

let currentRating = 0;
let currentCoverUrl = "";
let selectMode = false;
let selectedIds = new Set();

// ---------- Rendering: library grid ----------
function renderLibrary() {
  updateActiveFilterChip();

  const folderScoped = library.filter((a) => {
    if (currentFolderFilter === "all") return true;
    if (currentFolderFilter === "unsorted") return (a.folderIds || []).length === 0;
    return (a.folderIds || []).includes(currentFolderFilter);
  });

  if (activeArtistFilter) {
    renderAlbumCards(folderScoped.filter((a) => a.artist === activeArtistFilter));
    return;
  }

  const query = searchBox.value.trim().toLowerCase();

  if (viewMode === "artists") {
    renderArtistCards(folderScoped, query);
    return;
  }

  let items = folderScoped.filter((a) => {
    if (!query) return true;
    return (
      a.title.toLowerCase().includes(query) ||
      a.artist.toLowerCase().includes(query) ||
      (a.genre || "").toLowerCase().includes(query)
    );
  });

  const [sortKey, sortDir] = sortSelect.value.split("-");
  items.sort((a, b) => {
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

  renderAlbumCards(items);
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

  const dragEnabled = !selectMode && sortSelect.value === "order-asc" && !activeArtistFilter && viewMode === "albums";

  items.forEach((album) => {
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

    const stars = "★".repeat(album.rating) + "☆".repeat(5 - album.rating);
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
          <span class="mini-stars">${stars}</span>
          <span>▶ ${album.timesListened || 0}</span>
        </div>
        ${folderTagsHtml}
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
        if (draggedId && draggedId !== album.id) reorderAlbums(draggedId, album.id, items);
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

// Drag-and-drop custom ordering: assign new `order` values across the
// currently-visible (filtered) set based on where the card was dropped,
// so the manual order persists independent of whatever filter is active.
function reorderAlbums(draggedId, targetId, visibleItems) {
  const ids = visibleItems.map((a) => a.id);
  const fromIdx = ids.indexOf(draggedId);
  const toIdx = ids.indexOf(targetId);
  if (fromIdx === -1 || toIdx === -1) return;
  ids.splice(toIdx, 0, ids.splice(fromIdx, 1)[0]);
  ids.forEach((id, idx) => {
    const album = library.find((a) => a.id === id);
    if (album) album.order = idx;
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
    const ratedAlbums = entry.albums.filter((a) => a.rating > 0);
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

// ---------- Star rating widget ----------
function renderStars() {
  ratingStarsEl.innerHTML = "";
  for (let i = 1; i <= 5; i++) {
    const span = document.createElement("span");
    span.textContent = i <= currentRating ? "★" : "☆";
    span.className = i <= currentRating ? "filled" : "";
    span.addEventListener("click", () => {
      currentRating = i === currentRating ? 0 : i;
      renderStars();
    });
    ratingStarsEl.appendChild(span);
  }
}

// ---------- Track list rendering ----------
function renderTrackList() {
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
  genreInput.value = album?.genre || "";
  notesInput.value = album?.notes || "";
  timesListenedInput.value = album?.timesListened || 0;
  currentRating = album?.rating || 0;
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
  renderTrackList();
  renderRatingHistory(album);

  modal.hidden = false;
}

function closeModal() {
  modal.hidden = true;
  editingId = null;
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
    const stars = "★".repeat(entry.rating) + "☆".repeat(5 - entry.rating);
    li.innerHTML = `
      <span class="rh-date">${escapeHtml(dateStr)}</span>
      <span class="rh-stars">${stars}</span>
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
    genre: genreInput.value.trim(),
    notes: notesInput.value,
    timesListened: newListens,
    rating: currentRating,
    coverUrl: currentCoverUrl,
    tracklist: currentTracks,
    folderIds: getSelectedFolderIds(),
    ratingHistory,
    lastListened: listensIncreased ? new Date().toISOString() : prevAlbum?.lastListened || null,
    order: typeof prevAlbum?.order === "number" ? prevAlbum.order : maxOrder + 1,
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
  renderLibrary();
  closeModal();
});

deleteAlbumBtn.addEventListener("click", () => {
  if (!editingId) return;
  if (!confirm("Delete this album from your library? This can't be undone.")) return;
  library = library.filter((a) => a.id !== editingId);
  saveLibrary();
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
  updateBulkBar();
  renderLibrary();
});

// ---------- Auto-fill: search iTunes + MusicBrainz, let the user pick ----------
document.getElementById("autofillBtn").addEventListener("click", autofillSearch);

function normalizeKey(artist, title) {
  return `${(artist || "").trim().toLowerCase()}|${(title || "").trim().toLowerCase()}`;
}

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

// How well a candidate actually matches what was typed — title carries more
// weight since it's usually the more specific identifier. This is what
// determines list order, so the right album doesn't get buried under noise
// just because it came from whichever source's search ran second.
function scoreCandidate(candidate, queryArtist, queryTitle) {
  const titleSim = textSimilarity(candidate.title, queryTitle);
  const artistSim = queryArtist ? textSimilarity(candidate.artist, queryArtist) : 0.5;
  return titleSim * 0.65 + artistSim * 0.35;
}

async function searchItunes(artist, title) {
  const term = encodeURIComponent(`${artist} ${title}`.trim());
  const data = await jsonp(`https://itunes.apple.com/search?term=${term}&entity=album&limit=8`);
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
  // Not every release in a group has full track data attached — some are
  // stub/promo entries, or a truncated regional pressing. Scan all of them
  // and keep whichever has the MOST tracks (ties broken by Official status)
  // instead of just taking the first one that has anything at all.
  let best = [];
  let bestIsOfficial = false;
  (data.releases || []).forEach((release) => {
    const tracks = [];
    (release.media || []).forEach((medium) => {
      (medium.tracks || []).forEach((t) => tracks.push(t.title));
    });
    const isOfficial = release.status === "Official";
    if (tracks.length > best.length || (tracks.length === best.length && isOfficial && !bestIsOfficial)) {
      best = tracks;
      bestIsOfficial = isOfficial;
    }
  });
  return best;
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
async function fetchTracklistFallback(candidate) {
  try {
    if (candidate.source === "itunes") {
      const mbResults = await searchMusicBrainz(candidate.artist, candidate.title);
      const match =
        mbResults.find((rg) => rg.title.toLowerCase() === candidate.title.toLowerCase()) || mbResults[0];
      if (match) return await fetchMusicBrainzTracklist(match.id);
    } else {
      const itunesResults = await searchItunes(candidate.artist, candidate.title);
      const match =
        itunesResults.find((r) => r.collectionName?.toLowerCase() === candidate.title.toLowerCase()) ||
        itunesResults[0];
      if (match) return await fetchItunesTracklist(match.collectionId);
    }
  } catch (err) {
    console.error(err);
  }
  return [];
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

function addItunesCandidates(results, candidates, seenKeys) {
  results.forEach((r) => {
    const key = normalizeKey(r.artistName, r.collectionName);
    if (!r.collectionName || seenKeys.has(key)) return;
    seenKeys.add(key);
    candidates.push({
      source: "itunes",
      title: r.collectionName,
      artist: r.artistName,
      year: r.releaseDate ? new Date(r.releaseDate).getFullYear() : "",
      genre: r.primaryGenreName || "",
      coverUrl: r.artworkUrl100 ? r.artworkUrl100.replace("100x100bb", "600x600bb") : "",
      raw: r,
    });
  });
}

function addMusicBrainzCandidates(results, candidates, seenKeys) {
  results.forEach((rg) => {
    const artistName = (rg["artist-credit"] || []).map((c) => c.name).join(" ");
    const key = normalizeKey(artistName, rg.title);
    if (!rg.title || seenKeys.has(key)) return;
    seenKeys.add(key);
    candidates.push({
      source: "musicbrainz",
      title: rg.title,
      artist: artistName,
      year: rg["first-release-date"] ? rg["first-release-date"].slice(0, 4) : "",
      genre: "",
      coverUrl: `https://coverartarchive.org/release-group/${rg.id}/front-500`,
      raw: rg.id,
    });
  });
}

async function autofillSearch() {
  const artist = artistInput.value.trim();
  const title = titleInput.value.trim();
  if (!artist && !title) {
    autofillStatus.textContent = "Enter an artist or album title first.";
    return;
  }

  candidateListEl.innerHTML = "";

  // Artist only, no title: browse that artist's whole discography instead of
  // searching for one specific album.
  if (artist && !title) {
    autofillStatus.textContent = `Looking up albums by ${artist}...`;

    const [itunesResult, mbResult] = await Promise.allSettled([
      searchItunes(artist, ""),
      searchMusicBrainzByArtist(artist),
    ]);

    const candidates = [];
    const seenKeys = new Set();
    if (itunesResult.status === "fulfilled") addItunesCandidates(itunesResult.value, candidates, seenKeys);
    if (mbResult.status === "fulfilled") addMusicBrainzCandidates(mbResult.value, candidates, seenKeys);

    if (candidates.length === 0) {
      autofillStatus.textContent = `No albums found for "${artist}". Double-check the spelling, or add the album manually.`;
      return;
    }

    candidates.sort((a, b) => (parseInt(a.year) || 9999) - (parseInt(b.year) || 9999));
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
  candidates.sort((a, b) => scoreCandidate(b, artist, title) - scoreCandidate(a, artist, title));

  autofillStatus.textContent = `Found ${candidates.length} possible match${candidates.length === 1 ? "" : "es"} — pick the right one:`;
  renderCandidates(candidates);
}

function renderCandidates(candidates) {
  candidateListEl.innerHTML = "";
  candidates.forEach((c) => {
    const row = document.createElement("div");
    row.className = "candidate-item";

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
      <div class="candidate-title">${escapeHtml(c.title)}</div>
      <div class="candidate-meta">${escapeHtml(c.artist)}${c.year ? " · " + escapeHtml(String(c.year)) : ""}</div>
    `;

    const sourceTag = document.createElement("span");
    sourceTag.className = "candidate-source";
    sourceTag.textContent = c.source === "itunes" ? "iTunes" : "MusicBrainz";

    row.appendChild(thumb);
    row.appendChild(info);
    row.appendChild(sourceTag);
    row.addEventListener("click", () => selectCandidate(c));
    candidateListEl.appendChild(row);
  });
}

async function selectCandidate(candidate) {
  candidateListEl.innerHTML = "";
  artistInput.value = candidate.artist;
  titleInput.value = candidate.title;
  if (candidate.year) yearInput.value = candidate.year;
  if (candidate.genre) genreInput.value = candidate.genre;
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
    const primaryTracks = primaryResult.status === "fulfilled" ? primaryResult.value : [];
    const otherTracks = otherResult.status === "fulfilled" ? otherResult.value : [];
    const otherSourceName = candidate.source === "itunes" ? "MusicBrainz" : "iTunes";

    let trackNames = primaryTracks;
    let usedOther = false;
    if (otherTracks.length > primaryTracks.length) {
      trackNames = otherTracks;
      usedOther = true;
    }

    if (trackNames.length > 0) {
      currentTracks = trackNames.map((name) => ({ name, favorite: false, least: false }));
      renderTrackList();
      const sourceNote = usedOther ? ` (via ${otherSourceName} — more complete)` : "";
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
      library = merge ? library.concat(data) : data;
      saveLibrary();
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
  const ratedAlbums = library.filter((a) => a.rating > 0);
  const avgRating = ratedAlbums.length ? ratedAlbums.reduce((s, a) => s + a.rating, 0) / ratedAlbums.length : 0;

  const mostListened = library.reduce(
    (max, a) => (!max || (a.timesListened || 0) > (max.timesListened || 0) ? a : max),
    null
  );

  const distribution = [0, 0, 0, 0, 0]; // index 0 = 1 star ... index 4 = 5 star
  ratedAlbums.forEach((a) => distribution[a.rating - 1]++);

  const artistMap = new Map();
  library.forEach((a) => {
    const key = a.artist || "Unknown";
    if (!artistMap.has(key)) {
      artistMap.set(key, { artist: key, albums: 0, totalListens: 0, ratingSum: 0, ratingCount: 0 });
    }
    const entry = artistMap.get(key);
    entry.albums += 1;
    entry.totalListens += a.timesListened || 0;
    if (a.rating > 0) {
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
  library.forEach((a) => {
    const key = (a.genre || "").trim() || "Unknown";
    if (!genreMap.has(key)) {
      genreMap.set(key, { genre: key, albums: 0, totalListens: 0, ratingSum: 0, ratingCount: 0 });
    }
    const entry = genreMap.get(key);
    entry.albums += 1;
    entry.totalListens += a.timesListened || 0;
    if (a.rating > 0) {
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
      const stars = i + 1;
      return `
        <div class="bar-row">
          <span class="bar-label">${stars}★</span>
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

// ---------- Init ----------
renderFolderFilterOptions();
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
    navigator.serviceWorker.register("sw.js").catch((err) => console.error("SW registration failed", err));
  });
}
