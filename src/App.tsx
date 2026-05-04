import React, {
  useState, useEffect, useMemo, useRef, useCallback,
} from 'react';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mic, MicOff, Users, Target, AlertCircle,
  ChevronRight, Play, Loader2, BarChart2,
  Activity, Check, Copy, Skull, User,
  Link, RotateCcw, Info, X, Volume2, VolumeX,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { speak, stopSpeech } from './lib/speech';
import { Sounds } from './lib/sounds';

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

// ─── Types ────────────────────────────────────────────────

interface Player {
  id: string; name: string; isHost: boolean; isReady: boolean;
  votesReceived: number; suspicionScore: number; isSpeaking: boolean;
  word: string; isImposter: boolean; hasVoted: boolean;
}

type Phase = 'LOBBY' | 'WORD' | 'SPEAKING' | 'VOTING' | 'RESULT';

interface GameState {
  id: string; hostId: string;
  players: Player[];
  pendingPlayers: { id: string; name: string }[];
  phase: Phase; secretWord: string;
  currentSpeakerIndex: number; timer: number;
  activityLog: { id: string; type: string; message: string; timestamp: number }[];
  settings: { maxPlayers: number; roundTime: number; difficulty: 'EASY'|'MEDIUM'|'HARD'|'TOUGH' };
}

// ─── Mic Visualizer ───────────────────────────────────────

const MicVisualizer = ({ active, muted }: { active: boolean; muted: boolean }) => {
  const [bars, setBars] = useState([3, 6, 4, 8, 5]);
  useEffect(() => {
    if (!active || muted) return;
    const t = setInterval(() => setBars(prev => prev.map(() => Math.floor(Math.random() * 10) + 2)), 120);
    return () => clearInterval(t);
  }, [active, muted]);
  return (
    <div className="flex items-end gap-0.5 h-5">
      {bars.map((h, i) => (
        <motion.div
          key={i}
          animate={{ height: active && !muted ? h * 2 : 2 }}
          transition={{ duration: 0.1 }}
          className={cn('w-1 rounded-full', active && !muted ? 'bg-rose-500' : 'bg-zinc-700')}
        />
      ))}
    </div>
  );
};

// ─── Activity Log ─────────────────────────────────────────

const ActivityLog = ({ logs }: { logs: GameState['activityLog'] }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [logs]);
  return (
    <div className="bg-zinc-950 border border-zinc-900 rounded-xl p-3 h-32 flex flex-col">
      <p className="text-[10px] font-black uppercase text-zinc-600 tracking-widest mb-2 flex items-center gap-1.5">
        <Activity className="w-3 h-3" /> Activity Feed
      </p>
      <div ref={ref} className="flex-1 overflow-y-auto space-y-1.5 scrollbar-hide">
        {logs.length === 0
          ? <p className="text-[10px] text-zinc-700 italic">No activity yet…</p>
          : logs.map((log) => (
            <div key={log.id} className="text-[10px] flex items-start gap-2">
              <span className="text-zinc-700 font-mono shrink-0">
                [{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}]
              </span>
              <span className={cn('font-bold',
                log.type === 'JOIN'           && 'text-emerald-500',
                log.type === 'LEAVE'          && 'text-zinc-500',
                log.type === 'KICK'           && 'text-red-500',
                log.type === 'HOST_TRANSFER'  && 'text-rose-400',
                log.type === 'START'          && 'text-blue-400',
                log.type === 'RESULT'         && 'text-amber-400',
              )}>
                {log.message}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
};

// ─── Pending Join Request ─────────────────────────────────

const PendingRequest = ({
  request,
  onApprove,
}: {
  request: { id: string; name: string };
  onApprove: (id: string, approved: boolean) => void;
}) => (
  <motion.div
    initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
    exit={{ x: 40, opacity: 0 }}
    className="p-3 bg-zinc-900 border border-rose-500/30 rounded-xl flex items-center gap-3 shadow-2xl"
  >
    <div className="w-8 h-8 rounded-full bg-rose-500/10 flex items-center justify-center">
      <User className="w-4 h-4 text-rose-400" />
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-[9px] font-black text-rose-400 uppercase tracking-widest leading-none mb-0.5">Incoming</p>
      <p className="font-bold text-sm text-white truncate">{request.name}</p>
    </div>
    <div className="flex gap-1.5">
      <button onClick={() => { Sounds.kick(); onApprove(request.id, false); }}
        className="p-1.5 rounded-lg bg-zinc-800 text-zinc-500 hover:bg-zinc-700 transition-colors">
        <X className="w-3.5 h-3.5" />
      </button>
      <button onClick={() => { Sounds.join(); onApprove(request.id, true); }}
        className="p-1.5 rounded-lg bg-rose-500 text-white hover:bg-rose-600 transition-colors">
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  </motion.div>
);

// ─── Announcement Overlay ─────────────────────────────────

const Announcement = ({
  text,
  type,
}: {
  text: string;
  type: 'PHASE' | 'TURN' | 'SECRET' | 'RESULT';
}) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.85 }}
    animate={{ opacity: 1, scale: 1 }}
    exit={{ opacity: 0, scale: 1.08 }}
    className="fixed inset-0 z-[300] flex items-center justify-center pointer-events-none px-6"
  >
    <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />
    <motion.div
      animate={{ y: [0, -8, 0] }}
      transition={{ repeat: Infinity, duration: 2.5, ease: 'easeInOut' }}
      className={cn(
        'relative px-12 py-10 rounded-[32px] border-2 text-center space-y-5 shadow-2xl max-w-lg w-full',
        type === 'SECRET' && 'bg-red-950/60 border-red-500/60 shadow-red-900/40',
        type === 'TURN'   && 'bg-blue-950/60 border-blue-500/50 shadow-blue-900/40',
        type === 'PHASE'  && 'bg-zinc-900/90 border-zinc-600/60',
        type === 'RESULT' && 'bg-amber-950/60 border-amber-500/50 shadow-amber-900/40',
      )}
    >
      <p className="text-[9px] font-black uppercase tracking-[0.4em] text-zinc-400">
        {type === 'SECRET' ? 'Classified Intel' : type === 'TURN' ? 'Comms Channel Open' : type === 'RESULT' ? 'Mission Outcome' : 'System Broadcast'}
      </p>
      <h2 className={cn(
        'text-4xl font-black italic tracking-tight uppercase leading-tight',
        type === 'SECRET' ? 'text-red-400' : type === 'TURN' ? 'text-blue-300' : type === 'RESULT' ? 'text-amber-300' : 'text-white',
      )}>
        {text}
      </h2>
      <div className="flex justify-center gap-2">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            animate={{ scaleX: [1, 1.5, 1] }}
            transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.2 }}
            className="w-10 h-0.5 rounded-full bg-zinc-600"
          />
        ))}
      </div>
    </motion.div>
  </motion.div>
);

