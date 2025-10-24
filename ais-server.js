// AIS Stream Relay Server for Render.com
const WebSocket = require('ws');
const http = require('http');

const AIS_API_KEY = "f63580b31f6c9771f4892b28e028a1126d2a5167";
const PORT = process.env.PORT || 10000;

// Create HTTP server
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
      uptime: Math.floor((Date.now() - startTime) / 1000),
      messageCount: messageCount
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
        <meta http-equiv="refresh" content="5">
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
          <strong>Messages Processed:</strong> ${messageCount}<br>
          <strong>Uptime:</strong> ${Math.floor((Date.now() - startTime) / 1000)}s
        </div>
        <p>WebSocket endpoint: <code>wss://${req.headers.host}/</code></p>
        <p>Use this URL in your frontend application</p>
        <p><small>Auto-refreshing every 5 seconds</small></p>
      </body>
      </html>
    `);
    return;
  }
  
  res.writeHead(404);
  res.end('Not Found');
});

// Create WebSocket server with UPGRADED error handling
const wss = new WebSocket.Server({ 
  server,
  clientTracking: true,
  perMessageDeflate: false // Disable compression to reduce issues
});

let aisConnection = null;
let reconnectTimer = null;
let messageCount = 0;
const startTime = Date.now();
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

function connectToAISStream() {
  console.log(`🛰️  Connecting to AISStream (attempt ${reconnectAttempts + 1})...`);
  
  try {
    aisConnection = new WebSocket('wss://stream.aisstream.io/v0/stream', {
      handshakeTimeout: 10000
    });
    
    aisConnection.on('open', () => {
      console.log('✅ Connected to AISStream');
      reconnectAttempts = 0; // Reset counter on success
      
      const subscription = {
        APIKey: AIS_API_KEY,
        BoundingBoxes: [[[-12, 50], [-4, 57]]], // Extended Ireland + approaches
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
      
      try {
        broadcastToClients({
          type: 'ais-data',
          data: data.toString()
        });
      } catch (err) {
        console.error('Error broadcasting message:', err.message);
      }
      
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
      console.warn(`🔒 AISStream closed: ${code} - ${reason || 'no reason'}`);
      aisConnection = null;
      
      broadcastToClients({
        type: 'status',
        status: 'disconnected',
        message: 'Disconnected from AISStream'
      });
      
      // Implement exponential backoff for reconnection
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        const delay = Math.min(5000 * Math.pow(2, reconnectAttempts), 60000); // Max 60s
        reconnectAttempts++;
        
        console.log(`🔄 Reconnecting in ${delay/1000}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
        
        reconnectTimer = setTimeout(() => {
          connectToAISStream();
        }, delay);
      } else {
        console.error('❌ Max reconnection attempts reached. Giving up.');
      }
    });
    
  } catch (error) {
    console.error('❌ Failed to create AISStream connection:', error.message);
  }
}

function broadcastToClients(message) {
  if (wss.clients.size === 0) return; // Don't stringify if no clients
  
  const messageStr = JSON.stringify(message);
  let sent = 0;
  let failed = 0;
  
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(messageStr);
        sent++;
      } catch (err) {
        console.error('Error sending to client:', err.message);
        failed++;
      }
    }
  });
  
  // Debug broadcast issues
  if (failed > 0) {
    console.log(`⚠️ Broadcast: ${sent} sent, ${failed} failed`);
  }
}

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  const clientIP = req.socket.remoteAddress;
  console.log(`👤 New client connected: ${clientIP}`);
  console.log(`   Total clients: ${wss.clients.size}`);
  
  // Send initial status
  try {
    ws.send(JSON.stringify({
      type: 'status',
      status: aisConnection && aisConnection.readyState === WebSocket.OPEN ? 'connected' : 'disconnected',
      message: 'Connected to relay server',
      clients: wss.clients.size
    }));
  } catch (err) {
    console.error('Error sending initial status:', err.message);
  }
  
  // Handle client messages (if any)
  ws.on('message', (message) => {
    console.log('📨 Received from client:', message.toString());
  });
  
  // Handle client errors
  ws.on('error', (error) => {
    console.error('❌ Client error:', error.message);
  });
  
  // Handle client disconnect
  ws.on('close', (code, reason) => {
    console.log(`👋 Client disconnected: ${clientIP}`);
    console.log(`   Code: ${code}, Reason: ${reason || 'none'}`);
    console.log(`   Remaining clients: ${wss.clients.size}`);
  });
  
  // Send periodic ping to keep connection alive
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.ping();
      } catch (err) {
        console.error('Error sending ping:', err.message);
      }
    } else {
      clearInterval(pingInterval);
    }
  }, 30000); // Ping every 30 seconds
});

// Handle WebSocket server errors
wss.on('error', (error) => {
  console.error('❌ WebSocket server error:', error);
});

// Start HTTP server
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 WebSocket server ready`);
  connectToAISStream();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('⏹️  Shutting down gracefully...');
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (aisConnection) aisConnection.close();
  wss.clients.forEach(client => {
    try {
      client.close(1000, 'Server shutting down');
    } catch (err) {
      console.error('Error closing client:', err.message);
    }
  });
  server.close(() => {
    console.log('👋 Server shut down');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('⏹️  Received SIGINT, shutting down...');
  process.exit(0);
});
