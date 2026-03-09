/**
 * geminiClient.js
 *
 * Resilient Gemini API caller with automatic model fallback.
 *
 * Instead of hardcoding a single model string, this module tries a ranked list
 * of models in order. If one is deprecated or unavailable (400/404), it falls
 * through to the next. This means the app keeps working even when Google retires
 * a model, until you get around to updating the list.
 *
 * To update the preferred model: put it first in CANDIDATE_MODELS.
 * To add a new fallback: append it to the list.
 */

// Ranked list: most preferred first.
// gemini-2.5-flash is the default — fast, cost-effective, grounding-capable.
// gemini-2.5-pro is the quality upgrade fallback (not lite — pro > flash > lite).
// gemini-2.5-flash-lite is last resort: lowest capability, use only if both above fail.
const CANDIDATE_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.5-flash-lite',
];

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Call Gemini with automatic model fallback and retry on transient errors.
 *
 * @param {string} apiKey         - GEMINI_API_KEY
 * @param {object} payload        - The request body (contents, generationConfig, etc.)
 *                                  Do NOT include the model — this function handles that.
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=50000]  - Per-attempt timeout in ms
 * @param {number} [opts.retries=2]        - Retry attempts for transient errors (429/503)
 * @returns {Promise<{res: Response, modelUsed: string}>}
 * @throws  If all models are exhausted or a non-recoverable error occurs
 */
export async function callGemini(apiKey, payload, opts = {}) {
  const { timeoutMs = 45000, retries = 1 } = opts;
  const errors = [];

  for (const model of CANDIDATE_MODELS) {
    const url = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`;

    for (let attempt = 1; attempt <= retries; attempt++) {
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        if (attempt === retries) {
          errors.push(`${model}: network error - ${e.message}`);
          break; // try next model
        }
        await sleep(1500 * attempt);
        continue;
      }

      // Transient - retry same model
      if ((res.status === 429 || res.status === 503) && attempt < retries) {
        await sleep(2000 * attempt);
        continue;
      }

      // Deprecated / not found / not available to this key - try next model
      if (res.status === 400 || res.status === 404) {
        let reason = res.status;
        try {
          const body = await res.json();
          reason = body?.error?.message || reason;
        } catch {}
        errors.push(`${model}: ${reason}`);
        break; // move to next model in CANDIDATE_MODELS
      }

      // Any other status (200, 401, 429 on last retry, 500, etc.) - return as-is
      // The caller handles non-2xx status codes normally
      return { res, modelUsed: model };
    }
  }

  // All models failed
  throw new Error(
    `All Gemini models unavailable. Tried: ${CANDIDATE_MODELS.join(', ')}. ` +
    `Errors: ${errors.join(' | ')}`
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extract the text response from a Gemini response body.
 * Handles thinking models (gemini-2.5+) where parts[0] may be a thought block.
 *
 * @param {object} geminiBody - Parsed JSON from Gemini response
 * @returns {string}
 */
export function extractGeminiText(geminiBody) {
  const parts = geminiBody?.candidates?.[0]?.content?.parts || [];
  return (parts.find(p => !p.thought && p.text) || parts[0] || {}).text || '';
}
