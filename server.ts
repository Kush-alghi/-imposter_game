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
  isImposter: boolean;
  word: string;
}

interface ActivityLog {
  id: string;
  type: 'JOIN' | 'LEAVE' | 'HOST_TRANSFER' | 'START' | 'KICK';
  message: string;
  timestamp: number;
}

interface GameState {
  id: string;
  hostId: string;
  players: Map<string, Player>;
  pendingPlayers: Map<string, { id: string, name: string }>;
  phase: 'LOBBY' | 'WORD' | 'SPEAKING' | 'VOTING' | 'RESULT';
  secretWord: string;
  currentSpeakerIndex: number;
  timer: number;
  activityLog: ActivityLog[];
  settings: {
    maxPlayers: number;
    roundTime: number;
    difficulty: 'EASY' | 'MEDIUM' | 'HARD' | 'TOUGH';
  };
}

const rooms = new Map<string, GameState>();

function serializeState(state: GameState, socketId?: string) {
  const players = Array.from(state.players.values()).map(p => {
    // If not Result phase and not the player themselves, hide secret info
    if (state.phase !== 'RESULT' && p.id !== socketId) {
      return {
        ...p,
        word: '********',
        isImposter: false // Mask as innocent
      };
    }
    return p;
  });

  return {
    ...state,
    players,
    pendingPlayers: Array.from(state.pendingPlayers.values())
  };
}

// Helper to broadcast state to each member with their own view
function broadcastState(state: GameState) {
  state.players.forEach((player) => {
    io.to(player.id).emit('state_update', serializeState(state, player.id));
  });
  // Also update pending players (they see the lobby)
  state.pendingPlayers.forEach((player) => {
    io.to(player.id).emit('state_update', serializeState(state, player.id));
  });
}

function addLog(state: GameState, type: ActivityLog['type'], message: string) {
  state.activityLog.push({
    id: Math.random().toString(36).substring(7),
    type,
    message,
    timestamp: Date.now()
  });
  if (state.activityLog.length > 50) state.activityLog.shift();
}

