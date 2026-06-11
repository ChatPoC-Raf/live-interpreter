import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/operator/App';
import './ui/styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Brak elementu #root');
createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
