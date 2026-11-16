import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseSecretKey);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { token, answers } = req.body || {};

    if (!token) {
      return res.status(400).json({ error: 'Missing assessment token' });
    }

    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ error: 'Answers are required' });
    }

    // -----------------------------------
    // Look up assessment instance by token
    // -----------------------------------

    const {
      data: instance,
      error: instanceError,
    } = await supabase
      .from('assessment_instances')
      .select('id, assessment_type_id, status')
      .eq('access_token', token)
      .single();

    if (instanceError || !instance) {
      return res.status(404).json({ error: 'Assessment not found' });
    }

    if (instance.status === 'completed') {
      return res.status(409).json({
        error: 'This assessment has already been completed',
      });
    }

    // -----------------------------------
    // Fetch questions for this assessment type
    // so we can map answer keys -> question ids
    // -----------------------------------

    const {
      data: questions,
      error: questionsError,
    } = await supabase
      .from('assessment_questions')
      .select('id, question_key')
      .eq('assessment_type_id', instance.assessment_type_id);

    if (questionsError) {
      throw questionsError;
    }

    const questionsByKey = {};

    for (const question of questions || []) {
      questionsByKey[question.question_key] = question;
    }

    // -----------------------------------
    // Build response rows (no scoring)
    // -----------------------------------

    const responseRows = [];

    for (const [questionKey, answer] of Object.entries(answers)) {
      const question = questionsByKey[questionKey];

      if (!question) {
        continue;
      }

      responseRows.push({
        assessment_instance_id: instance.id,
        question_id: question.id,
        answer,
        item_score: null,
      });
    }

    if (responseRows.length === 0) {
      return res.status(200).json({ success: true });
    }

    // -----------------------------------
    // Upsert partial answers
    // -----------------------------------

    const { error: responsesError } = await supabase
      .from('assessment_responses')
      .upsert(responseRows, {
        onConflict: 'assessment_instance_id,question_id',
      });

    if (responsesError) {
      throw responsesError;
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Assessment save error:', error);

    return res.status(500).json({
      error: error.message || 'Internal server error',
    });
  }
}
