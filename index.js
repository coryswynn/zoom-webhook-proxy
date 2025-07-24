const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const ZOOM_SECRET = process.env.ZOOM_SECRET;

const server = http.createServer((req, res) => {
  const chunks = [];

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
        res.writeHead(401);
        return res.end('Unauthorized');
      }

      const message = Buffer.concat([
        Buffer.from(timestamp, 'utf-8'),
        rawBuffer
      ]);

      const hash = crypto
        .createHmac('sha256', ZOOM_SECRET)
        .update(message)
        .digest('hex');

      const expectedSignature = `v0=${hash}`;

      // 🧪 Detailed Logging
      console.log('🔐 Zoom Signature Verification');
      console.log('Timestamp:', timestamp);
      console.log('Raw Body:', rawBody);
      console.log('Expected Signature:', expectedSignature);
      console.log('Received Signature:', signature);

      if (expectedSignature !== signature) {
        console.log('❌ Signature mismatch');
        res.writeHead(401);
        return res.end('Invalid signature');
      }

      const body = JSON.parse(rawBody);

      // ✅ Handle endpoint validation
      if (body.event === 'endpoint.url_validation' && body.payload?.plainToken) {
        const responseBody = JSON.stringify({
          plainToken: body.payload.plainToken
        });

        console.log('✅ Responding with plainToken:', responseBody);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(responseBody);
      }

      // ➕ Handle other events if needed
      res.writeHead(200);
      res.end('OK');

    } catch (err) {
      console.error('❌ Error handling request:', err.message);
      res.writeHead(400);
      res.end('Bad request');
    }
  });
});

server.listen(PORT, () => {
  console.log(`✅ Zoom Webhook Proxy running on port ${PORT}`);
});
