const express = require("express");
const path = require("path");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 3000;

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const PARTNER_CODE = process.env.PARTNER_CODE || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

let stripe = null;
if (STRIPE_SECRET_KEY) {
  stripe = require("stripe")(STRIPE_SECRET_KEY);
}

// ---------- Purchase notification email ----------
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = process.env.SMTP_SECURE === "true"; // true for port 465, false for 587/25
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const EMAIL_FROM = process.env.EMAIL_FROM || `Insurance Elevated <${SMTP_USER}>`;
const NOTIFY_TO = "info@veritassolutions.io";
const NOTIFY_BCC = "eric@veritassolutions.io";

let mailer = null;
if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  mailer = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

function fmtAmount(cents) {
  if (cents == null) return "Unknown";
  return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function sendPurchaseNotification(session) {
  if (!mailer) {
    console.warn("Purchase notification not sent — SMTP isn't configured yet.");
    return;
  }
  const md = session.metadata || {};
  const amount = fmtAmount(session.amount_total);
  const buyerEmail = session.customer_details ? session.customer_details.email : "Not provided";
  const statesList = md.states ? md.states.split(",").join(", ") : "Not provided";

  const html = `
    <h2>New IUL OTP Leads Purchase</h2>
    <p><strong>Amount:</strong> ${amount}</p>
    <p><strong>Tier:</strong> ${md.tier || "Unknown"}</p>
    <p><strong>Packs:</strong> ${md.packs || "Unknown"}</p>
    <p><strong>Leads:</strong> ${md.leads || "Unknown"}</p>
    <p><strong>Target States (${md.state_count || "?"}):</strong> ${statesList}</p>
    <p><strong>Buyer Email:</strong> ${buyerEmail}</p>
    <p><strong>Stripe Session ID:</strong> ${session.id}</p>
  `;

  try {
    await mailer.sendMail({
      from: EMAIL_FROM,
      to: NOTIFY_TO,
      bcc: NOTIFY_BCC,
      subject: `New Lead Purchase — ${amount} (${md.leads || "?"} leads)`,
      html,
    });
    console.log("Purchase notification email sent for session", session.id);
  } catch (err) {
    console.error("Failed to send purchase notification email:", err);
  }
}

// Stripe webhook needs the raw request body for signature verification, so this
// route is registered BEFORE the global express.json() middleware below.
app.post("/api/stripe-webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    console.warn("Stripe webhook received but webhook isn't configured.");
    return res.status(503).send("Webhook not configured.");
  }

  let event;
  try {
    const sig = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    sendPurchaseNotification(session).catch((err) =>
      console.error("Unhandled error sending purchase notification:", err)
    );
  }

  res.json({ received: true });
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Pricing, in cents per lead. A "pack" is 25 leads.
const LEADS_PER_PACK = 25;
const MIN_STATES = 10;
const PRICING = {
  standard: { unitAmount: 5000, label: "Standard" }, // $50.00/lead
  partner: { unitAmount: 4000, label: "Partner" }, // $40.00/lead
};

const VALID_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO",
  "MT", "NE", "NV", "NH", "NJ", "NM", "NC", "ND", "OH", "OK", "OR", "PA",
  "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
]);

app.get("/api/status", (req, res) => {
  res.json({
    stripeConfigured: Boolean(stripe),
    partnerProgramConfigured: Boolean(PARTNER_CODE),
    webhookConfigured: Boolean(stripe && STRIPE_WEBHOOK_SECRET),
    emailConfigured: Boolean(mailer),
  });
});

app.post("/api/verify-partner", (req, res) => {
  const { code } = req.body || {};
  if (!PARTNER_CODE) {
    return res.status(503).json({
      ok: false,
      message:
        "Partner checkout isn't set up yet. Contact info@veritassolutions.io to get approved.",
    });
  }
  if (typeof code === "string" && code.trim() === PARTNER_CODE) {
    return res.json({ ok: true });
  }
  return res.status(403).json({ ok: false, message: "That partner code isn't valid." });
});

app.post("/api/create-checkout-session", async (req, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({
        error:
          "Checkout isn't live yet — the site's Stripe key hasn't been configured. Contact info@veritassolutions.io.",
      });
    }

    const { tier, packs, partnerCode, states } = req.body || {};
    const tierConfig = PRICING[tier];
    if (!tierConfig) {
      return res.status(400).json({ error: "Unknown pricing tier." });
    }

    const packCount = Number(packs);
    if (!Number.isInteger(packCount) || packCount < 1 || packCount > 400) {
      return res.status(400).json({ error: "Enter a whole number of packs (1 or more)." });
    }

    if (!Array.isArray(states)) {
      return res.status(400).json({ error: "Select your target states." });
    }
    const stateCodes = Array.from(new Set(states.map((s) => String(s).toUpperCase().trim())));
    const invalidStates = stateCodes.filter((s) => !VALID_STATES.has(s));
    if (invalidStates.length > 0) {
      return res.status(400).json({ error: `Unrecognized state code(s): ${invalidStates.join(", ")}` });
    }
    if (stateCodes.length < MIN_STATES) {
      return res.status(400).json({
        error: `Select at least ${MIN_STATES} target states (you selected ${stateCodes.length}).`,
      });
    }

    if (tier === "partner") {
      if (!PARTNER_CODE) {
        return res.status(503).json({
          error:
            "Partner checkout isn't set up yet. Contact info@veritassolutions.io to get approved.",
        });
      }
      if (typeof partnerCode !== "string" || partnerCode.trim() !== PARTNER_CODE) {
        return res.status(403).json({ error: "That partner code isn't valid." });
      }
    }

    const leadCount = packCount * LEADS_PER_PACK;
    const origin = `${req.protocol}://${req.get("host")}`;
    const statesLabel = stateCodes.join(", ");
    const statesForMeta = stateCodes.join(",").slice(0, 490); // Stripe metadata values cap at 500 chars

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: tierConfig.unitAmount,
            product_data: {
              name: `IUL OTP Leads — ${tierConfig.label} Rate`,
              description: `${leadCount} phone-verified IUL leads (${packCount} pack${
                packCount > 1 ? "s" : ""
              } of ${LEADS_PER_PACK}) — Target states: ${statesLabel}`,
            },
          },
          quantity: leadCount,
        },
      ],
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cancel.html`,
      metadata: {
        tier,
        packs: String(packCount),
        leads: String(leadCount),
        state_count: String(stateCodes.length),
        states: statesForMeta,
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Checkout session error:", err);
    res.status(500).json({ error: "Something went wrong creating your checkout session." });
  }
});

// Optional: confirm a session server-side for the success page.
app.get("/api/session/:id", async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ error: "Stripe not configured." });
    const session = await stripe.checkout.sessions.retrieve(req.params.id);
    res.json({
      status: session.payment_status,
      amount_total: session.amount_total,
      metadata: session.metadata,
      customer_email: session.customer_details ? session.customer_details.email : null,
    });
  } catch (err) {
    res.status(404).json({ error: "Session not found." });
  }
});

app.listen(PORT, () => {
  console.log(`Insurance Elevated site running on port ${PORT}`);
  console.log(`Stripe configured: ${Boolean(stripe)}`);
});
