# Insurance Elevated — IUL OTP Leads

Marketing site + Stripe-powered checkout for Insurance Elevated's IUL OTP Leads
program.

## Setup

1. `npm install`
2. Set environment variables (see below)
3. `npm start`

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `STRIPE_SECRET_KEY` | Yes, for live checkout | Your Stripe secret key (`sk_live_...` or `sk_test_...`). Without it the site runs fine but "Buy Now" shows a friendly "not configured yet" message instead of charging anyone. |
| `PARTNER_CODE` | Optional | A shared access code partners enter to unlock the $40/lead rate. Leave unset to keep the partner tier as "contact us" only. |
| `PORT` | No | Defaults to 3000; Render sets this automatically. |

No Stripe Products/Prices need to be pre-created in the Stripe Dashboard —
checkout sessions are created on the fly with the correct amount for
whatever quantity of packs the buyer selects.

## What it does

- `/` — the marketing site (hero, funnel screenshots, sample lead data, pricing).
- `POST /api/create-checkout-session` — creates a Stripe Checkout Session for
  a given tier (`standard` or `partner`) and number of 25-lead packs, then
  returns the hosted checkout URL for the browser to redirect to.
- `POST /api/verify-partner` — checks a partner access code against
  `PARTNER_CODE` before unlocking partner pricing in the UI.
- `/success.html`, `/cancel.html` — post-checkout landing pages.
