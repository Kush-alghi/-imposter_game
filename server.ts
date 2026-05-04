import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: '*' } });

  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

  // ─── Types ───────────────────────────────────────────────

  interface Player {
    id: string;
    name: string;
    isHost: boolean;
    isReady: boolean;
    votesReceived: number;
    suspicionScore: number;
    isSpeaking: boolean;
    isImposter: boolean;
    word: string;
    hasVoted: boolean;
  }

  interface ActivityLog {
    id: string;
    type: 'JOIN' | 'LEAVE' | 'HOST_TRANSFER' | 'START' | 'KICK' | 'RESULT';
    message: string;
    timestamp: number;
  }

  interface GameState {
    id: string;
    hostId: string;
    players: Map<string, Player>;
    pendingPlayers: Map<string, { id: string; name: string }>;
    phase: 'LOBBY' | 'WORD' | 'SPEAKING' | 'VOTING' | 'RESULT';
    secretWord: string;
    currentSpeakerIndex: number;
    currentRound: number;
    timer: number;
    activityLog: ActivityLog[];
    messages: { playerId: string; playerName: string; emoji: string; timestamp: number }[];
    settings: {
      maxPlayers: number;
      roundTime: number;
      difficulty: 'EASY' | 'MEDIUM' | 'HARD' | 'TOUGH';
    };
    phaseInterval?: ReturnType<typeof setInterval>;
  }

  // ─── Word Lists ───────────────────────────────────────────

  const WORD_LISTS = {
    EASY:   ['CAT','DOG','BIRD','FISH','APPLE','BANANA','CAR','HOUSE','TREE','BOOK'],
    MEDIUM: ['COFFEE','SPACE','LIBRARY','PYRAMID','AIRPLANE','SUBMARINE','GHOST','QUARTZ','VELVET','COMPASS'],
    HARD:   ['OSMOSIS','ENTROPY','PARADIGM','SYNAPSE','QUASAR','ISOTOPE','ALGORITHM','CHIMERA','LABYRINTH','NEBULA'],
    TOUGH:  ['EPHEMERAL','SESQUIPEDALIAN','PULCHRITUDE','MNEMONIC','CACOPHONY','SURREPTITIOUS','UBIQUITOUS','ANACHRONISTIC','SYNECDOCHE','ZEITGEIST'],
  };

  // ─── Helpers ──────────────────────────────────────────────

  const rooms = new Map<string, GameState>();

  function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  function addLog(state: GameState, type: ActivityLog['type'], message: string) {
    state.activityLog.push({
      id: Math.random().toString(36).substring(7),
      type,
      message,
      timestamp: Date.now(),
    });
    if (state.activityLog.length > 50) state.activityLog.shift();
  }

  function serializeState(state: GameState, socketId?: string) {
    const players = Array.from(state.players.values()).map((p) => {
      if (state.phase !== 'RESULT' && p.id !== socketId) {
        return { ...p, word: '********', isImposter: false };
      }
      return { ...p };
    });
    return {
      ...state,
      players,
      pendingPlayers: Array.from(state.pendingPlayers.values()),
      phaseInterval: undefined,
    };
  }

  function broadcastState(state: GameState) {
    state.players.forEach((player) => {
      io.to(player.id).emit('state_update', serializeState(state, player.id));
    });
    state.pendingPlayers.forEach((player) => {
      io.to(player.id).emit('state_update', serializeState(state, player.id));
    });
  }

  function resolveVotes(state: GameState) {
    const players = Array.from(state.players.values());
    let maxVotes = -1;
    let suspectedId = '';

    for (const p of players) {
      if (p.votesReceived > maxVotes) {
        maxVotes = p.votesReceived;
        suspectedId = p.id;
      } else if (p.votesReceived === maxVotes) {
        suspectedId = ''; // tie
      }
    }

    const suspected = state.players.get(suspectedId);
    const imposter = players.find((p) => p.isImposter);

    if (suspected?.isImposter) {
      addLog(state, 'RESULT', `✅ ${suspected.name} was the Imposter! Agents win!`);
    } else if (imposter) {
      addLog(state, 'RESULT', `❌ Wrong! ${imposter.name} was the Imposter. Imposter wins!`);
    } else {
      addLog(state, 'RESULT', `⚖️ Tie vote — no one was eliminated. Imposter escapes!`);
    }
  }

  function startPhaseLoop(roomId: string) {
    const state = rooms.get(roomId);
    if (!state) return;

    if (state.phaseInterval) clearInterval(state.phaseInterval);

    state.phaseInterval = setInterval(() => {
      const s = rooms.get(roomId);
      if (!s) { clearInterval(state.phaseInterval); return; }

      s.timer = Math.max(0, s.timer - 1);

      if (s.phase === 'WORD') {
        if (s.timer <= 0) {
          const pa = Array.from(s.players.values());
          pa.forEach((p, i) => { p.isSpeaking = i === 0; });
          s.phase = 'SPEAKING';
          s.currentSpeakerIndex = 0;
          s.currentRound = 1;
          s.timer = s.settings.roundTime;
        }
      } else if (s.phase === 'SPEAKING') {
        const pa = Array.from(s.players.values());
        const spk = pa[s.currentSpeakerIndex];
        if (spk) {
          spk.suspicionScore = Math.min(100, spk.suspicionScore + Math.random() * 1.5);
        }

        if (s.timer <= 0) {
          if (spk) spk.isSpeaking = false;
          s.currentSpeakerIndex += 1;

          if (s.currentSpeakerIndex >= s.players.size) {
            if (s.currentRound < 2) {
              s.currentRound += 1;
              s.currentSpeakerIndex = 0;
              const firstSpk = pa[0];
              if (firstSpk) firstSpk.isSpeaking = true;
              s.timer = s.settings.roundTime;
              addLog(s, 'START', `Starting Round ${s.currentRound} of 2.`);
            } else {
              pa.forEach((p) => { p.isSpeaking = false; });
              s.phase = 'VOTING';
              s.timer = 25;
            }
          } else {
            const nextSpk = pa[s.currentSpeakerIndex];
            if (nextSpk) nextSpk.isSpeaking = true;
            s.timer = s.settings.roundTime;
          }
        }
      } else if (s.phase === 'VOTING') {
        if (s.timer <= 0) {
          s.phase = 'RESULT';
          resolveVotes(s);
          if (s.phaseInterval) clearInterval(s.phaseInterval);
        }
      } else {
        if (s.phaseInterval) clearInterval(s.phaseInterval);
        return;
      }

      broadcastState(s);
    }, 1000);
  }

  // ─── Socket Handlers ──────────────────────────────────────

  io.on('connection', (socket) => {
    console.log('Connected:', socket.id);

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
      currentRound: 1,
      timer: 0,
      activityLog: [],
      messages: [],
      settings: {
        maxPlayers: 10,
          roundTime: 30,
          difficulty: difficulty || 'MEDIUM',
        },
      };

      const host: Player = {
        id: socket.id,
        name: playerName || 'Host',
        isHost: true,
        isReady: false,
        votesReceived: 0,
        suspicionScore: 0,
        isSpeaking: false,
        isImposter: false,
        word: '',
        hasVoted: false,
      };

      state.players.set(socket.id, host);
      addLog(state, 'JOIN', `${host.name} created the session.`);
      rooms.set(roomId, state);
      socket.join(roomId);
      socket.emit('room_created', { roomId });
      broadcastState(state);
    });

    socket.on('join_request', ({ roomId, playerName }) => {
      const state = rooms.get(roomId);
      if (!state) { socket.emit('error', 'Room not found'); return; }
      if (state.players.size + state.pendingPlayers.size >= state.settings.maxPlayers) {
        socket.emit('error', 'Room is full'); return;
      }
      state.pendingPlayers.set(socket.id, { id: socket.id, name: playerName });
      socket.emit('waiting_for_host');
      broadcastState(state);
    });

    socket.on('approve_player', ({ roomId, targetId, approved }) => {
      const state = rooms.get(roomId);
      if (!state || state.hostId !== socket.id) return;
      const pending = state.pendingPlayers.get(targetId);
      if (!pending) return;
      state.pendingPlayers.delete(targetId);
      const target = io.sockets.sockets.get(targetId);
      if (approved && target) {
        target.join(roomId);
        const newPlayer: Player = {
          id: targetId, name: pending.name,
          isHost: false, isReady: false,
          votesReceived: 0, suspicionScore: 0,
          isSpeaking: false, isImposter: false,
          word: '', hasVoted: false,
        };
        state.players.set(targetId, newPlayer);
        addLog(state, 'JOIN', `${newPlayer.name} joined the mission.`);
        target.emit('room_joined', { roomId });
      } else if (target) {
        target.emit('error', 'Host declined your request.');
      }
      broadcastState(state);
    });

    socket.on('kick_player', ({ roomId, targetId }) => {
      const state = rooms.get(roomId);
      if (!state || state.hostId !== socket.id) return;
      const p = state.players.get(targetId);
      if (p) {
        addLog(state, 'KICK', `${p.name} was removed.`);
        state.players.delete(targetId);
        const t = io.sockets.sockets.get(targetId);
        if (t) { t.leave(roomId); t.emit('error', 'You were removed from the session.'); }
        broadcastState(state);
      }
    });

    socket.on('update_settings', ({ roomId, settings }) => {
      const state = rooms.get(roomId);
      if (!state || state.hostId !== socket.id) return;
      state.settings = { ...state.settings, ...settings };
      broadcastState(state);
    });

    socket.on('start_game', (roomId) => {
      const state = rooms.get(roomId);
      if (!state || state.hostId !== socket.id || state.players.size < 3) return;

      const list = WORD_LISTS[state.settings.difficulty];
      const word = list[Math.floor(Math.random() * list.length)];
      state.secretWord = word;

      const pa = Array.from(state.players.values());
      const imposterIdx = Math.floor(Math.random() * pa.length);

      pa.forEach((p, i) => {
        p.isImposter = i === imposterIdx;
        p.word = p.isImposter ? 'UNKNOWN' : word;
        p.votesReceived = 0;
        p.suspicionScore = 0;
        p.isSpeaking = false;
        p.hasVoted = false;
      });

      state.phase = 'WORD';
      state.timer = 10;
      state.currentSpeakerIndex = -1;
      state.currentRound = 1;
      state.messages = [];

      addLog(state, 'START', `Mission initiated. Round 1 of 2. Difficulty: ${state.settings.difficulty}`);
      broadcastState(state);
      startPhaseLoop(roomId);
    });

    socket.on('vote', ({ roomId, targetId }) => {
      const state = rooms.get(roomId);
      if (!state || state.phase !== 'VOTING') return;
      const voter = state.players.get(socket.id);
      if (!voter || voter.hasVoted) return;
      voter.hasVoted = true;
      const target = state.players.get(targetId);
      if (target) {
        target.votesReceived += 1;
        target.suspicionScore = Math.min(
          100,
          Math.floor((target.votesReceived / state.players.size) * 100)
        );
      }
      const allVoted = Array.from(state.players.values()).every((p) => p.hasVoted);
      if (allVoted) {
        state.phase = 'RESULT';
        state.timer = 0;
        resolveVotes(state);
        if (state.phaseInterval) clearInterval(state.phaseInterval);
      }
      broadcastState(state);
    });

    socket.on('skip_turn', () => {
      for (const [, state] of rooms.entries()) {
        if (state.phase !== 'SPEAKING') continue;
        const pa = Array.from(state.players.values());
        const spk = pa[state.currentSpeakerIndex];
        if (spk && spk.id === socket.id) {
          state.timer = 1;
          broadcastState(state);
          break;
        }
      }
    });

    socket.on('send_emoji', ({ roomId, emoji }) => {
      const state = rooms.get(roomId);
      if (!state) return;
      const player = state.players.get(socket.id);
      if (!player) return;

      // Emoji-only check (allow multiple emojis)
      const emojiRegex = /^(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])+$/;
      const cleanEmoji = emoji.trim();
      if (!emojiRegex.test(cleanEmoji)) return;

      state.messages.push({
        playerId: socket.id,
        playerName: player.name,
        emoji: cleanEmoji.substring(0, 50), // limit length
        timestamp: Date.now(),
      });

      if (state.messages.length > 30) state.messages.shift();
      broadcastState(state);
    });

    socket.on('reset_room', (roomId) => {
      const state = rooms.get(roomId);
      if (!state || state.hostId !== socket.id) return;
      if (state.phaseInterval) clearInterval(state.phaseInterval);
      state.phase = 'LOBBY';
      state.timer = 0;
      state.secretWord = '';
      state.currentSpeakerIndex = -1;
      state.currentRound = 1;
      state.messages = [];
      state.players.forEach((p) => {
        p.isImposter = false; p.word = ''; p.isSpeaking = false;
        p.votesReceived = 0; p.suspicionScore = 0; p.hasVoted = false;
      });
      addLog(state, 'START', 'New round starting. Lobby open.');
      broadcastState(state);
    });

    socket.on('disconnect', () => {
      for (const [roomId, state] of rooms.entries()) {
        state.pendingPlayers.delete(socket.id);
        if (!state.players.has(socket.id)) continue;
        const leaving = state.players.get(socket.id);
        if (leaving) addLog(state, 'LEAVE', `${leaving.name} disconnected.`);
        state.players.delete(socket.id);

        if (state.players.size === 0) {
          if (state.phaseInterval) clearInterval(state.phaseInterval);
          rooms.delete(roomId);
          continue;
        }

        if (state.hostId === socket.id) {
          const nextId = state.players.keys().next().value!;
          state.hostId = nextId;
          const next = state.players.get(nextId)!;
          next.isHost = true;
          addLog(state, 'HOST_TRANSFER', `${next.name} is now the Host.`);
        }

        broadcastState(state);
      }
    });
  });

  // ─── Vite Middleware ────────────────────────────────────

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
