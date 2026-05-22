import axios from 'axios';
import { AudioContext } from 'web-audio-api';

/**
 * bufferLoader.js
 *
 * Shared module used by bpmService, keyService, and audioProcessor.
 * Downloads an audio file from a public URL and decodes it
 * into a mono PCM Float32Array using the Web Audio API.
 *
 * Supported formats: MP3, WAV, OGG, AAC, FLAC (anything libav
 * can decode on the host system).
 *
 * @param {string} url  - Publicly accessible audio URL
 * @returns {Promise<{channelData:Float32Array, sampleRate:number, duration:number}>}
 */
export async function fetchAudioBuffer(url) {
  // Step 1: Download the audio file as a raw ArrayBuffer
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout:      30_000,          // 30s max download time
    maxContentLength: 50 * 1024 * 1024, // 50MB max file size
    headers: { 'User-Agent': 'music-analyzer/1.0' },
  });

  const arrayBuffer = response.data;

  if (!arrayBuffer || arrayBuffer.byteLength === 0) {
    throw new Error(`Empty or invalid audio file at URL: ${url}`);
  }

  // Step 2: Decode using Web Audio API (node implementation via web-audio-api)
  const audioCtx = new AudioContext();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

  // Step 3: Convert to mono by averaging all channels (standard practice)
  const numChannels = audioBuffer.numberOfChannels;
  const length      = audioBuffer.length;
  const mono        = new Float32Array(length);

  for (let ch = 0; ch < numChannels; ch++) {
    const channel = audioBuffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      mono[i] += channel[i] / numChannels;
    }
  }

  audioCtx.close(); // Release resources immediately

  return {
    channelData: mono,
    sampleRate:  audioBuffer.sampleRate,
    duration:    audioBuffer.duration,
  };
}