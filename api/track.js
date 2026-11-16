// Privacy-conscious product analytics endpoint.
//
// POST { eventType: "page_view", metadata: {...} }
//
// Stores anonymous analytics events. NEVER accepts or stores:
//   - email addresses
//   - assessment answers
//   - health scores
//   - any PII
//
// Only event_type (string) + optional metadata (object) are stored.
// The participant_id is optionally linked if a valid JWT is provided,
// but no PII is ever stored in the metadata.

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

// Event types that are allowed (allowlist for safety)
const ALLOWED_EVENT_TYPES = new Set([
  'page_view',
  'signup_submitted',
  'signup_success',
  'signup_error',
  'assessment_started',
  'assessment_completed',
  'assessment_abandoned',
  'register_viewed',
  'register_success',
  'register_error',
  'dashboard_viewed',
  'reassessment_started',
  'feedback_submitted',
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { eventType, metadata } = req.body || {};

    if (!eventType || typeof eventType !== 'string') {
      return res.status(400).json({ error: 'eventType is required' });
    }

    if (!ALLOWED_EVENT_TYPES.has(eventType)) {
      return res.status(400).json({ error: 'Unknown event type' });
    }

    // Sanitize metadata — only allow primitive values, no deeply nested objects
    let safeMetadata = {};
    if (metadata && typeof metadata === 'object') {
      for (const [key, value] of Object.entries(metadata)) {
        if (
          typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'boolean'
        ) {
          safeMetadata[key] = value;
        }
      }
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
        // Non-blocking — analytics still works without auth
      }
    }

    const { error } = await supabase.from('analytics_events').insert({
      event_type: eventType,
      event_metadata: safeMetadata,
      participant_id: participantId,
    });

    if (error) {
      console.error('Analytics insert error:', error.message);
      // Don't expose the error to the client — analytics is non-critical
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Analytics handler error:', error.message);
    // Always return 200 — analytics failures should never break the UX
    return res.status(200).json({ success: true });
  }
}
