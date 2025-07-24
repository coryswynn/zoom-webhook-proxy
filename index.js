const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const ZOOM_SECRET = process.env.ZOOM_SECRET;

const server = http.createServer((req, res) => {
  let rawBody = '';

  req.on('data', chunk => rawBody += chunk);
  req.on('end', () => {
    try {
      const headers = req.headers;
      const body = JSON.parse(rawBody);

      const timestamp = headers['x-zm-request-timestamp'];
      const signature = headers['x-zm-signature'];

      if (!timestamp || !signature) {
        console.log('❌ Missing Zoom headers');
        res.writeHead(401);
        return res.end('Unauthorized');
      }

      const message = `${timestamp}${rawBody}`;
      const hash = crypto.createHmac('sha256', ZOOM_SECRET).update(message).digest('base64');
      const expectedSignature = `v0=${hash}`;

      if (expectedSignature !== signature) {
        console.log('❌ Signature mismatch');
        res.writeHead(401);
        return res.end('Invalid signature');
      }

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
