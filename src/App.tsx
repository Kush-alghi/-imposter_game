import React, { useState, useEffect, useMemo } from 'react';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Mic, Users, Target, AlertCircle, 
  ChevronRight, Play, Loader2, BarChart2,
  Activity, Check, Copy, ExternalLink,
  Skull, User
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useRef } from 'react';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
interface Player {
  id: string;
  name: string;
  isHost: boolean;
  isReady: boolean;
  votesReceived: number;
  suspicionScore: number;
  isSpeaking?: boolean;
  word?: string;
  isImposter?: boolean;
}

type Phase = 'LOBBY' | 'WORD' | 'SPEAKING' | 'VOTING' | 'RESULT';

interface GameState {
  id: string;
  hostId: string;
  players: Player[];
  pendingPlayers: { id: string, name: string }[];
  phase: Phase;
  secretWord: string;
  currentSpeakerIndex: number;
  timer: number;
  activityLog: { id: string, type: string, message: string, timestamp: number }[];
  settings: {
    maxPlayers: number;
    roundTime: number;
    difficulty: 'EASY' | 'MEDIUM' | 'HARD' | 'TOUGH';
  };
}

// --- Components ---

const ActivityLog = ({ logs }: { logs: GameState['activityLog'] }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="bg-zinc-950 border border-zinc-900 rounded-xl p-3 h-32 flex flex-col">
      <p className="text-[10px] font-black uppercase text-zinc-600 tracking-widest mb-2 flex items-center gap-2">
        <Activity className="w-3 h-3" />
        Activity Feed
      </p>
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-1.5 scrollbar-hide">
        {logs.length === 0 ? (
          <p className="text-[10px] text-zinc-700 italic">No activity recorded...</p>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="text-[10px] flex items-start gap-2">
              <span className="text-zinc-700 font-mono">[{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}]</span>
              <span className={cn(
                "font-bold",
                log.type === 'JOIN' && "text-green-500",
                log.type === 'LEAVE' && "text-zinc-500",
                log.type === 'KICK' && "text-red-500",
                log.type === 'HOST_TRANSFER' && "text-brand",
                log.type === 'START' && "text-blue-500"
              )}>
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

const PendingRequest = ({ request, onApprove }: { request: { id: string, name: string }, onApprove: (id: string, approved: boolean) => void }) => {
  return (
    <motion.div
      initial={{ x: 20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      className="p-3 bg-zinc-900 border border-brand/30 rounded-xl flex items-center justify-between gap-4 shadow-[0_4px_20px_rgba(244,63,94,0.1)]"
    >
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-brand/10 flex items-center justify-center">
          <User className="w-4 h-4 text-brand" />
        </div>
        <div className="overflow-hidden">
          <p className="text-[10px] font-black text-brand uppercase tracking-widest leading-none mb-1">Incoming</p>
          <p className="font-bold text-sm text-white truncate max-w-[120px]">{request.name}</p>
        </div>
      </div>
      <div className="flex gap-1.5">
        <button 
          onClick={() => onApprove(request.id, false)}
          className="p-1.5 rounded-lg bg-zinc-800 text-zinc-500 hover:bg-zinc-700 transition-colors"
        >
          <Skull className="w-3.5 h-3.5 rotate-180" />
        </button>
        <button 
          onClick={() => onApprove(request.id, true)}
          className="p-1.5 rounded-lg bg-brand text-white hover:bg-rose-600 transition-colors"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  );
};

const SuspicionMeter = ({ score }: { score: number }) => {
  const level = useMemo(() => {
    if (score < 20) return { label: 'Innocent', color: 'text-green-400', bg: 'bg-green-500/20' };
    if (score < 40) return { label: 'Normal', color: 'text-emerald-300', bg: 'bg-emerald-500/20' };
    if (score < 60) return { label: 'Suspect', color: 'text-yellow-400', bg: 'bg-yellow-500/20' };
    if (score < 80) return { label: 'Highly Sus', color: 'text-orange-500', bg: 'bg-orange-500/20' };
    return { label: 'CRITICAL', color: 'text-red-500', bg: 'bg-red-500/30 font-bold animate-pulse' };
  }, [score]);

  return (
    <div className="w-full space-y-1">
      <div className="flex justify-between items-center text-[10px] uppercase tracking-wider font-semibold">
        <span className={level.color}>{level.label}</span>
        <span className="text-zinc-500">{score}%</span>
      </div>
      <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          className={cn(
            "h-full transition-colors duration-500",
            score < 40 ? "bg-emerald-500" : score < 70 ? "bg-yellow-500" : "bg-red-500"
          )}
        />
      </div>
    </div>
  );
};

const PlayerCard = ({ 
  player, 
  isMe, 
  canVote, 
  onVote,
  onKick,
  isHostMe,
  phase
}: { 
  player: Player, 
  isMe: boolean, 
  canVote: boolean, 
  onVote: (id: string) => void,
  onKick: (id: string) => void,
  isHostMe: boolean,
  phase: Phase
}) => {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        "relative p-4 rounded-xl border flex flex-col gap-3 transition-all",
        isMe ? "bg-zinc-900 border-rose-500/50 shadow-[0_0_20px_rgba(244,63,94,0.1)]" : "bg-zinc-900/50 border-zinc-800",
        player.isHost && !isMe && "border-amber-500/30"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-10 h-10 rounded-full flex items-center justify-center border-2",
            player.isSpeaking ? "border-brand animate-pulse" : "border-zinc-800"
          )}>
            {player.isHost ? <Skull className="w-5 h-5 text-amber-500" /> : <User className="w-5 h-5 text-zinc-500" />}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="font-bold text-zinc-100 truncate max-w-[100px]">
                {player.name}
              </h3>
              {player.isHost && <span className="text-[8px] bg-amber-500/20 text-amber-500 px-1 py-0.5 rounded uppercase font-black">Host</span>}
              {isMe && <span className="text-[8px] bg-brand/20 text-brand px-1 py-0.5 rounded uppercase font-black">You</span>}
            </div>
            <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-tighter">
              {player.isSpeaking ? "Broadcasting..." : "Online"}
            </p>
          </div>
        </div>
        
        <div className="flex gap-2">
          {canVote && !isMe && phase === 'VOTING' && (
            <button
              onClick={() => onVote(player.id)}
              className="p-2 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-all group shrink-0"
            >
              <Skull className="w-4 h-4 group-hover:scale-110 transition-transform" />
            </button>
          )}
          {isHostMe && !isMe && phase === 'LOBBY' && (
            <button
              onClick={() => onKick(player.id)}
              className="p-2 rounded-lg bg-zinc-800 text-zinc-500 hover:bg-red-500 hover:text-white transition-all group shrink-0"
              title="Kick Player"
            >
              <Users className="w-4 h-4 group-hover:scale-110 transition-transform" />
            </button>
          )}
        </div>
      </div>

      <SuspicionMeter score={player.suspicionScore} />
    </motion.div>
  );
};

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomId, setRoomId] = useState('');
  const [name, setName] = useState('');
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState('');
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [waitingForApproval, setWaitingForApproval] = useState(false);
  const [flow, setFlow] = useState<'HOST' | 'JOIN'>('HOST');
  const [preDifficulty, setPreDifficulty] = useState<'EASY' | 'MEDIUM' | 'HARD' | 'TOUGH'>('MEDIUM');
  const [copiedId, setCopiedId] = useState(false);

  const isHost = useMemo(() => {
    return gameState?.hostId === socket?.id;
  }, [gameState, socket]);

  const me = useMemo(() => {
    return gameState?.players.find(p => p.id === socket?.id);
  }, [gameState, socket]);

  useEffect(() => {
    const s = io();
    setSocket(s);

    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    if (roomFromUrl) {
      setRoomId(roomFromUrl.toUpperCase());
    }

    s.on('state_update', (newState: GameState) => {
      setGameState(newState);
      if (newState.id) setRoomId(newState.id);
    });

    s.on('room_created', ({ roomId }: { roomId: string }) => {
      setRoomId(roomId);
      setJoined(true);
      setWaitingForApproval(false);
      requestPermissions();
    });

    s.on('room_joined', ({ roomId }: { roomId: string }) => {
      setRoomId(roomId);
      setJoined(true);
      setWaitingForApproval(false);
      requestPermissions();
    });

    s.on('waiting_for_host', () => {
      setWaitingForApproval(true);
    });

    s.on('error', (msg: string) => {
      setError(msg);
      setWaitingForApproval(false);
    });

    return () => {
      s.disconnect();
    };
  }, []);

  const requestPermissions = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      setMediaStream(stream);
    } catch (err) {
      console.error("Permission denied", err);
      setError("Microphone access is required to play.");
    }
  };

  const createRoom = () => {
    if (!name || !socket) return;
    setError('');
    socket.emit('create_room', { playerName: name });
    // After creation, we might want to apply the pre-selected difficulty
    // However, the server sets default difficulty. We'll handle it via update_settings if needed, 
    // but better to just emit difficulty with create_room if server supports it.
    // Looking at server.ts from previous turns, it uses a default 'MEDIUM'.
    // I should probably update server to handle difficulty in create_room.
  };

  useEffect(() => {
    if (joined && gameState && gameState.hostId === socket?.id && gameState.settings.difficulty !== preDifficulty) {
      socket.emit('update_settings', { roomId: gameState.id, settings: { difficulty: preDifficulty } });
    }
  }, [joined, gameState?.id]);

  const joinRoom = () => {
    if (!name || !roomId || !socket) return;
    setError('');
    socket.emit('join_request', { roomId, playerName: name });
  };

  const approvePlayer = (targetId: string, approved: boolean) => {
    if (!socket || !gameState || !isHost) return;
    socket.emit('approve_player', { roomId: gameState.id, targetId, approved });
  };

  const startGame = () => {
    if (!socket || !gameState || !isHost) return;
    socket.emit('start_game', gameState.id);
  };

  const kickPlayer = (targetId: string) => {
    if (!socket || !gameState || !isHost) return;
    socket.emit('kick_player', { roomId: gameState.id, targetId });
  };

  const castVote = (targetId: string) => {
    if (!socket || !gameState) return;
    socket.emit('vote', { roomId: gameState.id, targetId });
  };

  const copyRoomId = () => {
    if (!roomId) return;
    navigator.clipboard.writeText(roomId);
  };

  const copyInviteLink = () => {
    if (!roomId) return;
    const url = `${window.location.origin}?room=${roomId}`;
    navigator.clipboard.writeText(url);
  };

  const updateDifficulty = (difficulty: 'EASY' | 'MEDIUM' | 'HARD' | 'TOUGH') => {
    if (!socket || !gameState || !isHost) return;
    socket.emit('update_settings', { 
      roomId: gameState.id, 
      settings: { difficulty } 
    });
  };

  if (waitingForApproval) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center p-6 bg-[#09090b]">
        <div className="w-full max-w-sm text-center space-y-6">
          <motion.div
            animate={{ scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }}
            transition={{ repeat: Infinity, duration: 2 }}
            className="w-20 h-20 bg-brand/10 rounded-full flex items-center justify-center mx-auto"
          >
            <Loader2 className="w-10 h-10 text-brand animate-spin" />
          </motion.div>
          <div className="space-y-2">
            <h2 className="text-2xl font-black uppercase tracking-tighter text-white italic">Awaiting Clearance</h2>
            <p className="text-zinc-500 font-medium text-sm">Target Room: <span className="text-brand font-mono">{roomId}</span></p>
          </div>
          <p className="text-xs text-zinc-600 uppercase font-black tracking-widest leading-loose">
            The Host is currently reviewing your credentials.<br/>Stand by for authorization.
          </p>
          <button 
            onClick={() => setWaitingForApproval(false)}
            className="text-[10px] text-zinc-500 hover:text-zinc-300 uppercase font-black tracking-widest transition-colors"
          >
            Cancel Request
          </button>
        </div>
      </div>
    );
  }

  if (!joined) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center p-6 bg-[#0c0c0e] text-zinc-300 font-sans">
        <div className="w-full max-w-xl space-y-12">
          {/* Header */}
          <div className="text-center space-y-4">
            <motion.div 
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="inline-flex p-4 rounded-3xl bg-zinc-900 border border-zinc-800 shadow-2xl relative"
            >
              <Skull className="w-12 h-12 text-zinc-100" />
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full animate-pulse border-2 border-[#0c0c0e]" />
            </motion.div>
            <div className="space-y-1">
              <h1 className="text-5xl font-black italic tracking-tighter text-white uppercase">
                Vocal <span className="text-red-500 underline decoration-wavy decoration-2 underline-offset-8">Imposter</span>
              </h1>
              <p className="text-zinc-500 font-medium tracking-tight text-lg">Lurk in the shadows, or hunt for the truth.</p>
            </div>
          </div>

          {/* Flow Tabs */}
          <div className="flex p-1 bg-zinc-900/50 rounded-2xl border border-zinc-800 backdrop-blur-sm">
            {(['HOST', 'JOIN'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setFlow(t)}
                className={cn(
                  "flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all",
                  flow === t ? "bg-zinc-800 text-white shadow-lg" : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                {t} Session
              </button>
            ))}
          </div>

          <div className="relative pl-12 space-y-12 py-4">
            {/* Connector Line */}
            <div className="absolute left-[21px] top-8 bottom-8 w-[2px] bg-zinc-800" />

            {/* Step 1: Identity */}
            <div className="relative">
              <div className="absolute -left-12 w-11 h-11 rounded-full bg-zinc-900 border-2 border-zinc-800 flex items-center justify-center text-zinc-500 font-black text-sm z-10">1</div>
              <div className="space-y-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-lg font-bold text-white tracking-tight">Enter your agent name</h3>
                    <span className="text-[10px] bg-red-500/10 text-red-500 border border-red-500/20 px-2 py-0.5 rounded-full font-black uppercase tracking-widest">Required</span>
                  </div>
                  <p className="text-sm text-zinc-500 font-medium">Pick a pseudonym — shown to all players in the room.</p>
                </div>
                <div className="space-y-2">
                  <div className="relative group">
                    <input
                      type="text"
                      placeholder="GhostProtocol"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full bg-[#161618] border-2 border-zinc-800 focus:border-red-500/50 rounded-2xl px-5 py-4 outline-none transition-all font-bold text-white text-lg pr-12 group-hover:border-zinc-700"
                      maxLength={16}
                    />
                    <div className="absolute right-5 top-1/2 -translate-y-1/2 w-1.5 h-6 bg-red-500 rounded-full opacity-50" />
                  </div>
                  <div className="p-4 bg-zinc-900/30 rounded-2xl border border-zinc-800 border-dashed">
                    <p className="text-xs text-zinc-500 font-medium italic">Max 16 characters. This is your in-game identity.</p>
                  </div>
                </div>
              </div>
            </div>

            {flow === 'HOST' ? (
              <>
                {/* Step 2: Difficulty */}
                <div className="relative">
                  <div className="absolute -left-12 w-11 h-11 rounded-full bg-zinc-900 border-2 border-zinc-800 flex items-center justify-center text-zinc-500 font-black text-sm z-10">2</div>
                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-lg font-bold text-white tracking-tight">Choose difficulty</h3>
                        <span className="text-[10px] bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full font-black uppercase tracking-widest border border-zinc-700">Host Only</span>
                      </div>
                      <p className="text-sm text-zinc-500 font-medium">Controls how similar the imposter's fake word is. Can be changed anytime before the game starts.</p>
                    </div>
                    <div className="flex gap-2">
                      {(['EASY', 'MEDIUM', 'HARD', 'TOUGH'] as const).map((level) => (
                        <button
                          key={level}
                          onClick={() => setPreDifficulty(level)}
                          className={cn(
                            "flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-tighter transition-all border-2",
                            preDifficulty === level 
                              ? "bg-red-500/10 border-red-500/50 text-red-500" 
                              : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700"
                          )}
                        >
                          {level}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Step 3: Generate Room */}
                <div className="relative">
                  <div className="absolute -left-12 w-11 h-11 rounded-full bg-zinc-900 border-2 border-zinc-800 flex items-center justify-center text-zinc-500 font-black text-sm z-10">3</div>
                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-lg font-bold text-white tracking-tight">Generate your room</h3>
                        <span className="text-[10px] bg-red-500/10 text-red-500 border border-red-500/20 px-2 py-0.5 rounded-full font-black uppercase tracking-widest">Required</span>
                      </div>
                      <p className="text-sm text-zinc-500 font-medium">Click <span className="text-zinc-300 font-bold">Host Session</span> — a unique 6-character room ID is created and you enter automatically.</p>
                    </div>
                    <button
                      onClick={createRoom}
                      disabled={!name}
                      className="w-full bg-red-500 hover:bg-red-600 active:scale-95 disabled:opacity-50 disabled:active:scale-100 disabled:hover:bg-red-500 py-5 rounded-2xl text-white font-black uppercase tracking-widest transition-all shadow-[0_0_40px_rgba(239,68,68,0.2)] flex items-center justify-center gap-3"
                    >
                      <Play className="w-5 h-5 fill-current" />
                      Host Session
                    </button>
                    <div className="p-4 bg-zinc-900/30 rounded-2xl border border-zinc-800 border-dashed">
                      <p className="text-xs text-zinc-500 font-medium">A room ID like <span className="text-red-500 font-mono font-bold">QRTX7A</span> is generated. Share it or copy the invite link for others to join.</p>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* Step 2: Room ID */}
                <div className="relative">
                  <div className="absolute -left-12 w-11 h-11 rounded-full bg-zinc-900 border-2 border-zinc-800 flex items-center justify-center text-zinc-500 font-black text-sm z-10">2</div>
                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-lg font-bold text-white tracking-tight">Enter Room ID</h3>
                        <span className="text-[10px] bg-red-500/10 text-red-500 border border-red-500/20 px-2 py-0.5 rounded-full font-black uppercase tracking-widest">Required</span>
                      </div>
                      <p className="text-sm text-zinc-500 font-medium">Ask the host for the 6-character unique access code.</p>
                    </div>
                    <div className="relative group">
                      <input
                        type="text"
                        placeholder="QRTX7A"
                        value={roomId}
                        onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                        className="w-full bg-[#161618] border-2 border-zinc-800 focus:border-red-500/50 rounded-2xl px-5 py-4 outline-none transition-all font-mono font-bold text-white text-lg tracking-[0.2em] group-hover:border-zinc-700 text-center uppercase"
                        maxLength={6}
                      />
                      <button 
                        onClick={async () => {
                          try {
                            const text = await navigator.clipboard.readText();
                            if (text.length <= 6) setRoomId(text.toUpperCase());
                          } catch (e) {}
                        }}
                        className="absolute right-5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-red-500 transition-colors"
                        title="Paste ID"
                      >
                        <Copy className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Step 3: Authorization */}
                <div className="relative">
                  <div className="absolute -left-12 w-11 h-11 rounded-full bg-zinc-900 border-2 border-zinc-800 flex items-center justify-center text-zinc-500 font-black text-sm z-10">3</div>
                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-lg font-bold text-white tracking-tight">Request access</h3>
                        <span className="text-[10px] bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full font-black uppercase tracking-widest">Approval Flow</span>
                      </div>
                      <p className="text-sm text-zinc-500 font-medium">Click <span className="text-zinc-300 font-bold">Join Mission</span> — the host will receive your request and must authorize your entry.</p>
                    </div>
                    <button
                      onClick={joinRoom}
                      disabled={!name || !roomId}
                      className="w-full bg-zinc-100 hover:bg-white text-[#0c0c0e] active:scale-95 disabled:opacity-50 disabled:active:scale-100 py-5 rounded-2xl font-black uppercase tracking-widest transition-all shadow-xl flex items-center justify-center gap-3"
                    >
                      Join Mission
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Step 4: Share & Start (Common Context) */}
            <div className="relative">
              <div className="absolute -left-12 w-11 h-11 rounded-full bg-zinc-900 border-2 border-zinc-800 flex items-center justify-center text-zinc-500 font-black text-sm z-10">4</div>
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-bold text-white tracking-tight">Share & start</h3>
                  <p className="text-sm text-zinc-500 font-medium">{flow === 'HOST' ? "You're in the lobby. Share the room ID. Once 3+ agents are ready, press Start Phase." : "Once approved, you'll enter the lobby. Sit tight for the mission start."}</p>
                </div>
                <div className="flex flex-col gap-2">
                   <div className="flex items-center gap-2 p-4 bg-zinc-900/30 rounded-2xl border border-zinc-800">
                    <Users className="w-4 h-4 text-zinc-600" />
                    <p className="text-xs text-zinc-600 uppercase font-black tracking-widest italic">Sync status: Waiting for array deployment</p>
                  </div>
                   <div className="flex flex-wrap gap-3">
                      <button className="flex-1 px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-zinc-300 transition-all flex items-center gap-2">
                        Host controls <ExternalLink className="w-3 h-3" />
                      </button>
                      <button className="flex-1 px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-zinc-300 transition-all flex items-center gap-2 justify-end">
                        Next: Gameplay <ExternalLink className="w-3 h-3" />
                      </button>
                   </div>
                </div>
              </div>
            </div>
          </div>

          {error && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-5 rounded-2xl bg-red-500/5 border-2 border-red-500/20 text-red-500 text-sm text-center font-black uppercase tracking-widest flex items-center justify-center gap-3"
            >
              <AlertCircle className="w-5 h-5" />
              {error}
            </motion.div>
          )}

          <div className="text-center pt-8">
            <button className="text-[10px] text-zinc-600 hover:text-zinc-400 font-black uppercase tracking-[0.3em] transition-colors flex items-center gap-3 mx-auto">
              <div className="w-8 h-[1px] bg-zinc-800" />
              Agent Protocol v4.0.2
              <div className="w-8 h-[1px] bg-zinc-800" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-50 p-6 flex flex-col items-center">
      <header className="w-full max-w-6xl flex justify-between items-center mb-8 pb-4 border-b border-zinc-900">
        <div className="flex items-center gap-4">
          <div className="p-2 bg-brand/10 rounded-xl">
            <Skull className="w-6 h-6 text-brand" />
          </div>
          <div>
            <h2 className="font-black text-xl uppercase tracking-tighter flex items-center gap-2">
              Room: 
              <button 
                onClick={copyRoomId}
                className="text-brand font-mono hover:underline decoration-brand decoration-dotted transition-all"
                title="Click to copy Room ID"
              >
                {roomId || '......'}
              </button>
              <button
                onClick={copyInviteLink}
                className="ml-2 p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-brand/40 text-zinc-500 hover:text-brand transition-all"
                title="Copy Invite Link"
              >
                <Target className="w-4 h-4" />
              </button>
            </h2>
            <div className="flex items-center gap-2 text-[10px] text-zinc-500 uppercase font-black">
              <div className={cn("w-1.5 h-1.5 rounded-full bg-green-500", mediaStream ? "animate-pulse" : "bg-red-500")} />
              {mediaStream ? "Secure Link Active" : "Mic Access Missing"}
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          {isHost && gameState?.pendingPlayers && gameState.pendingPlayers.length > 0 && (
            <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
              {gameState.pendingPlayers.map((req) => (
                <div key={req.id} className="pointer-events-auto">
                  <PendingRequest request={req} onApprove={approvePlayer} />
                </div>
              ))}
            </div>
          )}
          <div className="hidden sm:flex items-center gap-2 bg-zinc-900 px-4 py-2 rounded-lg border border-zinc-800">
            <Users className="w-4 h-4 text-zinc-500" />
            <span className="font-bold text-sm tracking-tight">{gameState?.players.length || 0} Agent(s)</span>
          </div>
          <div className="flex items-center gap-2 bg-brand/10 px-4 py-2 rounded-lg border border-brand/20">
            <Loader2 className={cn("w-4 h-4 text-brand", gameState?.phase !== 'LOBBY' && "animate-spin")} />
            <span className="font-bold text-sm text-brand uppercase tracking-tighter">{gameState?.phase || 'LOBBY'}</span>
          </div>
        </div>
      </header>

      <main className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-zinc-900/50 p-6 rounded-2xl border border-zinc-800 space-y-4">
            <h3 className="font-black uppercase tracking-tighter flex items-center gap-2 italic">
              <AlertCircle className="w-4 h-4 text-brand" />
              Information
            </h3>
            <div className="p-4 bg-zinc-950 rounded-xl border border-zinc-800">
              <p className="text-[10px] text-zinc-500 uppercase font-bold mb-1 tracking-widest">Secret Keyword</p>
              <p className={cn(
                "text-2xl font-black tracking-widest uppercase truncate transition-all",
                me?.word === 'UNKNOWN' ? "text-red-500" : "text-white"
              )}>
                {me?.word || '********'}
              </p>
              {me?.isImposter && (
                <p className="text-[9px] text-red-500/70 font-black uppercase mt-1 tracking-tighter italic">
                   Warning: You are the imposter. Blend in.
                </p>
              )}
            </div>

            <div className="p-4 bg-zinc-950 rounded-xl border border-zinc-800">
              <p className="text-[10px] text-zinc-500 uppercase font-bold mb-1 tracking-widest">Threat Level</p>
              <div className="flex flex-wrap gap-1">
                {(['EASY', 'MEDIUM', 'HARD', 'TOUGH'] as const).map((level) => (
                  <button
                    key={level}
                    disabled={!isHost || gameState?.phase !== 'LOBBY'}
                    onClick={() => updateDifficulty(level)}
                    className={cn(
                      "flex-1 px-1 py-1.5 rounded text-[10px] font-black tracking-tighter transition-all border",
                      gameState?.settings.difficulty === level 
                        ? "bg-brand text-white border-brand" 
                        : "bg-zinc-900 text-zinc-500 border-zinc-800 hover:border-zinc-700 disabled:opacity-50 disabled:hover:border-zinc-800"
                    )}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>

            {gameState && <ActivityLog logs={gameState.activityLog} />}
            
            <div className="space-y-3">
              <div className="flex justify-between text-[10px] font-black uppercase text-zinc-500 tracking-widest">
                <span>Phase Progress</span>
                <span>{gameState?.timer || 0}s</span>
              </div>
              <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
                <motion.div 
                  animate={{ 
                    width: gameState?.phase === 'WORD' 
                      ? `${(gameState.timer / 10) * 100}%`
                      : gameState?.phase === 'SPEAKING'
                        ? `${(gameState.timer / 30) * 100}%`
                        : '0%'
                  }}
                  className="h-full bg-brand transition-all duration-1000 ease-linear" 
                />
              </div>
            </div>
          </div>

          <div className="bg-zinc-900/50 p-6 rounded-2xl border border-zinc-800 space-y-4">
             <h3 className="font-black uppercase tracking-tighter flex items-center gap-2 italic text-zinc-400">
              <BarChart2 className="w-4 h-4 text-brand" />
              Intelligence
            </h3>
            {gameState?.phase === 'LOBBY' ? (
               isHost ? (
                  <p className="text-xs text-brand leading-relaxed font-bold uppercase tracking-wider">
                   System Ready. Initiate transmission when personnel array is complete (min 3).
                  </p>
               ) : (
                   <p className="text-xs text-zinc-500 leading-relaxed font-medium">
                   Waiting for signal from the Host to synchronize keywords.
                  </p>
               )
            ) : gameState?.phase === 'WORD' ? (
                <p className="text-xs text-zinc-300 leading-relaxed font-medium">
                  Keyword assigned. Commencing speech synchronization in {gameState.timer}s. Memorize immediately.
                </p>
            ) : (
                <p className="text-xs text-zinc-500 leading-relaxed font-medium">
                Analysis in progress. Monitor the suspicion levels of each agent during their cycle.
               </p>
            )}
          </div>
        </div>

        <div className="lg:col-span-3 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-black uppercase tracking-tighter flex items-center gap-3">
              Personnel Grid
              <span className="text-xs font-normal text-zinc-500 normal-case tracking-normal">({gameState?.players.length} agents detected)</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <AnimatePresence mode="popLayout">
              {gameState?.players.map((p) => (
                <PlayerCard 
                  key={p.id} 
                  player={p} 
                  isMe={socket?.id === p.id}
                  canVote={gameState.phase !== 'LOBBY'}
                  onVote={castVote}
                  onKick={kickPlayer}
                  isHostMe={isHost}
                  phase={gameState.phase}
                />
              ))}
            </AnimatePresence>
          </div>
        </div>
      </main>
      
      <AnimatePresence>
        {gameState?.phase === 'LOBBY' && (
          <motion.div 
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-lg px-6"
          >
            <div className="bg-zinc-900/90 backdrop-blur-xl border border-zinc-700/50 p-2 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex items-center gap-2">
              <div className="flex-1 px-4">
                <p className="text-[10px] font-black uppercase text-brand tracking-widest">Protocol Staging</p>
                <div className="flex items-center gap-2">
                  <p className="font-bold text-sm text-zinc-200 truncate">
                    {gameState.players.length < 3 ? `Awaiting ${3 - gameState.players.length} more agent(s)...` : "Array Stabilized"}
                  </p>
                  <button 
                    onClick={copyInviteLink}
                    className="p-1 rounded bg-zinc-800 text-zinc-400 hover:text-brand transition-colors"
                    title="Copy Invite Link"
                  >
                    <Target className="w-3 h-3" />
                  </button>
                </div>
              </div>
              {isHost && (
                <button 
                  onClick={startGame}
                  disabled={gameState.players.length < 3}
                  className="h-12 px-8 bg-brand hover:bg-rose-600 disabled:opacity-50 text-white font-black rounded-xl uppercase tracking-tighter flex items-center gap-2 transition-all shadow-lg active:scale-95"
                >
                  Start Phase <Play className="w-4 h-4 fill-current" />
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
