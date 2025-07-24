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
  if (!verifyZoomSignature(req)) return res.status(401).send('Unauthorized');
  try {
    await fetch(SHEETS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    return res.status(200).send('OK');
  } catch (err) {
    console.error(err);
    return res.status(500).send('Forward error');
  }
});

app.get('/', (req, res) => res.send('✅ Zoom Webhook Proxy is running!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on ${PORT}`));
