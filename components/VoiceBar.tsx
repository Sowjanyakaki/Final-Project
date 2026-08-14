'use client';

import { useState } from 'react';
import { useVoiceRecorder } from '../lib/voice/useVoiceRecorder';
import { speak } from '../lib/voice/speak';

const TTS_MAX_CHARS = 200;

type VoiceStatus = 'idle' | 'transcribing' | 'thinking' | 'error';

/**
 * Replies over TTS_MAX_CHARS used to be skipped entirely rather than
 * spoken — since the model doesn't reliably keep replies under the limit,
 * that made voice output silently absent on a large fraction of turns.
 * Truncate at the last sentence boundary within the limit instead, so
 * something is always spoken; full text still always renders in the UI.
 */
function truncateForSpeech(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const lastSentenceEnd = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
  if (lastSentenceEnd > 0) {
    return slice.slice(0, lastSentenceEnd + 1);
  }
  return `${slice.trimEnd()}…`;
}

export default function VoiceBar() {
  const { start, stop } = useVoiceRecorder();
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [reply, setReply] = useState('');
  const [status, setStatus] = useState<VoiceStatus>('idle');

  async function handleMicClick() {
    if (!recording) {
      start();
      setRecording(true);
      return;
    }

    setRecording(false);
    setStatus('transcribing');

    try {
      const blob = await stop();

      const formData = new FormData();
      formData.append('audio', blob, 'recording.webm');
      const sttRes = await fetch('/api/stt', { method: 'POST', body: formData });
      if (!sttRes.ok) throw new Error('stt failed');
      const { text } = await sttRes.json();
      setTranscript(text);

      setStatus('thinking');
      const agentRes = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      if (!agentRes.ok) throw new Error('agent failed');
      const replyText = await agentRes.text();
      setReply(replyText);
      setStatus('idle');

      if (replyText.length > 0) {
        try {
          await speak(truncateForSpeech(replyText, TTS_MAX_CHARS));
        } catch {
          // Speaking the reply is a nice-to-have; a speech-synthesis failure
          // must not hide the text reply that's already rendered.
        }
      }
    } catch {
      setStatus('error');
    }
  }

  return (
    <section aria-label="Voice assistant" data-testid="voice-bar">
      <button type="button" onClick={handleMicClick} aria-pressed={recording}>
        {recording ? 'Stop recording' : 'Start recording'}
      </button>
      <p data-testid="voice-status">{status}</p>
      <p data-testid="transcript">{transcript || 'Say something to get started.'}</p>
      <p data-testid="agent-reply">{reply}</p>
    </section>
  );
}
