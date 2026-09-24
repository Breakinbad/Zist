const { selectOne, selectRows, insertRows, updateRows } = require('../_lib/supabase');
const {
  json,
  methodNotAllowed,
  isUuid,
  answerValue,
  multiValues,
  optionFor,
  isVisible,
} = require('../_lib/utils');

const DOMAIN_LABELS = {
  sleep_duration: 'Sleep Duration & Opportunity',
  sleep_quality: 'Sleep Quality & Continuity',
  daytime_recovery: 'Daytime Recovery',
  regularity: 'Sleep Regularity & Body Clock',
  sleep_habits: 'Sleep-Supporting Habits',
};

function profileHasValue(participant, field) {
  const value = participant[field];
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function normalizeProfileAnswer(question, answer) {
  const options = Array.isArray(question.options) ? question.options : [];
  const labelFor = (value) => {
    const option = options.find((item) => item.value === value);
    return option ? option.label : value;
  };

  if (question.question_type === 'multiple_choice') {
    const values = multiValues(answer);
    return values.map((value) => {
      if (value === 'other' && answer && typeof answer === 'object' && answer.otherText) {
        return `Other: ${String(answer.otherText).trim()}`;
      }
      return labelFor(value);
    });
  }

  if (answer && typeof answer === 'object' && !Array.isArray(answer)) {
    if (answer.value === 'other' && answer.otherText) return `Other: ${String(answer.otherText).trim()}`;
    return labelFor(answer.value);
  }
  return labelFor(answer);
}

function scoreLabel(score) {
  if (score >= 85) return { band: 'Strong Sleep & Recovery', description: 'Your current sleep pattern supports recovery well.' };
  if (score >= 70) return { band: 'Good Foundation', description: 'Your sleep is generally supportive of recovery, with a few areas worth improving.' };
  if (score >= 55) return { band: 'Room to Improve', description: 'Several parts of your sleep pattern may be limiting recovery.' };
  return { band: 'Sleep Needs Attention', description: 'Multiple parts of your sleep and recovery pattern could benefit from attention.' };
}

function buildRecommendations(questionsByKey, answers, itemScores, flags) {
  const recs = [];
  const add = (priority, key, title, text) => recs.push({ priority, key, title, text });

  const s = (key) => itemScores[key];

  if (s('q9') !== undefined && s('q9') < 4) {
    add(100, 'sleep_opportunity', 'Create more sleep opportunity', 'Try moving bedtime earlier by 15-30 minutes while keeping your wake time relatively consistent.');
  }
  if ((s('q19') !== undefined && s('q19') <= 2) || (s('q20') !== undefined && s('q20') <= 2)) {
    add(95, 'regularity', 'Make sleep timing more consistent', 'Choose a wake time you can maintain most days and try to stay within about one hour of it, including weekends.');
  }
  if (s('q12') !== undefined && s('q12') <= 2) {
    add(90, 'sleep_initiation', 'Support easier sleep onset', 'Create a repeatable wind-down period and avoid going to bed substantially before you feel sleepy.');
  }
  if (s('q23') !== undefined && s('q23') <= 2) {
    add(88, 'caffeine', 'Move caffeine earlier', 'For one week, try having your last caffeine at least 8 hours before your intended bedtime and notice whether falling asleep becomes easier.');
  }
  if (s('q24') !== undefined && s('q24') <= 2) {
    add(80, 'alcohol', 'Separate alcohol from sleep', 'Alcohol can make you feel sleepy at first but may contribute to lighter or more disrupted sleep later in the night.');
  }
  if (s('q25') !== undefined && s('q25') <= 2) {
    add(75, 'screens', 'Lower stimulation before bed', 'Try reducing brightness and replacing the final 20-30 minutes of highly engaging screen use with a quieter activity.');
  }
  if (s('q26') !== undefined && s('q26') <= 2) {
    add(72, 'environment', 'Improve your sleep environment', 'Focus on the factor that bothers you most: light, noise, temperature, or comfort.');
  }
  if (s('q28') !== undefined && s('q28') <= 2) {
    add(68, 'daylight', 'Get more early-day light', 'Aim for outdoor light or bright natural light earlier in your day on most days.');
  }
  if (flags.high_daytime_sleepiness_with_adequate_duration) {
    add(110, 'daytime_sleepiness', 'Pay attention to persistent daytime sleepiness', 'You report substantial daytime sleepiness despite adequate sleep duration. Persistent excessive sleepiness may be worth discussing with a healthcare professional.');
  }

  const seen = new Set();
  return recs
    .sort((a, b) => b.priority - a.priority)
    .filter((item) => {
      if (seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    })
    .slice(0, 3)
    .map(({ priority, ...item }) => item);
}

function buildWarnings(answers, itemScores) {
  const q = (key) => answerValue(answers[key]);
  const flags = {
    loud_snoring: q('q29') === 'yes',
    breathing_pause_or_gasping: q('q30') === 'yes',
    drowsy_driving: q('q31') === 'once' || q('q31') === 'more_than_once',
    insomnia_pattern:
      q('q32') === 'yes' &&
      q('q33') === 'yes' &&
      itemScores.q17 !== undefined &&
      itemScores.q17 <= 2,
    restless_legs_pattern: q('q34') === 'yes',
    high_daytime_sleepiness_with_adequate_duration:
      itemScores.q9 === 4 &&
      ((itemScores.q16 !== undefined && itemScores.q16 <= 1) ||
        (itemScores.q17 !== undefined && itemScores.q17 <= 1)),
  };

  const warnings = [];
  if (flags.drowsy_driving) {
    warnings.push({
      key: 'drowsy_driving',
      level: 'important',
      title: 'Driving safety',
      text: 'Severe sleepiness while driving can be dangerous. Avoid driving when you feel unable to stay alert and consider discussing persistent excessive sleepiness with a healthcare professional.',
    });
  }
  if (flags.breathing_pause_or_gasping) {
    warnings.push({
      key: 'sleep_breathing',
      level: 'review',
      title: 'Sleep breathing symptoms',
      text: 'Breathing pauses, choking, or gasping during sleep can occur with sleep-disordered breathing. Consider discussing this with a healthcare professional.',
    });
  }
  if (flags.insomnia_pattern) {
    warnings.push({
      key: 'insomnia_pattern',
      level: 'review',
      title: 'Persistent insomnia symptoms',
      text: 'Your answers show a persistent pattern of sleep difficulty with daytime impact. This assessment cannot diagnose insomnia, but it may be worth discussing with a healthcare professional. CBT-I is an evidence-based treatment for chronic insomnia.',
    });
  }
  if (flags.restless_legs_pattern) {
    warnings.push({
      key: 'restless_legs',
      level: 'review',
      title: 'Restless legs symptoms',
      text: 'An uncomfortable urge to move the legs that is worse at rest or at night can occur with restless legs syndrome and other conditions. Consider mentioning it to a healthcare professional if it regularly affects sleep.',
    });
  }

  return { flags, warnings };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const token = String(body.token || '').trim();
    const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};
    const consentAccepted = body.consentAccepted === true;
    const policyVersion = String(body.policyVersion || process.env.CONSENT_POLICY_VERSION || '2026-09-v1');

    if (!isUuid(token)) return json(res, 400, { error: 'Invalid assessment link.' });
    if (!consentAccepted) return json(res, 400, { error: 'Consent is required before submitting the assessment.' });

    const instance = await selectOne(
      'assessment_instances',
      `select=id,participant_id,assessment_type_id,status,overall_score,result_summary&access_token=eq.${encodeURIComponent(token)}`
    );

    if (!instance || instance.status === 'expired') {
      return json(res, 404, { error: 'This assessment link is invalid or has expired.' });
    }

    if (instance.status === 'completed') {
      const domainScores = await selectRows(
        'assessment_domain_scores',
        `select=domain,score,max_score&assessment_instance_id=eq.${instance.id}`
      );
      return json(res, 200, {
        ok: true,
        alreadyCompleted: true,
        result: {
          overallScore: Number(instance.overall_score),
          summary: instance.result_summary || {},
          domainScores,
        },
      });
    }

    const [participant, questions] = await Promise.all([
      selectOne(
        'participants',
        `select=id,preferred_name,pronouns,age_range,gender,sex_at_birth,race_ethnicity&id=eq.${instance.participant_id}`
      ),
      selectRows(
        'assessment_questions',
        `select=id,question_key,prompt,question_type,options,required,domain,scored,order_index,display_if,profile_field&assessment_type_id=eq.${instance.assessment_type_id}&order=order_index.asc`
      ),
    ]);

    if (!participant || !questions.length) {
      return json(res, 500, { error: 'Assessment configuration is incomplete.' });
    }

    const missing = [];
    for (const question of questions) {
      if (!question.required || !isVisible(question, answers)) continue;
      const answer = answers[question.question_key];
      const hasStoredProfile = question.profile_field && profileHasValue(participant, question.profile_field);
      const emptyArray = Array.isArray(answer) && answer.length === 0;
      const emptyObjectArray = answer && typeof answer === 'object' && Array.isArray(answer.values) && answer.values.length === 0;
      const missingAnswer = answer === undefined || answer === null || answer === '' || emptyArray || emptyObjectArray;
      if (missingAnswer && !hasStoredProfile) missing.push(question.question_key);
    }

    if (missing.length) {
      return json(res, 400, { error: 'Please answer all required questions.', missing });
    }

    const responseRows = [];
    const itemScores = {};
    const domainRaw = {};
    const profileUpdates = {};
    const questionsByKey = Object.fromEntries(questions.map((q) => [q.question_key, q]));

    for (const question of questions) {
      if (!isVisible(question, answers)) continue;
      let answer = answers[question.question_key];

      // If profile questions were already completed, the browser may omit them.
      if ((answer === undefined || answer === null || answer === '') && question.profile_field && profileHasValue(participant, question.profile_field)) {
        answer = participant[question.profile_field];
      }
      if (answer === undefined || answer === null || answer === '') continue;

      let itemScore = null;
      if (question.scored) {
        const option = optionFor(question, answer);
        if (!option || typeof option.score !== 'number') {
          return json(res, 400, { error: `Invalid answer for ${question.question_key}.` });
        }
        itemScore = option.score;
        itemScores[question.question_key] = itemScore;
        if (!domainRaw[question.domain]) domainRaw[question.domain] = { sum: 0, count: 0 };
        domainRaw[question.domain].sum += itemScore;
        domainRaw[question.domain].count += 1;
      }

      if (question.profile_field) {
        profileUpdates[question.profile_field] = normalizeProfileAnswer(question, answer);
      }

      responseRows.push({
        assessment_instance_id: instance.id,
        question_id: question.id,
        answer,
        item_score: itemScore,
        updated_at: new Date().toISOString(),
      });
    }

    const expectedDomains = ['sleep_duration', 'sleep_quality', 'daytime_recovery', 'regularity', 'sleep_habits'];
    const domainScores = [];
    for (const domain of expectedDomains) {
      const raw = domainRaw[domain];
      if (!raw || !raw.count) return json(res, 400, { error: `Missing scored responses for ${domain}.` });
      const score = Math.round(((raw.sum / raw.count) * 5) * 10) / 10;
      domainScores.push({ domain, score, max_score: 20 });
    }

    const overallScore = Math.round(domainScores.reduce((sum, row) => sum + row.score, 0));
    const strongest = [...domainScores].sort((a, b) => b.score - a.score)[0];
    const weakest = [...domainScores].sort((a, b) => a.score - b.score)[0];
    const { flags, warnings } = buildWarnings(answers, itemScores);
    const recommendations = buildRecommendations(questionsByKey, answers, itemScores, flags);
    const interpretation = scoreLabel(overallScore);

    if (responseRows.length) {
      await insertRows('assessment_responses', responseRows, {
        upsert: true,
        onConflict: 'assessment_instance_id,question_id',
        returnRepresentation: false,
      });
    }

    await insertRows(
      'assessment_domain_scores',
      domainScores.map((row) => ({ assessment_instance_id: instance.id, ...row })),
      {
        upsert: true,
        onConflict: 'assessment_instance_id,domain',
        returnRepresentation: false,
      }
    );

    if (Object.keys(profileUpdates).length) {
      await updateRows('participants', `id=eq.${participant.id}`, profileUpdates);
    }

    await insertRows(
      'consent_events',
      [
        {
          participant_id: participant.id,
          consent_type: 'assessment_data_processing',
          policy_version: policyVersion,
          accepted: true,
          source: 'sleep-recovery-assessment',
        },
      ],
      { returnRepresentation: false }
    );

    const resultSummary = {
      band: interpretation.band,
      description: interpretation.description,
      strongest_domain: strongest.domain,
      strongest_domain_label: DOMAIN_LABELS[strongest.domain] || strongest.domain,
      weakest_domain: weakest.domain,
      weakest_domain_label: DOMAIN_LABELS[weakest.domain] || weakest.domain,
      recommendations,
      flags,
      warnings,
    };

    await updateRows('assessment_instances', `id=eq.${instance.id}`, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      overall_score: overallScore,
      result_summary: resultSummary,
    });

    return json(res, 200, {
      ok: true,
      result: {
        overallScore,
        summary: resultSummary,
        domainScores,
      },
    });
  } catch (error) {
    console.error('assessment/submit error', error);
    return json(res, error.statusCode || 500, { error: 'Could not save your assessment. Please try again.' });
  }
};
