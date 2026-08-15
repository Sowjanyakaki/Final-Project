# Shortlist → PDF → Email n8n Workflow

This folder contains the n8n workflow that turns a shortlist payload from the
app's `POST /api/notify` route into a PDF attached to an email, satisfying the
"implement an n8n workflow that compiles the shortlist into a PDF and emails
it to the user" requirement.

Provisioning the n8n instance itself is **not** covered here. This doc assumes
you already have a running n8n instance with editor access — either
self-hosted (e.g. the Railway service described in `docs/ARCHITECTURE.md`
§3.5/§7) or **n8n Cloud**.

**Note on n8n Cloud:** Cloud instances have no Chromium runtime available, so
the community node `n8n-nodes-puppeteer` (used for HTML→PDF conversion on a
self-hosted instance) does not work there. This workflow instead uses n8n's
built-in **HTTP Request** node to call a hosted HTML→PDF API
([PDFShift](https://pdfshift.io), free tier, no credit card) — this works
identically on both Cloud and self-hosted instances, so there's no
Cloud-specific branch to maintain.

## 1. Import the workflow

1. In the n8n editor, choose **Workflow → Import from File** (or the `⋯` menu
   → **Import from File** / `Ctrl+O`, depending on your n8n version).
2. Select `n8n/shortlist-to-pdf-email.json` from this repo.
3. The workflow appears with 5 nodes: **Webhook → Format Shortlist HTML →
   Convert to PDF → Send Email → Respond to Webhook**.

## 2. Configure credentials (required before it will run)

### PDFShift (HTML → PDF)

The **Convert to PDF** node (an HTTP Request node calling
`https://api.pdfshift.io/v3/convert/pdf`) references an HTTP Basic Auth
credential by name (`PDFShift account`) rather than embedding the API key in
the JSON.

1. Sign up at [pdfshift.io](https://pdfshift.io) (free tier) and copy your API
   key from the dashboard.
2. Open the **Convert to PDF** node in the imported workflow.
3. Under its credential field, click **Create New**, choose credential type
   **HTTP Basic Auth**, and name it exactly `PDFShift account`.
4. Set **User** to `api` and **Password** to your PDFShift API key (this is
   PDFShift's documented auth scheme — the key goes in the password field).
5. Save the credential, then save the workflow.

### SMTP (sending the email)

The **Send Email** node references an SMTP credential by name
(`SMTP account`) rather than embedding secrets in the JSON. You must create it
once per n8n instance:

1. Open the **Send Email** node in the imported workflow.
2. Under **Credential for Send Email**, click **Create New** (or select an
   existing one) and name it exactly `SMTP account`.
3. Fill in your real SMTP host, port, user, and password — e.g. a Gmail App
   Password (Google Account → Security → 2-Step Verification → App passwords)
   works well for testing, or use a transactional email provider's SMTP
   credentials for production.
4. Save the credential, then save the workflow.

## 3. Activate the workflow

Toggle the workflow to **Active** in the top-right of the editor. Until it's
active, the webhook URL will not accept requests outside of "test" runs.

## 4. Manual verification

With the workflow active, send a fixture request (replace
`<your-n8n-domain>` with your instance's real domain — for n8n Cloud this is
your `*.app.n8n.cloud` domain — and the email with one you can check):

```bash
curl -X POST https://<your-n8n-domain>/webhook/shortlist-pdf \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "demo-session-1",
    "email": "you@example.com",
    "shortlist": [
      {
        "societyName": "Prestige Lakeside Habitat",
        "locality": "Koramangala",
        "rent": 35000,
        "bedrooms": 2,
        "amenities": ["parking", "gym", "power backup"],
        "sqft": 1150
      },
      {
        "societyName": "Brigade Meadows",
        "locality": "HSR Layout",
        "rent": 38000,
        "bedrooms": 2,
        "amenities": ["lift", "security"],
        "sqft": 1200
      }
    ]
  }'
```

Expect an HTTP 200 response like `{"status":"sent"}`, followed within about a
minute by an email at the destination address with a PDF attachment listing
both properties (society name, locality, rent, bedrooms, amenities, sqft).

## 5. Pointing the app at this workflow

Once imported and active, copy the workflow's production webhook URL (from
the **Webhook** node's "Production URL" field, ending in
`/webhook/shortlist-pdf`) into the app's `N8N_WEBHOOK_URL` environment
variable (already declared in `.env.local.example`).
