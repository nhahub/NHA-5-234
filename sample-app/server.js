const http = require('http');
http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ message: 'Hello from AutoDeployers', pod: process.env.HOSTNAME }));
}).listen(3000, () => console.log('listening on 3000'));
