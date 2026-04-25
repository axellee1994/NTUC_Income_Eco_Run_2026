import { searchParticipants, getDetail } from './api.js';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const PREFIXES_2 = Array.from({ length: 90 }, (_, i) => String(i + 10));
const PREFIXES_3 = Array.from({ length: 46 }, (_, i) => String(i + 100));
export const SEARCH_PHRASES = [...LETTERS, ...PREFIXES_2, ...PREFIXES_3];

const CACHE_TTL = 60 * 60 * 1000;

export function saveCache(year, subEventId, participants) {
  try {
    localStorage.setItem(`race_${year}_${subEventId}`, JSON.stringify({
      ts: Date.now(),
      participants,
    }));
  } catch { /* quota exceeded — ignore */ }
}

export function loadCache(year, subEventId) {
  try {
    const key = `race_${year}_${subEventId}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, participants } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) { localStorage.removeItem(key); return null; }
    return participants;
  } catch { return null; }
}

async function runPool(tasks, concurrency, fn) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await fn(tasks[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

export async function collectParticipantIds(code, subEventId, onProgress) {
  const seen = new Map();
  let done = 0;
  await runPool(SEARCH_PHRASES, 10, async (phrase) => {
    const rows = await searchParticipants(code, phrase);
    for (const r of rows) {
      // resultSubEventId comes as a string from the API; coerce both sides
      if (!subEventId || String(r.resultSubEventId) === String(subEventId)) {
        if (!seen.has(r.id)) seen.set(r.id, r);
      }
    }
    done++;
    onProgress?.(done, SEARCH_PHRASES.length, seen.size);
  });
  return [...seen.values()];
}

export async function fetchAllTiming(code, participants, onBatch) {
  let done = 0;
  await runPool(participants, 30, async (p) => {
    const detail = await getDetail(code, p.id);
    if (detail?.chipTimeSec != null) {
      p.chipTime    = detail.chipTime    ?? null;
      p.chipTimeSec = detail.chipTimeSec ?? 0;
      p.raceStatus  = detail.raceStatus  ?? 'UNKNOWN';
    } else {
      p.chipTime    = null;
      p.chipTimeSec = 0;
      p.raceStatus  = 'UNKNOWN';
    }
    done++;
    onBatch?.(done, participants.length);
  });
}
