#!/usr/bin/env tsx
/**
 * Test API connections to all three LLM providers.
 *
 * Usage:
 *   npx tsx scripts/test-model-connections.ts
 *
 * Reads from .env:
 *   - OPENAI_API_KEY / SUMMARY_API_KEY / EMBEDDING_API_KEY
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
  const key =
    process.env.OPENAI_API_KEY || process.env.SUMMARY_API_KEY || process.env.EMBEDDING_API_KEY;
  if (!key) {
    return {
      provider: 'openai',
      model,
      status: 'error',
      error: 'No OPENAI_API_KEY, SUMMARY_API_KEY, or EMBEDDING_API_KEY in .env',
      latencyMs: 0,
    };
  }

  const start = Date.now();
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: SIMPLE_PROMPT }],
        max_completion_tokens: 16,
      }),
    });

    const data = (await res.json()) as any;
    const latencyMs = Date.now() - start;

    if (!res.ok) {
      return {
        provider: 'openai',
        model,
        status: 'error',
        error: `HTTP ${res.status}: ${data?.error?.message ?? JSON.stringify(data)}`,
        latencyMs,
      };
    }

    const text = data.choices?.[0]?.message?.content ?? '';
    const actualModel = data.model ?? model;
    return {
      provider: 'openai',
      model: actualModel,
      status: 'ok',
      responseSnippet: text.trim().slice(0, 50),
      latencyMs,
    };
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
        max_tokens: 16,
      }),
    });

    const data = (await res.json()) as any;
    const latencyMs = Date.now() - start;

    if (!res.ok) {
      return {
        provider: 'anthropic',
        model,
        status: 'error',
        error: `HTTP ${res.status}: ${data?.error?.message ?? JSON.stringify(data)}`,
        latencyMs,
      };
    }

    const text =
      data.content?.find((c: any) => c.type === 'text')?.text ??
      data.content?.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('') ??
      '';
    const actualModel = data.model ?? model;
    return {
      provider: 'anthropic',
      model: actualModel,
      status: 'ok',
      responseSnippet: text.trim().slice(0, 50) || `(connected; stop=${data.stop_reason ?? 'ok'})`,
      latencyMs,
    };
  } catch (err) {
    return {
      provider: 'anthropic',
      model,
      status: 'error',
      error: String(err),
      latencyMs: Date.now() - start,
    };
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
    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: 256,
      temperature: 0,
    };
    // Flash can disable thinking for a cheap ping; Pro requires thinking mode.
    if (model.includes('flash')) {
      generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: SIMPLE_PROMPT }] }],
        generationConfig,
      }),
    });

    const data = (await res.json()) as any;
    const latencyMs = Date.now() - start;

    if (!res.ok) {
      return {
        provider: 'gemini',
        model,
        status: 'error',
        error: `HTTP ${res.status}: ${data?.error?.message ?? JSON.stringify(data)}`,
        latencyMs,
      };
    }

    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .map((p: any) => p.text)
      .filter((t: unknown) => typeof t === 'string' && t.trim())
      .join('')
      .trim();
    const blockReason = data.candidates?.[0]?.finishReason ?? data.promptFeedback?.blockReason;
    if (!text) {
      // Connection still counts if the API accepted the model and returned a candidate.
      if (data.candidates?.[0]) {
        return {
          provider: 'gemini',
          model,
          status: 'ok',
          responseSnippet: `(connected; empty text, finish=${blockReason ?? 'unknown'})`,
          latencyMs,
        };
      }
      return {
        provider: 'gemini',
        model,
        status: 'error',
        error: `Empty response (finish/block: ${blockReason ?? JSON.stringify(data).slice(0, 200)})`,
        latencyMs,
      };
    }
    return {
      provider: 'gemini',
      model,
      status: 'ok',
      responseSnippet: text.slice(0, 50),
      latencyMs,
    };
  } catch (err) {
    return { provider: 'gemini', model, status: 'error', error: String(err), latencyMs: Date.now() - start };
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== LLM Provider Connection Test ===\n');
  console.log('Keys detected:');
  console.log(`  OPENAI_API_KEY:    ${process.env.OPENAI_API_KEY ? '✓ set' : '✗ missing'}`);
  console.log(`  SUMMARY_API_KEY:   ${process.env.SUMMARY_API_KEY ? '✓ set' : '✗ missing'}`);
  console.log(`  EMBEDDING_API_KEY: ${process.env.EMBEDDING_API_KEY ? '✓ set' : '✗ missing'}`);
  console.log(`  CLAUDE_API_KEY:    ${process.env.CLAUDE_API_KEY ? '✓ set' : '✗ missing'}`);
  console.log(`  GEMINI_API_KEY:    ${process.env.GEMINI_API_KEY ? '✓ set' : '✗ missing'}`);
  console.log('');

  // Landing-page everyday lineup first, then extras already used in prior smoke runs.
  const results = await Promise.all([
    testOpenAI('gpt-5.6-terra'),
    testOpenAI('gpt-5.6-sol'),
    testAnthropic('claude-sonnet-5'),
    testGemini('gemini-3.5-flash'),
    testGemini('gemini-3.1-pro-preview'),
  ]);

  console.log('--- Results ---\n');
  const pad = (s: string, n: number) => s.padEnd(n);

  console.log(
    `${pad('Provider', 12)} ${pad('Model', 28)} ${pad('Status', 8)} ${pad('Latency', 10)} Response / Error`,
  );
  console.log('-'.repeat(100));

  for (const r of results) {
    const statusIcon = r.status === 'ok' ? 'OK' : 'FAIL';
    const detail = r.status === 'ok' ? r.responseSnippet : r.error;
    console.log(
      `${pad(r.provider, 12)} ${pad(r.model, 28)} ${pad(statusIcon, 8)} ${pad(r.latencyMs + 'ms', 10)} ${detail}`,
    );
  }

  console.log('\n--- Landing-page lineup ---\n');

  const openaiTerra = results[0]!;
  const openaiSol = results[1]!;
  const claude = results[2]!;
  const gemFlash = results[3]!;
  const gemPro = results[4]!;

  const line = (label: string, r: TestResult) =>
    console.log(
      `  ${label.padEnd(22)} ${r.status === 'ok' ? 'OK' : 'FAIL'}  ${r.model}  (${r.latencyMs}ms)${r.status === 'error' ? ` — ${r.error}` : ''}`,
    );

  line('gpt-5.6-terra', openaiTerra);
  line('claude-sonnet-5', claude);
  line('gemini-3.5-flash', gemFlash);
  console.log('');
  line('gpt-5.6-sol (extra)', openaiSol);
  line('gemini-3.1-pro (extra)', gemPro);

  const coreOk =
    openaiTerra.status === 'ok' && claude.status === 'ok' && gemFlash.status === 'ok';
  console.log(
    `\n${coreOk ? 'All core models reachable. Safe to start the bakeoff.' : 'Fix failing keys/models before the full run.'}`,
  );
  process.exit(coreOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
