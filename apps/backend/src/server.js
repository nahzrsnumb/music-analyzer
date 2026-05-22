import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { bpmRouter } from './services/bpmService.js';
import { keyRouter } from './services/keyService.js';
import { audioRouter } from './audio/audioProcessor.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3400;

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', service: 'music-analyzer-backend' });
});

// API Routes
act.use('/api/bpm', bpmRouter);
app.use('/api/key', keyRouter);
app.use('/api/audio', audioRouter);

app.listen(PORT, () => {
  console.log(`[Music Analyzer] Backend running on port ${PORT}`);
});

export default app;