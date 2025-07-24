const http = require('http');

const server = http.createServer((req, res) => {
  let body = '';

  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const parsed = JSON.parse(body);

      if (parsed.event === 'endpoint.url_validation' && parsed.payload?.plainToken) {
        const responseBody = JSON.stringify({ plainToken: parsed.payload.plainToken });

        console.log('✅ Native response:', responseBody);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(responseBody);
      }

      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Not validation');
    } catch (err) {
      console.error('❌ JSON parse error:', err.message);
      res.writeHead(400);
      res.end('Invalid JSON');
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Native Zoom webhook listener running on port ${PORT}`);
});
