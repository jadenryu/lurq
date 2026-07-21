#!/usr/bin/env tsx
/**
 * Test API connections to all three LLM providers.
 * 
 * Usage:
 *   npx tsx scripts/test-model-connections.ts
 * 
 * Reads from .env:
 *   - SUMMARY_API_KEY (OpenAI — already used by Lurq for embeddings/summaries)
 *   - CLAUDE_API_KEY (Anthropic)
 *   - GEMINI_API_KEY (Google)
 */
import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

interface TestResult {
  provider: string;
  model: string;
  status: 'ok' | 'error';
  responseSnippet?: string;
  error?: string;
  latencyMs: number;
}

const SIMPLE_PROMPT = 'Respond with exactly one word: "hello"';

// ── OpenAI ──────────────────────────────────────────────────────────────────

async function testOpenAI(model: string): Promise<TestResult> {
  const key = process.env.SUMMARY_API_KEY || process.env.EMBEDDING_API_KEY;
  if (!key) {
    return { provider: 'openai', model, status: 'error', error: 'No SUMMARY_API_KEY or EMBEDDING_API_KEY in .env', latencyMs: 0 };
  }

  const start = Date.now();
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: SIMPLE_PROMPT }],
        max_completion_tokens: 10,
      }),
    });

    const data = await res.json() as any;
    const latencyMs = Date.now() - start;

    if (!res.ok) {
      return { provider: 'openai', model, status: 'error', error: `HTTP ${res.status}: ${data?.error?.message ?? JSON.stringify(data)}`, latencyMs };
    }

    const text = data.choices?.[0]?.message?.content ?? '';
    const actualModel = data.model ?? model;
    return { provider: 'openai', model: actualModel, status: 'ok', responseSnippet: text.trim().slice(0, 50), latencyMs };
  } catch (err) {
    return { provider: 'openai', model, status: 'error', error: String(err), latencyMs: Date.now() - start };
  }
}

// ── Anthropic ───────────────────────────────────────────────────────────────

async function testAnthropic(model: string): Promise<TestResult> {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) {
    return { provider: 'anthropic', model, status: 'error', error: 'No CLAUDE_API_KEY in .env', latencyMs: 0 };
  }

  const start = Date.now();
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: SIMPLE_PROMPT }],
        max_tokens: 10,
      }),
    });

    const data = await res.json() as any;
    const latencyMs = Date.now() - start;

    if (!res.ok) {
      return { provider: 'anthropic', model, status: 'error', error: `HTTP ${res.status}: ${data?.error?.message ?? JSON.stringify(data)}`, latencyMs };
    }

    const text = data.content?.[0]?.text ?? '';
    const actualModel = data.model ?? model;
    return { provider: 'anthropic', model: actualModel, status: 'ok', responseSnippet: text.trim().slice(0, 50), latencyMs };
  } catch (err) {
    return { provider: 'anthropic', model, status: 'error', error: String(err), latencyMs: Date.now() - start };
  }
}

// ── Google Gemini ───────────────────────────────────────────────────────────

async function testGemini(model: string): Promise<TestResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return { provider: 'gemini', model, status: 'error', error: 'No GEMINI_API_KEY in .env', latencyMs: 0 };
  }

  const start = Date.now();
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: SIMPLE_PROMPT }] }],
        generationConfig: { maxOutputTokens: 10, temperature: 0 },
      }),
    });

    const data = await res.json() as any;
    const latencyMs = Date.now() - start;

    if (!res.ok) {
      return { provider: 'gemini', model, status: 'error', error: `HTTP ${res.status}: ${data?.error?.message ?? JSON.stringify(data)}`, latencyMs };
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return { provider: 'gemini', model, status: 'ok', responseSnippet: text.trim().slice(0, 50), latencyMs };
  } catch (err) {
    return { provider: 'gemini', model, status: 'error', error: String(err), latencyMs: Date.now() - start };
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== LLM Provider Connection Test ===\n');
  console.log('Keys detected:');
  console.log(`  SUMMARY_API_KEY:   ${process.env.SUMMARY_API_KEY ? '✓ set' : '✗ missing'}`);
  console.log(`  EMBEDDING_API_KEY: ${process.env.EMBEDDING_API_KEY ? '✓ set' : '✗ missing'}`);
  console.log(`  CLAUDE_API_KEY:    ${process.env.CLAUDE_API_KEY ? '✓ set' : '✗ missing'}`);
  console.log(`  GEMINI_API_KEY:    ${process.env.GEMINI_API_KEY ? '✓ set' : '✗ missing'}`);
  console.log('');

  const tests: Promise<TestResult>[] = [
    // OpenAI models
    testOpenAI('gpt-5.6-sol'),
    testOpenAI('gpt-5.6-terra'),
    testOpenAI('gpt-5.6-luna'),
    testOpenAI('gpt-5.5-2026-04-23'),
    // Anthropic models
    testAnthropic('claude-sonnet-5'),
    testAnthropic('claude-opus-4-8'),
    // Gemini models
    testGemini('gemini-3.1-pro-preview'),
  ];

  const results = await Promise.all(tests);

  console.log('--- Results ---\n');
  const pad = (s: string, n: number) => s.padEnd(n);

  console.log(`${pad('Provider', 12)} ${pad('Model', 28)} ${pad('Status', 8)} ${pad('Latency', 10)} Response / Error`);
  console.log('-'.repeat(100));

  for (const r of results) {
    const statusIcon = r.status === 'ok' ? '✅' : '❌';
    const detail = r.status === 'ok' ? r.responseSnippet : r.error;
    console.log(`${pad(r.provider, 12)} ${pad(r.model, 28)} ${statusIcon}${pad('', 5)} ${pad(r.latencyMs + 'ms', 10)} ${detail}`);
  }

  console.log('\n--- Recommendations ---\n');

  const working = results.filter(r => r.status === 'ok');
  const openaiOk = working.filter(r => r.provider === 'openai');
  const anthropicOk = working.filter(r => r.provider === 'anthropic');
  const geminiOk = working.filter(r => r.provider === 'gemini');

  if (openaiOk.length > 0) {
    const pick = openaiOk.find(r => r.model.includes('sol')) ?? openaiOk.find(r => r.model.includes('terra')) ?? openaiOk[0]!;
    console.log(`  OpenAI:    ${pick.model} (${pick.latencyMs}ms)`);
  } else {
    console.log('  OpenAI:    ❌ No working model found');
  }

  if (anthropicOk.length > 0) {
    const pick = anthropicOk.find(r => r.model.includes('sonnet')) ?? anthropicOk[0]!;
    console.log(`  Anthropic: ${pick.model} (${pick.latencyMs}ms)`);
  } else {
    console.log('  Anthropic: ❌ No working model found');
  }

  if (geminiOk.length > 0) {
    console.log(`  Gemini:    ${geminiOk[0]!.model} (${geminiOk[0]!.latencyMs}ms)`);
  } else {
    console.log('  Gemini:    ❌ No working model found');
  }

  const allOk = openaiOk.length > 0 && anthropicOk.length > 0 && geminiOk.length > 0;
  console.log(`\n${allOk ? '✅ All three providers have working models. Ready for Step 5.' : '⚠️  Some providers are missing. Check your .env keys.'}`);
}

main().catch(console.error);
