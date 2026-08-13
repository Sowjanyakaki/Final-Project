# Shortlist → PDF → Email n8n Workflow

This folder contains the n8n workflow that turns a shortlist payload from the
app's `POST /api/notify` route into a PDF attached to an email, satisfying the
"implement an n8n workflow that compiles the shortlist into a PDF and emails
it to the user" requirement.

Provisioning the n8n instance itself (Railway service, from the official n8n
Railway template) is **not** covered here — see the main `docs/ARCHITECTURE.md`
§3.5/§7. This doc assumes you already have a running n8n instance with editor
access.

## 1. Install the required community node

The PDF conversion step uses the community node package
[`n8n-nodes-puppeteer`](https://www.npmjs.com/package/n8n-nodes-puppeteer). It is
**not installed by default** on a fresh n8n instance.

1. In the n8n editor, go to **Settings → Community Nodes**.
2. Click **Install a community node**.
3. Enter the package name `n8n-nodes-puppeteer` and confirm.
4. Wait for installation to finish (n8n will restart the relevant process). If
   your instance has community-node installation disabled via the
   `N8N_COMMUNITY_PACKAGES_ENABLED` environment variable, set it to `true` on
   the n8n Railway service and redeploy before continuing.

## 2. Import the workflow

1. In the n8n editor, choose **Workflow → Import from File**.
2. Select `n8n/shortlist-to-pdf-email.json` from this repo.
3. The workflow appears with 5 nodes: **Webhook → Format Shortlist HTML →
   Convert to PDF → Send Email → Respond to Webhook**.

## 3. Configure credentials (required before it will run)

The **Send Email** node references an SMTP credential by name
(`SMTP account`) rather than embedding secrets in the JSON. You must create it
once per n8n instance:

1. Open the **Send Email** node in the imported workflow.
2. Under **Credential for Send Email**, click **Create New** (or select an
   existing one) and name it exactly `SMTP account`.
3. Fill in your real SMTP host, port, user, and password (e.g. from your email
   provider or a transactional email service that exposes SMTP credentials).
4. Save the credential, then save the workflow.

Also double-check the **Convert to PDF** node's configuration after installing
`n8n-nodes-puppeteer` — community node parameter names can shift slightly
between versions, so confirm the node reads HTML from `{{$json.html}}` and
note its output binary property name (commonly `data`); update the **Send
Email** node's attachment field to match if it differs.

## 4. Activate the workflow

Toggle the workflow to **Active** in the top-right of the editor. Until it's
active, the webhook URL will not accept requests outside of "test" runs.

## 5. Manual verification

With the workflow active, send a fixture request (replace
`<your-n8n-domain>` with your instance's real Railway domain, and the email
with one you can check):

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

## 6. Pointing the app at this workflow

Once imported and active, copy the workflow's production webhook URL (from
the **Webhook** node's "Production URL" field, ending in
`/webhook/shortlist-pdf`) into the app's `N8N_WEBHOOK_URL` environment
variable (already declared in `.env.local.example`).
