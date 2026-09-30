import { readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// GPT-6.1 Sol verified 2026-10-01: https://developers.openai.com/api/docs/changelog#september-2026
// Retain earlier rates for saved usage and explicit model overrides.
export const prices = { 'gpt-6.1-sol': [2, 10], 'gpt-5.6-sol': [4, 20], 'gpt-5-mini-2025-08-07': [0.25, 2], 'gpt-5.5-2026-04-23': [5, 30] };
export const conversion = 200 * 1.2; // Budget assumption + cushion, NOT observed FX or invoice.
export const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function readJSON(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' && fallback !== undefined) return fallback; throw e; }
}
export async function saveJSON(path, value) {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(tmp, path);
}
export function cost(model, input, output) {
  if (!prices[model] || !Number.isSafeInteger(input) || input < 0 || !Number.isSafeInteger(output) || output < 0) throw Error('Invalid model or token usage');
  // Conservatively treat all Sol input as cache writes (1.25x); not an invoice.
  const sol = ['gpt-5.6-sol', 'gpt-6.1-sol'].includes(model);
  const cacheWriteCushion = sol ? 1.25 : 1;
  const longContext = sol && input > 272000;
  return (input * prices[model][0] * cacheWriteCushion * (longContext ? 2 : 1) + output * prices[model][1] * (longContext ? 1.5 : 1)) / 1e6 * conversion;
}
export function ceiling(body) {
  // Generous bound for fixed text-only requests including schema/token framing.
  if (body.tools || !Number.isSafeInteger(body.max_output_tokens)) throw Error('Unsupported budget request');
  return cost(body.model, Buffer.byteLength(JSON.stringify(body), 'utf8') * 2 + 4096, body.max_output_tokens);
}
export const committed = (ledger) => ledger.calls.reduce((sum, row) => sum + row.charged_jpy, 0);
export function reserve(ledger, id, body) {
  const digest = hash(body);
  const prior = ledger.calls.find(row => row.id === id);
  if (prior) {
    if (prior.request_hash !== digest) throw Error('Request changed under existing call ID');
    if (prior.status !== 'complete') throw Error('Uncertain/failed call reserved; no automatic retry');
    return prior;
  }
  const bound = ceiling(body);
  if (committed(ledger) + bound > ledger.cap_jpy) throw Error('Cumulative budget would be exceeded');
  const row = { id, request_hash: digest, model: body.model, reserved_jpy: bound, charged_jpy: bound, status: 'reserved', started_at: new Date().toISOString() };
  ledger.calls.push(row);
  return row;
}
export function settle(row, usage) {
  const actual = cost(row.model, usage?.input_tokens, usage?.output_tokens);
  row.usage = usage; row.charged_jpy = actual;
  if (actual > row.reserved_jpy) { row.status = 'bound_exceeded'; throw Error('Usage exceeded conservative reservation; stop'); }
}
