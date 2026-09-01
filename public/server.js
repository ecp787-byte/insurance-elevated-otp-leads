const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const PARTNER_CODE = process.env.PARTNER_CODE || "";

let stripe = null;
if (STRIPE_SECRET_KEY) {
  stripe = require("stripe")(STRIPE_SECRET_KEY);
}

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
  "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
  "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
]);

app.get("/api/status", (req, res) => {
  res.json({
    stripeConfigured: Boolean(stripe),
    partnerProgramConfigured: Boolean(PARTNER_CODE),
  });
});

app.post("/api/verify-partner", (req, res) => {
  const { code } = req.body || {};
  if (!PARTNER_CODE) {
    return res.status(503).json({
      ok: false,
      message:
        "Partner checkout isn't set up yet. Contact eric@veritassolutions.io to get approved.",
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
          "Checkout isn't live yet — the site's Stripe key hasn't been configured. Contact eric@veritassolutions.io.",
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
            "Partner checkout isn't set up yet. Contact eric@veritassolutions.io to get approved.",
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
