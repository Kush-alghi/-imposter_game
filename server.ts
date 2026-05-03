import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
  }
});

const PORT = 3000;

app.use(express.static(path.join(__dirname, 'dist')));

interface Player {
  id: string;
  name: string;
  isHost: boolean;
  isReady: boolean;
  votesReceived: number;
  suspicionScore: number;
}

interface GameState {
  id: string;
  hostId: string;
  players: Map<string, Player>;
  phase: 'LOBBY' | 'WORD' | 'SPEAKING' | 'VOTING' | 'RESULT';
  secretWord: string;
  currentSpeakerIndex: number;
  timer: number;
  settings: {
    maxPlayers: number;
    roundTime: number;
  };
}

const rooms = new Map<string, GameState>();

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('create_room', ({ playerName }) => {
    const roomId = generateRoomId();
    const state: GameState = {
      id: roomId,
      hostId: socket.id,
      players: new Map(),
      phase: 'LOBBY',
      secretWord: '',
      currentSpeakerIndex: -1,
      timer: 0,
      settings: {
        maxPlayers: 8,
        roundTime: 30
      }
    };

    state.players.set(socket.id, {
      id: socket.id,
      name: playerName || `Host`,
      isHost: true,
      isReady: false,
      votesReceived: 0,
      suspicionScore: 0
    });

    rooms.set(roomId, state);
    socket.join(roomId);
    socket.emit('room_created', { roomId });
    io.to(roomId).emit('state_update', serializeState(state));
    console.log(`Room created: ${roomId} by ${playerName}`);
  });

  socket.on('join_room', ({ roomId, playerName }) => {
    const state = rooms.get(roomId);
    if (!state) {
      socket.emit('error', 'Room not found');
      return;
    }

    if (state.players.size >= state.settings.maxPlayers) {
      socket.emit('error', 'Room is full');
      return;
    }

    if (state.phase !== 'LOBBY') {
      socket.emit('error', 'Game already in progress');
      return;
    }

    socket.join(roomId);
    state.players.set(socket.id, {
      id: socket.id,
      name: playerName || `Player ${state.players.size + 1}`,
      isHost: false,
      isReady: false,
      votesReceived: 0,
      suspicionScore: 0
    });

    console.log(`User ${playerName} (${socket.id}) joined room ${roomId}`);
    io.to(roomId).emit('state_update', serializeState(state));
  });

  socket.on('vote', ({ roomId, targetId }) => {
    const state = rooms.get(roomId);
    if (!state || state.phase !== 'VOTING') return;

    const target = state.players.get(targetId);
    if (target) {
      target.votesReceived += 1;
      const totalPlayers = state.players.size;
      target.suspicionScore = Math.min(100, Math.floor((target.votesReceived / totalPlayers) * 100));

      io.to(roomId).emit('state_update', serializeState(state));
      io.to(roomId).emit('suspicion_update', { playerId: targetId, score: target.suspicionScore });
    }
  });

  socket.on('disconnect', () => {
    for (const [roomId, state] of rooms.entries()) {
      if (state.players.has(socket.id)) {
        state.players.delete(socket.id);
        
        if (state.players.size === 0) {
          rooms.delete(roomId);
          console.log(`Room ${roomId} deleted (empty)`);
        } else {
          // Transfer host if necessary
          if (state.hostId === socket.id) {
            const nextHostId = state.players.keys().next().value;
            if (nextHostId) {
              state.hostId = nextHostId;
              const nextHost = state.players.get(nextHostId);
              if (nextHost) nextHost.isHost = true;
              console.log(`Host transferred to ${nextHostId} in room ${roomId}`);
            }
          }
          io.to(roomId).emit('state_update', serializeState(state));
        }
      }
    }
  });
});

function serializeState(state: GameState) {
  return {
    ...state,
    players: Array.from(state.players.values())
  };
}

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