// ─── Player Card ──────────────────────────────────────────

const PlayerCard = ({
  player, isMe, phase, isHostMe,
  onVote, onKick, isMuted, onMuteToggle, socketRef,
}: {
  player: Player; isMe: boolean; phase: Phase; isHostMe: boolean;
  onVote: (id: string) => void; onKick: (id: string) => void;
  isMuted: boolean; onMuteToggle: () => void;
  socketRef: React.RefObject<Socket | null>;
}) => {
  const speaking = player.isSpeaking;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={cn(
        'relative p-5 rounded-2xl border-2 flex flex-col gap-4 transition-all duration-300 overflow-hidden',
        speaking
          ? 'bg-rose-950/20 border-rose-500 shadow-[0_0_32px_rgba(244,63,94,0.2)]'
          : isMe
            ? 'bg-zinc-900 border-zinc-700'
            : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700',
      )}
    >
      {speaking && (
        <motion.div
          animate={{ opacity: [0.05, 0.15, 0.05] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
          className="absolute inset-0 bg-rose-500/10 pointer-events-none"
        />
      )}

      {/* Header row */}
      <div className="flex items-center justify-between relative z-10">
        <div className="flex items-center gap-3">
          <div className={cn(
            'w-11 h-11 rounded-xl flex items-center justify-center border-2 transition-all duration-300',
            speaking && !isMuted ? 'bg-rose-500 border-rose-400 shadow-lg shadow-rose-500/30 rotate-2'
              : speaking ? 'bg-zinc-800 border-rose-500/50'
              : 'bg-zinc-950 border-zinc-800',
          )}>
            {phase === 'RESULT' && player.isImposter
              ? <Skull className="w-5 h-5 text-white" />
              : speaking && isMuted && isMe
                ? <MicOff className="w-5 h-5 text-rose-400" />
                : <User className={cn('w-5 h-5', speaking ? 'text-white' : 'text-zinc-500')} />
            }
          </div>
          <div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-black text-white truncate max-w-[110px]">{player.name}</span>
              {isMe && <span className="text-[8px] bg-rose-500 text-white px-1.5 py-0.5 rounded-full font-black uppercase tracking-widest">You</span>}
              {player.isHost && <span className="text-[8px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full font-black uppercase tracking-widest border border-amber-500/20">Host</span>}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className={cn(
                'text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md border',
                speaking && !isMuted ? 'bg-rose-500/20 text-rose-400 border-rose-500/20'
                  : speaking ? 'bg-zinc-800 text-zinc-500 border-zinc-700'
                  : 'bg-zinc-950 text-zinc-600 border-zinc-900',
              )}>
                {speaking ? (isMuted ? 'Muted' : 'Live') : 'Standby'}
              </span>
              {speaking && !isMuted && <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse shadow-[0_0_6px_rgba(244,63,94,1)]" />}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 items-center">
          {speaking && <MicVisualizer active={speaking} muted={isMe ? isMuted : false} />}

          {speaking && isMe && (
            <>
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => { Sounds[isMuted ? 'unmute' : 'mute'](); onMuteToggle(); }}
                className={cn(
                  'p-2.5 rounded-xl border-2 transition-all',
                  isMuted
                    ? 'bg-rose-500 border-rose-400 text-white shadow-lg shadow-rose-500/30'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-600',
                )}
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => socketRef.current?.emit('skip_turn')}
                className="p-2.5 rounded-xl bg-zinc-800 border-2 border-zinc-700 text-zinc-400 hover:bg-rose-500/20 hover:border-rose-500/50 transition-all"
                title="End your turn early"
              >
                <ChevronRight className="w-4 h-4" />
              </motion.button>
            </>
          )}

          {!isMe && phase === 'VOTING' && (
            <motion.button
              whileTap={{ scale: 0.85 }}
              onClick={() => { Sounds.vote(); onVote(player.id); }}
              className="p-2.5 rounded-xl bg-rose-500/10 border-2 border-rose-500/20 text-rose-400 hover:bg-rose-500 hover:text-white hover:border-rose-400 transition-all"
            >
              <Skull className="w-4 h-4" />
            </motion.button>
          )}

          {isHostMe && !isMe && phase === 'LOBBY' && (
            <motion.button
              whileTap={{ scale: 0.85 }}
              onClick={() => { Sounds.kick(); onKick(player.id); }}
              className="p-2.5 rounded-xl bg-zinc-800 border-2 border-zinc-700 text-zinc-500 hover:bg-rose-500 hover:text-white transition-all"
              title="Remove player"
            >
              <X className="w-4 h-4" />
            </motion.button>
          )}
        </div>
      </div>

      {/* Votes (Suspicion Meter removed per request) */}
      <div className="space-y-2 relative z-10">
        {player.votesReceived > 0 && (
          <div className="flex gap-1 flex-wrap">
            {Array.from({ length: player.votesReceived }).map((_, i) => (
              <motion.div key={i} initial={{ scale: 0 }} animate={{ scale: 1 }}
                className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.8)]" />
            ))}
          </div>
        )}
        {phase === 'RESULT' && (
          <div className={cn(
            'mt-2 px-3 py-2 rounded-xl border flex items-center gap-2',
            player.isImposter ? 'bg-rose-950/30 border-rose-500/40' : 'bg-zinc-950 border-zinc-800',
          )}>
            {player.isImposter && <Skull className="w-3.5 h-3.5 text-rose-400 shrink-0" />}
            <span className="text-xs font-black text-white tracking-widest uppercase">{player.word}</span>
            {player.isImposter && <span className="ml-auto text-[9px] text-rose-400 font-black uppercase tracking-widest">Imposter</span>}
          </div>
        )}
      </div>
    </motion.div>
  );
};

