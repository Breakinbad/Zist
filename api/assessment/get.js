const { selectOne, selectRows } = require('../_lib/supabase');
const { json, methodNotAllowed, isUuid } = require('../_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  try {
    const token = String(req.query.token || '').trim();
    if (!isUuid(token)) return json(res, 400, { error: 'Invalid assessment link.' });

    const instance = await selectOne(
      'assessment_instances',
      `select=id,participant_id,assessment_type_id,status,completed_at,overall_score,result_summary&access_token=eq.${encodeURIComponent(token)}`
    );

    if (!instance || instance.status === 'expired') {
      return json(res, 404, { error: 'This assessment link is invalid or has expired.' });
    }

    const [assessment, participant, questions, domainScores] = await Promise.all([
      selectOne(
        'assessment_types',
        `select=id,slug,name,version,description&active=eq.true&id=eq.${instance.assessment_type_id}`
      ),
      selectOne(
        'participants',
        `select=id,preferred_name,pronouns,age_range,gender,sex_at_birth,race_ethnicity&id=eq.${instance.participant_id}`
      ),
      selectRows(
        'assessment_questions',
        `select=id,question_key,section,prompt,help_text,question_type,options,required,domain,scored,order_index,display_if,profile_field&assessment_type_id=eq.${instance.assessment_type_id}&order=order_index.asc`
      ),
      instance.status === 'completed'
        ? selectRows(
            'assessment_domain_scores',
            `select=domain,score,max_score&assessment_instance_id=eq.${instance.id}&order=domain.asc`
          )
        : Promise.resolve([]),
    ]);

    if (!assessment) return json(res, 404, { error: 'Assessment is unavailable.' });

    const profile = participant || {};
    const profileComplete = Boolean(
      profile.preferred_name &&
      profile.age_range &&
      profile.gender &&
      profile.sex_at_birth &&
      Array.isArray(profile.race_ethnicity) &&
      profile.race_ethnicity.length
    );

    return json(res, 200, {
      instance: {
        id: instance.id,
        status: instance.status,
        completedAt: instance.completed_at,
      },
      assessment,
      participant: {
        preferredName: profile.preferred_name || '',
        profileComplete,
        profile: {
          preferred_name: profile.preferred_name || null,
          pronouns: profile.pronouns || null,
          age_range: profile.age_range || null,
          gender: profile.gender || null,
          sex_at_birth: profile.sex_at_birth || null,
          race_ethnicity: profile.race_ethnicity || null,
        },
      },
      questions,
      result:
        instance.status === 'completed'
          ? {
              overallScore: Number(instance.overall_score),
              summary: instance.result_summary || {},
              domainScores,
            }
          : null,
    });
  } catch (error) {
    console.error('assessment/get error', error);
    return json(res, error.statusCode || 500, { error: 'Could not load this assessment.' });
  }
};
