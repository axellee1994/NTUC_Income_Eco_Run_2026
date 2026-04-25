const BASE = '/api';

async function get(path) {
  const res = await fetch(`${BASE}/${path}`);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

export async function getEvent(code) {
  const res = await get(`events/${code}`);
  // API wraps response: { data: { event: {...} } }
  return res?.data?.event ?? res;
}

export async function searchParticipants(code, phrase) {
  try {
    const data = await get(`events/${code}/participant-search?phrase=${encodeURIComponent(phrase)}`);
    return [...(data.data?.exact ?? []), ...(data.data?.other ?? [])];
  } catch {
    return [];
  }
}

export async function getDetail(code, id) {
  try {
    const res = await get(`events/${code}/detail/${id}`);
    // API wraps response: { data: { result: {...} } }
    return res?.data?.result ?? res?.data ?? res;
  } catch {
    return null;
  }
}
