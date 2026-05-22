import React, { useState, useRef, useEffect } from 'react';

interface Message {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: Date;
}

interface ChatAgentProps {
  channelId: string;
  context: {
    trackTitle: string;
    bpm: number | null;
    musicalKey: string | null;
  };
}

/**
 * ChatAgent - Burbuja de IA estilo iPhone (Certeza/Ego)
 * Agente consciente del contexto musical de la pista
 */
export const ChatAgent: React.FC<ChatAgentProps> = ({ channelId, context }) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      role: 'agent',
      content: `Hola, soy tu Agente Musical – Estoy �_analizando ${context.trackTitle} (BPM: ${context.bpm ?? '—'}, Clave: ${context.musicalKey ?? '—'}). ¿Qué quieres saber?`,
      timestamp: new Date(),
    }
  ]);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;
    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    // TODO: conectar con API de IA (OpenAI/Claude)
  };

  return (
    <div className="chat-agent">
      <div className="chat-messages">
        {messages.map(msg => (
          <div key={msg.id} className={`bubble ${msg.role}`}>
            {msg.content}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div className="chat-input-area">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder="Pregunta sobre esta pista..."
        />
        <button onClick={handleSend}>→</button>
      </div>
    </div>
  );
};

export default ChatAgent;