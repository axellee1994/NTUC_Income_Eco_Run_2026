import { getEvent }                                                        from './api.js';
import { state }                                                             from './state.js';
import { races as STATIC_RACES }                                             from './races/index.js';
import { collectParticipantIds, fetchAllTiming, saveCache, loadCache }       from './loader.js';
import { computePositions, renderTable, renderProgress, hideProgress }       from './render.js';
import { YEARS }                                                             from './years.js';

const landingScreen = document.getElementById('landing-screen');
const app           = document.getElementById('app');
const eventLogo     = document.getElementById('event-logo');
const eventName     = document.getElementById('event-name');
const raceSelect    = document.getElementById('race-select');
const chipRace      = document.getElementById('chip-race');
const chipTotal     = document.getElementById('chip-total');
const chipLoaded    = document.getElementById('chip-loaded');
const loadBtn       = document.getElementById('load-btn');
const searchInput   = document.getElementById('search-input');
const tbody         = document.getElementById('tbody');
const backBtn       = document.getElementById('back-btn');

// ── Year selection ────────────────────────────────────────────────────────────

document.querySelectorAll('.btn-year').forEach(btn => {
  btn.addEventListener('click', () => {
    const year = btn.dataset.year;
    const cfg  = YEARS[year];
    if (!cfg) return;
    state.selectedYear = year;
    state.eventCode    = cfg.code;
    landingScreen.style.display = 'none';
    app.style.display = 'block';
    initApp();
  });
});

backBtn.addEventListener('click', () => {
  // Reset app state
  state.selectedYear  = null;
  state.eventCode     = null;
  state.event         = null;
  state.subEvents     = [];
  state.selectedId    = null;
  state.participants  = [];
  state.loading       = false;
  state.searchTerm    = '';
  // Reset UI
  eventLogo.style.display = 'none';
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
  const sub = currentSub();
  setInfoBar(sub);
  setTableMessage('Click ▶ Load Results to fetch timing data');
  loadBtn.style.display = 'inline-block';
  loadBtn.disabled = false;
  hideProgress();
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
  loadBtn.disabled = true;
  searchInput.disabled = true;

  const cached = loadCache(state.selectedYear, subEventId);
  if (cached) {
    state.participants = cached;
    computePositions(state.participants);
    renderTable(state.participants, currentSub(), state.searchTerm, state.sortCol, state.sortDir);
    chipLoaded.textContent = `Loaded: ${state.participants.length.toLocaleString()} (cached)`;
    searchInput.disabled = false;
    loadBtn.disabled = false;
    state.loading = false;
    return;
  }

  setTableMessage('Discovering participants…');

  // Phase 1 — collect IDs
  const participants = await collectParticipantIds(
    state.eventCode,
    subEventId,
    (done, total, found) => renderProgress(1, done, total, found)
  );

  state.participants = participants;
  setTableMessage(`Found ${participants.length.toLocaleString()} participants. Fetching timing…`);
  renderProgress(2, 0, participants.length, participants.length);

  // Phase 2 — fetch timing, render in batches
  let lastRender = 0;
  await fetchAllTiming(state.eventCode, participants, (done, total) => {
    renderProgress(2, done, total, total);
    if (done - lastRender >= 50 || done === total) {
      lastRender = done;
      computePositions(state.participants);
      renderTable(state.participants, currentSub(), state.searchTerm, state.sortCol, state.sortDir);
    }
  });

  computePositions(state.participants);
  renderTable(state.participants, currentSub(), state.searchTerm, state.sortCol, state.sortDir);
  saveCache(state.selectedYear, subEventId, state.participants);
  hideProgress();
  chipLoaded.textContent = `Loaded: ${state.participants.length.toLocaleString()}`;
  searchInput.disabled = false;
  loadBtn.disabled = false;
  state.loading = false;
}

// ── Bootstrap (called after year is chosen) ───────────────────────────────────

async function initApp() {
  const yearCfg = YEARS[state.selectedYear];
  try {
    const ev = await getEvent(state.eventCode);
    state.event = ev;
    eventName.textContent = ev.name ?? yearCfg.label;
    if (ev.logo) {
      eventLogo.src = ev.logo;
      eventLogo.style.display = 'block';
    }

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
