import express from 'express';
import { fetchAudioBuffer } from '../audio/bufferLoader.js';

export const keyRouter = express.Router();

// ================================================================
// KRUMHANSL-SCHMUCKLER KEY PROFILES
// Encodes the perceived stability of each of the 12 semitones
// relative to a tonic for both major and minor modes.
// Ref: Krumhansl & Kessler (1982), JEP General.
// ================================================================

const KP_MAJOR = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09,
  2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];

const KP_MINOR = [
  6.33, 2.68, 3.52, 5.38, 2.60, 3.53,
  2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

const NOTE_NAMES      = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// Keys conventionally written with flats in minor mode
const FLAT_MINOR_KEYS = new Set([1, 3, 6, 8, 10]); // Db Eb Gb Ab Bb

// ================================================================
// HELPERS
// ================================================================

function rotate(profile, semitones) {
  const n = profile.length;
  return profile.map((_, i) => profile[(i + semitones) % n]);
}

function pearson(a, b) {
  const n = a.length;
  const meanA = a.reduce((x, y) => x + y, 0) / n;
  const meanB = b.reduce((x, y) => x + y, 0) / n;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num  += da * db;
    denA += da * da;
    denB += db * db;
  }
  const denom = Math.sqrt(denA * denB);
  return denom === 0 ? 0 : num / denom;
}

// ================================================================
// CHROMA VECTOR EXTRACTION
// Aggregates energy per pitch class (0-11) using the Goertzel
// algorithm at exact note frequencies across 7 octaves.
// ================================================================

function buildChromaVector(channelData, sampleRate) {
  const chroma = new Float64Array(12).fill(0);

  const FRAME_SIZE = 4096;
  const HOP_SIZE   = 2048;

  // Pre-compute expected frequencies for each note across 7 octaves
  const noteFreqs = [];
  for (let octave = 1; octave <= 7; octave++) {
    for (let pc = 0; pc < 12; pc++) {
      const midi = octave * 12 + pc;
      const freq = 440 * Math.pow(2, (midi - 69) / 12);
      if (freq < sampleRate / 2) { // below Nyquist
        noteFreqs.push({ pc, freq });
      }
    }
  }

  for (let start = 0; start + FRAME_SIZE < channelData.length; start += HOP_SIZE) {
    const frame = channelData.subarray(start, start + FRAME_SIZE);

    // Hanning window to reduce spectral leakage
    const windowed = new Float32Array(FRAME_SIZE);
    for (let i = 0; i < FRAME_SIZE; i++) {
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FRAME_SIZE - 1)));
      windowed[i] = frame[i] * w;
    }

    // Goertzel at each note frequency
    for (const { pc, freq } of noteFreqs) {
      const omega = (2 * Math.PI * freq) / sampleRate;
      const cosw  = Math.cos(omega);
      let s1 = 0, s2 = 0;
      for (let n = 0; n < FRAME_SIZE; n++) {
        const s = windowed[n] + 2 * cosw * s1 - s2;
        s2 = s1;
        s1 = s;
      }
      const power = s1 * s1 + s2 * s2 - 2 * cosw * s1 * s2;
      chroma[pc] += Math.sqrt(Math.max(0, power));
    }
  }

  const maxChroma = Math.max(...chroma);
  return maxChroma === 0
    ? Array.from(chroma)
    : Array.from(chroma).map(v => v / maxChroma);
}

// ================================================================
// SCALE BUILDER
// ================================================================

const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10]; // natural minor

function buildScale(rootPc, mode) {
  const intervals = mode === 'major' ? MAJOR_INTERVALS : MINOR_INTERVALS;
  const useFlats  = mode === 'minor' && FLAT_MINOR_KEYS.has(rootPc);
  const names     = useFlats ? NOTE_NAMES_FLAT : NOTE_NAMES;
  return intervals.map(interval => names[(rootPc + interval) % 12]);
}

// ================================================================
// KEY DETECTION CORE
// ================================================================

function detectKeyFromChroma(chroma) {
  const candidates = [];

  for (let pc = 0; pc < 12; pc++) {
    const majorScore = pearson(chroma, rotate(KP_MAJOR, pc));
    const minorScore = pearson(chroma, rotate(KP_MINOR, pc));
    candidates.push({ pc, mode: 'major', score: majorScore });
    candidates.push({ pc, mode: 'minor', score: minorScore });
  }

  candidates.sort((a, b) => b.score - a.score);
  const best       = candidates[0];
  const secondBest = candidates[1];

  const useFlats = best.mode === 'minor' && FLAT_MINOR_KEYS.has(best.pc);
  const noteName = useFlats ? NOTE_NAMES_FLAT[best.pc] : NOTE_NAMES[best.pc];
  const scale    = buildScale(best.pc, best.mode);

  const scoreGap   = best.score - secondBest.score;
  const confidence = Math.min(0.99, Math.max(0.40, scoreGap * 4));

  return {
    key:         noteName,
    mode:        best.mode,
    rootPc:      best.pc,
    scale,
    confidence:  Math.round(confidence * 1000) / 1000,
    allScores:   candidates.slice(0, 5).map(c => ({
      key:   (NOTE_NAMES[c.pc]),
      mode:  c.mode,
      score: Math.round(c.score * 10000) / 10000,
    })),
  };
}

// ================================================================
// ROUTES
// ================================================================

/**
 * POST /api/key/analyze
 * Body: { url: string }
 * Returns: { key, mode, scale, confidence, allScores, analyzedAt }
 */
keyRouter.post('/analyze', async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Field "url" is required and must be a string.' });
  }

  try {
    const { channelData, sampleRate } = await fetchAudioBuffer(url);
    const chroma                       = buildChromaVector(channelData, sampleRate);
    const { key, mode, scale, confidence, allScores } = detectKeyFromChroma(chroma);

    return res.json({
      key,
      mode,
      scale,
      chromaVector:   chroma.map(v => Math.round(v * 1000) / 1000),
      confidence,
      topCandidates:  allScores,
      algorithm:      'chroma-krumhansl-schmuckler',
      analyzedAt:     new Date().toISOString(),
    });
  } catch (err) {
    console.error('[KeyService] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});