// ─── Main App ─────────────────────────────────────────────

export default function App() {
  const socketRef = useRef<Socket | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomId, setRoomId] = useState('');
  const [name, setName] = useState('');
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState('');
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [waitingApproval, setWaitingApproval] = useState(false);
  const [flow, setFlow] = useState<'HOST' | 'JOIN'>('HOST');
  const [preDifficulty, setPreDifficulty] = useState<'EASY'|'MEDIUM'|'HARD'|'TOUGH'>('MEDIUM');
  const [isMuted, setIsMuted] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [copiedId, setCopiedId] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [announcement, setAnnouncement] = useState<{ text: string; type: 'PHASE'|'TURN'|'SECRET'|'RESULT' } | null>(null);
  const lastAnnKey = useRef('');
  const announcementTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Socket setup ────────────────────────────────────────
  useEffect(() => {
    // Inside the useEffect that sets up the socket:
    const backendUrl = import.meta.env.VITE_BACKEND_URL || '';
    const s = io(backendUrl, { path: '/socket.io' });
    socketRef.current = s;
    Promise.resolve().then(() => setSocket(s));

    const urlRoomId = new URLSearchParams(window.location.search).get('room');
    if (urlRoomId) Promise.resolve().then(() => setRoomId(urlRoomId.toUpperCase()));

    const requestMicInternal = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setMediaStream(stream);
        stream.getAudioTracks().forEach((t) => { t.enabled = false; });
        Promise.resolve().then(() => setIsMuted(true));
      } catch {
        setError('Microphone access required to play.');
      }
    };

    s.on('state_update', (gs: GameState) => {
      setGameState(gs);
      if (gs.id) Promise.resolve().then(() => setRoomId(gs.id));
    });
    s.on('room_created', ({ roomId: rId }: { roomId: string }) => {
      setRoomId(rId); setJoined(true); setWaitingApproval(false);
      requestMicInternal();
    });
    s.on('room_joined', ({ roomId: rId }: { roomId: string }) => {
      setRoomId(rId); setJoined(true); setWaitingApproval(false);
      requestMicInternal();
    });
    s.on('waiting_for_host', () => setWaitingApproval(true));
    s.on('error', (msg: string) => { setError(msg); setWaitingApproval(false); });

    return () => { s.disconnect(); };
  }, []);

  // ── Announcement helper ──────────────────────────────────
  const announce = useCallback((text: string, type: typeof announcement extends null ? never : NonNullable<typeof announcement>['type'], duration = 3500) => {
    if (announcementTimer.current) clearTimeout(announcementTimer.current);
    setAnnouncement({ text, type });
    if (voiceOn) speak(text);
    announcementTimer.current = setTimeout(() => setAnnouncement(null), duration);
  }, [voiceOn]);

  // ── Phase/turn announcement logic ────────────────────────
  useEffect(() => {
    if (!gameState || !socket) return;
    const mePlayer = gameState.players.find((p) => p.id === socket.id);

    if (gameState.phase === 'WORD' && gameState.timer === 10 && lastAnnKey.current !== `word-start`) {
      lastAnnKey.current = `word-start`;
      const msg = mePlayer?.isImposter
        ? 'YOU ARE THE IMPOSTER. BLEND IN.'
        : `YOUR WORD IS: ${mePlayer?.word}`;
      Promise.resolve().then(() => announce(msg, 'SECRET', 5000));
      Sounds.start();
    }

    if (gameState.phase === 'SPEAKING') {
      const spk = gameState.players[gameState.currentSpeakerIndex];
      const spkKey = `speaking-${gameState.currentSpeakerIndex}`;
      if (spk && gameState.timer === gameState.settings.roundTime && lastAnnKey.current !== spkKey) {
        lastAnnKey.current = spkKey;
        const isMyTurn = spk.id === socket.id;

        if (isMyTurn) {
          mediaStream?.getAudioTracks().forEach((t) => { t.enabled = true; });
          Promise.resolve().then(() => setIsMuted(false));
          Promise.resolve().then(() => announce(`IT IS YOUR TURN. SPEAK NOW.`, 'TURN', 3000));
          Sounds.yourTurn();
        } else {
          mediaStream?.getAudioTracks().forEach((t) => { t.enabled = false; });
          Promise.resolve().then(() => setIsMuted(true));
          Promise.resolve().then(() => announce(`${spk.name}'S TURN.`, 'TURN', 2500));
        }
      }

      const prevSpk = gameState.players[gameState.currentSpeakerIndex - 1];
      if (prevSpk?.id === socket.id && gameState.timer < gameState.settings.roundTime) {
        mediaStream?.getAudioTracks().forEach((t) => { t.enabled = false; });
        Promise.resolve().then(() => setIsMuted(true));
      }
    }

    if (gameState.phase === 'VOTING' && gameState.timer === 25 && lastAnnKey.current !== 'voting') {
      lastAnnKey.current = 'voting';
      Promise.resolve().then(() => announce('VOTING OPEN. IDENTIFY THE IMPOSTER.', 'PHASE', 3000));
      Sounds.vote();
    }

    if (gameState.phase === 'RESULT' && lastAnnKey.current !== 'result') {
      lastAnnKey.current = 'result';
      const resultLog = gameState.activityLog[gameState.activityLog.length - 1];
      Promise.resolve().then(() => announce(resultLog?.message ?? 'MISSION COMPLETE.', 'RESULT', 6000));
      Sounds.result();
    }
  }, [gameState, socket, mediaStream, announce]);

  // ── Derived ──────────────────────────────────────────────
  const isHost = useMemo(() => gameState?.hostId === socket?.id, [gameState, socket]);
  const me = useMemo(() => gameState?.players.find((p) => p.id === socket?.id), [gameState, socket]);

  const toggleMute = useCallback(() => {
    mediaStream?.getAudioTracks().forEach((t) => { t.enabled = isMuted; });
    setIsMuted((m) => !m);
  }, [mediaStream, isMuted]);

  // ── Socket emitters ──────────────────────────────────────
  const createRoom = () => {
    if (!name || !socket) return;
    setError('');
    socket.emit('create_room', { playerName: name, difficulty: preDifficulty });
  };
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
    if (!socket || !gameState || me?.hasVoted) return;
    socket.emit('vote', { roomId: gameState.id, targetId });
  };
  const resetRoom = () => {
    if (!socket || !gameState || !isHost) return;
    lastAnnKey.current = '';
    socket.emit('reset_room', gameState.id);
    stopSpeech();
  };
  const updateDifficulty = (d: 'EASY'|'MEDIUM'|'HARD'|'TOUGH') => {
    if (!socket || !gameState || !isHost) return;
    socket.emit('update_settings', { roomId: gameState.id, settings: { difficulty: d } });
  };
  const copyId = () => { navigator.clipboard.writeText(roomId); setCopiedId(true); setTimeout(() => setCopiedId(false), 2000); };
  const copyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}?room=${roomId}`);
    setCopiedLink(true); setTimeout(() => setCopiedLink(false), 2000);
  };

  useEffect(() => {
    if (joined && gameState && isHost && gameState.settings.difficulty !== preDifficulty && gameState.phase === 'LOBBY') {
      socket?.emit('update_settings', { roomId: gameState.id, settings: { difficulty: preDifficulty } });
    }
  }, [joined, gameState, isHost, preDifficulty, socket]);

  // ─────────────────────────────────────────────────────────
  // WAITING FOR APPROVAL
  // ─────────────────────────────────────────────────────────
  if (waitingApproval) return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#09090b] p-6">
      <div className="text-center space-y-6 max-w-xs w-full">
        <motion.div animate={{ scale: [1, 1.1, 1], opacity: [0.4, 1, 0.4] }}
          transition={{ repeat: Infinity, duration: 2 }}
          className="w-20 h-20 bg-rose-500/10 rounded-full flex items-center justify-center mx-auto">
          <Loader2 className="w-10 h-10 text-rose-400 animate-spin" />
        </motion.div>
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tighter text-white italic">Awaiting Clearance</h2>
          <p className="text-zinc-500 text-sm mt-1">Room: <span className="text-rose-400 font-mono">{roomId}</span></p>
        </div>
        <p className="text-xs text-zinc-600 uppercase font-black tracking-widest leading-loose">
          Host is reviewing your request.<br />Stand by for authorization.
        </p>
        <button onClick={() => setWaitingApproval(false)}
          className="text-[10px] text-zinc-500 hover:text-zinc-300 uppercase font-black tracking-widest transition-colors">
          Cancel Request
        </button>
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────
  // JOIN / HOST SCREEN
  // ─────────────────────────────────────────────────────────
  if (!joined) return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#0a0a0c] p-6">
      <div className="w-full max-w-lg space-y-10">
        <div className="text-center space-y-4">
          <motion.div initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 200 }}
            className="inline-flex p-4 rounded-3xl bg-zinc-900 border border-zinc-800 shadow-2xl relative">
            <Skull className="w-14 h-14 text-rose-400" />
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 rounded-full border-2 border-[#0a0a0c] animate-pulse" />
          </motion.div>
          <motion.h1 initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15 }}
            className="text-5xl font-black italic tracking-tighter text-white uppercase">
            Vocal <span className="text-rose-400 underline decoration-wavy decoration-2 underline-offset-8">Imposter</span>
          </motion.h1>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}
            className="text-zinc-500 font-medium">Speak carefully. Trust no one.</motion.p>
        </div>

        <div className="flex p-1 bg-zinc-900/60 border border-zinc-800 rounded-2xl">
          {(['HOST', 'JOIN'] as const).map((t) => (
            <button key={t} onClick={() => setFlow(t)}
              className={cn('flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all',
                flow === t ? 'bg-zinc-800 text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-300')}>
              {t} Session
            </button>
          ))}
        </div>

        <div className="relative pl-12 space-y-10">
          <div className="absolute left-[21px] top-6 bottom-6 w-[2px] bg-zinc-800/80" />

          <div className="relative">
            <div className="absolute -left-12 w-11 h-11 rounded-full bg-zinc-900 border-2 border-zinc-800 flex items-center justify-center text-zinc-500 font-black z-10">1</div>
            <div className="space-y-3">
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <h3 className="font-bold text-white text-lg">Agent name</h3>
                  <span className="text-[9px] bg-rose-500/10 text-rose-400 border border-rose-500/20 px-2 py-0.5 rounded-full font-black uppercase">Required</span>
                </div>
                <p className="text-sm text-zinc-500">Shown to all players in the room.</p>
              </div>
              <input type="text" placeholder="GhostProtocol" value={name}
                onChange={(e) => setName(e.target.value.slice(0, 16))}
                className="w-full bg-zinc-900 border-2 border-zinc-800 focus:border-rose-500/60 rounded-2xl px-5 py-4 outline-none text-white font-bold text-lg transition-colors"
                maxLength={16}
              />
            </div>
          </div>

          {flow === 'HOST' ? (<>
            <div className="relative">
              <div className="absolute -left-12 w-11 h-11 rounded-full bg-zinc-900 border-2 border-zinc-800 flex items-center justify-center text-zinc-500 font-black z-10">2</div>
              <div className="space-y-3">
                <div>
                  <h3 className="font-bold text-white text-lg mb-0.5">Difficulty</h3>
                  <p className="text-sm text-zinc-500">How obscure is the secret word?</p>
                </div>
                <div className="flex gap-2">
                  {(['EASY','MEDIUM','HARD','TOUGH'] as const).map((d) => (
                    <button key={d} onClick={() => setPreDifficulty(d)}
                      className={cn('flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-wider border-2 transition-all',
                        preDifficulty === d ? 'bg-rose-500/10 border-rose-500/50 text-rose-400' : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700')}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="absolute -left-12 w-11 h-11 rounded-full bg-zinc-900 border-2 border-zinc-800 flex items-center justify-center text-zinc-500 font-black z-10">3</div>
              <div className="space-y-3">
                <div>
                  <h3 className="font-bold text-white text-lg mb-0.5">Generate room</h3>
                  <p className="text-sm text-zinc-500">A 6-character room ID is created automatically.</p>
                </div>
                <button onClick={createRoom} disabled={!name}
                  className="w-full bg-rose-500 hover:bg-rose-600 active:scale-95 disabled:opacity-40 py-5 rounded-2xl text-white font-black uppercase tracking-widest transition-all shadow-[0_0_30px_rgba(244,63,94,0.25)] flex items-center justify-center gap-3">
                  <Play className="w-5 h-5 fill-current" /> Host Session
                </button>
              </div>
            </div>
          </>) : (<>
            <div className="relative">
              <div className="absolute -left-12 w-11 h-11 rounded-full bg-zinc-900 border-2 border-zinc-800 flex items-center justify-center text-zinc-500 font-black z-10">2</div>
              <div className="space-y-3">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <h3 className="font-bold text-white text-lg">Room ID</h3>
                    <span className="text-[9px] bg-rose-500/10 text-rose-400 border border-rose-500/20 px-2 py-0.5 rounded-full font-black uppercase">Required</span>
                  </div>
                  <p className="text-sm text-zinc-500">6-character code from the host.</p>
                </div>
                <div className="relative">
                  <input type="text" placeholder="QRTX7A" value={roomId}
                    onChange={(e) => setRoomId(e.target.value.toUpperCase().slice(0, 6))}
                    className="w-full bg-zinc-900 border-2 border-zinc-800 focus:border-rose-500/60 rounded-2xl px-5 py-4 outline-none text-white font-mono font-bold text-xl text-center tracking-[0.25em] transition-colors"
                    maxLength={6}
                  />
                  <button onClick={async () => { try { const t = await navigator.clipboard.readText(); setRoomId(t.toUpperCase().slice(0, 6)); } catch (e) { console.error('Failed to read clipboard:', e); } }}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-rose-400 transition-colors">
                    <Copy className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="absolute -left-12 w-11 h-11 rounded-full bg-zinc-900 border-2 border-zinc-800 flex items-center justify-center text-zinc-500 font-black z-10">3</div>
              <div className="space-y-3">
                <div>
                  <h3 className="font-bold text-white text-lg mb-0.5">Request access</h3>
                  <p className="text-sm text-zinc-500">Host must approve your entry.</p>
                </div>
                <button onClick={joinRoom} disabled={!name || roomId.length < 6}
                  className="w-full bg-zinc-100 hover:bg-white active:scale-95 disabled:opacity-40 text-zinc-950 py-5 rounded-2xl font-black uppercase tracking-widest transition-all shadow-xl flex items-center justify-center gap-3">
                  Join Mission <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          </>)}
        </div>

        {error && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="p-4 rounded-2xl bg-rose-500/5 border-2 border-rose-500/20 text-rose-400 text-sm text-center font-black uppercase tracking-widest flex items-center justify-center gap-2">
            <AlertCircle className="w-4 h-4" /> {error}
          </motion.div>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-50 flex flex-col items-center">
      <AnimatePresence>{announcement && <Announcement text={announcement.text} type={announcement.type} />}</AnimatePresence>

      {isHost && gameState?.pendingPlayers && gameState.pendingPlayers.length > 0 && (
        <div className="fixed top-4 right-4 z-50 space-y-2">
          <AnimatePresence>
            {gameState.pendingPlayers.map((r) => (
              <PendingRequest key={r.id} request={r} onApprove={approvePlayer} />
            ))}
          </AnimatePresence>
        </div>
      )}

      <header className="w-full max-w-6xl px-6 py-4 border-b border-zinc-900 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-rose-500/10 rounded-xl">
            <Skull className="w-6 h-6 text-rose-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-black text-lg uppercase tracking-tight text-zinc-300">Room:</span>
              <button onClick={copyId} className="font-mono text-lg font-black text-rose-400 hover:underline decoration-dotted">
                {roomId}
              </button>
              <button onClick={copyLink} className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-rose-500/30 text-zinc-500 hover:text-rose-400 transition-all" title="Copy invite link">
                {copiedLink ? <Check className="w-4 h-4 text-emerald-400" /> : <Link className="w-4 h-4" />}
              </button>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-zinc-500 uppercase font-black">
              <span className={cn('w-1.5 h-1.5 rounded-full', mediaStream ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500')} />
              {mediaStream ? 'Secure link active' : 'Mic access missing'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => setVoiceOn((v) => !v)}
            className={cn('p-2 rounded-lg border transition-all', voiceOn ? 'bg-zinc-900 border-zinc-700 text-zinc-300' : 'bg-zinc-900 border-zinc-800 text-zinc-600')}
            title={voiceOn ? 'Disable voice' : 'Enable voice'}>
            {voiceOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 px-3 py-2 rounded-lg text-sm font-bold">
            <Users className="w-4 h-4 text-zinc-500" />
            <span>{gameState?.players.length ?? 0}</span>
          </div>

          <div className={cn('flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-black uppercase tracking-tight',
            gameState?.phase === 'LOBBY' ? 'bg-zinc-900 border-zinc-800 text-zinc-400'
              : gameState?.phase === 'SPEAKING' ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
              : gameState?.phase === 'VOTING' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
              : gameState?.phase === 'RESULT' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : 'bg-blue-500/10 border-blue-500/30 text-blue-400')}>
            <Loader2 className={cn('w-4 h-4', gameState?.phase !== 'LOBBY' && 'animate-spin')} />
            {gameState?.phase ?? 'LOBBY'}
          </div>

          {isHost && gameState?.phase === 'RESULT' && (
            <button onClick={resetRoom}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-300 hover:border-rose-500/40 hover:text-rose-400 transition-all text-sm font-black uppercase tracking-tight">
              <RotateCcw className="w-4 h-4" /> New Round
            </button>
          )}
        </div>
      </header>

      <main className="w-full max-w-6xl px-6 py-8 grid grid-cols-1 lg:grid-cols-4 gap-8">
        <aside className="lg:col-span-1 space-y-5">
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5 space-y-3">
            <p className="text-[10px] font-black uppercase text-zinc-600 tracking-widest">Share Access</p>
            <div onClick={copyId} className="flex items-center justify-between cursor-pointer bg-zinc-950 border border-zinc-800 hover:border-rose-500/30 rounded-xl p-4 transition-all group">
              <span className="font-mono text-2xl font-black text-white tracking-[0.2em]">{roomId}</span>
              {copiedId ? <Check className="w-5 h-5 text-emerald-400" /> : <Copy className="w-5 h-5 text-zinc-600 group-hover:text-rose-400 transition-colors" />}
            </div>
            <button onClick={copyLink}
              className="w-full py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white hover:border-zinc-700 transition-all flex items-center justify-center gap-2">
              {copiedLink ? <><Check className="w-3 h-3 text-emerald-400" /> Copied!</> : <><Link className="w-3 h-3" /> Copy Invite Link</>}
            </button>
          </div>

          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5 space-y-4">
            <h3 className="font-black uppercase tracking-tight flex items-center gap-2 text-sm">
              <AlertCircle className="w-4 h-4 text-rose-400" /> Mission Intel
            </h3>
            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
              <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-1">Secret Word</p>
              <p className={cn('text-2xl font-black tracking-widest uppercase', me?.word === 'UNKNOWN' ? 'text-rose-400' : 'text-white')}>
                {me?.word || '• • • • • •'}
              </p>
              {me?.isImposter && <p className="text-[9px] text-rose-500/70 font-black uppercase mt-1 italic">You are the imposter — blend in.</p>}
            </div>

            {gameState?.phase === 'LOBBY' && (
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-2">
                <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Difficulty</p>
                <div className="flex gap-1">
                  {(['EASY','MEDIUM','HARD','TOUGH'] as const).map((d) => (
                    <button key={d} disabled={!isHost} onClick={() => updateDifficulty(d)}
                      className={cn('flex-1 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-tighter border transition-all',
                        gameState.settings.difficulty === d ? 'bg-rose-500/10 border-rose-500/40 text-rose-400' : 'bg-zinc-900 border-zinc-800 text-zinc-600 hover:border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed')}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <ActivityLog logs={gameState?.activityLog ?? []} />

            {gameState?.phase !== 'LOBBY' && gameState?.phase !== 'RESULT' && (
              <div className="space-y-2">
                <div className="flex justify-between text-[10px] font-black uppercase text-zinc-500">
                  <span>Timer</span><span>{gameState?.timer ?? 0}s</span>
                </div>
                <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                  <motion.div
                    animate={{ width: `${((gameState?.timer ?? 0) / (gameState?.phase === 'WORD' ? 10 : gameState?.phase === 'SPEAKING' ? gameState.settings.roundTime : 25)) * 100}%` }}
                    transition={{ duration: 1, ease: 'linear' }}
                    className={cn('h-full rounded-full', (gameState?.timer ?? 0) <= 5 ? 'bg-rose-500 animate-pulse' : 'bg-rose-400')}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5 space-y-2">
            <h3 className="font-black uppercase tracking-tight flex items-center gap-2 text-sm text-zinc-400">
              <BarChart2 className="w-4 h-4 text-rose-400" /> Status
            </h3>
            <p className="text-xs text-zinc-500 font-medium leading-relaxed">
              {gameState?.phase === 'LOBBY' && (isHost
                ? 'Ready. Invite agents and press Start Phase when 3+ are present.'
                : 'Waiting for the host to start the mission.')}
              {gameState?.phase === 'WORD' && `Memorise your word in ${gameState.timer}s.`}
              {gameState?.phase === 'SPEAKING' && 'Each agent speaks in turn. Listen closely.'}
              {gameState?.phase === 'VOTING' && 'Cast your vote. Who is the imposter?'}
              {gameState?.phase === 'RESULT' && 'Mission concluded. See the results below.'}
            </p>
          </div>
        </aside>

        <section className="lg:col-span-3 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-black uppercase tracking-tight">
              Personnel <span className="text-zinc-600 font-normal text-base normal-case tracking-normal">({gameState?.players.length} agents)</span>
            </h2>
          </div>

          {gameState?.phase === 'LOBBY' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="py-16 flex flex-col items-center gap-6 bg-zinc-900/30 rounded-3xl border-2 border-dashed border-zinc-800">
              <div className="w-20 h-20 rounded-3xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                <Users className="w-10 h-10 text-zinc-700" />
              </div>
              <div className="text-center space-y-1">
                <h3 className="text-xl font-black text-white uppercase italic">Mission Staging</h3>
                <p className="text-sm text-zinc-500 max-w-xs">Share the room code to recruit agents.</p>
              </div>
              <div className="flex items-center gap-3 bg-zinc-950 border border-zinc-800 rounded-2xl px-6 py-4 cursor-pointer hover:border-rose-500/30 transition-all" onClick={copyId}>
                <span className="text-[10px] text-zinc-600 font-black uppercase tracking-widest">Code</span>
                <span className="font-mono text-3xl font-black text-rose-400 tracking-[0.25em]">{roomId}</span>
                {copiedId ? <Check className="w-5 h-5 text-emerald-400" /> : <Copy className="w-5 h-5 text-zinc-600" />}
              </div>
            </motion.div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <AnimatePresence mode="popLayout">
              {gameState?.players.map((p) => (
                <PlayerCard
                  key={p.id}
                  player={p}
                  isMe={socket?.id === p.id}
                  phase={gameState.phase}
                  isHostMe={!!isHost}
                  onVote={castVote}
                  onKick={kickPlayer}
                  isMuted={p.id === socket?.id ? isMuted : false}
                  onMuteToggle={toggleMute}
                  socketRef={socketRef}
                />
              ))}
            </AnimatePresence>
          </div>
        </section>
      </main>

      <AnimatePresence>
        {gameState?.phase === 'LOBBY' && (
          <motion.div initial={{ y: 100 }} animate={{ y: 0 }} exit={{ y: 100 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 w-full max-w-lg px-4">
            <div className="bg-zinc-900/90 backdrop-blur-xl border border-zinc-700/50 rounded-2xl p-2 shadow-2xl flex items-center gap-3">
              <div className="flex-1 px-3">
                <p className="text-[9px] font-black uppercase text-rose-400 tracking-widest">Protocol Staging</p>
                <p className="text-sm font-bold text-zinc-200">
                  {(gameState.players.length ?? 0) < 3
                    ? `Need ${3 - (gameState.players.length ?? 0)} more agent(s)…`
                    : 'Array stabilized — ready to launch'}
                </p>
              </div>
              {isHost && (
                <button onClick={startGame} disabled={(gameState.players.length ?? 0) < 3}
                  className="h-12 px-8 bg-rose-500 hover:bg-rose-600 disabled:opacity-40 active:scale-95 text-white font-black rounded-xl uppercase tracking-tighter flex items-center gap-2 transition-all shadow-lg">
                  Start <Play className="w-4 h-4 fill-current" />
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
