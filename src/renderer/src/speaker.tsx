import React from 'react';
import { createRoot } from 'react-dom/client';
import { SpeakerApp } from './ui/speaker/SpeakerApp';
import './ui/styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Brak elementu #root');
createRoot(container).render(
  <React.StrictMode>
    <SpeakerApp />
  </React.StrictMode>,
);
