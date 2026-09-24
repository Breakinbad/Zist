const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function assertConfigured() {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    const error = new Error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY.');
    error.statusCode = 500;
    throw error;
  }
}

async function sbFetch(path, options = {}) {
  assertConfigured();

  const headers = {
    apikey: SUPABASE_SECRET_KEY,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  // Legacy service_role keys are JWTs. New sb_secret_* keys should be sent
  // in the apikey header only.
  if (SUPABASE_SECRET_KEY.startsWith('eyJ')) {
    headers.Authorization = `Bearer ${SUPABASE_SECRET_KEY}`;
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`Supabase request failed (${response.status}): ${text}`);
    error.statusCode = 500;
    throw error;
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function selectRows(table, query) {
  return sbFetch(`${table}?${query}`, { method: 'GET' });
}

async function selectOne(table, query) {
  const rows = await selectRows(table, `${query}&limit=1`);
  return rows && rows.length ? rows[0] : null;
}

async function insertRows(table, rows, { upsert = false, onConflict = null, returnRepresentation = true } = {}) {
  const params = [];
  if (onConflict) params.push(`on_conflict=${encodeURIComponent(onConflict)}`);

  const prefer = [];
  if (upsert) prefer.push('resolution=merge-duplicates');
  prefer.push(returnRepresentation ? 'return=representation' : 'return=minimal');

  const suffix = params.length ? `?${params.join('&')}` : '';
  return sbFetch(`${table}${suffix}`, {
    method: 'POST',
    headers: { Prefer: prefer.join(',') },
    body: JSON.stringify(rows),
  });
}

async function updateRows(table, query, values, { returnRepresentation = false } = {}) {
  return sbFetch(`${table}?${query}`, {
    method: 'PATCH',
    headers: { Prefer: returnRepresentation ? 'return=representation' : 'return=minimal' },
    body: JSON.stringify(values),
  });
}

module.exports = {
  sbFetch,
  selectRows,
  selectOne,
  insertRows,
  updateRows,
};
