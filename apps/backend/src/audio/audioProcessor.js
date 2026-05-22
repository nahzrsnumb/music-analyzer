import express from 'express';
import { fetchAudioBuffer } from './bufferLoader.js';

export const audioRouter = express.Router();

// ================================================================
// WAVEFORM EXTRACTION
// Reduces the full PCM buffer to peak amplitude values per bin,
// compatible with wavesurfer.js `peaks` format.
// ================================================================

/**
 * Downsamples a PCM buffer to a fixed number of amplitude peaks.
 * @param {Float32Array} channelData
 * @param {number} targetSamples - number of output points (default 1440)
 * @returns {number[]}
 */
function extractWaveformPeaks(channelData, targetSamples = 1440) {
  const total   = channelData.length;
  const binSize = Math.floor(total / targetSamples);
  const peaks   = new Array(targetSamples);

  for (let i = 0; i < targetSamples; i++) {
    let maxAmp = 0;
    const start = i * binSize;
    const end   = Math.min(start + binSize, total);
    for (let j = start; j < end; j++) {
      const abs = Math.abs(channelData[j]);
      if (abs > maxAmp) maxAmp = abs;
    }
    peaks[i] = Math.round(maxAmp * 10000) / 10000;
  }

  return peaks;
}

// ================================================================
// SECTION SEGMENTATION  (Energy-Based)
//
// Algorithm:
//  1. Compute RMS energy per frame (~2 seconds) over the full track.
//  2. Smooth with a moving-average kernel to eliminate transients.
//  3. Detect significant energy changes (derivative threshold).
//  4. Cluster changepoints into meaningful sections and assign
//     semantic labels based on position and relative energy level.
// ================================================================

function computeRmsEnergy(data, frameSize) {
  const numFrames = Math.floor(data.length / frameSize);
  const rms       = new Array(numFrames);
  for (let i = 0; i < numFrames; i++) {
    let sum = 0;
    const offset = i * frameSize;
    for (let j = 0; j < frameSize; j++) {
      sum += data[offset + j] ** 2;
    }
    rms[i] = Math.sqrt(sum / frameSize);
  }
  return rms;
}

function smooth(series, radius) {
  return series.map((_, i, arr) => {
    const win = arr.slice(Math.max(0, i - radius), i + radius + 1);
    return win.reduce((a, b) => a + b, 0) / win.length;
  });
}

function findChangepoints(smoothedRms, minGap) {
  const n           = smoothedRms.length;
  const derivative  = smoothedRms.map((v, i) =>
    i === 0 ? 0 : Math.abs(v - smoothedRms[i - 1])
  );
  const maxDerivative = Math.max(...derivative);
  const thresh        = maxDerivative * 0.25;

  const changepoints = [0];
  let last = 0;
  for (let i = 1; i < n; i++) {
    if (derivative[i] >= thresh && (i - last) >= minGap) {
      changepoints.push(i);
      last = i;
    }
  }
  changepoints.push(n - 1);
  return changepoints;
}

function labelSections(changepoints, smoothedRms, totalFrames) {
  const segments = [];
  for (let i = 0; i < changepoints.length - 1; i++) {
    const startF = changepoints[i];
    const endF   = changepoints[i + 1];
    const slice  = smoothedRms.slice(startF, endF);
    const meanE  = slice.reduce((a, b) => a + b, 0) / slice.length;
    segments.push({ startF, endF, energy: meanE, length: endF - startF });
  }

  if (segments.length === 0) return [];

  const maxEnergy   = Math.max(...segments.map(s => s.energy));
  const labelCounter = {};

  return segments.map((seg) => {
    const posInTrack = seg.startF / totalFrames;
    const endPos     = seg.endF   / totalFrames;
    const relEnergy  = maxEnergy > 0 ? seg.energy / maxEnergy : 0;

    let type;
    if (posInTrack < 0.08 && seg.length / totalFrames < 0.15) {
      type = 'intro';
    } else if (endPos > 0.92 && seg.length / totalFrames < 0.15) {
      type = 'outro';
    } else if (relEnergy > 0.75) {
      type = 'chorus';
    } else if (relEnergy > 0.40) {
      type = 'verse';
    } else {
      type = 'bridge';
    }

    labelCounter[type] = (labelCounter[type] || 0) + 1;
    const label = labelCounter[type] > 1 ? `${type} ${labelCounter[type]}` : type;

    return { type: label, startFrame: seg.startF, endFrame: seg.endF, energy: Math.round(seg.energy * 10000) / 10000 };
  });
}

// ================================================================
// ROUTES
// ================================================================

/**
 * POST /api/audio/structure
 * Body: { url: string }
 * Returns: { sections, duration, timeSignature, frameDurationSec, analyzedAt }
 */
audioRouter.post('/structure', async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Field "url" is required and must be a string.' });
  }

  try {
    const { channelData, sampleRate, duration } = await fetchAudioBuffer(url);

    const FRAME_DURATION_SEC = 2;
    const frameSize          = Math.floor(sampleRate * FRAME_DURATION_SEC);
    const MIN_GAP_FRAMES     = 8;

    const rms          = computeRmsEnergy(channelData, frameSize);
    const smoothed     = smooth(rms, 4);
    const changepoints = findChangepoints(smoothed, MIN_GAP_FRAMES);
    const sections     = labelSections(changepoints, smoothed, smoothed.length);

    const sectionsSec = sections.map(s => ({
      type:         s.type,
      startSec:     Math.round(s.startFrame * FRAME_DURATION_SEC * 100) / 100,
      endSec:       Math.round(s.endFrame   * FRAME_DURATION_SEC * 100) / 100,
      durationSec:  Math.round((s.endFrame - s.startFrame) * FRAME_DURATION_SEC * 100) / 100,
      energy:       s.energy,
    }));

    return res.json({
      sections:         sectionsSec,
      duration:         Math.round(duration * 100) / 100,
      frameDurationSec: FRAME_DURATION_SEC,
      timeSignature:    '4/4',
      analyzedAt:       new Date().toISOString(),
    });
  } catch (err) {
    console.error('[AudioProcessor] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/audio/waveform
 * Body: { url: string, samples: number (optional, default 1440) }
 * Returns: { peaks, duration, sampleRate, analyzedAt }
 */
audioRouter.post('/waveform', async (req, res) => {
  const { url, samples = 1440 } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Field "url" is required and must be a string.' });
  }

  const targetSamples = Math.min(Math.max(Number(samples) || 1440, 288), 7200);

  try {
    const { channelData, sampleRate, duration } = await fetchAudioBuffer(url);
    const peaks = extractWaveformPeaks(channelData, targetSamples);

    return res.json({
      peaks,
      duration:    Math.round(duration * 100) / 100,
      sampleRate,
      analyzedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[AudioProcessor] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});
