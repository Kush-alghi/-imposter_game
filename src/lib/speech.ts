// Centralized speech synthesis utility
let currentUtterance: SpeechSynthesisUtterance | null = null;

export function speak(text: string, opts?: { rate?: number; pitch?: number }) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = opts?.rate ?? 0.88;
  u.pitch = opts?.pitch ?? 0.75;
  u.volume = 1;

  // Prefer a deep/robotic voice if available
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(
    (v) =>
      v.name.includes('Google UK English Male') ||
      v.name.includes('Microsoft David') ||
      v.name.toLowerCase().includes('male')
  );
  if (preferred) u.voice = preferred;

  currentUtterance = u;
  window.speechSynthesis.speak(u);
}

export function stopSpeech() {
  window.speechSynthesis?.cancel();
  currentUtterance = null;
}