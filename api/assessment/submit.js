import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseSecretKey);

function normalizeDomainScore(itemScores) {
  if (!itemScores.length) return 0;

  const average =
    itemScores.reduce((sum, value) => sum + value, 0) /
    itemScores.length;

  return Math.round(average * 5 * 100) / 100;
}

function buildRecommendations({
  answersByKey,
  domainScores,
}) {
  const recommendations = [];

  const duration = domainScores.sleep_duration ?? 0;
  const quality = domainScores.sleep_quality ?? 0;
  const daytime = domainScores.daytime_recovery ?? 0;
  const regularity = domainScores.regularity ?? 0;
  const habits = domainScores.sleep_habits ?? 0;

  if (duration <= 12) {
    recommendations.push({
      title: 'Create more sleep opportunity',
      text:
        'Try moving your bedtime earlier by 15–30 minutes while keeping your wake time relatively consistent.',
    });
  }

  if (regularity <= 12) {
    recommendations.push({
      title: 'Improve sleep regularity',
      text:
        'Try to keep your wake time within about one hour from day to day, including weekends.',
    });
  }

  if (habits <= 12) {
    recommendations.push({
      title: 'Strengthen your wind-down routine',
      text:
        'Focus on the habits that scored lowest, such as earlier caffeine timing, less stimulating screen use, or improving your sleep environment.',
    });
  }

  if (quality <= 12) {
    recommendations.push({
      title: 'Support sleep quality',
      text:
        'Pay attention to factors that may be disrupting sleep, including stress, discomfort, nighttime awakenings, alcohol, or your sleep environment.',
    });
  }

  if (daytime <= 12) {
    recommendations.push({
      title: 'Address daytime sleepiness',
      text:
        'If significant sleepiness continues despite adequate sleep opportunity, consider discussing it with a healthcare professional.',
    });
  }

  const caffeineAnswer = answersByKey.q23;
  if (
    caffeineAnswer &&
    [
      '3–4 days per week',
      '5 or more days per week',
    ].includes(caffeineAnswer)
  ) {
    recommendations.unshift({
      title: 'Move caffeine earlier',
      text:
        'Try having your last caffeine at least 8 hours before your intended bedtime for one week.',
    });
  }

  const screenAnswer = answersByKey.q25;
  if (
    screenAnswer &&
    ['Often', 'Almost every night'].includes(screenAnswer)
  ) {
    recommendations.unshift({
      title: 'Create a lower-stimulation final hour',
      text:
        'Try replacing the final 20–30 minutes of highly stimulating screen use with a quieter activity.',
    });
  }

  return recommendations.slice(0, 3);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      token,
      answers,
      profile,
      consentAccepted,
    } = req.body || {};

    if (!token) {
      return res.status(400).json({ error: 'Missing assessment token' });
    }

    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ error: 'Answers are required' });
    }

    const { data: instance, error: instanceError } = await supabase
      .from('assessment_instances')
      .select(`
        id,
        participant_id,
        assessment_type_id,
        status
      `)
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

    const { data: questions, error: questionsError } = await supabase
      .from('assessment_questions')
      .select(`
        id,
        question_key,
        prompt,
        domain,
        scored,
        options,
        required
      `)
      .eq('assessment_type_id', instance.assessment_type_id);

    if (questionsError) {
      throw questionsError;
    }

    const questionsByKey = {};
    for (const question of questions || []) {
      questionsByKey[question.question_key] = question;
    }

    const responseRows = [];
    const domainItemScores = {};
    const answersByKey = {};

    for (const [questionKey, answer] of Object.entries(answers)) {
      const question = questionsByKey[questionKey];

      if (!question) continue;

      answersByKey[questionKey] = answer;

      let itemScore = null;

      if (question.scored && Array.isArray(question.options)) {
        const matchedOption = question.options.find((option) => {
          if (Array.isArray(answer)) {
            return false;
          }

          return option.value === answer ||
                 option.label === answer;
        });

        if (
          matchedOption &&
          typeof matchedOption.score === 'number'
        ) {
          itemScore = matchedOption.score;

          if (!domainItemScores[question.domain]) {
            domainItemScores[question.domain] = [];
          }

          domainItemScores[question.domain].push(itemScore);
        }
      }

      responseRows.push({
        assessment_instance_id: instance.id,
        question_id: question.id,
        answer,
        item_score: itemScore,
      });
    }

    if (responseRows.length === 0) {
      return res.status(400).json({
        error: 'No valid assessment answers were provided',
      });
    }

    const { error: responsesError } = await supabase
      .from('assessment_responses')
      .upsert(responseRows, {
        onConflict: 'assessment_instance_id,question_id',
      });

    if (responsesError) {
      throw responsesError;
    }

    // Save profile fields from Q1-Q6 / onboarding.
    if (profile && typeof profile === 'object') {
      const participantUpdate = {};

      if (profile.preferred_name !== undefined) {
        participantUpdate.preferred_name = profile.preferred_name;
      }

      if (profile.pronouns !== undefined) {
        participantUpdate.pronouns = profile.pronouns;
      }

      if (profile.age_range !== undefined) {
        participantUpdate.age_range = profile.age_range;
      }

      if (profile.gender !== undefined) {
        participantUpdate.gender = profile.gender;
      }

      if (profile.sex_at_birth !== undefined) {
        participantUpdate.sex_at_birth = profile.sex_at_birth;
      }

      if (profile.race_ethnicity !== undefined) {
        participantUpdate.race_ethnicity =
          profile.race_ethnicity;
      }

      if (Object.keys(participantUpdate).length > 0) {
        const { error: participantError } = await supabase
          .from('participants')
          .update(participantUpdate)
          .eq('id', instance.participant_id);

        if (participantError) {
          throw participantError;
        }
      }
    }

    if (consentAccepted === true) {
      const { error: consentError } = await supabase
        .from('consent_events')
        .insert({
          participant_id: instance.participant_id,
          consent_type: 'assessment_wellness_data',
          policy_version:
            process.env.CONSENT_POLICY_VERSION || '1.0',
          accepted: true,
          source: 'sleep_assessment',
        });

      if (consentError) {
        throw consentError;
      }
    }

    const domainScores = {};

    for (const [domain, scores] of Object.entries(domainItemScores)) {
      domainScores[domain] =
        normalizeDomainScore(scores);
    }

    const domainRows = Object.entries(domainScores).map(
      ([domain, score]) => ({
        assessment_instance_id: instance.id,
        domain,
        score,
        max_score: 20,
      })
    );

    if (domainRows.length > 0) {
      const { error: domainError } = await supabase
        .from('assessment_domain_scores')
        .upsert(domainRows, {
          onConflict: 'assessment_instance_id,domain',
        });

      if (domainError) {
        throw domainError;
      }
    }

    const allDomainScores = Object.values(domainScores);

    const overallScore = Math.round(
      allDomainScores.reduce(
        (sum, score) => sum + Number(score),
        0
      )
    );

    const sortedDomains = Object.entries(domainScores)
      .sort((a, b) => b[1] - a[1]);

    const strongestDomain =
      sortedDomains.length > 0
        ? sortedDomains[0][0]
        : null;

    const weakestDomain =
      sortedDomains.length > 0
        ? sortedDomains[sortedDomains.length - 1][0]
        : null;

    // Safety flags
    const sleepBreathingFlag =
      answersByKey.q30 === 'Yes';

    const drivingSleepinessFlag =
      answersByKey.q31 === 'Once' ||
      answersByKey.q31 === 'More than once';

    const insomniaFlag =
      answersByKey.q32 === 'Yes' &&
      answersByKey.q33 === 'Yes';

    const restlessLegsFlag =
      answersByKey.q34 === 'Yes';

    const recommendations = buildRecommendations({
      answersByKey,
      domainScores,
    });

    const resultSummary = {
      strongest_domain: strongestDomain,
      weakest_domain: weakestDomain,
      sleep_breathing_flag: sleepBreathingFlag,
      driving_sleepiness_flag: drivingSleepinessFlag,
      insomnia_flag: insomniaFlag,
      restless_legs_flag: restlessLegsFlag,
      recommendations,
    };

    const { error: completeError } = await supabase
      .from('assessment_instances')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        overall_score: overallScore,
        result_summary: resultSummary,
      })
      .eq('id', instance.id);

    if (completeError) {
      throw completeError;
    }

    return res.status(200).json({
      success: true,
      result: {
        overallScore,
        domainScores,
        strongestDomain,
        weakestDomain,
        flags: {
          sleepBreathing: sleepBreathingFlag,
          drivingSleepiness: drivingSleepinessFlag,
          insomnia: insomniaFlag,
          restlessLegs: restlessLegsFlag,
        },
        recommendations,
      },
    });
  } catch (error) {
    console.error('Assessment submit error:', error);

    return res.status(500).json({
      error: error.message || 'Internal server error',
    });
  }
}
