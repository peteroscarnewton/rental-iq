/**
 * lib/fingerprint.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Client-side device fingerprinting for guest free-trial anti-abuse.
 *
 * Generates a stable ~128-bit fingerprint from browser signals that:
 *   - Persist across page refreshes (unlike sessionStorage)
 *   - Persist across incognito sessions (hardware/browser signals don't change)
 *   - Are NOT cleared by cookie deletion or localStorage.clear()
 *
 * Signals used:
 *   - User agent string (browser + OS version)
 *   - Screen resolution + color depth + pixel ratio
 *   - Timezone offset + timezone name
 *   - Language + languages list
 *   - Hardware concurrency (CPU core count)
 *   - Platform string
 *   - Canvas 2D fingerprint (GPU/font rendering differences)
 *
 * This stops casual abuse (incognito, refresh, VPN change) without requiring
 * any third-party service. It does NOT stop sophisticated attackers with
 * headless browsers and custom canvas spoofing — that's fine for our purposes.
 *
 * Usage (client-side only):
 *   import { getDeviceFingerprint } from '../lib/fingerprint';
 *   const fp = await getDeviceFingerprint();
 *   // fp is a 32-char hex string (128-bit SHA-256 truncated)
 *
 * @module fingerprint
 */

/**
 * Simple non-cryptographic hash — FNV-1a 32-bit variant.
 * Fast, deterministic, good distribution for fingerprinting.
 */
function fnv1a(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Canvas fingerprint: draw text + shapes, read pixel data.
 * GPU driver and font rendering differences produce unique results.
 */
function canvasFingerprint() {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'no-canvas';

    // Text rendering (font hinting differs per OS/GPU)
    ctx.textBaseline = 'top';
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('RentalIQ fp', 2, 15);
    ctx.fillStyle = 'rgba(102,204,0,0.7)';
    ctx.fillText('RentalIQ fp', 4, 17);

    // Arc (GPU-dependent anti-aliasing)
    ctx.beginPath();
    ctx.arc(50, 25, 18, 0, Math.PI * 2);
    ctx.strokeStyle = '#166638';
    ctx.stroke();

    return fnv1a(canvas.toDataURL().slice(22, 120)); // slice avoids base64 overhead
  } catch {
    return 'canvas-blocked';
  }
}

/**
 * Collect all browser signals into a single string, then hash.
 */
function collectSignals() {
  const nav = window.navigator;
  const scr = window.screen;

  const signals = [
    nav.userAgent,
    `${scr.width}x${scr.height}`,
    scr.colorDepth,
    window.devicePixelRatio || 1,
    new Date().getTimezoneOffset(),
    Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    nav.language || '',
    (nav.languages || []).join(','),
    nav.hardwareConcurrency || 0,
    nav.platform || '',
    nav.maxTouchPoints || 0,
    canvasFingerprint(),
  ].join('|');

  // Combine multiple fnv1a passes for better distribution
  const h1 = fnv1a(signals);
  const h2 = fnv1a(signals.split('').reverse().join(''));
  const h3 = fnv1a(signals.slice(10));
  const h4 = fnv1a(signals.slice(0, -10));

  return `${h1}${h2}${h3}${h4}`; // 32-char hex = 128-bit
}

// Cache in memory for the session — don't recompute on every call
let _cached = null;

/**
 * Returns a stable 32-character hex device fingerprint.
 * Safe to call multiple times — returns cached value after first call.
 *
 * @returns {string} 32-char hex fingerprint
 */
export function getDeviceFingerprint() {
  if (typeof window === 'undefined') return 'ssr-no-fp';
  if (_cached) return _cached;
  _cached = collectSignals();
  return _cached;
}
