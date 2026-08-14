/**
 * bridge.js — MAIN world content script
 * 
 * This runs in the page's MAIN world so it CAN access localStorage.
 * It reads the auth token and user details, then posts them via
 * window.postMessage so the ISOLATED-world content script can relay
 * them to the service worker.
 * 
 * This script is intentionally minimal (~20 lines of logic).
 * It never stores, logs, or exposes the token.
 */

(function () {
  'use strict';

  const CHANNEL = '__SMART_METER_EXT_AUTH__';

  function extractAuthContext() {
    try {
      const token = localStorage.getItem('token') || '';
      const userDetailRaw = localStorage.getItem('userDetail') || '';

      if (!token) {
        window.postMessage({ channel: CHANNEL, type: 'AUTH_MISSING' }, '*');
        return;
      }

      // Parse URL for vertical/project/module context
      const urlParts = window.location.href.split('/').slice(4);
      const vertical = urlParts[0] || '';
      const project = decodeURIComponent(urlParts[1] || '') || '';
      const module = urlParts[2] || '';

      // Parse user details
      let username = '';
      let userType = '';
      let scNo = '';
      try {
        if (userDetailRaw) {
          const parsed = JSON.parse(atob(userDetailRaw.split('.')[1]));
          username = parsed?.username || '';
          userType = parsed?.user_type || '';
          if (userType === 'consumer') {
            scNo = parsed?.sc_no_access?.[0] || '';
          }
        }
      } catch {
        // userDetail might not be a JWT — try direct JSON parse
        try {
          const parsed = JSON.parse(userDetailRaw);
          username = parsed?.username || '';
          userType = parsed?.user_type || '';
          if (userType === 'consumer') {
            scNo = parsed?.sc_no_access?.[0] || '';
          }
        } catch {
          // Cannot parse userDetail
        }
      }

      // Extract sc_no from URL hash if not found in userDetail
      // URL pattern: #/coliving/.../mdms/.../SC_NO
      if (!scNo) {
        const hash = window.location.hash || '';
        const hashParts = hash.split('/');
        if (hashParts.length > 0) {
          scNo = decodeURIComponent(hashParts[hashParts.length - 1]) || '';
        }
      }

      window.postMessage({
        channel: CHANNEL,
        type: 'AUTH_CONTEXT',
        payload: {
          token,
          vertical,
          project,
          module,
          username,
          userType,
          scNo
        }
      }, '*');
    } catch {
      window.postMessage({ channel: CHANNEL, type: 'AUTH_ERROR' }, '*');
    }
  }

  // Extract on load
  extractAuthContext();

  // Re-extract on hash changes (user switches meters)
  window.addEventListener('hashchange', extractAuthContext);

  // Re-extract when the portal updates localStorage (e.g., token refresh)
  window.addEventListener('storage', (e) => {
    if (e.key === 'token' || e.key === 'userDetail') {
      extractAuthContext();
    }
  });
})();
