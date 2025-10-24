// AIS Stream Relay Server for Render.com
const WebSocket = require('ws');
const http = require('http');

const AIS_API_KEY = "f63580b31f6c9771f4892b28e028a1126d2a5167";
const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'ok', 
      clients: wss.clients.size,
      aisConnected: aisConnection && aisConnection.readyState === WebSocket.OPEN,
      uptime: Math.floor((Date.now() - startTime) / 1000)
    }));
    return;
  }

  if (req.url === '/' || req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>AIS Relay Server</title>
        <style>
          body { font-family: Arial; padding: 20px; background: #1a1a1a; color: #fff; }
          .status { padding: 15px; background: #2a2a2a; border-radius: 8px; margin: 10px 0; }
          .connected { color: #00ff00; }
          .disconnected { color: #ff0000; }
          code { background: #333; padding: 2px 6px; border-radius: 3px; }
        </style>
      </head>
      <body>
        <h1>🛰️ AIS Stream Relay Server</h1>
        <div class="status">
          <strong>Status:</strong> <span class="connected">✅ Running</span><br>
          <strong>Connected Clients:</strong> ${wss.clients.size}<br>
          <strong>AIS Connection:</strong> <span class="${aisConnection && aisConnection.readyState === WebSocket.OPEN ? 'connected' : 'disconnected'}">
            ${aisConnection && aisConnection.readyState === WebSocket.OPEN ? '✅ Connected' : '❌ Disconnected'}
          </span><br>
          <strong>Uptime:</strong> ${Math.floor((Date.now() - startTime) / 1000)}s
        </div>
        <p>WebSocket endpoint: <code>wss://${req.headers.host}/</code></p>
        <p>Use this URL in your frontend application</p>
      </body>
      </html>
    `);
    return;
  }
  
  res.writeHead(404);
  res.end('Not Found');
});

const wss = new WebSocket.Server({ server });

let aisConnection = null;
let reconnectTimer = null;
let messageCount = 0;
const startTime = Date.now();

function connectToAISStream() {
  console.log('🛰️  Connecting to AISStream...');
  
  try {
    aisConnection = new WebSocket('wss://stream.aisstream.io/v0/stream');
    
    aisConnection.on('open', () => {
      console.log('✅ Connected to AISStream');
      
      const subscription = {
        APIKey: AIS_API_KEY,
       // Ireland and surrounding waters
   BoundingBoxes: [[[51, -11], [56, -5]]],
        FilterMessageTypes: ["PositionReport"]
      };
      
      aisConnection.send(JSON.stringify(subscription));
      console.log('📨 Subscription sent');
      
      broadcastToClients({
        type: 'status',
        status: 'connected',
        message: 'Connected to AISStream'
      });
    });
    
    aisConnection.on('message', (data) => {
      messageCount++;
      broadcastToClients({
        type: 'ais-data',
        data: data.toString()
      });
      
      if (messageCount % 100 === 0) {
        console.log(`📊 Processed ${messageCount} messages, ${wss.clients.size} clients`);
      }
    });
    
    aisConnection.on('error', (error) => {
      console.error('❌ AISStream error:', error.message);
      broadcastToClients({
        type: 'status',
        status: 'error',
        message: 'AISStream connection error'
      });
    });
    
    aisConnection.on('close', (code, reason) => {
      console.warn(`🔒 AISStream closed: ${code} - ${reason}`);
      aisConnection = null;
      
      broadcastToClients({
        type: 'status',
        status: 'disconnected',
        message: 'Disconnected from AISStream'
      });
      
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        console.log('🔄 Attempting to reconnect...');
        connectToAISStream();
      }, 5000);
    });
    
  } catch (error) {
    console.error('❌ Failed to create AISStream connection:', error.message);
  }
}

function broadcastToClients(message) {
  const messageStr = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(messageStr);
      } catch (err) {
        console.error('Error sending to client:', err.message);
      }
    }
  });
}

wss.on('connection', (ws, req) => {
  const clientIP = req.socket.remoteAddress;
  console.log(`👤 New client: ${clientIP} (Total: ${wss.clients.size})`);
  
  ws.send(JSON.stringify({
    type: 'status',
    status: aisConnection && aisConnection.readyState === WebSocket.OPEN ? 'connected' : 'disconnected',
    message: 'Connected to relay server'
  }));
  
  ws.on('close', () => {
    console.log(`👋 Client disconnected (Total: ${wss.clients.size})`);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  connectToAISStream();
});

process.on('SIGTERM', () => {
  console.log('⏹️  Shutting down...');
  if (aisConnection) aisConnection.close();
  wss.clients.forEach(client => client.close());
  server.close(() => process.exit(0));
});
