import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(
  supabaseUrl,
  supabaseSecretKey
);

const DOMAIN_LABELS = {
  duration: 'Sleep Duration',
  regularity: 'Sleep Regularity',
  satisfaction: 'Sleep Satisfaction',
  continuity: 'Sleep Continuity',
  alertness: 'Daytime Alertness & Recovery',
  timing: 'Sleep Timing & Alignment',
};

function answerValue(answer) {
  return (
    answer &&
    typeof answer === 'object' &&
    !Array.isArray(answer) &&
    'value' in answer
  )
    ? answer.value
    : answer;
}

function answerValues(answer) {
  if (Array.isArray(answer)) {
    return answer;
  }

  if (
    answer &&
    Array.isArray(answer.values)
  ) {
    return answer.values;
  }

  return [];
}

function getOption(question, answer) {
  const value = answerValue(answer);

  return (question.options || []).find(
    (option) =>
      option.value === value ||
      option.label === value
  );
}

function calculateDomainScore(scores) {
  if (!scores.length) {
    return null;
  }

  const earned = scores.reduce(
    (sum, score) =>
      sum + Number(score),
    0
  );

  const maximum = scores.length * 4;

  return Math.round(
    (earned / maximum) * 100
  );
}

function getBand(score) {
  if (score >= 85) {
    return {
      band:
        'Sleep is supporting you well',
      description:
        'Your overall sleep pattern is strong across most dimensions.',
    };
  }

  if (score >= 70) {
    return {
      band:
        'Generally healthy, with opportunities to improve',
      description:
        'Several aspects of your sleep are working well, with one or more areas that could improve recovery.',
    };
  }

  if (score >= 55) {
    return {
      band:
        'Several areas could improve',
      description:
        'Some important dimensions of sleep may be limiting how well rested and recovered you feel.',
    };
  }

  return {
    band:
      'Your sleep needs more attention',
    description:
      'Multiple dimensions of your sleep pattern may be interfering with recovery or daytime functioning.',
  };
}

function buildWarnings({
  answersByKey,
  domainScores,
}) {
  const warnings = [];

  // Possible sleep-breathing concern
  if (
    answerValue(
      answersByKey.q30
    ) === 'yes'
  ) {
    warnings.push({
      level: 'important',
      title:
        'Possible sleep-breathing concern',
      text:
        'Breathing pauses, choking, or gasping during sleep can occur with sleep-disordered breathing. Zist cannot determine whether you have a sleep disorder. Consider discussing these symptoms with a healthcare professional.',
    });
  } else if (
    answerValue(
      answersByKey.q29
    ) === 'yes'
  ) {
    warnings.push({
      level: 'normal',
      title:
        'Regular loud snoring',
      text:
        'You reported regular loud snoring. Snoring alone does not establish a sleep disorder, but it can be useful context if you discuss your sleep with a healthcare professional.',
    });
  }

  // Driving safety
  if (
    [
      'once',
      'more_than_once',
    ].includes(
      answerValue(
        answersByKey.q31
      )
    )
  ) {
    warnings.push({
      level: 'important',
      title: 'Driving safety',
      text:
        'Severe sleepiness while driving can be dangerous. Avoid driving when you feel unable to remain alert. Persistent excessive daytime sleepiness may also be worth discussing with a healthcare professional.',
    });
  }

  // Persistent insomnia-like symptoms
  const insomniaSymptoms =
    answerValues(
      answersByKey.q32
    );

  const hasInsomniaSymptoms =
    insomniaSymptoms.length > 0 &&
    !insomniaSymptoms.includes(
      'none'
    );

  if (
    hasInsomniaSymptoms &&
    answerValue(
      answersByKey.q33
    ) === 'yes' &&
    answerValue(
      answersByKey.q34
    ) === 'yes'
  ) {
    warnings.push({
      level: 'normal',
      title:
        'Persistent sleep difficulty',
      text:
        'Your answers describe persistent sleep difficulties that affect daytime functioning. Zist cannot diagnose insomnia, but these symptoms may be worth discussing with a healthcare professional. Cognitive behavioral therapy for insomnia (CBT-I) is an evidence-based treatment for chronic insomnia.',
    });
  }

  // Restless-leg-type symptoms
  if (
    answerValue(
      answersByKey.q35
    ) === 'yes' &&
    answerValue(
      answersByKey.q36
    ) === 'yes'
  ) {
    warnings.push({
      level: 'normal',
      title:
        'Leg discomfort at night',
      text:
        'An urge to move the legs that appears at rest and improves with movement can occur with restless legs syndrome and other conditions. If it regularly interferes with sleep, consider discussing it with a healthcare professional.',
    });
  }

  // Daytime sleepiness despite adequate duration
  if (
    (
      domainScores.alertness ??
      100
    ) < 50 &&
    (
      domainScores.duration ??
      0
    ) >= 75
  ) {
    warnings.push({
      level: 'normal',
      title:
        'Daytime sleepiness despite adequate sleep duration',
      text:
        'You report significant daytime sleepiness despite a reasonable amount of sleep. Persistent excessive sleepiness can have several causes and may be worth discussing with a healthcare professional.',
    });
  }

  return warnings;
}

