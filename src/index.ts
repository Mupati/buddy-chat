import { series } from 'async';
import { Server, ServerOptions } from 'socket.io';
import express from 'express';
import debug from 'debug';
import { yellow, red, cyan } from 'colors';
import fs from 'fs';
import http from 'http';
import https from 'https';
import expressServer from './config.json';

const app = express();
app.use(express.static('./web_client_demo'));

// Debugging
const d = {
  debug: debug('debug'),
  err: debug('error'),
  warn: debug('warn'),
  timer: debug('timer'),
  info: debug('info'),
};

// Socket.io connection/message handler
const socketSignalingServer = (httpServerParams: Partial<ServerOptions> |
  http.Server | https.Server | undefined) => {
  const io = new Server(httpServerParams);
  io.on('connection', (socket) => {
    // convenience function to log server messages on the client
    const log = (...args: string[]) => {
      const array = ['Message from server:'];
      array.push(...args);
      socket.emit('log', array);
      d.info(array);
    };

    socket.on('message', (message: string) => {
      log('Client said: ', message);
      // To support multiple rooms in app, would be room-only (not broadcast)
      socket.broadcast.emit('message', message);
    });

    socket.on('create or join', (room: string) => {
      log(`Received request to create or join room ${room}`);

      const clients = io.sockets.adapter.rooms.get(room);
      const numClients = clients ? clients.size : 0;

      log(`Room ${room} now has ${numClients} client(s)`);

      if (numClients === 0) {
        socket.join(room);
        log(`Client ID ${socket.id} created room ${room}`);
        socket.emit('created', room, socket.id);
      } else if (numClients === 1) {
        log(`Client ID ${socket.id} joined room ${room}`);
        io.sockets.in(room).emit('join', room);
        socket.join(room);
        socket.emit('joined', room, socket.id);
        io.sockets.in(room).emit('ready');
      } else { // max two clients
        socket.emit('full', room);
      }

      socket.on('disconnect', () => {
        log(`Client ID ${socket.id} disconnected.`);
      });
    });
  });
};

series(
  [
  // 1. HTTP
    (callback) => {
      console.log(yellow('[1. HTTP]'));
      if (expressServer.ws.http_port) {
        const httpServer = http.createServer(app);
        socketSignalingServer(httpServer);
        httpServer.on('error', (err: { code: string; }) => {
          d.err('HTTP error:', err);
          if (err.code === 'EADDRINUSE') {
            console.log(yellow(`Port ${expressServer.ws.http_port} for HTTP backend already in use`));
            callback();
          }
        });
        httpServer.listen(expressServer.ws.http_port, () => {
          d.info(`HTTP backend listening on *:${expressServer.ws.http_port} (HTTP)`);
          callback(null, 'HTTP backend OK');
        });
      } else {
        callback(null, 'No HTTP server backend');
      }
    },
    // 2. HTTPS
    (callback) => {
      console.log(yellow('[2. HTTPS]'));
      if (expressServer.ws.https_port) {
        const options = {
          key: fs.readFileSync(expressServer.ws.key, 'utf8'),
          cert: fs.readFileSync(expressServer.ws.cert, 'utf8'),
        };
        const httpsServer = https.createServer(options, app);
        socketSignalingServer(httpsServer);
        httpsServer.on('error', (err: { code: string; }) => {
          d.err('HTTPS backend error:', err);
          if (err.code === 'EADDRINUSE') {
            console.log(yellow(`Port ${expressServer.ws.https_port} for HTTPS backend already in use`));
            callback();
          }
        });
        httpsServer.listen(expressServer.ws.https_port, () => {
          d.info(`HTTPS backend listening on *:${expressServer.ws.https_port} (HTTPS)`);
          callback(null, 'HTTPS backend OK');
        });
      } else {
        callback(null, 'No HTTPS users backend');
      }
    },
  ],
  (err, results) => {
    if (err) {
      console.log(red('The WebRTC signaling server failed to start'));
      process.exit(1);
    } else {
    // We're up and running
      console.log(cyan('Server started!'));
      console.log(results);
    }
  },
);
