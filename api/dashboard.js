// Returns the authenticated user's assessment history and dashboard data.
//
// GET  Authorization: Bearer <access token>
//   → assessment instances + domain scores for the linked participant.
//
// POST Authorization: Bearer <access token>
//   → creates a new 'invited' Sleep & Recovery assessment instance for the
//     linked participant and returns its access token so the dashboard can
//     redirect to /a/<token>.
//
// Uses the service role key (bypasses RLS) to read and create assessments
// linked to the authenticated user's participant record.

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return getDashboard(req, res);
  }
  if (req.method === 'POST') {
    return createReassessment(req, res);
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

// ── Shared: verify the JWT and resolve the linked participant ──
async function verifyAuth(accessToken) {
  if (!accessToken) {
    return { error: { status: 401, body: { error: 'Authentication required' } } };
  }

  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } =
    await supabase.auth.getUser(accessToken);

  if (userError || !userData?.user) {
    return { error: { status: 401, body: { error: 'Invalid or expired session' } } };
  }

  const authUserId = userData.user.id;

  const { data: participant, error: participantError } = await supabase
    .from('participants')
    .select('id, preferred_name, email')
    .eq('user_id', authUserId)
    .maybeSingle();

  if (participantError) {
    return { error: { status: 500, body: { error: participantError.message } } };
  }

  return { supabase, authUserId, userData, participant };
}

async function getDashboard(req, res) {
  try {
    // ── Verify the user's JWT ──
    const authHeader = req.headers['authorization'] || '';
    const accessToken = authHeader.replace(/^Bearer\s+/i, '');

    const authed = await verifyAuth(accessToken);
    if (authed.error) {
      return res.status(authed.error.status).json(authed.error.body);
    }
    const { supabase, userData, participant } = authed;

    if (!participant) {
      // User exists but hasn't been linked to any assessments yet
      return res.status(200).json({
        success: true,
        user: {
          email: userData.user.email,
        },
        participant: null,
        assessments: [],
      });
    }

    // ── Fetch all assessment instances for this participant ──
    const { data: instances, error: instancesError } = await supabase
      .from('assessment_instances')
      .select(
        `
        id,
        access_token,
        status,
        overall_score,
        result_summary,
        started_at,
        completed_at,
        assessment_type_id,
        assessment_types (
          slug,
          name,
          version,
          description
        )
      `
      )
      .eq('participant_id', participant.id)
      .order('completed_at', { ascending: false, nullsFirst: false });

    if (instancesError) {
      throw instancesError;
    }

    // ── Fetch domain scores for completed assessments ──
    const completedIds = (instances || [])
      .filter((i) => i.status === 'completed')
      .map((i) => i.id);

    let domainScores = {};
    if (completedIds.length > 0) {
      const { data: scores, error: scoresError } = await supabase
        .from('assessment_domain_scores')
        .select('assessment_instance_id, domain, score, max_score')
        .in('assessment_instance_id', completedIds);

      if (scoresError) {
        throw scoresError;
      }

      for (const s of scores || []) {
        if (!domainScores[s.assessment_instance_id]) {
          domainScores[s.assessment_instance_id] = [];
        }
        domainScores[s.assessment_instance_id].push({
          domain: s.domain,
          score: s.score,
          maxScore: s.max_score,
        });
      }
    }

    // ── Format the response ──
    const assessments = (instances || []).map((instance) => ({
      id: instance.id,
      accessToken: instance.access_token,
      status: instance.status,
      overallScore: instance.overall_score,
      resultSummary: instance.result_summary || {},
      startedAt: instance.started_at,
      completedAt: instance.completed_at,
      type: instance.assessment_types
        ? {
            slug: instance.assessment_types.slug,
            name: instance.assessment_types.name,
            version: instance.assessment_types.version,
            description: instance.assessment_types.description,
          }
        : null,
      domainScores: domainScores[instance.id] || [],
    }));

    return res.status(200).json({
      success: true,
      user: {
        email: userData.user.email,
      },
      participant: {
        preferredName: participant.preferred_name,
        email: participant.email,
      },
      assessments,
    });
  } catch (error) {
    console.error('Dashboard API error:', error);
    return res
      .status(500)
      .json({ error: 'Something went wrong. Please try again.' });
  }
}

async function createReassessment(req, res) {
  try {
    // ── Verify the user's JWT ──
    const authHeader = req.headers['authorization'] || '';
    const accessToken = authHeader.replace(/^Bearer\s+/i, '');

    const authed = await verifyAuth(accessToken);
    if (authed.error) {
      return res.status(authed.error.status).json(authed.error.body);
    }
    const { supabase, participant } = authed;

    if (!participant) {
      // No linked participant — can't create an assessment for this account
      return res.status(403).json({
        error: 'No participant record is linked to this account.',
      });
    }

    // ── Get the latest active sleep-recovery assessment type ──
    const { data: assessmentType, error: assessmentTypeError } = await supabase
      .from('assessment_types')
      .select('id, slug, name, version')
      .eq('slug', 'sleep-recovery')
      .eq('active', true)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (assessmentTypeError) {
      throw assessmentTypeError;
    }

    if (!assessmentType) {
      return res.status(404).json({
        error: 'No active Sleep & Recovery assessment type is configured.',
      });
    }

    // ── Create a new 'invited' assessment instance ──
    const { data: instance, error: instanceError } = await supabase
      .from('assessment_instances')
      .insert({
        participant_id: participant.id,
        assessment_type_id: assessmentType.id,
        status: 'invited',
      })
      .select()
      .single();

    if (instanceError) {
      throw instanceError;
    }

    return res.status(200).json({
      success: true,
      accessToken: instance.access_token,
    });
  } catch (error) {
    console.error('Reassessment API error:', error);
    return res
      .status(500)
      .json({ error: 'Something went wrong. Please try again.' });
  }
}
