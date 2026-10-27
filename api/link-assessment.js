// Links an assessment instance (by its access token) to the authenticated
// user's account. Called after the user signs up / signs in on /register.
//
// POST { token: "<assessment access token>" }
// Authorization: Bearer <supabase access token>
//
// The server verifies the JWT, extracts the user's email + ID, finds the
// assessment instance by token, verifies the participant email matches,
// and sets participant.user_id to the auth user's UUID.

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { token } = req.body || {};

    if (!token) {
      return res.status(400).json({ error: 'Assessment token is required' });
    }

    // ── Verify the user's JWT ──
    const authHeader = req.headers['authorization'] || '';
    const accessToken = authHeader.replace(/^Bearer\s+/i, '');

    if (!accessToken) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const supabase = createClient(supabaseUrl, supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } =
      await supabase.auth.getUser(accessToken);

    if (userError || !userData?.user) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    const authUserId = userData.user.id;
    const authEmail = (userData.user.email || '').toLowerCase();

    // ── Look up the assessment instance by token ──
    const { data: instance, error: instanceError } = await supabase
      .from('assessment_instances')
      .select('id, participant_id, status')
      .eq('access_token', token)
      .single();

    if (instanceError || !instance) {
      return res.status(404).json({ error: 'Assessment not found' });
    }

    // ── Look up the participant ──
    const { data: participant, error: participantError } = await supabase
      .from('participants')
      .select('id, email, user_id')
      .eq('id', instance.participant_id)
      .single();

    if (participantError || !participant) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    // ── Security check: email must match ──
    // The assessment was sent to a specific email. Only the person
    // who controls that email should be able to link it to their account.
    if (participant.email.toLowerCase() !== authEmail) {
      return res.status(403).json({
        error:
          'This assessment was sent to a different email address. Please sign in with the email that received the assessment link.',
      });
    }

    // ── Link the participant to the auth user ──
    if (participant.user_id !== authUserId) {
      const { error: linkError } = await supabase
        .from('participants')
        .update({ user_id: authUserId })
        .eq('id', participant.id);

      if (linkError) {
        console.error('Link error:', linkError);
        return res
          .status(500)
          .json({ error: 'Could not link assessment to your account' });
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Assessment linked to your account',
      assessmentStatus: instance.status,
    });
  } catch (error) {
    console.error('Link assessment error:', error);
    return res
      .status(500)
      .json({ error: 'Something went wrong. Please try again.' });
  }
}
