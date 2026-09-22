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

    const normalizedEmail = email.trim().toLowerCase();

    // Save signup in Supabase
    const { error } = await supabase
      .from("signups")
      .insert({
        email: normalizedEmail,
      });

    if (error) {
      // Email already exists
      if (error.code === "23505") {
        return res.status(200).json({
          success: true,
          alreadySignedUp: true,
          message: "You're already signed up.",
        });
      }

      console.error("Supabase insert error:", error);

      return res.status(500).json({
        error: "We couldn't save your signup. Please try again.",
      });
    }

    // Send welcome email through Resend
    try {
      const emailResponse = await fetch(
        "https://api.resend.com/emails",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: "ZIST <welcome@zisthealth.com>",
            to: [normalizedEmail],
            subject: "Welcome to ZIST",
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
                  You're in.
                </p>

                <p style="
                  font-size: 17px;
                  line-height: 1.7;
                  color: #40554e;
                ">
                  ZIST is designed to help you understand the
                  different parts of your wellbeing, see how they
                  connect, and know what to focus on first.
                </p>

                <p style="
                  font-size: 17px;
                  line-height: 1.7;
                  color: #40554e;
                ">
                  Your first assessment is coming soon.
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
        const details = await emailResponse.text();
        console.error("Resend error:", details);
      }
    } catch (emailError) {
      // Don't undo the signup just because the welcome email failed.
      console.error("Welcome email error:", emailError);
    }

    return res.status(200).json({
      success: true,
      alreadySignedUp: false,
      message:
        "You're in! Check your inbox for a welcome from ZIST.",
    });

  } catch (error) {
    console.error("Signup handler error:", error);

    return res.status(500).json({
      error: "Something went wrong. Please try again.",
    });
  }
}
