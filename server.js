const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Serve static files
app.use(express.static('public'));

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html on root path
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Optional: handle unknown routes (like React Router)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Track screen sharing state
const screenSharing = {};

// Socket.IO signaling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Handle joining a room
  socket.on('join-room', (roomId, userId) => {
    socket.join(roomId);
    socket.to(roomId).emit('user-connected', userId);

    // Send current screen sharing state to the new user
    if (screenSharing[roomId]) {
      socket.emit('screen-sharing', screenSharing[roomId]);
    }

    socket.on('disconnect', () => {
      socket.to(roomId).emit('user-disconnected', userId);
      if (screenSharing[roomId] === userId) {
        delete screenSharing[roomId];
        socket.to(roomId).emit('screen-sharing-stopped');
      }
    });
  });

  // Handle WebRTC signaling messages
  socket.on('signal', (data) => {
    io.to(data.to).emit('signal', {
      from: socket.id,
      signal: data.signal,
    });
  });

  // Handle screen sharing
  socket.on('start-screen-sharing', (roomId, userId) => {
    if (!screenSharing[roomId]) {
      screenSharing[roomId] = userId;
      io.to(roomId).emit('screen-sharing', userId);
    }
  });

  socket.on('stop-screen-sharing', (roomId, userId) => {
    if (screenSharing[roomId] === userId) {
      delete screenSharing[roomId];
      io.to(roomId).emit('screen-sharing-stopped');
    }
  });

  // Generate meeting ID
  socket.on('start-meeting', (callback) => {
    const roomId = uuidv4();
    callback(roomId);
  });
});


const PORT = process.env.PORT || 3000;
//app.get("/", (req, res) => {
//  res.send("nothing to show here");
//});
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
// Start the server
//const PORT = process.env.PORT || 3000;
//server.listen(PORT, '0.0.0.0', () => {
//  console.log(`Server running on port ${PORT}`);
//});
