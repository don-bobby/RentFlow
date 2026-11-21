import React from 'react';
import ReactDOM from 'react-dom/client';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import './index.css';
import App from './app';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Lets the app open without signal: the service worker keeps a copy of the app itself.
if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}

// Android app only: the phone's Back button goes back one step (for example closes an open
// unit on the listings page) and only leaves the app when there is nothing left to go back to.
// Ignored in a normal browser. If an older APK does not have the plugin yet, this quietly does nothing.
if (Capacitor.isNativePlatform()) {
  try {
    CapApp.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) window.history.back();
      else CapApp.exitApp();
    }).catch(() => {});
  } catch (e) { /* plugin missing in this APK */ }
}