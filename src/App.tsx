import React, { useState, useEffect, useMemo, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Mic, MicOff, Users, Target, AlertCircle, 
  ChevronRight, Play, Loader2, BarChart2,
  Activity, Check, Copy, ExternalLink,
  Skull, User, Shield, Zap, Database,
  Cpu, Layers, Settings, X, Info, Link
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

const StrategyGuide = ({ isOpen, onClose, initialTab = 'PHASES', initialPhase = 'WORD' }: { 
  isOpen: boolean, 
  onClose: () => void, 
  initialTab?: 'PHASES' | 'BACKEND'
  initialPhase?: string
}) => {
  const [activeTab, setActiveTab] = useState<'PHASES' | 'BACKEND'>(initialTab);
  const [activePhase, setActivePhase] = useState(initialPhase);

  const phases = ['WORD', 'SPEAKING', 'VOTING', 'RESULT'];
  const backendPhases = ['LOBBY', 'WORD', 'SPEAKING', 'VOTING', 'RESULT'];

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-md"
          />
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            className="relative w-full max-w-4xl h-[80vh] bg-[#0c0c0e] border border-zinc-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="p-6 border-b border-zinc-800 flex items-center justify-between shrink-0">
              <div className="flex gap-4">
                {(['PHASES', 'BACKEND'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                        setActiveTab(t);
                        setActivePhase(t === 'PHASES' ? 'WORD' : 'LOBBY');
                    }}
                    className={cn(
                      "px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all",
                      activeTab === t 
                        ? "bg-red-500/10 text-red-500 border border-red-500/20" 
                        : "text-zinc-600 hover:text-zinc-400"
                    )}
                  >
                    {t === 'PHASES' ? 'Game Phases' : 'Backend Strategy'}
                  </button>
                ))}
              </div>
              <button 
                onClick={onClose}
                className="p-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-white transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Sub-tabs */}
            <div className="px-6 py-4 bg-zinc-900/30 flex gap-2 shrink-0 overflow-x-auto scrollbar-hide">
              {(activeTab === 'PHASES' ? phases : backendPhases).map((p) => (
                <button
                  key={p}
                  onClick={() => setActivePhase(p)}
                  className={cn(
                    "px-6 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all shrink-0 border",
                    activePhase === p 
                      ? "bg-zinc-800 text-white border-zinc-700 shadow-lg" 
                      : "text-zinc-600 border-transparent hover:text-zinc-400"
                  )}
                >
                  {p}
                </button>
              ))}
            </div>

            {/* Content Container */}
            <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
              {activeTab === 'PHASES' ? (
                <div className="space-y-8">
                  {activePhase === 'WORD' && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                      <div className="flex items-center justify-between">
                         <div>
                            <h2 className="text-3xl font-black text-white italic uppercase tracking-tighter">Word assignment</h2>
                            <p className="text-zinc-500 mt-1">Each player privately receives their secret keyword the moment the host presses Start Phase.</p>
                         </div>
                         <div className="px-3 py-1 bg-amber-500/10 border border-amber-500/20 text-amber-500 rounded-full text-[10px] font-black uppercase tracking-widest">
                            10S
                         </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-6 bg-zinc-900/50 rounded-2xl border border-zinc-800">
                          <p className="text-[10px] font-black uppercase text-zinc-600 tracking-widest mb-2">Your Word</p>
                          <p className="text-2xl font-black text-red-500 tracking-widest">VOLCANO</p>
                        </div>
                        <div className="p-6 bg-zinc-900/50 rounded-2xl border border-zinc-800 opacity-50">
                          <p className="text-[10px] font-black uppercase text-zinc-600 tracking-widest mb-2">Imposter Word</p>
                          <p className="text-2xl font-black text-zinc-400 tracking-widest uppercase">Unknown</p>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <p className="text-[10px] font-black uppercase text-zinc-600 tracking-widest">What Happens</p>
                        <div className="space-y-3">
                          {[
                            "Server picks a word pair based on difficulty. All real players get the same word.",
                            "The Imposter(s) receive UNKNOWN — they must bluff without knowing the word.",
                            "A 10-second countdown runs while players memorise. Then phase auto-advances to Speaking."
                          ].map((step, i) => (
                            <div key={i} className="flex gap-4 p-4 bg-zinc-900/20 rounded-xl border border-zinc-800/50">
                              <div className="w-6 h-6 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-500 font-bold text-xs shrink-0">{i+1}</div>
                              <p className="text-sm text-zinc-400 font-medium">{step}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  )}
                  {activePhase === 'SPEAKING' && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                      <div className="flex items-center justify-between">
                         <div>
                            <h2 className="text-3xl font-black text-white italic uppercase tracking-tighter">Speaking round</h2>
                            <p className="text-zinc-500 mt-1">Players take turns speaking about the secret word — without saying it directly. The imposter must blend in.</p>
                         </div>
                         <div className="px-3 py-1 bg-amber-500/10 border border-amber-500/20 text-amber-500 rounded-full text-[10px] font-black uppercase tracking-widest">
                            30S EACH
                         </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-6 bg-zinc-900/50 rounded-2xl border border-zinc-800">
                          <p className="text-[10px] font-black uppercase text-zinc-600 tracking-widest mb-2">Current Speaker</p>
                          <p className="text-lg font-black text-red-500 uppercase tracking-tight">GhostProtocol</p>
                        </div>
                        <div className="p-6 bg-zinc-900/50 rounded-2xl border border-zinc-800">
                          <p className="text-[10px] font-black uppercase text-zinc-600 tracking-widest mb-2">Speaker Index</p>
                          <p className="text-lg font-black text-zinc-400 font-mono">currentSpeakerIndex</p>
                        </div>
                      </div>
                       <div className="space-y-4">
                        <p className="text-[10px] font-black uppercase text-zinc-600 tracking-widest">Mechanics</p>
                        <div className="space-y-3">
                          {[
                            "The server steps through players[] in order using currentSpeakerIndex. The active player's card shows 'Broadcasting...' and a pulsing border.",
                            "Each speaker gets 30 seconds. The timer bar on the sidebar counts down live via state_update.",
                            "While listening, players can watch suspicion scores update in real time on each player card.",
                            "After all players speak, the server transitions to Voting automatically."
                          ].map((step, i) => (
                            <div key={i} className="flex gap-4 p-4 bg-zinc-900/20 rounded-xl border border-zinc-800/50">
                              <div className="w-6 h-6 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-500 font-bold text-xs shrink-0">{i+1}</div>
                              <p className="text-sm text-zinc-400 font-medium">{step}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  )}
                   {activePhase === 'VOTING' && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                      <div>
                        <h2 className="text-3xl font-black text-white italic uppercase tracking-tighter">Voting</h2>
                        <p className="text-zinc-500 mt-1">Everyone simultaneously votes for who they think the imposter is. One vote per player — no self-votes.</p>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-6 bg-zinc-900/50 rounded-2xl border border-zinc-800">
                          <p className="text-[10px] font-black uppercase text-zinc-600 tracking-widest mb-2">Vote Action</p>
                          <p className="text-xs font-mono text-red-500">socket.emit('vote', ...)</p>
                        </div>
                        <div className="p-6 bg-zinc-900/50 rounded-2xl border border-zinc-800">
                          <p className="text-[10px] font-black uppercase text-zinc-600 tracking-widest mb-2">Tracked On</p>
                          <p className="text-xs font-mono text-zinc-400">votesReceived</p>
                        </div>
                      </div>
                       <div className="space-y-4">
                        <p className="text-[10px] font-black uppercase text-zinc-600 tracking-widest">Mechanics</p>
                        <div className="space-y-3">
                          {[
                            "The skull button appears on every PlayerCard that isn't yours.",
                            "Clicking it emits vote: { roomId, targetId }. The server tallies votes on each player's votesReceived field.",
                            "Suspicion scores continue updating as votes come in, giving a live read of who's being targeted.",
                            "Once all votes are cast (or timer expires), the server resolves the round and emits the RESULT phase."
                          ].map((step, i) => (
                            <div key={i} className="flex gap-4 p-4 bg-zinc-900/20 rounded-xl border border-zinc-800/50">
                              <div className="w-6 h-6 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-500 font-bold text-xs shrink-0">{i+1}</div>
                              <p className="text-sm text-zinc-400 font-medium">{step}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  )}
                  {activePhase === 'RESULT' && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                      <div>
                        <h2 className="text-3xl font-black text-white italic uppercase tracking-tighter">Result</h2>
                        <p className="text-zinc-500 mt-1">The server reveals who the imposter was, whether the vote was correct, and final suspicion scores for all players.</p>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-6 bg-zinc-900/50 rounded-2xl border border-zinc-800">
                          <p className="text-[10px] font-black uppercase text-zinc-600 tracking-widest mb-2">Revealed Fields</p>
                          <p className="text-sm font-mono text-red-500">isImposter, word</p>
                        </div>
                        <div className="p-6 bg-zinc-900/50 rounded-2xl border border-zinc-800">
                          <p className="text-[10px] font-black uppercase text-zinc-600 tracking-widest mb-2">Final State</p>
                          <p className="text-sm font-mono text-zinc-400">RESULT phase</p>
                        </div>
                      </div>
                       <div className="space-y-4">
                        <p className="text-[10px] font-black uppercase text-zinc-600 tracking-widest">What Players See</p>
                        <div className="space-y-3">
                          {[
                            "Each player's isImposter flag and actual word are revealed in the state broadcast.",
                            "Final votesReceived counts show who the group suspected most.",
                            "The host can start a new round (back to LOBBY) or the room dissolves."
                          ].map((step, i) => (
                            <div key={i} className="flex gap-4 p-4 bg-zinc-900/20 rounded-xl border border-zinc-800/50">
                              <div className="w-6 h-6 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-500 font-bold text-xs shrink-0">{i+1}</div>
                              <p className="text-sm text-zinc-400 font-medium">{step}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </div>
              ) : (
                <div className="space-y-6">
                    <h2 className="text-lg font-black text-white uppercase tracking-widest flex items-center gap-2">
                        {activePhase} — Socket Events
                    </h2>
                    <div className="space-y-3">
                        {activePhase === 'LOBBY' && [
                            { role: 'CLIENT', event: 'create_room', data: '{ playerName }', desc: 'Server generates a 6-char room ID, creates GameState, adds host player, emits room_created back.' },
                            { role: 'SERVER', event: 'room_created', data: '{ roomId }', desc: 'Host receives this, sets joined=true, requests mic permissions.' },
                            { role: 'CLIENT', event: 'join_request', data: '{ roomId, playerName }', desc: 'Server adds player to pendingPlayers[], notifies host, emits waiting_for_host to requester.' },
                            { role: 'CLIENT', event: 'approve_player', data: '{ roomId, targetId, approved }', desc: 'Host only. If approved, moves player from pending to players[]. Broadcasts state_update.' },
                            { role: 'CLIENT', event: 'update_settings', data: '{ roomId, settings: { difficulty } }', desc: 'Host only. Updates GameState.settings, broadcasts state_update to room.' },
                            { role: 'CLIENT', event: 'kick_player', data: '{ roomId, targetId }', desc: 'Host only. Removes player, logs KICK to activityLog, broadcasts state_update.' },
                            { role: 'BROADCAST', event: 'state_update', data: 'GameState', desc: 'Sent to all room members on any state change. Client calls setGameState().' },
                        ].map((item, i) => (
                            <motion.div 
                                key={i} 
                                initial={{ opacity: 0, x: -10 }} 
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: i * 0.05 }}
                                className="p-4 bg-zinc-900/30 border border-zinc-800 rounded-xl space-y-1"
                            >
                                <div className="flex items-center gap-3">
                                    <span className={cn(
                                        "text-[8px] font-black px-1.5 py-0.5 rounded tracking-widest",
                                        item.role === 'CLIENT' ? "bg-blue-500/20 text-blue-400" :
                                        item.role === 'SERVER' ? "bg-green-500/20 text-green-400" :
                                        "bg-amber-500/20 text-amber-500"
                                    )}>
                                        {item.role}
                                    </span>
                                    <span className="font-mono text-xs font-bold text-zinc-100">{item.event}</span>
                                    <span className="font-mono text-[10px] text-zinc-500 tracking-tight">{item.data}</span>
                                </div>
                                <p className="text-xs text-zinc-400 pl-[56px]">{item.desc}</p>
                            </motion.div>
                        ))}
                        {activePhase === 'WORD' && [
                            { role: 'CLIENT', event: 'start_game', data: 'roomId', desc: 'Host only. Triggers word assignment and phase transition.' },
                            { role: 'SERVER', event: 'Word selection logic', data: '', desc: 'Server picks a word pair based on difficulty. One imposter is randomly selected. Real players get player.word = "VOLCANO", imposter gets player.word = "UNKNOWN" and player.isImposter = true.' },
                            { role: 'SERVER', event: 'Timer: 10s countdown', data: '', desc: "Server sets phase = 'WORD', timer = 10. Decrements each second, broadcasting state_update. At 0, auto-transitions to SPEAKING." },
                            { role: 'BROADCAST', event: 'state_update', data: "phase: 'WORD', timer: 10→0", desc: 'Client reads me.word and me.isImposter from state. Sidebar shows countdown via timer field.' },
                        ].map((item, i) => (
                            <motion.div 
                                key={i} 
                                initial={{ opacity: 0, x: -10 }} 
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: i * 0.05 }}
                                className="p-4 bg-zinc-900/30 border border-zinc-800 rounded-xl space-y-1"
                            >
                                <div className="flex items-center gap-3">
                                    <span className={cn(
                                        "text-[8px] font-black px-1.5 py-0.5 rounded tracking-widest",
                                        item.role === 'CLIENT' ? "bg-blue-500/20 text-blue-400" :
                                        item.role === 'SERVER' ? "bg-green-500/20 text-green-400" :
                                        "bg-amber-500/20 text-amber-500"
                                    )}>
                                        {item.role}
                                    </span>
                                    <span className="font-mono text-xs font-bold text-zinc-100">{item.event}</span>
                                    {item.data && <span className="font-mono text-[10px] text-zinc-500 tracking-tight">{item.data}</span>}
                                </div>
                                <p className="text-xs text-zinc-400 pl-[56px]">{item.desc}</p>
                            </motion.div>
                        ))}
                         {activePhase === 'SPEAKING' && [
                            { role: 'SERVER', event: 'Speaker rotation', data: '', desc: 'Sets currentSpeakerIndex = 0, marks players[0].isSpeaking = true. Starts 30s timer.' },
                            { role: 'BROADCAST', event: 'state_update', data: "phase: 'SPEAKING', currentSpeakerIndex, timer", desc: 'Client uses players[currentSpeakerIndex].isSpeaking to show pulsing border + "Broadcasting..." label.' },
                            { role: 'SERVER', event: 'suspicionScore update', data: '', desc: 'As speech/activity occurs, server increments suspicionScore per player. Triggers state_update so SuspicionMeter animates live.' },
                            { role: 'SERVER', event: 'Next speaker advance', data: '', desc: 'When timer hits 0, currentSpeakerIndex++. Repeats until all players have spoken, then transitions to VOTING.' },
                        ].map((item, i) => (
                            <motion.div 
                                key={i} 
                                initial={{ opacity: 0, x: -10 }} 
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: i * 0.05 }}
                                className="p-4 bg-zinc-900/30 border border-zinc-800 rounded-xl space-y-1"
                            >
                                <div className="flex items-center gap-3">
                                    <span className={cn(
                                        "text-[8px] font-black px-1.5 py-0.5 rounded tracking-widest",
                                        item.role === 'CLIENT' ? "bg-blue-500/20 text-blue-400" :
                                        item.role === 'SERVER' ? "bg-green-500/20 text-green-400" :
                                        "bg-amber-500/20 text-amber-500"
                                    )}>
                                        {item.role}
                                    </span>
                                    <span className="font-mono text-xs font-bold text-zinc-100">{item.event}</span>
                                    {item.data && <span className="font-mono text-[10px] text-zinc-500 tracking-tight">{item.data}</span>}
                                </div>
                                <p className="text-xs text-zinc-400 pl-[56px]">{item.desc}</p>
                            </motion.div>
                        ))}
                        {activePhase === 'VOTING' && [
                            { role: 'BROADCAST', event: 'state_update', data: "phase: 'VOTING'", desc: "Client shows skull vote buttons on all PlayerCards except the player's own card." },
                            { role: 'CLIENT', event: 'vote', data: '{ roomId, targetId }', desc: "Server increments target's votesReceived. Updates suspicionScore. Broadcasts state_update." },
                            { role: 'SERVER', event: 'Vote resolution', data: '', desc: 'When all votes tallied (or timeout), server finds player with max votesReceived, checks if they are the imposter, determines win/loss, transitions to RESULT.' },
                        ].map((item, i) => (
                            <motion.div 
                                key={i} 
                                initial={{ opacity: 0, x: -10 }} 
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: i * 0.05 }}
                                className="p-4 bg-zinc-900/30 border border-zinc-800 rounded-xl space-y-1"
                            >
                                <div className="flex items-center gap-3">
                                    <span className={cn(
                                        "text-[8px] font-black px-1.5 py-0.5 rounded tracking-widest",
                                        item.role === 'CLIENT' ? "bg-blue-500/20 text-blue-400" :
                                        item.role === 'SERVER' ? "bg-green-500/20 text-green-400" :
                                        "bg-amber-500/20 text-amber-500"
                                    )}>
                                        {item.role}
                                    </span>
                                    <span className="font-mono text-xs font-bold text-zinc-100">{item.event}</span>
                                    {item.data && <span className="font-mono text-[10px] text-zinc-500 tracking-tight">{item.data}</span>}
                                </div>
                                <p className="text-xs text-zinc-400 pl-[56px]">{item.desc}</p>
                            </motion.div>
                        ))}
                        {activePhase === 'RESULT' && [
                            { role: 'BROADCAST', event: 'state_update', data: "phase: 'RESULT', players[].isImposter, players[].word", desc: "All players now see each other's words and who the imposter was. isImposter and word fields are fully revealed." },
                            { role: 'SERVER', event: 'Activity log entry', data: '', desc: "Server appends a result entry to activityLog[] with type 'RESULT'. Visible in ActivityLog sidebar component." },
                            { role: 'CLIENT', event: 'start_game (new round)', data: 'roomId', desc: 'Host can restart. Server resets phase to LOBBY, clears words, votes, and suspicion scores. Keeps players in room.' },
                        ].map((item, i) => (
                            <motion.div 
                                key={i} 
                                initial={{ opacity: 0, x: -10 }} 
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: i * 0.05 }}
                                className="p-4 bg-zinc-900/30 border border-zinc-800 rounded-xl space-y-1"
                            >
                                <div className="flex items-center gap-3">
                                    <span className={cn(
                                        "text-[8px] font-black px-1.5 py-0.5 rounded tracking-widest",
                                        item.role === 'CLIENT' ? "bg-blue-500/20 text-blue-400" :
                                        item.role === 'SERVER' ? "bg-green-500/20 text-green-400" :
                                        "bg-amber-500/20 text-amber-500"
                                    )}>
                                        {item.role}
                                    </span>
                                    <span className="font-mono text-xs font-bold text-zinc-100">{item.event}</span>
                                    {item.data && <span className="font-mono text-[10px] text-zinc-500 tracking-tight">{item.data}</span>}
                                </div>
                                <p className="text-xs text-zinc-400 pl-[56px]">{item.desc}</p>
                            </motion.div>
                        ))}
                    </div>

                    <div className="flex gap-4 pt-4 border-t border-zinc-800/50">
                        <button className="flex-1 py-3 px-6 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white transition-all flex items-center justify-center gap-2">
                           suspicionScore logic <ExternalLink className="w-3 h-3" />
                        </button>
                        <button className="flex-1 py-3 px-6 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white transition-all flex items-center justify-center gap-2">
                           Server architecture <ExternalLink className="w-3 h-3" />
                        </button>
                    </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-zinc-800 bg-zinc-900/20 shrink-0 flex items-center justify-between">
              <button 
                onClick={() => {
                   const currPhases = activeTab === 'PHASES' ? phases : backendPhases;
                   const idx = currPhases.indexOf(activePhase);
                   if (idx > 0) setActivePhase(currPhases[idx-1]);
                }}
                className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white transition-all"
              >
                <ChevronRight className="w-4 h-4 rotate-180" /> Prev phase
              </button>
              <div className="flex gap-1.5">
                  {(activeTab === 'PHASES' ? phases : backendPhases).map(p => (
                      <div key={p} className={cn("w-1.5 h-1.5 rounded-full", activePhase === p ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" : "bg-zinc-800")} />
                  ))}
              </div>
              <button 
                 onClick={() => {
                    const currPhases = activeTab === 'PHASES' ? phases : backendPhases;
                    const idx = currPhases.indexOf(activePhase);
                    if (idx < currPhases.length - 1) setActivePhase(currPhases[idx+1]);
                 }}
                className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white transition-all"
              >
                Next phase <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};


const MicVisualizer = ({ isActive, isMuted }: { isActive: boolean, isMuted?: boolean }) => {
  const [bars, setBars] = useState([4, 8, 5, 10, 6]);

  useEffect(() => {
    if (!isActive || isMuted) return;
    const interval = setInterval(() => {
      setBars(prev => prev.map(() => Math.floor(Math.random() * 8) + 4));
    }, 150);
    return () => clearInterval(interval);
  }, [isActive, isMuted]);

  return (
    <div className="flex items-end gap-0.5 h-4">
      {bars.map((h, i) => (
        <motion.div
          key={i}
          animate={{ height: (isActive && !isMuted) ? h * 2 : 2 }}
          className={cn("w-1 rounded-full", (isActive && !isMuted) ? "bg-red-500" : "bg-zinc-800")}
        />
      ))}
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
  phase,
  isMuted,
  onMuteToggle
}: { 
  player: Player, 
  isMe: boolean, 
  canVote: boolean, 
  onVote: (id: string) => void,
  onKick: (id: string) => void,
  isHostMe: boolean,
  phase: Phase,
  isMuted?: boolean,
  onMuteToggle?: () => void
}) => {
  const isSpeaking = player.isSpeaking;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        "relative p-6 rounded-[24px] border-2 transition-all duration-500 overflow-hidden",
        isSpeaking ? "bg-red-500/5 border-red-500 shadow-[0_0_40px_rgba(239,68,68,0.15)] ring-4 ring-red-500/10" : "bg-zinc-900/50 border-zinc-800 hover:border-zinc-700",
        isMe && !isSpeaking && "border-zinc-700 bg-zinc-900 shadow-inner"
      )}
    >
      {isSpeaking && (
        <motion.div 
          animate={{ opacity: [0.1, 0.2, 0.1] }}
          transition={{ repeat: Infinity, duration: 2 }}
          className="absolute inset-0 bg-red-500/5 pointer-events-none"
        />
      )}

      <div className="flex justify-between items-start mb-6 relative z-10">
        <div className="flex items-center gap-4">
          <div className={cn(
            "w-12 h-12 rounded-[18px] flex items-center justify-center transition-all duration-500",
            (isSpeaking && !isMuted) ? "bg-red-500 shadow-lg shadow-red-500/20 rotate-3" : isSpeaking ? "bg-zinc-800 border-2 border-red-500/50" : "bg-zinc-950 border border-zinc-800"
          )}>
            {player.isImposter && phase === 'RESULT' ? (
              <Skull className="w-6 h-6 text-white" />
            ) : (
              isSpeaking && isMuted ? <MicOff className="w-6 h-6 text-red-500" /> : <User className={cn("w-6 h-6 transition-colors", isSpeaking ? "text-white" : "text-zinc-600")} />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-black text-lg text-white tracking-tight leading-none truncate max-w-[120px]">
                {player.name}
              </h3>
              {isMe && <span className="text-[7px] bg-red-500 text-white px-1.5 py-0.5 rounded-full uppercase font-black tracking-widest">You</span>}
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <span className={cn(
                "text-[8px] font-black uppercase tracking-[0.2em] px-2 py-0.5 rounded-md border",
                (isSpeaking && isMuted) ? "bg-zinc-800 text-zinc-500 border-zinc-700" : isSpeaking ? "bg-red-500/20 text-red-500 border-red-500/20" : "bg-zinc-950 text-zinc-600 border-zinc-800"
              )}>
                {isSpeaking ? (isMuted ? 'Transmission Suspended' : 'Establishing Connection...') : 'Standby'}
              </span>
              {isSpeaking && <div className={cn("w-1.5 h-1.5 rounded-full shadow-[0_0_8px_rgba(239,68,68,1)]", isMuted ? "bg-zinc-700 animate-pulse" : "bg-red-500 animate-pulse")} />}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          {isSpeaking && <MicVisualizer isActive={true} isMuted={isMuted} />}
          <div className="flex gap-2">
            {isSpeaking && isMe && (
              <>
                <button
                  onClick={onMuteToggle}
                  className={cn(
                    "p-2.5 rounded-xl border transition-all shadow-lg active:scale-95 flex items-center gap-2",
                    isMuted ? "bg-red-500 border-red-400 text-white" : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700"
                  )}
                  title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
                >
                  {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => {
                    // End turn early
                    socketRef.current?.emit('skip_turn', player.id);
                  }}
                  className="p-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-400 hover:bg-red-500 hover:text-white transition-all shadow-lg active:scale-95 flex items-center gap-2"
                  title="End your speech"
                >
                  <X className="w-4 h-4" />
                </button>
              </>
            )}
            {canVote && !isMe && phase === 'VOTING' && (
              <button
                onClick={() => onVote(player.id)}
                className="p-2.5 rounded-xl bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-all shadow-lg active:scale-95"
              >
                <Skull className="w-4 h-4" />
              </button>
            )}
            {isHostMe && !isMe && phase === 'LOBBY' && (
              <button
                onClick={() => onKick(player.id)}
                className="p-2.5 rounded-xl bg-zinc-800 text-zinc-500 hover:bg-red-500 hover:text-white transition-all shadow-lg active:scale-95"
              >
                <Users className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4 relative z-10">
        <div className="flex items-center justify-between pt-2">
           <div className="flex gap-1.5">
            {Array.from({ length: player.votesReceived }).map((_, i) => (
              <motion.div 
                key={i}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="w-2 h-2 bg-red-500 rounded-full shadow-[0_0_8px_rgba(239,68,68,0.5)]" 
              />
            ))}
          </div>

          {phase === 'RESULT' && (
             <div className="flex items-center gap-3 bg-zinc-950/50 p-2 px-3 rounded-xl border border-zinc-800">
               <div className="text-right">
                 <p className="text-[8px] font-black uppercase text-zinc-600 tracking-widest leading-none mb-1">INTEL REVEALED</p>
                 <p className="text-xs font-black text-white italic tracking-widest uppercase">{player.word}</p>
               </div>
               {player.isImposter && <Skull className="w-4 h-4 text-red-500" />}
             </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default function App() {
  const socketRef = useRef<Socket | null>(null);
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
  const [copiedLink, setCopiedLink] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const lastAnnouncementRef = useRef<string>('');
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideConfig, setGuideConfig] = useState<{ tab: 'PHASES' | 'BACKEND', phase: string }>({ tab: 'PHASES', phase: 'WORD' });
  const [announcement, setAnnouncement] = useState<{ text: string, type: 'PHASE' | 'TURN' | 'SECRET' } | null>(null);

  const speak = (text: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.pitch = 0.8; // More robotic
    const voices = window.speechSynthesis.getVoices();
    const robotVoice = voices.find(v => v.name.includes('Google UK English Male') || v.name.includes('Male'));
    if (robotVoice) utterance.voice = robotVoice;
    window.speechSynthesis.speak(utterance);
  };

  useEffect(() => {
    if (!gameState) return;

    const me = gameState.players.find(p => p.id === socket?.id);
    const announcementKey = `${gameState.phase}-${gameState.currentSpeakerIndex}-${gameState.timer >= 10}`;

    // Handle voice and text announcements
    if (gameState.phase === 'WORD' && gameState.timer === 10 && lastAnnouncementRef.current !== announcementKey) {
      lastAnnouncementRef.current = announcementKey;
      const wordText = me?.isImposter ? 'YOU ARE THE IMPOSTER. BLEND IN.' : `YOUR SECRET WORD IS: ${me?.word}`;
      Promise.resolve().then(() => setAnnouncement({ text: wordText, type: 'SECRET' }));
      speak(wordText);
      setTimeout(() => setAnnouncement(null), 4000);
    }

    if (gameState.phase === 'SPEAKING') {
      const activePlayer = gameState.players[gameState.currentSpeakerIndex];
      if (activePlayer && gameState.timer === gameState.settings.roundTime && lastAnnouncementRef.current !== announcementKey) {
        lastAnnouncementRef.current = announcementKey;
        const turnText = activePlayer.id === socket?.id ? 'IT IS YOUR TURN TO SPEAK.' : `${activePlayer.name}'S TURN.`;
        
        // Reset mute state when it becomes your turn
        if (activePlayer.id === socket?.id) {
          Promise.resolve().then(() => {
            setIsMuted(false);
            if (mediaStream) {
              mediaStream.getAudioTracks().forEach(t => t.enabled = true);
            }
          });
        }

        Promise.resolve().then(() => setAnnouncement({ text: turnText, type: 'TURN' }));
        speak(turnText);
        setTimeout(() => setAnnouncement(null), 3000);
      }
    }

    if (gameState.phase === 'VOTING' && gameState.timer === 20 && lastAnnouncementRef.current !== announcementKey) {
      lastAnnouncementRef.current = announcementKey;
      const voteText = "VOTING INITIALIZED. IDENTIFY THE IMPOSTER.";
      Promise.resolve().then(() => setAnnouncement({ text: voteText, type: 'PHASE' }));
      speak(voteText);
      setTimeout(() => setAnnouncement(null), 3000);
    }
  }, [gameState, socket?.id, mediaStream]);

  const toggleMute = () => {
    if (mediaStream) {
      const audioTrack = mediaStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const isHost = useMemo(() => {
    return gameState?.hostId === socket?.id;
  }, [gameState, socket]);

  const me = useMemo(() => {
    return gameState?.players.find(p => p.id === socket?.id);
  }, [gameState, socket]);

  const requestPermissions = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      setMediaStream(stream);
    } catch (err) {
      console.error("Permission denied", err);
      setError("Microphone access is required to play.");
    }
  };

  useEffect(() => {
    const s = io();
    socketRef.current = s;
    Promise.resolve().then(() => setSocket(s));

    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    if (roomFromUrl) {
      Promise.resolve().then(() => setRoomId(roomFromUrl.toUpperCase()));
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
  }, [joined, gameState, socket, preDifficulty]);

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
                          } catch (e) {
                            // User might not have granted clipboard permission or browser doesn't support it
                          }
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
                      <button 
                        onClick={() => {
                            setGuideConfig({ tab: 'LOBBY', phase: 'LOBBY' } as any); // Type cast for brevity
                            setGuideOpen(true);
                            // We'll adjust the component to handle 'LOBBY' correctly if needed, or just set to 'PHASES'
                            setGuideConfig({ tab: 'BACKEND', phase: 'LOBBY' });
                        }}
                        className="flex-1 px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-zinc-300 transition-all flex items-center gap-2"
                      >
                        Host controls <ExternalLink className="w-3 h-3" />
                      </button>
                      <button 
                        onClick={() => {
                            setGuideConfig({ tab: 'PHASES', phase: 'WORD' });
                            setGuideOpen(true);
                        }}
                        className="flex-1 px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-zinc-300 transition-all flex items-center gap-2 justify-end"
                      >
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
          <button 
            onClick={() => {
                setGuideConfig({ tab: 'PHASES', phase: gameState?.phase || 'WORD' });
                setGuideOpen(true);
            }}
            className="flex items-center gap-2 bg-zinc-900 hover:bg-zinc-800 px-4 py-2 rounded-lg border border-zinc-800 transition-colors"
          >
            <Info className="w-4 h-4 text-zinc-500" />
            <span className="font-bold text-sm text-zinc-300 uppercase tracking-tighter">Protocol Guide</span>
          </button>
        </div>
      </header>

      {announcement && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.2 }}
          className="fixed inset-0 z-[200] flex items-center justify-center pointer-events-none px-6"
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <motion.div 
            animate={{ y: [0, -10, 0] }}
            transition={{ repeat: Infinity, duration: 2 }}
            className={cn(
              "relative p-12 rounded-[32px] border-2 text-center space-y-4 shadow-2xl",
              announcement.type === 'SECRET' ? "bg-red-500/10 border-red-500/50 shadow-red-500/20" : "bg-zinc-900/90 border-zinc-700"
            )}
          >
            <p className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-400">
              {announcement.type === 'PHASE' ? 'System Broadcast' : announcement.type === 'TURN' ? 'Network Update' : 'Top Secret / Classified'}
            </p>
            <h2 className={cn(
              "text-5xl font-black italic tracking-tighter uppercase",
              announcement.type === 'SECRET' ? "text-red-500" : "text-white"
            )}>
              {announcement.text}
            </h2>
            <div className="flex justify-center gap-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="w-12 h-1 bg-zinc-800 rounded-full overflow-hidden">
                  <motion.div 
                    animate={{ x: [-48, 48] }}
                    transition={{ repeat: Infinity, duration: 1.5, delay: i * 0.2 }}
                    className="w-full h-full bg-brand"
                  />
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}

      <StrategyGuide 
        key={`${guideOpen}-${guideConfig.tab}-${guideConfig.phase}`}
        isOpen={guideOpen} 
        onClose={() => setGuideOpen(false)} 
        initialTab={guideConfig.tab}
        initialPhase={guideConfig.phase}
      />

      <main className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-zinc-900/50 p-6 rounded-2xl border border-zinc-800 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-black uppercase text-zinc-600 tracking-widest leading-none">Secret Access Code</p>
              <div className="px-2 py-1 bg-red-500/10 border border-red-500/20 text-red-500 rounded-md text-[10px] font-black font-mono animate-pulse uppercase">Lobby Open</div>
            </div>
            <div className="space-y-4">
              <div 
                className="flex items-center justify-between group cursor-pointer p-4 bg-zinc-950 rounded-xl border border-zinc-900 hover:border-brand/30 transition-all shadow-inner" 
                onClick={() => {
                  navigator.clipboard.writeText(roomId);
                  setCopiedId(true);
                  setTimeout(() => setCopiedId(false), 2000);
                }}
              >
                <h3 className="text-3xl font-black text-white tracking-[0.2em] font-mono">{roomId}</h3>
                <button className="p-2 transition-colors text-zinc-600 group-hover:text-brand">
                  {copiedId ? <Check className="w-5 h-5 text-green-500" /> : <Copy className="w-5 h-5" />}
                </button>
              </div>

              <button
                onClick={() => {
                  const url = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
                  navigator.clipboard.writeText(url);
                  setCopiedLink(true);
                  setTimeout(() => setCopiedLink(false), 2000);
                }}
                className="w-full py-3 bg-zinc-950 border border-zinc-800 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white hover:border-zinc-700 transition-all flex items-center justify-center gap-2"
              >
                {copiedLink ? (
                  <><Check className="w-3 h-3 text-green-500" /> Authorized Link Copied</>
                ) : (
                  <><Link className="w-3 h-3" /> Copy Mission Invite Link</>
                )}
              </button>
            </div>
          </div>

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
            {gameState?.phase === 'LOBBY' && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="col-span-full py-12 flex flex-col items-center text-center space-y-6 bg-zinc-900/30 rounded-3xl border border-zinc-800 border-dashed"
              >
                  <div className="w-20 h-20 bg-zinc-950 rounded-3xl border border-zinc-800 flex items-center justify-center relative overflow-hidden group">
                      <div className="absolute inset-0 bg-brand/5 animate-pulse opacity-50" />
                      <Users className="w-10 h-10 text-zinc-700 relative z-10 group-hover:scale-110 transition-transform" />
                  </div>
                  <div className="space-y-2">
                      <h2 className="text-2xl font-black text-white uppercase italic tracking-tight">Mission Staging Ground</h2>
                      <p className="text-sm text-zinc-500 max-w-xs mx-auto">Waiting for agents to join. Share the <span className="text-brand font-bold italic">Secret Password</span> to authorize their entry.</p>
                  </div>
                  
                  <div className="flex flex-col items-center gap-3">
                      <div 
                        className="p-3 px-6 bg-zinc-950 border border-zinc-800 rounded-2xl flex items-center gap-4 group cursor-pointer hover:border-brand/50 transition-all shadow-2xl" 
                        onClick={() => {
                          navigator.clipboard.writeText(roomId);
                          setCopiedId(true);
                          setTimeout(() => setCopiedId(false), 2000);
                        }}
                      >
                          <span className="text-[10px] font-black uppercase text-zinc-600 tracking-widest">Entry Key:</span>
                          <span className="text-3xl font-black text-brand font-mono tracking-[0.3em]">{roomId}</span>
                          {copiedId ? <Check className="w-4 h-4 text-green-500 ml-2" /> : <Copy className="w-4 h-4 text-zinc-700 group-hover:text-brand ml-2" />}
                      </div>
                  </div>
              </motion.div>
            )}
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
                  isMuted={p.id === socket?.id ? isMuted : false}
                  onMuteToggle={toggleMute}
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
