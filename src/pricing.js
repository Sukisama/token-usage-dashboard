// Token pricing — USD per 1,000,000 tokens.
//
// ⚠️  EDIT THIS TABLE to match what you actually pay. The defaults are rough
// public list prices and change often; treat every cost in the dashboard as an
// estimate (the UI shows "≈"). A model that matches nothing here yields
// cost = null and is shown as "—" — we never invent a number.
//
// Matching is by case-insensitive substring against the model name, first hit
// wins, so order from most specific to least specific.
//
// Fields: input / output are required. cacheRead / cacheWrite are optional; if
// omitted they default to input*0.1 (read) and input*1.25 (write), which is the
// typical Anthropic-style ratio.

const PRICES = [
  // --- Anthropic Claude ---
  { match: 'opus',     input: 15,   output: 75,  cacheRead: 1.5,   cacheWrite: 18.75 },
  { match: 'sonnet',   input: 3,    output: 15,  cacheRead: 0.3,   cacheWrite: 3.75 },
  { match: 'haiku',    input: 0.8,  output: 4,   cacheRead: 0.08,  cacheWrite: 1 },

  // --- OpenAI / Codex ---
  { match: 'gpt-5',    input: 1.25, output: 10,  cacheRead: 0.125 },
  { match: 'gpt-4',    input: 2.5,  output: 10,  cacheRead: 0.25 },
  { match: 'o3',       input: 2,    output: 8 },
  { match: 'o4',       input: 2,    output: 8 },

  // --- Others (proxies / open models) ---
  { match: 'minimax',  input: 0.2,  output: 1.1 },
  { match: 'kimi',     input: 0.15, output: 2.5, cacheRead: 0.015 },
  { match: 'glm',      input: 0.6,  output: 2.2 },
  { match: 'deepseek', input: 0.28, output: 1.1 },
  { match: 'gemini',   input: 1.25, output: 10 },
  { match: 'qwen',     input: 0.3,  output: 1.2 },
];

const PER_MILLION = 1_000_000;

function priceFor(model) {
  if (!model) return null;
  const m = String(model).toLowerCase();
  return PRICES.find(p => m.includes(p.match)) || null;
}

// Returns estimated cost in USD for a row of token counts, or null when the
// model is unknown (so callers can distinguish "free/zero" from "unpriced").
function costOf(row) {
  const p = priceFor(row.model);
  if (!p) return null;
  const cacheRead = p.cacheRead != null ? p.cacheRead : p.input * 0.1;
  const cacheWrite = p.cacheWrite != null ? p.cacheWrite : p.input * 1.25;
  const usd =
    (row.input_tokens || 0) * p.input +
    (row.output_tokens || 0) * p.output +
    (row.cache_read_tokens || 0) * cacheRead +
    (row.cache_creation_tokens || 0) * cacheWrite;
  return usd / PER_MILLION;
}

module.exports = { priceFor, costOf, PRICES };
