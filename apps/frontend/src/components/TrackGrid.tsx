import React, { useState, useRef} from 'react';
import '../styles/TrackGrid.css';

interface Track {
  id: string;
  title: string;
  artist: string;
  bpm: number | null;
  key: string | null;
  duration: number;
  waveformPeaks: number[];
}

interface TrackGridProps {
  tracks: Track[];
  onTrackSelect: (track: Track) => void;
  selectedTrackId?: string;
}

/**
 * TrackGrid - Playlist interactiva horizontal con Zoom
 * Estilo: Paleta Ableton — Grises intensos, Azul Real y Morados
 */
export const TrackGrid: React.FC<TrackGridProps> = ({ tracks, onTrackSelect, selectedTrackId }) => {
  const [zoom, setZoom] = useState(1);
  const gridRef = useRef<HTMLDivElement>(null);

  const handleZoomIn = () => setZoom(prev => Math.min(prev * 1.2, 4));
  const handleZoomOut = () => setZoom(prev => Math.max(prev / 1.2, 0.5));

  return (
    <div className="track-grid-container">
      <div className="track-grid-controls">
        <button onClick={handleZoomOut}>−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button onClick={handleZoomIn}>+</button>
      </div>
      <div
        ref={gridRef}
        className="track-grid"
        style={{ transform: `scaleX(${zoom})`, transformOrigin: 'left' }}
      >
        {tracks.map(track => (
          <div
            key={track.id}
            className={`track-row ${selectedTrackId === track.id ? 'active' : ''}`}
            onClick={() => onTrackSelect(track)}
          >
            <span className="track-title">{track.title}</span>
            <span className="track-artist">{track.artist}</span>
            <span className="track-bpm">{track.bpm ?? '—'} BPM </span>
            <span className="track-key">{track.key ?? '诎目站'}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TrackGrid;