const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const ZOOM_SECRET = process.env.ZOOM_SECRET;

const server = http.createServer((req, res) => {
  const startTime = Date.now();
  const chunks = [];

  // Debug: Show all requests
  console.log('\n--- Incoming Request ---');
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  console.log('Headers:', req.headers);

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    return res.end('Method Not Allowed');
  }

  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const rawBuffer = Buffer.concat(chunks);
    const rawBody = rawBuffer.toString();

    try {
      const headers = req.headers;
      const timestamp = headers['x-zm-request-timestamp'];
      const signature = headers['x-zm-signature'];

      if (!timestamp || !signature) {
        console.log('❌ Missing Zoom headers');
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        return res.end('Unauthorized: Missing Zoom headers');
      }

      const message = `v0:${timestamp}:${rawBody}`;
      const hash = crypto
        .createHmac('sha256', ZOOM_SECRET)
        .update(message)
        .digest('hex');
      const expectedSignature = `v0=${hash}`;

      console.log('🔐 Zoom Signature Verification');
      console.log('Timestamp:', timestamp);
      console.log('Raw Body:', rawBody);
      console.log('Expected Signature:', expectedSignature);
      console.log('Received Signature:', signature);

      if (expectedSignature !== signature) {
        console.log('❌ Signature mismatch');
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        return res.end('Invalid signature');
      }

      const body = JSON.parse(rawBody);

      // Handle endpoint validation
      if (body.event === 'endpoint.url_validation' && body.payload?.plainToken) {
        const plainToken = body.payload.plainToken;
        const encryptedToken = crypto
          .createHmac('sha256', ZOOM_SECRET)
          .update(plainToken)
          .digest('base64');

        const responseBody = JSON.stringify({
          plainToken,
          encryptedToken
        });

        console.log('✅ Responding to endpoint validation with:', responseBody);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(responseBody);
        console.log('Response time:', Date.now() - startTime, 'ms');
        return;
      }

      // Other events
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
      console.log('Response time:', Date.now() - startTime, 'ms');

    } catch (err) {
      console.error('❌ Error handling request:', err);
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Bad request');
    }
  });
});

server.listen(PORT, () => {
  console.log(`✅ Zoom Webhook Proxy running on port ${PORT}`);
});
