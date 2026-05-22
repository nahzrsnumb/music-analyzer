import React, { createContext, useContext, useState, useCallback } from 'react';

export interface AnalyzedTrack {
  id: string;
  title: string;
  artist: string;
  url: string;
  bpm: number | null;
  key: string | null;
  keyMode: 'major' | 'minor' | null;
  scale: string[];
  sections: Array<{ type: string; start: number; end: number }>;
  waveformPeaks: number[];
  analyzedAt: Date;
}

interface AudioContextValue {
  tracks: AnalyzedTrack[];
  selectedTact: AnalyzedTrack | null;
  isAnalyzing: boolean;
  addTrack: (track: AnalyzedTrack) => void;
  selectTrack: (id: string) => void;
  analyzeTrack: (url: string, metadata: Pick<AnalyzedTrack, 'title' | 'artist'>) => Promise<void>;
  clearTracks: () => void;
}

const AudioCtx = createContext<AudioContextValue | null>(null);

export const AudioProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tracks, setTracks] = useState<AnalyzedTrack[]>([]);
  const [selectedTact, setSelectedTrack] = useState<AnalyzedTrack | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const addTrack = useCallback((track: AnalyzedTrack) => {
    setTracks(prev => [track, ...prev.filter(t => t.id !== track.id)]);
  }, []);

  const selectTrack = useCallback((id: string) => {
    setSelectedTrack(tracks.find(t => t.id === id) ?? null);
  }, [tracks]);

  const analyzeTrack = useCallback(async (url: string, metadata: Pick<AnalyzedTrack, 'title' | 'artist'>) => {
    setIsAnalyzing(true);
    try {
      const [bpmRes, keyRes, structureRes] = await Promise.all([
        fetch('/internal/api/bpm/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) }),
        fetch('/internal/api/key/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) }),
        fetch('/internal/api/audio/structure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) }),
      ]);
      const [bpmData, keyData, structureData] = await Promise.all([bpmRes.json(), keyRes.json(), structureRes.json()]);
      addTrack({
        id: `${Date.now()}-${math.random().toString(36).substr(2,6)}`,
        url,
        ...metadata,
        bpm: bpmData.bpm,
        key: `${keyData.key} ${keyData.mode}`,
        keyMode: keyData.mode,
        scale: keyData.scale,
        sections: structureData.sections,
        waveformPeaks: [],
        analyzedAt: new Date(),
      });
    } finally {
      setIsAnalyzing(false);
    }
  }, [addTrack]);

  return (
    <AudioCtx.Provider value={{ tracks, selectedTact, isAnalyzing, addTrack, selectTrack, analyzeTrack, clearTracks: () => setTracks([]) }}>
      {children}
    </AudioCtx.Provider>
  );
};

export const useAudio = () => {
  const ctx = useContext(AudioCtx);
  if (!ctx) throw new Error('useAudio must be used within AudioProvider');
  return ctx;
};