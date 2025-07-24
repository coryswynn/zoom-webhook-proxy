const express = require('express');
const crypto = require('crypto');
const fetch = require('node-fetch');
const app = express();
app.use(express.json({ verify: (req, res, buf) => req.rawBody = buf }));

const ZOOM_SECRET = process.env.ZOOM_SECRET;
const SHEETS_WEBHOOK_URL = process.env.SHEETS_WEBHOOK_URL;

function verifyZoomSignature(req) {
  const sig = req.headers['x-zm-signature'];
  const ts = req.headers['x-zm-request-timestamp'];
  const msg = `${ts}${req.rawBody}`;
  const hash = crypto.createHmac('sha256', ZOOM_SECRET).update(msg).digest('base64');
  return hash === sig;
}

app.post('/', async (req, res) => {
  const headers = req.headers;
  const body = req.body;
  const rawBody = req.rawBody.toString();

  console.log("🔔 Incoming POST");
  console.log("Headers:", headers);
  console.log("Body:", body);
  console.log("RawBody:", rawBody);

  // ✅ 1. Handle Zoom's URL validation
if (body.event === 'endpoint.url_validation' && body.payload?.plainToken) {
  const responseBody = {
    plainToken: body.payload.plainToken
  };

  console.log("🔑 Responding to Zoom endpoint validation with:");
  console.log("Response body:", responseBody);

  res.setHeader('Content-Type', 'application/json');
  return res.status(200).send(JSON.stringify(responseBody));
}

  // ✅ 2. Verify Zoom signature for real event posts
  if (!verifyZoomSignature(req)) {
    console.log("❌ Signature verification failed.");
    return res.status(401).send('Unauthorized');
  }

  // ✅ 3. Forward event to Google Sheets
  try {
    await fetch(SHEETS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    console.log("✅ Event forwarded successfully:", body.event);
    return res.status(200).send('OK');
  } catch (err) {
    console.error("🔥 Error forwarding:", err.message);
    return res.status(500).send('Forward error');
  }
});



app.get('/', (req, res) => res.send('✅ Zoom Webhook Proxy is running!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on ${PORT}`));
