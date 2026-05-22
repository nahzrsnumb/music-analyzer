import express from 'express';

export const keyRouter = express.Router();

/**
 * POST /api/key/analyze
 * Body: { url: string }
 * Returns: { key: string, mode: 'major'|'minor', scale: string[], confidence: number }
 */
keyRouter.post('/analyze', async (req, res) => {
  try {
    // TODO: Integrate Chroma vector analysis / Essentia.js or music-metadata
    const { url } = req.body;
    res.json({
      key: 'A',
      mode: 'minor',
      scale: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
      confidence: 0.89,
      analyzedUrl: url,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});