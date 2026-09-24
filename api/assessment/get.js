import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseSecretKey);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const token = req.query.token;

    if (!token) {
      return res.status(400).json({ error: 'Missing assessment token' });
    }

    const { data: instance, error: instanceError } = await supabase
      .from('assessment_instances')
      .select(`
        id,
        status,
        overall_score,
        result_summary,
        started_at,
        completed_at,
        participant_id,
        assessment_type_id,
        participants (
          preferred_name,
          pronouns,
          age_range,
          gender,
          sex_at_birth,
          race_ethnicity
        ),
        assessment_types (
          id,
          slug,
          name,
          version,
          description
        )
      `)
      .eq('access_token', token)
      .single();

    if (instanceError || !instance) {
      return res.status(404).json({ error: 'Assessment not found' });
    }

    const { data: questions, error: questionError } = await supabase
      .from('assessment_questions')
      .select('*')
      .eq('assessment_type_id', instance.assessment_type_id)
      .order('order_index', { ascending: true });

    if (questionError) {
      throw questionError;
    }

    let domainScores = [];
    let responses = [];

    if (instance.status === 'completed') {
      const { data: scoreData, error: scoreError } = await supabase
        .from('assessment_domain_scores')
        .select('domain, score, max_score')
        .eq('assessment_instance_id', instance.id);

      if (scoreError) throw scoreError;

      domainScores = scoreData || [];

      const { data: responseData, error: responseError } = await supabase
        .from('assessment_responses')
        .select(`
          question_id,
          answer,
          item_score,
          assessment_questions (
            question_key,
            prompt,
            domain
          )
        `)
        .eq('assessment_instance_id', instance.id);

      if (responseError) throw responseError;

      responses = responseData || [];
    }

    if (instance.status === 'invited') {
      await supabase
        .from('assessment_instances')
        .update({
          status: 'started',
          started_at: new Date().toISOString(),
        })
        .eq('id', instance.id);
    }

    return res.status(200).json({
      success: true,
      assessment: {
        id: instance.id,
        status:
          instance.status === 'invited'
            ? 'started'
            : instance.status,
        overallScore: instance.overall_score,
        resultSummary: instance.result_summary,
        participant: instance.participants,
        type: instance.assessment_types,
        questions,
        domainScores,
        responses,
      },
    });
  } catch (error) {
    console.error('Assessment get error:', error);

    return res.status(500).json({
      error: error.message || 'Internal server error',
    });
  }
}
