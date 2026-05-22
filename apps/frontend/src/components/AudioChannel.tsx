import React, { useState } from 'react';
import ChatAgent from './ChatAgent';

interface AudioChannelProps {
  channelId: string;
  trackTitle: string;
  bpm: number | null;
  musicalKey: string | null;
  onClose: () => void;
}

/**
 * AudioChannel - Canales laterales con acceso a chats individuales
 * Cada pista tiene su propio canal con agente de IA (Certeza/Ego)
 */
export const AudioChannel: React.FC<AudioChannelProps> = ({
  channelId, trackTitle, bpm, musicalKey, onClose
}) => {
  const [isChatOpen, setIsChatOpen] = useState(false);

  return (
    <div className="audio-channel">
      <div className="channel-header">
        <h3 className="channel-title">{trackTitle}</h3>
        <button className="channel-close" onClick={onClose}>X</button>
      </div>

      <div className="channel-stats">
        <div className="stat-block">
          <span className="stat-label">BPB</span>
          <span className="stat-value bpm">{bpm ?? '—'}</span>
        </div>
        <div className="stat-block">
          <span className="stat-label">Clave</span>
          <span className="stat-value key">{musicalKey ?? '—'}</span>
        </div>
      </div>

      <button
        className="chat-toggle"
        onClick={() => setIsChatOpen(prev => !prev)}
      >
        {isChatOpen ? 'Cerrar IA' : 'Hablar con IA'}
      </button>

      {isChatOpen && (
        <ChatAgent
          channelId={channelId}
          context={{ trackTitle, bpm, musicalKey }}
        />
      )}
    </div>
  );
};

export default AudioChannel;