const WORD_LISTS = {
  EASY: ['CAT', 'DOG', 'BIRD', 'FISH', 'APPLE', 'BANANA', 'CAR', 'HOUSE', 'TREE', 'BOOK'],
  MEDIUM: ['COFFEE', 'SPACE', 'LIBRARY', 'PYRAMID', 'AIRPLANE', 'SUBMARINE', 'PARCHMENT', 'GHOST', 'QUARTZ', 'VELVET'],
  HARD: ['OSMOSIS', 'ENTROPY', 'PARADIGM', 'SYNAPSE', 'QUASAR', 'ISOTOPE', 'ALGORITHM', 'CHIMERA', 'LABYRINTH', 'NEBULA'],
  TOUGH: ['EPHEMERAL', 'SESQUIPEDALIAN', 'PULCHRITUDE', 'MNEMONIC', 'CACOPHONY', 'SURREPTITIOUS', 'UBIQUITOUS', 'ANACHRONISTIC', 'SYNECDOCHE', 'ZEITGEIST']
};

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('create_room', ({ playerName, difficulty }) => {
    const roomId = generateRoomId();
    const state: GameState = {
      id: roomId,
      hostId: socket.id,
      players: new Map(),
      pendingPlayers: new Map(),
      phase: 'LOBBY',
      secretWord: '',
      currentSpeakerIndex: -1,
      timer: 0,
      activityLog: [],
      settings: {
        maxPlayers: 10,
        roundTime: 30,
        difficulty: difficulty || 'MEDIUM'
      }
    };

    const host: Player = {
      id: socket.id,
      name: playerName || `Host`,
      isHost: true,
      isReady: false,
      votesReceived: 0,
      suspicionScore: 0,
      isImposter: false,
      word: ''
    };
    
    state.players.set(socket.id, host);
    addLog(state, 'JOIN', `${host.name} created the session.`);

    rooms.set(roomId, state);
    socket.join(roomId);
    socket.emit('room_created', { roomId });
    broadcastState(state);
    console.log(`Room created: ${roomId} by ${playerName}`);
  });

  socket.on('join_request', ({ roomId, playerName }) => {
    const state = rooms.get(roomId);
    if (!state) {
      socket.emit('error', 'Room not found');
      return;
    }

    if (state.players.size + state.pendingPlayers.size >= state.settings.maxPlayers) {
      socket.emit('error', 'Room is currently full or busy');
      return;
    }

    state.pendingPlayers.set(socket.id, { id: socket.id, name: playerName });
    socket.emit('waiting_for_host');
    broadcastState(state);
    console.log(`Join request from ${playerName} for room ${roomId}`);
  });

  socket.on('approve_player', ({ roomId, targetId, approved }) => {
    const state = rooms.get(roomId);
    if (!state || state.hostId !== socket.id) return;

    const pendingPlayer = state.pendingPlayers.get(targetId);
    if (!pendingPlayer) return;

    state.pendingPlayers.delete(targetId);
    const targetSocket = io.sockets.sockets.get(targetId);

    if (approved) {
      if (targetSocket) {
        targetSocket.join(roomId);
        const newPlayer: Player = {
          id: targetId,
          name: pendingPlayer.name,
          isHost: false,
          isReady: false,
          votesReceived: 0,
          suspicionScore: 0,
          isImposter: false,
          word: ''
        };
        state.players.set(targetId, newPlayer);
        addLog(state, 'JOIN', `${newPlayer.name} joined the mission.`);
        targetSocket.emit('room_joined', { roomId });
      }
    } else {
      if (targetSocket) {
        targetSocket.emit('error', 'The host has declined your request to join.');
      }
    }

    broadcastState(state);
  });

  socket.on('kick_player', ({ roomId, targetId }) => {
    const state = rooms.get(roomId);
    if (!state || state.hostId !== socket.id) return;

    const playerToKick = state.players.get(targetId);
    if (playerToKick) {
      addLog(state, 'KICK', `${playerToKick.name} was removed from the mission.`);
      state.players.delete(targetId);
      const targetSocket = io.sockets.sockets.get(targetId);
      if (targetSocket) {
        targetSocket.leave(roomId);
        targetSocket.emit('error', 'You have been removed from the session.');
      }
      broadcastState(state);
      console.log(`Player ${targetId} kicked from room ${roomId}`);
    }
  });

  socket.on('update_settings', ({ roomId, settings }) => {
    const state = rooms.get(roomId);
    if (!state || state.hostId !== socket.id) return;
    state.settings = { ...state.settings, ...settings };
    addLog(state, 'HOST_TRANSFER', `Settings updated: Difficulty set to ${state.settings.difficulty}`);
    broadcastState(state);
  });

  socket.on('start_game', (roomId) => {
    const state = rooms.get(roomId);
    if (!state || state.hostId !== socket.id) return;
    if (state.players.size < 3) return;

    addLog(state, 'START', `Imposter mission initiated.`);

    // Pick word
    const difficulty = state.settings.difficulty || 'MEDIUM';
    const list = WORD_LISTS[difficulty];
    const randomWord = list[Math.floor(Math.random() * list.length)];
    state.secretWord = randomWord;

    // Assign Imposter
    const playerArray = Array.from(state.players.values());
    const imposterIndex = Math.floor(Math.random() * playerArray.length);
    const imposterId = playerArray[imposterIndex].id;

    for (const player of state.players.values()) {
      player.isImposter = player.id === imposterId;
      player.word = player.isImposter ? 'UNKNOWN' : randomWord;
      player.votesReceived = 0;
      player.suspicionScore = 0;
    }

    state.phase = 'WORD';
    state.timer = 10; // 10 seconds to look at the word
    
    broadcastState(state);
    
    // Start countdown for WORD phase
    const interval = setInterval(() => {
      const currentState = rooms.get(roomId);
      if (!currentState) {
        clearInterval(interval);
        return;
      }

      if (currentState.phase === 'WORD') {
        currentState.timer -= 1;
        if (currentState.timer <= 0) {
          currentState.phase = 'SPEAKING';
          currentState.currentSpeakerIndex = 0;
          currentState.timer = currentState.settings.roundTime;
        }
      } else if (currentState.phase === 'SPEAKING') {
        currentState.timer -= 1;
        // Simulate suspicion score drift during speaking
        const players = Array.from(currentState.players.values());
        const currentSpeaker = players[currentState.currentSpeakerIndex];
        if (currentSpeaker) {
          currentSpeaker.suspicionScore = Math.min(100, currentSpeaker.suspicionScore + Math.random() * 2);
        }

        if (currentState.timer <= 0) {
          currentState.currentSpeakerIndex += 1;
          if (currentState.currentSpeakerIndex >= currentState.players.size) {
            currentState.phase = 'VOTING';
            currentState.timer = 20; // 20 seconds to vote
          } else {
            currentState.timer = currentState.settings.roundTime;
          }
        }
      } else if (currentState.phase === 'VOTING') {
        currentState.timer -= 1;
        if (currentState.timer <= 0) {
          currentState.phase = 'RESULT';
          resolveVotes(currentState);
          clearInterval(interval);
        }
      } else {
        clearInterval(interval);
        return;
      }

      broadcastState(currentState);
    }, 1000);
  });

  function resolveVotes(state: GameState) {
    const players = Array.from(state.players.values());
    let maxVotes = -1;
    let suspectedPlayerId = '';
    
    for (const p of players) {
      if (p.votesReceived > maxVotes) {
        maxVotes = p.votesReceived;
        suspectedPlayerId = p.id;
      } else if (p.votesReceived === maxVotes) {
        suspectedPlayerId = ''; // Tie
      }
    }

    const suspectedPlayer = state.players.get(suspectedPlayerId);
    const imposter = players.find(p => p.isImposter);
    
    if (suspectedIdIsImposter(state, suspectedPlayerId)) {
      addLog(state, 'START', `Imposter ${suspectedPlayer?.name} was caught! Agents win.`);
    } else {
      addLog(state, 'START', `Mission failed. ${imposter?.name} was the Imposter.`);
    }
  }

  function suspectedIdIsImposter(state: GameState, id: string): boolean {
    const p = state.players.get(id);
    return p ? p.isImposter : false;
  }

  socket.on('vote', ({ roomId, targetId }) => {
    const state = rooms.get(roomId);
    if (!state || state.phase !== 'VOTING') return;

    const target = state.players.get(targetId);
    if (target) {
      target.votesReceived += 1;
      const totalPlayers = state.players.size;
      target.suspicionScore = Math.min(100, Math.floor((target.votesReceived / totalPlayers) * 100));

      broadcastState(state);
      io.to(roomId).emit('suspicion_update', { playerId: targetId, score: target.suspicionScore });
    }
  });

  socket.on('skip_turn', (playerId) => {
    // Only the current speaker can skip their turn
    for (const [roomId, state] of rooms.entries()) {
      if (state.phase === 'SPEAKING') {
        const players = Array.from(state.players.values());
        const currentSpeaker = players[state.currentSpeakerIndex];
        if (currentSpeaker && currentSpeaker.id === socket.id) {
          state.timer = 0; // Force advance
          broadcastState(state);
          break;
        }
      }
    }
  });

  socket.on('disconnect', () => {
    for (const [roomId, state] of rooms.entries()) {
      if (state.pendingPlayers.has(socket.id)) {
        state.pendingPlayers.delete(socket.id);
        broadcastState(state);
      }

      if (state.players.has(socket.id)) {
        const leavingPlayer = state.players.get(socket.id);
        if (leavingPlayer) {
          addLog(state, 'LEAVE', `${leavingPlayer.name} disconnected.`);
        }
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
              if (nextHost) {
                nextHost.isHost = true;
                addLog(state, 'HOST_TRANSFER', `${nextHost.name} is now the session Host.`);
              }
              console.log(`Host transferred to ${nextHostId} in room ${roomId}`);
            }
          }
          broadcastState(state);
        }
      }
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
