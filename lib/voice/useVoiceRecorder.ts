'use client';

import { useCallback, useRef, useState } from 'react';

export interface VoiceRecorder {
  isRecording: boolean;
  start(): void;
  stop(): Promise<Blob>;
}

/**
 * Push-to-talk recorder (per docs/ARCHITECTURE.md §1: "push-to-talk mic
 * button, not always-on streaming"). Wraps the browser MediaRecorder API —
 * browser-only, so this must run behind 'use client' and only ever be
 * called after a user gesture (mic click), per getUserMedia's permission
 * model.
 */
export function useVoiceRecorder(): VoiceRecorder {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const start = useCallback(() => {
    void (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    })();
  }, []);

  const stop = useCallback((): Promise<Blob> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder) {
        resolve(new Blob([], { type: 'audio/webm' }));
        return;
      }

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;
        setIsRecording(false);
        resolve(blob);
      };
      recorder.stop();
    });
  }, []);

  return { isRecording, start, stop };
}
