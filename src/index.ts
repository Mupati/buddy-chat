import { series } from "async";
import { Server, ServerOptions } from "socket.io";
import express from "express";
import debug from "debug";
import { yellow, red, cyan } from "colors";
import fs from "fs";
import http from "http";
import https from "https";
import url from "url";
import expressServer from "./config.json";

const app = express();
app.use(express.static("./web_client_demo"));

// Debugging
const d = {
  debug: debug("debug"),
  err: debug("error"),
  warn: debug("warn"),
  timer: debug("timer"),
  info: debug("info"),
};

// events
const EVENTS = {
  CONNECTION: "connection",
  MESSAGE: "message",
  CREATE_OR_JOIN: "create_or_join",
  CREATED: "created",
  JOIN: "join",
  JOINED: "joined",
  READY: "ready",
  FULL: "full",
  DISCONNECT: "disconnect",
  LOG: "log",
  USER_JOINED: "user_joined",
  USER_LEFT: "user_left",
  ALL_USERS_IN_ROOM: "all_users_in_room",
};

interface User {
  [key: string]: string;
}
interface Room {
  [key: string]: User[];
}

const roomsData: Room = {};

const getConnectedUserInfo = (socket: any, next: () => void) => {
  const { query } = url.parse(socket.request.url, true);
  socket.user = query.name;
  d.info(query);
  next();
};

// Socket.io connection/message handler
const socketSignalingServer = (
  httpServerParams:
    | Partial<ServerOptions>
    | http.Server
    | https.Server
    | undefined
) => {
  const io = new Server(httpServerParams);
  io.use(getConnectedUserInfo);

  io.on(EVENTS.CONNECTION, (socket) => {
    // convenience function to log server messages on the client
    const log = (...args: string[]) => {
      const array = ["Message from server:"];
      array.push(...args);
      socket.emit(EVENTS.LOG, array);
      d.info(array);
    };

    socket.on(EVENTS.MESSAGE, (message: string) => {
      log("Client said: ", message);
      // To support multiple rooms in app, would be room-only (not broadcast)
      socket.broadcast.emit(EVENTS.MESSAGE, message);
    });

    socket.on(EVENTS.CREATE_OR_JOIN, (room: string) => {
      log(`Received request to create or join room ${room}`);

      const clients = io.sockets.adapter.rooms.get(room);
      const numClients = clients ? clients.size : 0;

      log(`Room ${room} now has ${numClients} client(s)`);

      // Get room Data and share with users when they connect
      if (!roomsData[room]) {
        roomsData[room] = [];
      }

      if (numClients === 0) {
        socket.join(room);
        log(`Client ID ${socket.id} created room ${room}`);
        socket.emit(EVENTS.CREATED, room, { name: socket.user, id: socket.id });
        roomsData[room].push({ name: socket.user, id: socket.id });
      } else if (numClients === 1) {
        log(`Client ID ${socket.id} joined room ${room}`);
        io.sockets.in(room).emit(EVENTS.JOIN, room);
        socket.join(room);
        socket.emit(EVENTS.JOINED, room, { name: socket.user, id: socket.id });
        roomsData[room].push({ name: socket.user, id: socket.id });

        socket.broadcast.emit(EVENTS.USER_JOINED, {
          id: socket.id,
          name: socket.user,
        });

        // Broadcast room-specific info to all users in the room
        io.to(room).emit(EVENTS.ALL_USERS_IN_ROOM, roomsData[room]);
        // io.sockets.in(room).emit(EVENTS.READY);
      } else {
        // max two clients
        socket.emit(EVENTS.FULL, room);
      }

      socket.on(EVENTS.DISCONNECT, () => {
        log(`Client ID ${socket.id} disconnected.`);
        // when a user is disconnected, find them and delete from the roomData
        roomsData[room] = roomsData[room].filter(
          (userInfo) => userInfo.id !== socket.id
        );

        // send updated list of available users.
        io.to(room).emit(EVENTS.ALL_USERS_IN_ROOM, roomsData[room]);
      });
    });
  });
};

series(
  [
    // 1. HTTP
    (callback) => {
      console.log(yellow("[1. HTTP]"));
      if (expressServer.ws.http_port) {
        const httpServer = http.createServer(app);
        socketSignalingServer(httpServer);
        httpServer.on("error", (err: { code: string }) => {
          d.err("HTTP error:", err);
          if (err.code === "EADDRINUSE") {
            console.log(
              yellow(
                `Port ${expressServer.ws.http_port} for HTTP backend already in use`
              )
            );
            callback();
          }
        });
        httpServer.listen(
          process.env.PORT || expressServer.ws.http_port,
          () => {
            d.info(
              `HTTP backend listening on *:${expressServer.ws.http_port} (HTTP)`
            );
            callback(null, "HTTP backend OK");
          }
        );
      } else {
        callback(null, "No HTTP server backend");
      }
    },
    // 2. HTTPS
    (callback) => {
      console.log(yellow("[2. HTTPS]"));
      if (expressServer.ws.https_port) {
        const options = {
          key: fs.readFileSync(expressServer.ws.key, "utf8"),
          cert: fs.readFileSync(expressServer.ws.cert, "utf8"),
        };
        const httpsServer = https.createServer(options, app);
        socketSignalingServer(httpsServer);
        httpsServer.on("error", (err: { code: string }) => {
          d.err("HTTPS backend error:", err);
          if (err.code === "EADDRINUSE") {
            console.log(
              yellow(
                `Port ${expressServer.ws.https_port} for HTTPS backend already in use`
              )
            );
            callback();
          }
        });
        httpsServer.listen(
          process.env.PORT || expressServer.ws.https_port,
          () => {
            d.info(
              `HTTPS backend listening on *:${expressServer.ws.https_port} (HTTPS)`
            );
            callback(null, "HTTPS backend OK");
          }
        );
      } else {
        callback(null, "No HTTPS users backend");
      }
    },
  ],
  (err, results) => {
    if (err) {
      console.log(red("The WebRTC signaling server failed to start"));
      process.exit(1);
    } else {
      // We're up and running
      console.log(cyan("Server started!"));
      console.log(results);
    }
  }
);
