require('dotenv').config();
console.log('Starting server...');
console.log('Environment:', {
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    DOCKER: process.env.DOCKER_ENV
});

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./routes/api');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());

// Static Files
// In Docker, we copied frontend to ./public. Locally it is ../frontend
const frontendPath = process.env.NODE_ENV === 'production' || process.env.DOCKER_ENV
    ? path.join(__dirname, 'public')
    : path.join(__dirname, '../frontend');

console.log('Serving frontend from:', frontendPath);
app.use(express.static(frontendPath));

// Routes
app.use('/api', apiRoutes);

// Socket.io connection
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// Make io available in routes
app.set('socketio', io);

// Error Handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!', details: err.message });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT}`);
});
