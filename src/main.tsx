import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import 'katex/dist/katex.min.css';
import './ui/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
