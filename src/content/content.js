/**
 * content.js — ISOLATED world content script
 * 
 * Listens for auth context from the MAIN-world bridge (via window.postMessage)
 * and relays it to the service worker (via chrome.runtime.sendMessage).
 * 
 * This script never accesses localStorage directly (it can't — ISOLATED world).
 * It never exposes the token to the page. It's a one-way relay:
 *   bridge.js → content.js → service-worker.js
 */

(function () {
  'use strict';

  const CHANNEL = '__SMART_METER_EXT_AUTH__';

  window.addEventListener('message', (event) => {
    // Only accept messages from this page
    if (event.source !== window) return;
    if (!event.data || event.data.channel !== CHANNEL) return;

    const { type, payload } = event.data;

    if (type === 'AUTH_CONTEXT' && payload) {
      chrome.runtime.sendMessage({
        type: 'AUTH_CONTEXT',
        payload
      });
    } else if (type === 'AUTH_MISSING') {
      chrome.runtime.sendMessage({
        type: 'AUTH_MISSING'
      });
    } else if (type === 'AUTH_ERROR') {
      chrome.runtime.sendMessage({
        type: 'AUTH_ERROR'
      });
    }
  });

  // Notify the service worker that the portal page is open
  chrome.runtime.sendMessage({ type: 'PORTAL_DETECTED' });
})();
