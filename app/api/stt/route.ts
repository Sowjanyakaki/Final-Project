import { NextResponse } from 'next/server';
import { transcribe } from 'ai';
import { groq } from '@ai-sdk/groq';

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data with an audio field' }, { status: 400 });
  }

  const audio = formData.get('audio');

  if (!(audio instanceof Blob)) {
    return NextResponse.json({ error: 'audio file is required' }, { status: 400 });
  }

  const bytes = new Uint8Array(await audio.arrayBuffer());

  try {
    const result = await transcribe({
      model: groq.transcription('whisper-large-v3-turbo'),
      audio: bytes,
    });
    return NextResponse.json({ text: result.text });
  } catch {
    return NextResponse.json({ error: 'Transcription failed' }, { status: 502 });
  }
}
