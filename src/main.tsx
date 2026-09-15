import React from 'react';
import ReactDOM from 'react-dom/client';
import { getVersion } from '@tauri-apps/api/app';
import App from './App';
import './styles.css';
import './parity-fixes.css';

if ('__TAURI_INTERNALS__' in window) {
  void getVersion()
    .then((version) => document.documentElement.style.setProperty('--torgy-version', `"Torgy ${version}"`))
    .catch(() => undefined);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
