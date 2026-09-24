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
    const adminKey = req.headers['x-zist-admin-key'];

    if (!adminKey || adminKey !== process.env.ZIST_ADMIN_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      email,
      assessmentSlug = 'sleep-recovery',
      sendEmail = false,
    } = req.body || {};

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // 1. Find or create participant
    let { data: participant, error: participantError } = await supabase
      .from('participants')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (participantError) {
      throw participantError;
    }

    if (!participant) {
      const { data, error } = await supabase
        .from('participants')
        .insert({
          email,
        })
        .select()
        .single();

      if (error) throw error;
      participant = data;
    }

    // 2. Get assessment type
    const { data: assessmentType, error: assessmentTypeError } =
      await supabase
        .from('assessment_types')
        .select('*')
        .eq('slug', assessmentSlug)
        .eq('active', true)
        .order('version', { ascending: false })
        .limit(1)
        .single();

    if (assessmentTypeError) {
      throw assessmentTypeError;
    }

    // 3. Create assessment instance
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

    const siteUrl =
      process.env.SITE_URL || 'https://zisthealth.com';

    const assessmentUrl =
      `${siteUrl}/a/${instance.access_token}`;

    // 4. Optionally send email
    if (sendEmail) {
      if (!process.env.RESEND_API_KEY) {
        throw new Error('RESEND_API_KEY is missing');
      }

      const fromEmail =
        process.env.ASSESSMENT_FROM_EMAIL ||
        'Zist Health <assessment@zisthealth.com>';

      const emailResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [email],
          subject: 'Your Zist Sleep & Recovery Assessment',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px;">
              <h2>Your Zist assessment is ready</h2>
              <p>
                Your Sleep & Recovery Assessment takes about 5 minutes.
              </p>
              <p>
                <a
                  href="${assessmentUrl}"
                  style="
                    display:inline-block;
                    padding:12px 20px;
                    background:#111;
                    color:#fff;
                    text-decoration:none;
                    border-radius:8px;
                  "
                >
                  Take the assessment
                </a>
              </p>
              <p>
                Zist provides wellness education and does not provide
                medical diagnosis or treatment.
              </p>
            </div>
          `,
        }),
      });

      if (!emailResponse.ok) {
        const errorText = await emailResponse.text();
        throw new Error(`Resend error: ${errorText}`);
      }

      await supabase
        .from('assessment_instances')
        .update({
          email_sent_at: new Date().toISOString(),
        })
        .eq('id', instance.id);
    }

    return res.status(200).json({
      success: true,
      participantId: participant.id,
      assessmentInstanceId: instance.id,
      assessmentUrl,
    });

  } catch (error) {
    console.error('Assessment create error:', error);

    return res.status(500).json({
      error: error.message || 'Internal server error',
    });
  }
}
