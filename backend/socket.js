const socketio = require("socket.io");
const { v4: uuid } = require("uuid");
// classes
const SuperTTTGame = require("./classes/SuperTTTGame.js");
const BasicTTTGame = require("./classes/BasicTTTGame.js");
// models
const User = require("./models/User.js");

const rooms = {};

module.exports = (server) => {
  const io = socketio(server, { cors: { origin: "*" } });

  io.on("connection", (socket) => {
    socket.on("disconnect", () => {
      let userRoomId = null;
      for (const key in rooms) {
        const room = rooms[key];
        if (room.clients.find((c) => c.playerId === socket.id)) {
          userRoomId = key;
        }
      }
      if (userRoomId) {
        rooms[userRoomId].clients = rooms[userRoomId].clients.filter(
          (c) => c.playerId !== socket.id
        );
        if (rooms[userRoomId].clients.length < 1) {
          delete rooms[userRoomId];
          return;
        }

        const game = rooms[userRoomId].game;
        if (game && !game.winner) {
          game.winner = rooms[userRoomId].clients[0];
          game.gameState = "finished";
        }

        io.to(userRoomId).emit("gameUpdated", game);
        io.to(userRoomId).emit("clientsUpdated", rooms[userRoomId].clients);
      }
    });

    socket.on("play", (payLoad) => {
      const { roomId, posBasic, posSuper } = payLoad;
      const room = rooms[roomId];
      if (!room) return; // room doesn't exist
      const game = room.game;
      if (!game) return; // game hasn't started yet

      if (socket.id !== game.playerTurn.playerId) return; // not your turn

      if (posSuper) {
        const played = game.play(posSuper, posBasic);

        if (!played) return; // can't play that field (super)

        io.to(roomId).emit("gameUpdated", game);
        return;
      }
      const played = game.play(posBasic);
      if (!played) return; // can't play that field (basic)

      io.to(roomId).emit("gameUpdated", game);
      return;
    });

    socket.on("createRoom", (gameMode) => {
      const room = {
        mode: gameMode,
        // id: uuid(),
        id: "room" + (Object.keys(rooms).length || "0"),
        clients: [],
      };

      rooms[room.id] = room;
      socket.emit("roomCreated", room.id);
    });

    socket.on("joinRoom", async ({ roomId, userId }) => {
      if (!roomId) return;

      const room = rooms[roomId];
      const clientId = socket.id;

      if (!room) return; // room doesn't exist
      if (room?.game && room.game.gameState === "finished") return;
      if (room.clients.length === 2) return; // room full
      const isPlayerTwo = room.clients.length === 1;

      if (isPlayerTwo) {
        const client = { clientId };
        if (userId) {
          client.userId = userId;
        }
        room.clients.push(client);

        const [playerOne, playerTwo] = await Promise.all(
          room.clients.map(async (c) => {
            let user = {};
            if (c.userId) {
              user = await User.findById(c.userId).select("username score");
            }
            let player = { playerId: c.clientId };
            if (user) {
              player = {
                ...player,
                username: user.username,
                score: user.score,
              };
            }
            return player;
          })
        );

        let game = {};
        if (room.mode === "SUPER") {
          game = new SuperTTTGame(playerOne, playerTwo);
        } else {
          game = new BasicTTTGame(playerOne, playerTwo);
        }

        room.clients[0] = game.playerOne;
        room.clients[1] = game.playerTwo;

        socket.join(roomId);

        rooms[roomId].game = game;
        io.to(roomId).emit("roomJoined", room);
        return;
      }

      const client = { clientId };
      if (userId) {
        client.userId = userId;
      }
      socket.join(roomId);
      room.clients.push(client);
      socket.emit("roomJoined", room);
    });

    socket.on("leaveRoom", (roomId) => {
      socket.leave(roomId);
      const room = rooms[roomId];
      if (!room) return; // room doesn't exist

      if (room.clients.length <= 1) {
        delete rooms[roomId];
        return;
      } else {
        room.clients = room.clients.filter((c) => c.playerId !== socket.id);
      }

      const game = room.game;
      if (game && !game.winner) {
        game.winner = room.clients[0];
        game.gameState = "finished";
      }

      io.to(roomId).emit("gameUpdated", game);
      io.to(roomId).emit("clientsUpdated", room.clients);
    });
  });
};
