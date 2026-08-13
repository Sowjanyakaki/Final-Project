'use client';

import { useState } from 'react';
import { useVoiceRecorder } from '../lib/voice/useVoiceRecorder';
import { playAudio } from '../lib/voice/playAudio';

const TTS_MAX_CHARS = 200;

type VoiceStatus = 'idle' | 'transcribing' | 'thinking' | 'error';

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

      if (replyText.length > 0 && replyText.length <= TTS_MAX_CHARS) {
        try {
          const ttsRes = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: replyText }),
          });
          if (ttsRes.ok) {
            const audioBlob = await ttsRes.blob();
            await playAudio(audioBlob);
          }
        } catch {
          // Speaking the reply is a nice-to-have; a TTS/playback failure must not
          // hide the text reply that's already rendered.
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
