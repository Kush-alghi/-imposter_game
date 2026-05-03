import React, { useState, useEffect, useMemo } from 'react';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Mic, Users, Target, AlertCircle, 
  ChevronRight, Play, Loader2, BarChart2,
  Skull, User
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

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
}

type Phase = 'LOBBY' | 'WORD' | 'SPEAKING' | 'VOTING' | 'RESULT';

interface GameState {
  id: string;
  hostId: string;
  players: Player[];
  phase: Phase;
  secretWord: string;
  currentSpeakerIndex: number;
  timer: number;
}

// --- Components ---

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
  phase
}: { 
  player: Player, 
  isMe: boolean, 
  canVote: boolean, 
  onVote: (id: string) => void,
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
        
        {canVote && !isMe && phase === 'VOTING' && (
          <button
            onClick={() => onVote(player.id)}
            className="p-2 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-all group shrink-0"
          >
            <Skull className="w-4 h-4 group-hover:scale-110 transition-transform" />
          </button>
        )}
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

  const isHost = useMemo(() => {
    return gameState?.hostId === socket?.id;
  }, [gameState, socket]);

  useEffect(() => {
    const s = io();
    setSocket(s);

    s.on('state_update', (newState: GameState) => {
      setGameState(newState);
      if (newState.id) setRoomId(newState.id);
    });

    s.on('room_created', ({ roomId }: { roomId: string }) => {
      setRoomId(roomId);
      setJoined(true);
    });

    s.on('error', (msg: string) => {
      setError(msg);
      setJoined(false);
    });

    return () => {
      s.disconnect();
    };
  }, []);

  const createRoom = () => {
    if (!name || !socket) return;
    setError('');
    socket.emit('create_room', { playerName: name });
  };

  const joinRoom = () => {
    if (!name || !roomId || !socket) return;
    setError('');
    socket.emit('join_room', { roomId, playerName: name });
    setJoined(true);
  };

  const castVote = (targetId: string) => {
    if (!socket || !gameState) return;
    socket.emit('vote', { roomId: gameState.id, targetId });
  };

  if (!joined) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center p-6 bg-[#09090b]">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center space-y-2">
            <motion.div 
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="inline-flex p-3 rounded-2xl bg-brand/10 mb-4"
            >
              <Skull className="w-12 h-12 text-brand" />
            </motion.div>
            <h1 className="text-4xl font-black italic tracking-tighter text-white uppercase">
              Vocal <span className="text-brand underline decoration-wavy decoration-2">Imposter</span>
            </h1>
            <p className="text-zinc-500 font-medium">Lurk in the shadows, or hunt for the truth.</p>
          </div>

          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest ml-1">Your Identity</label>
              <input
                type="text"
                placeholder="Ex: GhostProtocol"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-zinc-900 border-2 border-zinc-800 focus:border-brand rounded-xl px-4 py-3 outline-none transition-all font-bold text-lg"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={createRoom}
                disabled={!name}
                className="bg-zinc-900 border border-zinc-800 hover:border-brand/40 text-white font-black py-4 rounded-xl flex flex-col items-center justify-center gap-2 transition-all group disabled:opacity-50"
              >
                <div className="p-2 rounded-lg bg-brand/10 group-hover:bg-brand/20 transition-colors">
                  <Play className="w-5 h-5 text-brand" />
                </div>
                <span className="uppercase text-xs tracking-widest">Create Room</span>
              </button>
              
              <div className="flex flex-col gap-2">
                <input
                  type="text"
                  placeholder="ID: ABCDEF"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  className="w-full bg-zinc-900 border border-zinc-800 focus:border-brand rounded-xl px-4 py-2 outline-none transition-all font-mono text-center uppercase"
                />
                <button
                  onClick={joinRoom}
                  disabled={!name || !roomId}
                  className="h-full bg-brand hover:bg-rose-600 disabled:opacity-50 text-white font-black rounded-xl uppercase tracking-tighter transition-all flex items-center justify-center gap-2"
                >
                  Join Room <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {error && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-xs text-center font-bold uppercase tracking-widest"
              >
                {error}
              </motion.div>
            )}
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
            <h2 className="font-black text-xl uppercase tracking-tighter">Room: <span className="text-brand font-mono">{gameState?.id || '......'}</span></h2>
            <div className="flex items-center gap-2 text-[10px] text-zinc-500 uppercase font-black">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              Secure Link Active
            </div>
          </div>
        </div>

        <div className="flex gap-2">
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
              <p className="text-2xl font-black text-white tracking-widest uppercase truncate">
                {gameState?.secretWord || '********'}
              </p>
            </div>
            
            <div className="space-y-3">
              <div className="flex justify-between text-[10px] font-black uppercase text-zinc-500 tracking-widest">
                <span>Phase Progress</span>
                <span>{gameState?.timer || 0}s</span>
              </div>
              <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
                <motion.div 
                  animate={{ width: `${(gameState?.timer || 0) * 3.33}%` }}
                  className="h-full bg-brand" 
                />
              </div>
            </div>
          </div>

          <div className="bg-zinc-900/50 p-6 rounded-2xl border border-zinc-800 space-y-4">
             <h3 className="font-black uppercase tracking-tighter flex items-center gap-2 italic text-zinc-400">
              <BarChart2 className="w-4 h-4 text-brand" />
              Lobby Controls
            </h3>
            {isHost ? (
               <p className="text-xs text-brand leading-relaxed font-bold uppercase tracking-wider">
                You are the HOST. <br/>
                Wait for at least 3 players to begin the surveillance phase.
               </p>
            ) : (
                <p className="text-xs text-zinc-500 leading-relaxed font-medium">
                Connected and ready. Waiting for the Host to initiate the transmission frequency.
               </p>
            )}
          </div>
        </div>

        <div className="lg:col-span-3 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-black uppercase tracking-tighter flex items-center gap-3">
              Personnel Grid
              <span className="text-xs font-normal text-zinc-500 normal-case tracking-normal">({gameState?.players.length} online)</span>
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
                  phase={gameState.phase}
                />
              ))}
            </AnimatePresence>
          </div>
        </div>
      </main>
      
      {/* Footer / Action Bar */}
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
                <p className="text-[10px] font-black uppercase text-brand tracking-widest">Protocol</p>
                <p className="font-bold text-sm text-zinc-200 truncate">
                  {gameState.players.length < 3 ? `Waiting for ${3 - gameState.players.length} more...` : "System Prime"}
                </p>
              </div>
              {isHost && (
                <button 
                  disabled={gameState.players.length < 3}
                  className="h-12 px-8 bg-brand hover:bg-rose-600 disabled:opacity-50 text-white font-black rounded-xl uppercase tracking-tighter flex items-center gap-2 transition-all shadow-lg active:scale-95"
                >
                  Start Game <Play className="w-4 h-4 fill-current" />
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
