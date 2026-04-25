const tbody        = document.getElementById('tbody');
const resultsCount = document.getElementById('results-count');
const progressWrap = document.getElementById('progress-wrap');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const chipLoaded   = document.getElementById('chip-loaded');

export function computePositions(participants) {
  const finishers = participants
    .filter(p => p.chipTimeSec > 0 && p.raceStatus === 'COMPLETE')
    .sort((a, b) => a.chipTimeSec - b.chipTimeSec);
  finishers.forEach((p, i) => { p.position = i + 1; });
  participants.filter(p => !(p.chipTimeSec > 0 && p.raceStatus === 'COMPLETE'))
    .forEach(p => { p.position = null; });
}

export function filterAndSort(participants, searchTerm, sortCol, sortDir) {
  let rows = participants;
  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    rows = rows.filter(p =>
      p.name?.toLowerCase().includes(q) ||
      String(p.bib ?? '').includes(q)
    );
  }
  rows = [...rows].sort((a, b) => {
    let av = a[sortCol], bv = b[sortCol];
    if (sortCol === 'position') {
      av = av ?? Infinity;
      bv = bv ?? Infinity;
    } else if (sortCol === 'chipTimeSec') {
      av = av > 0 ? av : Infinity;
      bv = bv > 0 ? bv : Infinity;
    }
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });
  return rows;
}

function posCell(pos) {
  if (pos == null) return `<td class="pos">—</td>`;
  const medal = pos === 1 ? ' gold' : pos === 2 ? ' silver' : pos === 3 ? ' bronze' : '';
  return `<td class="pos${medal}">${pos}</td>`;
}

function timeCell(chipTime, chipTimeSec) {
  if (!chipTime && !chipTimeSec) return `<td class="time">—</td>`;
  return `<td class="time">${chipTime ?? fmtSec(chipTimeSec)}</td>`;
}

function fmtSec(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
           : `${m}:${String(sec).padStart(2,'0')}`;
}

function statusBadge(status) {
  if (!status || status === 'UNKNOWN') return '';
  const cls = status === 'COMPLETE' ? 'text-bg-success' : status === 'DNF' ? 'text-bg-danger' : 'text-bg-warning';
  return `<span class="badge ${cls}">${status}</span>`;
}

export function renderTable(participants, sub, searchTerm, sortCol, sortDir) {
  const rows = filterAndSort(participants, searchTerm, sortCol, sortDir);
  resultsCount.textContent = rows.length
    ? `Showing ${rows.length.toLocaleString()} of ${participants.length.toLocaleString()} participants`
    : '';

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No results found</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(p => `
    <tr>
      ${posCell(p.position)}
      <td class="bib">${p.bib ?? '—'}</td>
      <td class="name">${p.name ?? '—'}</td>
      ${timeCell(p.chipTime, p.chipTimeSec)}
      <td>${statusBadge(p.raceStatus)}</td>
    </tr>`).join('');
}

export function renderProgress(pct, text) {
  progressWrap.style.display = 'block';
  progressFill.style.width = `${pct}%`;
  progressText.textContent = text;
}

export function hideProgress() {
  progressWrap.style.display = 'none';
}
