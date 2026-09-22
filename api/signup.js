import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

const supabase = createClient(
  supabaseUrl,
  supabaseSecretKey,
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

    const { error } = await supabase
      .from("signups")
      .insert({
        email: normalizedEmail,
      });

    if (error) {
      if (error.code === "23505") {
        return res.status(200).json({
          success: true,
          alreadySignedUp: true,
          message: "You're already signed up.",
        });
      }

      console.error("Supabase insert error:", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });

      return res.status(500).json({
        error: "We couldn't save your signup. Please try again.",
      });
    }

    return res.status(200).json({
      success: true,
      alreadySignedUp: false,
      message:
        "You're in! We'll send your first ZIST assessment here.",
    });
  } catch (error) {
    console.error("Signup handler error:", error);

    return res.status(500).json({
      error: "Something went wrong. Please try again.",
    });
  }
}
