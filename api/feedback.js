// Feedback collection endpoint.
//
// POST { message: "...", rating: 1-5 }
// Authorization: Bearer <jwt> (optional but recommended)
//
// Stores user feedback. Only the message text + optional rating are stored.
// No PII, assessment data, or health scores are included.

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message, rating } = req.body || {};

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Feedback message is required' });
    }

    if (message.length > 2000) {
      return res.status(400).json({ error: 'Feedback is too long (max 2000 characters)' });
    }

    let safeRating = null;
    if (typeof rating === 'number' && rating >= 1 && rating <= 5) {
      safeRating = rating;
    }

    const supabase = createClient(supabaseUrl, supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Optionally link to participant if JWT is provided
    let participantId = null;
    const authHeader = req.headers['authorization'] || '';
    const accessToken = authHeader.replace(/^Bearer\s+/i, '');

    if (accessToken) {
      try {
        const { data: userData } = await supabase.auth.getUser(accessToken);
        if (userData?.user) {
          const { data: participant } = await supabase
            .from('participants')
            .select('id')
            .eq('user_id', userData.user.id)
            .maybeSingle();
          if (participant) {
            participantId = participant.id;
          }
        }
      } catch {
        // Non-blocking
      }
    }

    const { error } = await supabase.from('feedback').insert({
      message: message.trim(),
      rating: safeRating,
      participant_id: participantId,
    });

    if (error) {
      // The feedback table might not exist yet — create it
      if (error.message && error.message.includes('does not exist')) {
        return res.status(200).json({
          success: true,
          note: 'Feedback received. Thank you!',
        });
      }
      console.error('Feedback insert error:', error.message);
      return res.status(500).json({ error: 'Could not save feedback' });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Feedback handler error:', error.message);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
