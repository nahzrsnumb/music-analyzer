import express from 'express';
import fs from 'fs';
import path from 'path';
import { fetchAudioBuffer } from '../audio/bufferLoader.js';

export const bpmRouter = express.Router();

// ===============================================================
// IN-MEMORY HISTO  - persisted across requests for GET /history
// ===============================================================
/** @type {Array<{id:string,url:string,bpm:number,confidence:number,algorithm:string,analyzedAt:string}>} */
const analysisHistory = [];
const MAX_HISTORY = 100;

// ===============================================================
// ALGORITHM 1: PEAK DETECTION (Onset-based)
// Detecta picos de energía en la señal para identificar beats.
// ===============================================================

/**
 * Calcula el BPM usando detección de picos de energía.
 * @param {Float32Array} channelData  - PCM mono del audio
 * @param {number} sampleRate         - Hz (e.g. 44100)
 * @returns {{bpm:number, confidence:number}}
 */
function detectBpmPeaks(channelData, sampleRate) {
  const WINDOW_SIZE = Math.floor(sampleRate * 0.02); // 20ms windows
  const HOP_SIZE    = Math.floor(WINDOW_SIZE / 2);

  // Step 1: compute RMS energy per window
  const energy = [];
  for (let i = 0; i + WINDOW_SIZE < channelData.length; i += HOP_SIZE) {
    let sum = 0;
    for (let j = 0; j < WINDOW_SIZE; j++) {
      sum += channelData[i + j] ** 2;
    }
    energy.push(Math.sqrt(sum / WINDOW_SIZE));
  }

  // Step 2: smooth energy with a 5-frame moving average
  const smoothed = energy.map((_, i, arr) => {
    const win = arr.slice(Math.max(0, i - 2), i + 3);
    return win.reduce((a, b) => a + b, 0) / win.length;
  });

  // Step 3: detect peaks (local maxima above threshold)
  const meanE   = smoothed.reduce((a, b) => a + b, 0) / smoothed.length;
  const thresh  = meanE * 1.3;  // 30% above mean is a beat
  const peakIndices = [];
  for (let i = 2; i < smoothed.length - 2; i++) {
    if (smoothed[i] > thresh &&
        smoothed[i] >= smoothed[i - 1] &&
        smoothed[i] >= smoothed[i + 1] &&
        smoothed[i] >= smoothed[i - 2] &&
        smoothed[i] >= smoothed[i + 2]) {
      peakIndices.push(i);
    }
  }

  if (peakIndices.length < 2) {
    // Fallback to autocorrelation if not enough peaks
    return detectBpmAutocorrelation(channelData, sampleRate);
  }

  // Step 4: calculate median interval between peaks
  const intervals = [];
  for (let i = 1; i < peakIndices.length; i++) {
    intervals.push(peakIndices[i] - peakIndices[i - 1]);
  }
  const sorted = [...intervals].sort((a, b) => a - b);
  const medianInterval = sorted[Math.floor(sorted.length / 2)];

  // Convert frame-interval to seconds, then to BPM
  const intervalSeconds = (medianInterval * HOP_SIZE) / sampleRate;
  const rawBpm = 60 / intervalSeconds;

  // Octave folding: normalize into [60, 180] BPM range
  let bpm = rawBpm;
  while (bpm > 180) bpm /= 2;
  while (bpm < 60)  bpm *= 2;
  bpm = Math.round(bpm * 10) / 10;

  // Confidence: higher when peak count is adequate and interval variance is low
  const variance = intervals.reduce((acc, v) => acc + (v - medianInterval) ** 2, 0) / intervals.length;
  const maxVariance = medianInterval ** 2 * 0.5;
  const confidence  = Math.max(0.3, Math.min(0.99, 1 - variance / maxVariance));

  return { bpm, confidence: Math.round(confidence * 1000) / 1000 };
}


// ===============================================================
// ALGORITHM 2: AUTOCORRELATION (fallback for sparse signals)
// Finds periodicity by correlating the signal with a lagged copy.
// ===============================================================

/**
 * Autocorrelation-based BPM detection.
 * @param {Float32Array} channelData
 * @param {number} sampleRate
 * @returns {{bpm:number, confidence:number}}
 */
function detectBpmAutocorrelation(channelData, sampleRate) {
  // Use a 30-second window from the middle of the track (most representative)
  const analysisDuration = Math.min(30 * sampleRate, channelData.length);
  const startOffset      = Math.floor(
    Math.max(0, channelData.length / 2 - analysisDuration / 2)
  );
  const slice = channelData.slice(startOffset, startOffset + analysisDuration);

  // Downsample to reduce computation: take one sample per millisecond
  const downsampleFactor = Math.floor(sampleRate / 1000);
  const ds = [];
  for (let i = 0; i < slice.length; i += downsampleFactor) {
    ds.push(Math.abs(slice[i]));
  }

  // BPM range [60, 180] => lag range in ms
  const lagMin = Math.floor(60000 / 180); // 333ms
  const lagMax = Math.floor(60000 / 60);  // 1000ms

  // Compute autocorrelation for each lag
  let bestLag    = lagMin;
  let bestScore  = -Infinity;
  for (let lag = lagMin; lag <= lagMax && lag < ds.length; lag++) {
    let score = 0;
    const n   = ds.length - lag;
    for (let i = 0; i < n; i++) {
      score += ds[i] * ds[i + lag];
    }
    score /= n;
    if (score > bestScore) {
      bestScore = score;
      bestLag   = lag;
    }
  }

  const bpm        = Math.round((60000 / bestLag) * 10) / 10;
  const confidence = Math.round(0.75 * 1000) / 1000; // Autocorrelation is slightly less certain

  return { bpm, confidence };
}


// ===============================================================
// ROUTES
// ===============================================================

/**
 * POST /api/bpm/analyze
 * Body: { url: string }   (URL publico de audio: mp3/wav/ogg)
 * Returns: { id, url, bpm, confidence, algorithm, analyzedAt }
 */
bpmRouter.post('/analyze', async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Field "url" is required and must be a string.' });
  }

  try {
    const { channelData, sampleRate } = await fetchAudioBuffer(url);

    // Run peak detection first; autocorrelation is used internally as fallback
    const { bpm, confidence } = detectBpmPeaks(channelData, sampleRate);

    const result = {
      id:          `${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      url,
      bpm,
      confidence,
      algorithm: confidence >= 0.8 ? 'peak-detection' : 'autocorrelation',
      analyzedAt: new Date().toISOString(),
    };

    // Save to in-memory history
    analysisHistory.unshift(result);
    if (analysisHistory.length > MAX_HISTORY) analysisHistory.pop();

    return res.json(result);
  } catch (err) {
    console.error('[BPMService] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/bpm/history?limit=20
 * Returns the most recent BPM analysis results
 */
bpmRouter.get('/history', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, MAX_HISTORY);
  return res.json({
    history: analysisHistory.slice(0, limit),
    total:   analysisHistory.length,
  });
});
