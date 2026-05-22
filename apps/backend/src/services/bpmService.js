import express from 'express';
import { fetchAudioBuffer } from '../audio/bufferLoader.js';

export const bpmRouter = express.Router();

// ================================================================
// IN-MEMORY HISTORY - persisted across requests for GET /history
// ================================================================
/** @type {Array<{id:string,url:string,bpm:number,confidence:number,algorithm:string,analyzedAt:string}>} */
const analysisHistory = [];
const MAX_HISTORY = 100;

// ================================================================
// ALGORITHM 1: PEAK DETECTION (Onset-based)
// ================================================================

function detectBpmPeaks(channelData, sampleRate) {
  const WINDOW_SIZE = Math.floor(sampleRate * 0.02);
  const HOP_SIZE    = Math.floor(WINDOW_SIZE / 2);

  const energy = [];
  for (let i = 0; i + WINDOW_SIZE < channelData.length; i += HOP_SIZE) {
    let sum = 0;
    for (let j = 0; j < WINDOW_SIZE; j++) {
      sum += channelData[i + j] ** 2;
    }
    energy.push(Math.sqrt(sum / WINDOW_SIZE));
  }

  const smoothed = energy.map((_, i, arr) => {
    const win = arr.slice(Math.max(0, i - 2), i + 3);
    return win.reduce((a, b) => a + b, 0) / win.length;
  });

  const meanE  = smoothed.reduce((a, b) => a + b, 0) / smoothed.length;
  const thresh = meanE * 1.3;
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
    return detectBpmAutocorrelation(channelData, sampleRate);
  }

  const intervals = [];
  for (let i = 1; i < peakIndices.length; i++) {
    intervals.push(peakIndices[i] - peakIndices[i - 1]);
  }
  const sorted = [...intervals].sort((a, b) => a - b);
  const medianInterval = sorted[Math.floor(sorted.length / 2)];

  const intervalSeconds = (medianInterval * HOP_SIZE) / sampleRate;
  const rawBpm = 60 / intervalSeconds;

  let bpm = rawBpm;
  while (bpm > 180) bpm /= 2;
  while (bpm < 60)  bpm *= 2;
  bpm = Math.round(bpm * 10) / 10;

  const variance    = intervals.reduce((acc, v) => acc + (v - medianInterval) ** 2, 0) / intervals.length;
  const maxVariance = medianInterval ** 2 * 0.5;
  const confidence  = Math.max(0.3, Math.min(0.99, 1 - variance / maxVariance));

  return { bpm, confidence: Math.round(confidence * 1000) / 1000 };
}

// ================================================================
// ALGORITHM 2: AUTOCORRELATION (fallback for sparse signals)
// ================================================================

function detectBpmAutocorrelation(channelData, sampleRate) {
  const analysisDuration = Math.min(30 * sampleRate, channelData.length);
  const startOffset      = Math.floor(
    Math.max(0, channelData.length / 2 - analysisDuration / 2)
  );
  const slice = channelData.slice(startOffset, startOffset + analysisDuration);

  const downsampleFactor = Math.floor(sampleRate / 1000);
  const ds = [];
  for (let i = 0; i < slice.length; i += downsampleFactor) {
    ds.push(Math.abs(slice[i]));
  }

  const lagMin = Math.floor(60000 / 180);
  const lagMax = Math.floor(60000 / 60);

  let bestLag   = lagMin;
  let bestScore = -Infinity;
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
  const confidence = Math.round(0.75 * 1000) / 1000;

  return { bpm, confidence };
}

// ================================================================
// ROUTES
// ================================================================

bpmRouter.post('/analyze', async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Field "url" is required and must be a string.' });
  }

  try {
    const { channelData, sampleRate } = await fetchAudioBuffer(url);
    const { bpm, confidence } = detectBpmPeaks(channelData, sampleRate);

    const result = {
      id:         `${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      url,
      bpm,
      confidence,
      algorithm:  confidence >= 0.8 ? 'peak-detection' : 'autocorrelation',
      analyzedAt: new Date().toISOString(),
    };

    analysisHistory.unshift(result);
    if (analysisHistory.length > MAX_HISTORY) analysisHistory.pop();

    return res.json(result);
  } catch (err) {
    console.error('[BPMService] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

bpmRouter.get('/history', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, MAX_HISTORY);
  return res.json({
    history: analysisHistory.slice(0, limit),
    total:   analysisHistory.length,
  });
});
