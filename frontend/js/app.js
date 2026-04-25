import { getEvent }                                                              from './api.js';
import { state }                                                                   from './state.js';
import { races as STATIC_RACES }                                                   from './races/index.js';
import { collectAndFetchAll, saveCache, loadCache, pruneExpiredCache }             from './loader.js';
import { computePositions, renderTable, renderProgress, hideProgress }             from './render.js';
import { YEARS }                                                                   from './years.js';

// Remove stale cache entries from previous sessions on startup
pruneExpiredCache();

const landingScreen = document.getElementById('landing-screen');
const app           = document.getElementById('app');
const eventName     = document.getElementById('event-name');
const yearBadge     = document.getElementById('year-badge');
const raceSelect    = document.getElementById('race-select');
const chipRace      = document.getElementById('chip-race');
const chipTotal     = document.getElementById('chip-total');
const chipLoaded    = document.getElementById('chip-loaded');
const loadBtn       = document.getElementById('load-btn');
const searchInput   = document.getElementById('search-input');
const tbody         = document.getElementById('tbody');
const backBtn       = document.getElementById('back-btn');
const backTopBtn    = document.getElementById('back-top-btn');

// ── Back to top ───────────────────────────────────────────────────────────────

window.addEventListener('scroll', () => {
  backTopBtn.style.display = window.scrollY > 400 ? 'flex' : 'none';
});
backTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

// ── Year selection ────────────────────────────────────────────────────────────

document.querySelectorAll('.btn-year').forEach(btn => {
  btn.addEventListener('click', async () => {
    const year = btn.dataset.year;
    const cfg  = YEARS[year];
    if (!cfg) return;

    // Disable all buttons and show a loading indicator on the clicked one
    const allBtns = document.querySelectorAll('.btn-year');
    allBtns.forEach(b => { b.disabled = true; });
    btn.textContent = `${year}…`;

    state.selectedYear = year;
    state.eventCode    = cfg.code;

    // Fetch event data before transitioning so the dashboard appears ready
    await initApp();

    yearBadge.textContent   = year;
    yearBadge.style.display = 'inline';
    landingScreen.style.display = 'none';
    app.style.display = 'block';

    // Auto-load the first race (cache hit = instant, miss = starts fetch)
    if (state.selectedId) loadRace(state.selectedId);

    // Restore button states for when the user navigates back
    allBtns.forEach(b => {
      b.disabled = false;
      b.textContent = b.dataset.year;
    });
  });
});

// ── Back button ───────────────────────────────────────────────────────────────

backBtn.addEventListener('click', () => {
  if (state.loading) return; // block mid-load navigation

  // Reset state
  state.selectedYear  = null;
  state.eventCode     = null;
  state.event         = null;
  state.subEvents     = [];
  state.selectedId    = null;
  state.participants  = [];
  state.loading       = false;
  state.searchTerm    = '';

  // Reset UI
  yearBadge.textContent   = '';
  yearBadge.style.display = 'none';
  eventName.textContent   = 'Loading event…';
  raceSelect.innerHTML    = '<option value="">Loading races…</option>';
  raceSelect.disabled     = true;
  searchInput.value       = '';
  searchInput.disabled    = true;
  loadBtn.style.display   = 'none';
  loadBtn.disabled        = false;
  hideProgress();
  tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Select a race to begin</td></tr>';

  app.style.display           = 'none';
  landingScreen.style.display = 'flex';
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function currentSub() {
  return state.subEvents.find(s => s.id === state.selectedId) ?? null;
}

function setInfoBar(sub) {
  chipRace.innerHTML  = sub ? `<span>${sub.name}</span>` : '—';
  chipTotal.innerHTML = sub ? `Total: <span>${sub.resultCount?.toLocaleString()}</span>` : '—';
  chipLoaded.textContent = '—';
}

function setTableMessage(msg) {
  tbody.innerHTML = `<tr><td colspan="5" class="empty-state">${msg}</td></tr>`;
}

// ── Sort headers ──────────────────────────────────────────────────────────────

document.querySelectorAll('thead th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (state.sortCol === col) {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortCol = col;
      state.sortDir = 'asc';
    }
    document.querySelectorAll('thead th').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
    th.classList.add(state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
    if (state.participants.length) {
      renderTable(state.participants, currentSub(), state.searchTerm, state.sortCol, state.sortDir);
    }
  });
});

// ── Search ────────────────────────────────────────────────────────────────────

searchInput.addEventListener('input', () => {
  state.searchTerm = searchInput.value.trim();
  if (state.participants.length) {
    renderTable(state.participants, currentSub(), state.searchTerm, state.sortCol, state.sortDir);
  }
});

// ── Race select ───────────────────────────────────────────────────────────────