function buildRecommendations({
  answersByKey,
  domainScores,
}) {
  const recommendations = [];

  function addRecommendation(
    title,
    text
  ) {
    if (
      !recommendations.some(
        (item) =>
          item.title === title
      )
    ) {
      recommendations.push({
        title,
        text,
      });
    }
  }

  const q8 =
    answerValues(
      answersByKey.q8
    );

  // Low sleep duration
  if (
    (
      domainScores.duration ??
      100
    ) < 70 &&
    [
      'lt5',
      '5_6',
      '6_7',
    ].includes(
      answerValue(
        answersByKey.q9
      )
    )
  ) {
    addRecommendation(
      'Create more sleep opportunity',
      'Try adding 15–30 minutes to your sleep opportunity for the next week while keeping your wake time relatively consistent.'
    );
  }

  // Low regularity
  if (
    (
      domainScores.regularity ??
      100
    ) < 70
  ) {
    addRecommendation(
      'Anchor your wake time',
      'Choose a wake time that works for most days and try to stay within approximately one hour of it, including weekends when practical.'
    );
  }

  // Low continuity + late caffeine
  if (
    (
      domainScores.continuity ??
      100
    ) < 70 &&
    [
      '3_4_week',
      '5_plus_week',
    ].includes(
      answerValue(
        answersByKey.q21
      )
    )
  ) {
    addRecommendation(
      'Move caffeine earlier',
      'Try having your last caffeine at least 8 hours before you intend to sleep for the next week and see whether falling or staying asleep becomes easier.'
    );
  }

  // Low continuity + alcohol
  if (
    (
      domainScores.continuity ??
      100
    ) < 70 &&
    [
      '3_4_week',
      '5_plus_week',
    ].includes(
      answerValue(
        answersByKey.q22
      )
    )
  ) {
    addRecommendation(
      'Separate alcohol from bedtime',
      'Alcohol can make you feel sleepy initially while contributing to lighter or more disrupted sleep later in the night. Try increasing the time between alcohol and sleep.'
    );
  }

  // Low continuity + screen use
  if (
    (
      domainScores.continuity ??
      100
    ) < 70 &&
    [
      'often',
      'almost_every_night',
    ].includes(
      answerValue(
        answersByKey.q23
      )
    )
  ) {
    addRecommendation(
      'Create a lower-stimulation final 30 minutes',
      'Try replacing the final 20–30 minutes of highly stimulating screen use with something quieter.'
    );
  }

  // Low satisfaction + stress
  if (
    (
      domainScores.satisfaction ??
      100
    ) < 70 &&
    q8.includes('stress')
  ) {
    addRecommendation(
      'Build a mental wind-down period',
      'Give yourself a short transition between the day’s demands and trying to sleep. Experiment with a consistent 10–20 minute calming routine.'
    );
  }

  // Low continuity + poor environment
  if (
    (
      domainScores.continuity ??
      100
    ) < 70 &&
    [
      'occasionally',
      'rarely',
    ].includes(
      answerValue(
        answersByKey.q24
      )
    )
  ) {
    addRecommendation(
      'Improve your sleep environment',
      'Look for one environmental change that would make your sleep space darker, quieter, or more comfortable.'
    );
  }

  // Poor alertness despite adequate duration
  if (
    (
      domainScores.alertness ??
      100
    ) < 50 &&
    (
      domainScores.duration ??
      0
    ) >= 75
  ) {
    addRecommendation(
      'Pay attention to persistent daytime sleepiness',
      'You report substantial daytime tiredness despite reasonable sleep duration. Persistent sleepiness can have several causes and may be worth discussing with a healthcare professional.'
    );
  }

  // Long sleep + poor alertness
  if (
    answerValue(
      answersByKey.q9
    ) === 'gt9' &&
    (
      domainScores.alertness ??
      100
    ) < 50
  ) {
    addRecommendation(
      'Notice fatigue despite longer sleep',
      'You report relatively long sleep along with substantial daytime tiredness. Longer sleep can be normal in some situations, but persistent fatigue despite extended sleep may be worth discussing with a healthcare professional.'
    );
  }

  // Fill remaining recommendations
  // according to lowest domains.
  const domainsFromLowestToHighest =
    Object.entries(
      domainScores
    ).sort(
      (a, b) =>
        a[1] - b[1]
    );

  for (
    const [domain]
    of domainsFromLowestToHighest
  ) {
    if (
      recommendations.length >= 3
    ) {
      break;
    }

    if (
      domain ===
      'satisfaction'
    ) {
      addRecommendation(
        'Support sleep satisfaction',
        'Focus on the one sleep factor that feels most disruptive to you and make one small change consistently for the next week.'
      );
    }

    if (
      domain === 'timing'
    ) {
      addRecommendation(
        'Support your natural sleep timing',
        'When possible, make your sleep window better match the hours when your body naturally feels ready to sleep and wake.'
      );
    }

    if (
      domain === 'alertness'
    ) {
      addRecommendation(
        'Protect daytime recovery',
        'Track when daytime sleepiness is strongest and whether it improves as your sleep schedule becomes more consistent.'
      );
    }
  }

  return recommendations.slice(
    0,
    3
  );
}

