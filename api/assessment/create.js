const { selectOne, insertRows, updateRows } = require('../_lib/supabase');
const {
  json,
  methodNotAllowed,
  normalizeEmail,
  validEmail,
  safeEqual,
  escapeHtml,
} = require('../_lib/utils');

function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${req.headers.host}`;
}

async function sendInviteEmail({ to, preferredName, assessmentName, link }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ASSESSMENT_FROM_EMAIL || 'Zist Health <hello@zisthealth.com>';
  if (!apiKey) return { sent: false, reason: 'RESEND_API_KEY is not configured.' };

  const firstLine = preferredName ? `Hi ${escapeHtml(preferredName)},` : 'Hi,';
  const safeName = escapeHtml(assessmentName);
  const safeLink = escapeHtml(link);

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `Your Zist ${assessmentName} assessment is ready`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#1f2937;line-height:1.6">
          <p>${firstLine}</p>
          <p>Your <strong>${safeName}</strong> assessment is ready. It takes about 5 minutes.</p>
          <p style="margin:28px 0">
            <a href="${safeLink}" style="display:inline-block;background:#111827;color:white;text-decoration:none;padding:13px 22px;border-radius:999px;font-weight:700">
              Take the assessment
            </a>
          </p>
          <p>Your link is unique to you. Please do not forward it.</p>
          <p style="font-size:13px;color:#6b7280">Zist provides wellness education and is not a substitute for medical diagnosis or treatment.</p>
        </div>
      `,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Resend failed (${response.status}): ${JSON.stringify(data)}`);
  }
  return { sent: true, id: data.id };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    if (!process.env.ZIST_ADMIN_KEY) {
      return json(res, 500, { error: 'ZIST_ADMIN_KEY is not configured.' });
    }
    if (!safeEqual(req.headers['x-zist-admin-key'], process.env.ZIST_ADMIN_KEY)) {
      return json(res, 401, { error: 'Unauthorized.' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const email = normalizeEmail(body.email);
    const preferredName = String(body.preferredName || '').trim();
    const assessmentSlug = String(body.assessmentSlug || 'sleep-recovery').trim();
    const assessmentVersion = Number(body.assessmentVersion || 1);
    const sendEmail = body.sendEmail !== false;

    if (!validEmail(email)) return json(res, 400, { error: 'Please provide a valid email.' });

    let participant = await selectOne(
      'participants',
      `select=id,email,preferred_name&email=eq.${encodeURIComponent(email)}`
    );

    if (!participant) {
      const inserted = await insertRows('participants', [
        {
          email,
          preferred_name: preferredName || null,
        },
      ]);
      participant = inserted[0];
    } else if (preferredName && !participant.preferred_name) {
      await updateRows('participants', `id=eq.${participant.id}`, { preferred_name: preferredName });
      participant.preferred_name = preferredName;
    }

    const assessment = await selectOne(
      'assessment_types',
      `select=id,slug,name,version&slug=eq.${encodeURIComponent(assessmentSlug)}&version=eq.${assessmentVersion}&active=eq.true`
    );

    if (!assessment) return json(res, 404, { error: 'Assessment type not found.' });

    let instance = await selectOne(
      'assessment_instances',
      `select=id,access_token,status,email_sent_at,created_at&participant_id=eq.${participant.id}&assessment_type_id=eq.${assessment.id}&status=in.(invited,started)&order=created_at.desc`
    );

    if (!instance) {
      const rows = await insertRows('assessment_instances', [
        {
          participant_id: participant.id,
          assessment_type_id: assessment.id,
          status: 'invited',
        },
      ]);
      instance = rows[0];
    }

    const link = `${siteUrl(req)}/a/${instance.access_token}`;
    let emailResult = { sent: false, reason: 'sendEmail=false' };

    if (sendEmail) {
      emailResult = await sendInviteEmail({
        to: email,
        preferredName: participant.preferred_name,
        assessmentName: assessment.name,
        link,
      });
      if (emailResult.sent) {
        await updateRows('assessment_instances', `id=eq.${instance.id}`, {
          email_sent_at: new Date().toISOString(),
        });
      }
    }

    return json(res, 200, {
      ok: true,
      participantId: participant.id,
      assessmentInstanceId: instance.id,
      assessment: assessment.name,
      link,
      email: emailResult,
    });
  } catch (error) {
    console.error('assessment/create error', error);
    return json(res, error.statusCode || 500, { error: 'Could not create the assessment invitation.' });
  }
};