raceSelect.addEventListener('change', () => {
  const id = Number(raceSelect.value);
  state.selectedId   = id;
  state.participants = [];
  state.searchTerm   = '';
  searchInput.value  = '';
  hideProgress();
  setInfoBar(currentSub());

  // If this race was loaded before, restore it from cache immediately
  const cached = loadCache(state.selectedYear, id);
  if (cached) {
    state.participants = cached;
    computePositions(state.participants);
    renderTable(state.participants, currentSub(), state.searchTerm, state.sortCol, state.sortDir);
    chipLoaded.textContent = `Loaded: ${state.participants.length.toLocaleString()} (cached)`;
    loadBtn.style.display = 'inline-block';
    loadBtn.disabled = false;
    searchInput.disabled = false;
  } else {
    setTableMessage('Click ▶ Load Results to fetch timing data');
    loadBtn.style.display = 'inline-block';
    loadBtn.disabled = false;
    searchInput.disabled = true;
  }
});

// ── Load button ───────────────────────────────────────────────────────────────

loadBtn.addEventListener('click', () => {
  if (!state.selectedId || state.loading) return;
  loadRace(state.selectedId);
});

// ── Core loader ───────────────────────────────────────────────────────────────

async function loadRace(subEventId) {
  if (state.loading) return;
  state.loading = true;
  loadBtn.disabled      = true;
  backBtn.disabled      = true;
  raceSelect.disabled   = true; // prevent switching races mid-load
  searchInput.disabled  = true;

  try {
    const cached = loadCache(state.selectedYear, subEventId);
    if (cached) {
      state.participants = cached;
      computePositions(state.participants);
      renderTable(state.participants, currentSub(), state.searchTerm, state.sortCol, state.sortDir);
      chipLoaded.textContent = `Loaded: ${state.participants.length.toLocaleString()} (cached)`;
      return;
    }

    state.participants = []; // live array — populated in place during fetch
    setTableMessage('Loading…');
    let lastRender = 0;

    await collectAndFetchAll(
      state.eventCode,
      subEventId,
      state.participants,
      ({ searchDone, searchTotal, found, timingDone }) => {
        // Progress bar tracks timing completion (the slower, meaningful metric)
        const pct  = found > 0 ? Math.round((timingDone / found) * 100) : 0;
        const text = searchDone < searchTotal
          ? `Searching ${searchDone}/${searchTotal} · ${timingDone.toLocaleString()} / ${found.toLocaleString()} loaded`
          : `Fetching timing… ${timingDone.toLocaleString()} / ${found.toLocaleString()}`;
        renderProgress(pct, text);
        chipLoaded.textContent = `Loaded: ${timingDone.toLocaleString()} / ${found.toLocaleString()}`;

        // Re-render table as batches of 50 timing results arrive
        if (timingDone - lastRender >= 50) {
          lastRender = timingDone;
          computePositions(state.participants);
          renderTable(state.participants, currentSub(), state.searchTerm, state.sortCol, state.sortDir);
        }
      }
    );

    computePositions(state.participants);
    renderTable(state.participants, currentSub(), state.searchTerm, state.sortCol, state.sortDir);
    saveCache(state.selectedYear, subEventId, state.participants);
    chipLoaded.textContent = `Loaded: ${state.participants.length.toLocaleString()}`;

  } catch (err) {
    console.error('[loadRace]', err);
    setTableMessage('Failed to load results. Please try again.');
  } finally {
    hideProgress();
    state.loading         = false;
    loadBtn.disabled      = false;
    backBtn.disabled      = false;
    raceSelect.disabled   = false;
    searchInput.disabled  = false;
  }
}

// ── Bootstrap (called after year is chosen) ───────────────────────────────────

async function initApp() {
  const yearCfg = YEARS[state.selectedYear];
  try {
    const ev = await getEvent(state.eventCode);
    state.event = ev;
    eventName.textContent = ev.name ?? yearCfg.label;
    state.subEvents = (ev.subEvents ?? []).filter(s => s.resultCount > 0);

    raceSelect.innerHTML = state.subEvents.map(s =>
      `<option value="${s.id}">${s.name} (${s.resultCount?.toLocaleString()})</option>`
    ).join('');
    raceSelect.disabled = false;

    if (state.subEvents.length) {
      state.selectedId = state.subEvents[0].id;
      raceSelect.value  = state.selectedId;
      setInfoBar(state.subEvents[0]);
      loadBtn.style.display = 'inline-block';
      setTableMessage('Click ▶ Load Results to fetch timing data');
    }
  } catch (err) {
    console.warn('[app] API fetch failed, falling back to static race list:', err.message);
    eventName.textContent = yearCfg.label;
    if (state.selectedYear === '2026') {
      state.subEvents = STATIC_RACES;
      raceSelect.innerHTML = STATIC_RACES.map(s =>
        `<option value="${s.id}">${s.name} (${s.resultCount?.toLocaleString()})</option>`
      ).join('');
      raceSelect.disabled = false;
      if (STATIC_RACES.length) {
        state.selectedId = STATIC_RACES[0].id;
        raceSelect.value  = state.selectedId;
        setInfoBar(STATIC_RACES[0]);
        loadBtn.style.display = 'inline-block';
        setTableMessage('Click ▶ Load Results to fetch timing data');
      }
    } else {
      raceSelect.innerHTML = '<option value="">No data available</option>';
      setTableMessage('Could not load event data. Please try again later.');
    }
  }
}