export default async function handler(
  req,
  res
) {
  if (
    req.method !== 'POST'
  ) {
    return res
      .status(405)
      .json({
        error:
          'Method not allowed',
      });
  }

  try {
    const {
      token,
      answers,
      consentAccepted,
      policyVersion,
    } = req.body || {};

    if (!token) {
      return res
        .status(400)
        .json({
          error:
            'Missing assessment token',
        });
    }

    if (
      !answers ||
      typeof answers !==
        'object'
    ) {
      return res
        .status(400)
        .json({
          error:
            'Answers are required',
        });
    }

    // -----------------------------------
    // Get assessment instance
    // -----------------------------------

    const {
      data: instance,
      error: instanceError,
    } = await supabase
      .from(
        'assessment_instances'
      )
      .select(`
        id,
        participant_id,
        assessment_type_id,
        status
      `)
      .eq(
        'access_token',
        token
      )
      .single();

    if (
      instanceError ||
      !instance
    ) {
      return res
        .status(404)
        .json({
          error:
            'Assessment not found',
        });
    }

    if (
      instance.status ===
      'completed'
    ) {
      return res
        .status(409)
        .json({
          error:
            'This assessment has already been completed',
        });
    }

    // -----------------------------------
    // Get questions
    // -----------------------------------

    const {
      data: questions,
      error: questionsError,
    } = await supabase
      .from(
        'assessment_questions'
      )
      .select(`
        id,
        question_key,
        prompt,
        question_type,
        domain,
        scored,
        options,
        required,
        profile_field
      `)
      .eq(
        'assessment_type_id',
        instance.assessment_type_id
      );

    if (questionsError) {
      throw questionsError;
    }

    const questionsByKey = {};

    for (
      const question
      of questions || []
    ) {
      questionsByKey[
        question.question_key
      ] = question;
    }

    // -----------------------------------
    // Process answers
    // -----------------------------------

    const responseRows = [];
    const domainItemScores = {};
    const answersByKey = {};

    for (
      const [
        questionKey,
        answer,
      ] of Object.entries(
        answers
      )
    ) {
      const question =
        questionsByKey[
          questionKey
        ];

      if (!question) {
        continue;
      }

      answersByKey[
        questionKey
      ] = answer;

      let itemScore = null;

      if (
        question.scored &&
        Array.isArray(
          question.options
        )
      ) {
        const matchedOption =
          getOption(
            question,
            answer
          );

        if (
          matchedOption &&
          typeof matchedOption
            .score === 'number'
        ) {
          itemScore =
            matchedOption.score;

          if (
            !domainItemScores[
              question.domain
            ]
          ) {
            domainItemScores[
              question.domain
            ] = [];
          }

          domainItemScores[
            question.domain
          ].push(itemScore);
        }
      }

      responseRows.push({
        assessment_instance_id:
          instance.id,
        question_id:
          question.id,
        answer,
        item_score:
          itemScore,
      });
    }

    if (
      responseRows.length === 0
    ) {
      return res
        .status(400)
        .json({
          error:
            'No valid assessment answers were provided',
        });
    }

    // -----------------------------------
    // Save individual responses
    // -----------------------------------

    const {
      error: responsesError,
    } = await supabase
      .from(
        'assessment_responses'
      )
      .upsert(
        responseRows,
        {
          onConflict:
            'assessment_instance_id,question_id',
        }
      );

    if (responsesError) {
      throw responsesError;
    }

    // -----------------------------------
    // Save About You profile fields
    // -----------------------------------

    const participantUpdate = {};

    for (
      const question
      of questions || []
    ) {
      if (
        !question.profile_field ||
        !(
          question.question_key
          in answers
        )
      ) {
        continue;
      }

      const answer =
        answers[
          question.question_key
        ];

      if (
        question.question_type ===
        'multiple_choice'
      ) {
        const selectedValues =
          answerValues(answer);

        participantUpdate[
          question.profile_field
        ] = selectedValues.map(
          (value) => {
            const option =
              (
                question.options ||
                []
              ).find(
                (item) =>
                  item.value ===
                  value
              );

            if (
              option
                ?.requires_text &&
              answer?.otherText
            ) {
              return answer
                .otherText;
            }

            return (
              option?.label ||
              value
            );
          }
        );
      } else if (
        question.question_type ===
        'text'
      ) {
        participantUpdate[
          question.profile_field
        ] = answer;
      } else {
        const option =
          getOption(
            question,
            answer
          );

        participantUpdate[
          question.profile_field
        ] =
          option?.requires_text &&
          answer?.otherText
            ? answer.otherText
            : option?.label ||
              answerValue(
                answer
              );
      }
    }

    if (
      Object.keys(
        participantUpdate
      ).length > 0
    ) {
      const {
        error:
          participantError,
      } = await supabase
        .from('participants')
        .update(
          participantUpdate
        )
        .eq(
          'id',
          instance.participant_id
        );

      if (
        participantError
      ) {
        throw participantError;
      }
    }

    // -----------------------------------
    // Save consent
    // -----------------------------------

    if (
      consentAccepted === true
    ) {
      const {
        error: consentError,
      } = await supabase
        .from(
          'consent_events'
        )
        .insert({
          participant_id:
            instance.participant_id,

          consent_type:
            'assessment_wellness_data',

          policy_version:
            policyVersion ||
            process.env
              .CONSENT_POLICY_VERSION ||
            '2026-09-v2',

          accepted: true,

          source:
            'sleep_assessment_v2',
        });

      if (consentError) {
        throw consentError;
      }
    }

    // -----------------------------------
    // Calculate the six V2 domains
    // -----------------------------------

    const requiredDomains = [
      'duration',
      'regularity',
      'satisfaction',
      'continuity',
      'alertness',
      'timing',
    ];

    const domainScores = {};

    for (
      const [
        domain,
        scores,
      ] of Object.entries(
        domainItemScores
      )
    ) {
      const score =
        calculateDomainScore(
          scores
        );

      if (score !== null) {
        domainScores[
          domain
        ] = score;
      }
    }

    // Make sure all six domains exist.
    for (
      const domain
      of requiredDomains
    ) {
      if (
        !(
          domain in
          domainScores
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              `Missing scored answers for ${DOMAIN_LABELS[domain]}`,
          });
      }
    }

    // -----------------------------------
    // Overall score
    //
    // Each domain contributes equally.
    // -----------------------------------

    const overallScore =
      Math.round(
        requiredDomains.reduce(
          (
            sum,
            domain
          ) =>
            sum +
            Number(
              domainScores[
                domain
              ]
            ),
          0
        ) /
          requiredDomains.length
      );

    // -----------------------------------
    // Strongest / weakest domains
    // -----------------------------------

    const sortedDomains =
      requiredDomains
        .map(
          (domain) => [
            domain,
            domainScores[
              domain
            ],
          ]
        )
        .sort(
          (a, b) =>
            b[1] - a[1]
        );

    const strongestDomain =
      sortedDomains[0][0];

    const weakestDomain =
      sortedDomains[
        sortedDomains.length -
          1
      ][0];

    // -----------------------------------
    // Warnings + recommendations
    // -----------------------------------

    const warnings =
      buildWarnings({
        answersByKey,
        domainScores,
      });

    const recommendations =
      buildRecommendations({
        answersByKey,
        domainScores,
      });

    const scoreBand =
      getBand(
        overallScore
      );

    const resultSummary = {
      ...scoreBand,

      strongest_domain:
        strongestDomain,

      strongest_domain_label:
        DOMAIN_LABELS[
          strongestDomain
        ],

      weakest_domain:
        weakestDomain,

      weakest_domain_label:
        DOMAIN_LABELS[
          weakestDomain
        ],

      warnings,
      recommendations,
    };

    // -----------------------------------
    // Save domain scores
    // -----------------------------------

    const domainRows =
      requiredDomains.map(
        (domain) => ({
          assessment_instance_id:
            instance.id,

          domain,

          score:
            domainScores[
              domain
            ],

          max_score: 100,
        })
      );

    const {
      error: domainError,
    } = await supabase
      .from(
        'assessment_domain_scores'
      )
      .upsert(
        domainRows,
        {
          onConflict:
            'assessment_instance_id,domain',
        }
      );

    if (domainError) {
      throw domainError;
    }

    // -----------------------------------
    // Complete assessment
    // -----------------------------------

    const {
      error: completeError,
    } = await supabase
      .from(
        'assessment_instances'
      )
      .update({
        status:
          'completed',

        completed_at:
          new Date()
            .toISOString(),

        overall_score:
          overallScore,

        result_summary:
          resultSummary,
      })
      .eq(
        'id',
        instance.id
      );

    if (completeError) {
      throw completeError;
    }

    // -----------------------------------
    // Return results to frontend
    // -----------------------------------

    return res
      .status(200)
      .json({
        success: true,

        result: {
          overallScore,

          domainScores:
            domainRows.map(
              ({
                domain,
                score,
                max_score,
              }) => ({
                domain,
                score,
                max_score,
              })
            ),

          summary:
            resultSummary,
        },
      });
  } catch (error) {
    console.error(
      'Assessment submit error:',
      error
    );

    return res
      .status(500)
      .json({
        error:
          error.message ||
          'Internal server error',
      });
  }
}
