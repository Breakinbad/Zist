import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      error: "Method not allowed.",
    });
  }

  try {
    const { email } = req.body || {};

    if (
      typeof email !== "string" ||
      !isValidEmail(email.trim())
    ) {
      return res.status(400).json({
        error: "Please enter a valid email address.",
      });
    }

    const normalizedEmail = email
      .trim()
      .toLowerCase();

    const siteUrl =
      process.env.SITE_URL ||
      "https://zisthealth.com";


    // =====================================================
    // 1. SAVE SIGNUP
    //
    // We keep the signups table for your waitlist /
    // marketing history.
    //
    // If they already exist, that's okay.
    // =====================================================

    const { error: signupError } =
      await supabase
        .from("signups")
        .insert({
          email: normalizedEmail,
        });

    let alreadySignedUp = false;

    if (signupError) {
      if (signupError.code === "23505") {
        alreadySignedUp = true;
      } else {
        console.error(
          "Signup insert error:",
          signupError
        );

        return res.status(500).json({
          error:
            "We couldn't save your signup. Please try again.",
        });
      }
    }


    // =====================================================
    // 2. FIND OR CREATE PARTICIPANT
    // =====================================================

    let participant;

    const {
      data: existingParticipant,
      error: participantLookupError,
    } = await supabase
      .from("participants")
      .select("id, email, preferred_name")
      .eq("email", normalizedEmail)
      .maybeSingle();


    if (participantLookupError) {
      throw participantLookupError;
    }


    if (existingParticipant) {
      participant =
        existingParticipant;
    } else {
      const {
        data: newParticipant,
        error: participantCreateError,
      } = await supabase
        .from("participants")
        .insert({
          email: normalizedEmail,
        })
        .select(
          "id, email, preferred_name"
        )
        .single();


      if (participantCreateError) {
        throw participantCreateError;
      }

      participant =
        newParticipant;
    }


    // =====================================================
    // 3. GET LATEST ACTIVE SLEEP ASSESSMENT
    //
    // This should currently return V2.
    // =====================================================

    const {
      data: assessmentType,
      error: assessmentTypeError,
    } = await supabase
      .from("assessment_types")
      .select(
        "id, slug, name, version"
      )
      .eq(
        "slug",
        "sleep-recovery"
      )
      .eq("active", true)
      .order(
        "version",
        { ascending: false }
      )
      .limit(1)
      .single();


    if (assessmentTypeError) {
      throw assessmentTypeError;
    }


    // =====================================================
    // 4. CHECK WHETHER THIS PERSON ALREADY HAS
    //    THIS VERSION OF THE ASSESSMENT
    // =====================================================

    const {
      data: existingInstances,
      error: instanceLookupError,
    } = await supabase
      .from("assessment_instances")
      .select(`
        id,
        access_token,
        status,
        created_at,
        completed_at
      `)
      .eq(
        "participant_id",
        participant.id
      )
      .eq(
        "assessment_type_id",
        assessmentType.id
      )
      .order(
        "created_at",
        { ascending: false }
      )
      .limit(1);


    if (instanceLookupError) {
      throw instanceLookupError;
    }


    let assessmentInstance =
      existingInstances?.[0] ||
      null;


    // =====================================================
    // 5. IF ALREADY COMPLETED, DON'T CREATE ANOTHER
    // =====================================================

    if (
      assessmentInstance &&
      assessmentInstance.status ===
        "completed"
    ) {
      return res.status(200).json({
        success: true,
        alreadySignedUp,
        alreadyCompleted: true,
        message:
          "You've already completed your Sleep & Recovery assessment.",
      });
    }


    // =====================================================
    // 6. OTHERWISE CREATE A NEW INSTANCE IF NEEDED
    //
    // If they already have an invited/started assessment,
    // we reuse the existing private link.
    // =====================================================

    if (!assessmentInstance) {
      const {
        data: newInstance,
        error: instanceCreateError,
      } = await supabase
        .from(
          "assessment_instances"
        )
        .insert({
          participant_id:
            participant.id,

          assessment_type_id:
            assessmentType.id,

          status: "invited",
        })
        .select(`
          id,
          access_token,
          status,
          created_at
        `)
        .single();


      if (instanceCreateError) {
        throw instanceCreateError;
      }

      assessmentInstance =
        newInstance;
    }


    const assessmentUrl =
      `${siteUrl}/a/${assessmentInstance.access_token}`;


    // =====================================================
    // 7. SEND ASSESSMENT EMAIL
    // =====================================================

    try {
      const preferredName =
        participant.preferred_name;

      const greeting =
        preferredName
          ? `Hi ${preferredName},`
          : "Hi,";


      const emailResponse =
        await fetch(
          "https://api.resend.com/emails",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",

              Authorization:
                `Bearer ${process.env.RESEND_API_KEY}`,
            },

            body: JSON.stringify({
              from:
                process.env
                  .ASSESSMENT_FROM_EMAIL ||
                "ZIST <welcome@zisthealth.com>",

              to: [
                normalizedEmail,
              ],

              subject:
                "Your first ZIST assessment is ready",

              html: `
                <div style="
                  max-width: 560px;
                  margin: 0 auto;
                  padding: 48px 28px;
                  font-family: Arial, Helvetica, sans-serif;
                  color: #163f35;
                  background: #fbfaf6;
                ">

                  <div style="
                    font-size: 25px;
                    letter-spacing: 5px;
                    font-weight: 600;
                    margin-bottom: 54px;
                  ">
                    ZIST
                  </div>

                  <h1 style="
                    font-family: Georgia, serif;
                    font-size: 42px;
                    line-height: 1.08;
                    font-weight: 500;
                    margin: 0 0 28px;
                  ">
                    Feel better.<br>
                    Know why.
                  </h1>

                  <p style="
                    font-size: 17px;
                    line-height: 1.7;
                    color: #40554e;
                  ">
                    ${greeting}
                  </p>

                  <p style="
                    font-size: 17px;
                    line-height: 1.7;
                    color: #40554e;
                  ">
                    You're in.
                  </p>

                  <p style="
                    font-size: 17px;
                    line-height: 1.7;
                    color: #40554e;
                  ">
                    Your first ZIST assessment is ready.
                    We'll start with
                    <strong>Sleep & Recovery</strong>.
                  </p>

                  <p style="
                    font-size: 17px;
                    line-height: 1.7;
                    color: #40554e;
                  ">
                    It takes about 5 minutes and looks at
                    six dimensions of sleep, including
                    duration, regularity, satisfaction,
                    continuity, daytime alertness, and timing.
                  </p>

                  <div style="
                    margin: 34px 0;
                  ">

                    <a
                      href="${assessmentUrl}"
                      style="
                        display: inline-block;
                        padding: 15px 24px;
                        background: #163f35;
                        color: #ffffff;
                        text-decoration: none;
                        border-radius: 999px;
                        font-size: 16px;
                        font-weight: 600;
                      "
                    >
                      Take my Sleep & Recovery assessment
                    </a>

                  </div>

                  <p style="
                    font-size: 14px;
                    line-height: 1.6;
                    color: #78857f;
                  ">
                    This link is private and unique to you.
                    Please don't forward it to someone else.
                  </p>

                  <div style="
                    margin-top: 48px;
                    padding-top: 22px;
                    border-top: 1px solid #d8dfda;
                    font-size: 13px;
                    color: #78857f;
                  ">
                    ZIST · Feel better. Know why.<br>
                    zisthealth.com
                  </div>

                </div>
              `,
            }),
          }
        );


      if (!emailResponse.ok) {
        const details =
          await emailResponse.text();

        console.error(
          "Resend error:",
          details
        );

        throw new Error(
          "Assessment email could not be sent."
        );
      }


      // Mark email as sent.
      await supabase
        .from(
          "assessment_instances"
        )
        .update({
          email_sent_at:
            new Date().toISOString(),
        })
        .eq(
          "id",
          assessmentInstance.id
        );

    } catch (emailError) {
      console.error(
        "Assessment email error:",
        emailError
      );

      // We don't delete the participant or assessment.
      // They can be emailed again later.
      return res.status(200).json({
        success: true,
        emailSent: false,
        alreadySignedUp,
        message:
          "You're signed up, but we had trouble sending your assessment email. Please try again shortly.",
      });
    }


    // =====================================================
    // 8. SUCCESS
    // =====================================================

    return res.status(200).json({
      success: true,
      emailSent: true,
      alreadySignedUp,

      message:
        alreadySignedUp
          ? "You're already signed up. We sent your assessment link again."
          : "You're in! Check your inbox for your first ZIST assessment.",
    });

  } catch (error) {
    console.error(
      "Signup handler error:",
      error
    );

    return res.status(500).json({
      error:
        "Something went wrong. Please try again.",
    });
  }
}
