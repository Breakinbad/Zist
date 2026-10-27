// Returns public Supabase config (URL + anon key) to the frontend.
// The anon key is safe to expose — it's designed for client-side use
// and is gated by RLS policies. The service role key is NEVER returned.

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = process.env.SUPABASE_URL || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  if (!url || !anonKey) {
    return res.status(500).json({
      error: 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY environment variables.',
    });
  }

  // Set cache headers — this config doesn't change often
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).json({ url, anonKey });
}
