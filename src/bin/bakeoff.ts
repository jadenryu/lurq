import { readFileSync, writeFileSync } from 'fs';
import { createDb } from '../db/client';
import { handlePlan } from '../mcp/plan';
import { LocalSandbox } from '../sandbox';
import { getConfig } from '../core/config';
import { httpRequest } from '../core/http';


/*
  Author: Shivansh Singh
  - Testing among 3 different latest GPT-models against Lurq.run
  - We have mechanism to toggle between live DB and local DB
  - Our prompts are coming from bakeoff-spec.json
*/

async function runBakeOff() {
  const specs = JSON.parse(readFileSync('tests/integration/bakeoff-specs.json', 'utf8'));
  const dbHandler = createDb();
  const sandbox = new LocalSandbox();
  const results = [];
  const config = getConfig();

  // const TEST_MODELS = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'];
  const TEST_MODELS = ['gpt-4o', 'gpt-4-turbo', 'gpt-4o-mini'];

  try {
    for (const spec of specs) {
      console.log(`\n Testing spec: ${spec.id}`);
      
      const baselineOutcomes = [];

      // TEST 1: The AI Baseline (No Lurq)
      for (const model of TEST_MODELS) {
        console.log(`\nGetting baseline recommendations for ${model}...`);
        
        try {
          const rawLLMPackages = await fetchWithTimeout(getLLMBaseLine(spec.document, model), 15000);
          console.log(`Baseline LLM (${model}) picked: ${rawLLMPackages.join(',')}`);

          // Testing compatibility by installing the baseline stack
          console.log(`Running npm install on baseline stack for ${model}...`);
          const baselineSandboxPackages = rawLLMPackages.map((name: any) => ({ name, version: null }));
          const baselineResult = await sandbox.verifySet(baselineSandboxPackages, {
            target: { node: '20', moduleSystem: 'esm' },
          });

          if (baselineResult.installed) {
            console.log(`Baseline (${model}) Install successful!`);
          } else {
            console.log(`Baseline (${model}) install failed!`);
          }

          baselineOutcomes.push({
            model,
            packages: rawLLMPackages,
            installSuccess: baselineResult.installed,
            installTimeMs: baselineResult.durationMs,
            error: baselineResult.error ?? null
          });

        } catch (err: any) {
          console.log(`Baseline (${model}) failed or timed out: ${err.message}`);
          baselineOutcomes.push({
            model,
            packages: [],
            installSuccess: false,
            installTimeMs: 0,
            error: err.message
          });
        }
      }

      // TEST 2: Hitting the Global Lurq API (api.lurq.run)
      let plan;

      if (config.USE_LIVE_API === 'true') {
        console.log(`Asking global lurq index for a plan...`);
        const { data: mcpResponse } = await httpRequest<any>('https://api.lurq.run/mcp', {
          host: 'api.lurq.run',
          method: 'POST',
          ttlMs: 0,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.LURQ_API_KEY}`,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name: 'plan',
              arguments: { document: spec.document },
            },
          }),
        });
        if (mcpResponse.error || mcpResponse.isError) {
          console.log(`Failed to plan: ${JSON.stringify(mcpResponse.error)}`);
          continue;
        }
        plan = JSON.parse(mcpResponse.result.content[0].text);
      } else {
        console.log(`Asking local lurq index for a plan...`);
        plan = await handlePlan(dbHandler.db, { document: spec.document });
      }

      if (!plan || !('slots' in plan)) {
        console.log(`Failed to plan: ${plan.note}`);
        continue;
      }

      // Extracting the recommended package names
      const recommendedPackages = plan.slots
        .filter((s: any) => s.recommended)
        .map((s: any) => ({
          name: s.recommended!.name,
          version: s.recommended!.latestVersion ?? null,
        }));

      console.log(`Lurq picked: ${recommendedPackages.map((p: any) => p.name).join(',')}`);

      // Testing compatibility by installing the stack in local sandbox
      console.log(`Running npm install in sandbox...`);
      const installResult = await sandbox.verifySet(recommendedPackages, {
        target: {
          node: '20',
          moduleSystem: 'esm',
        },
      });

      // Recording the outcome
      const outcome = {
        id: spec.id,
        baselineOutcomes,
        lurqPackages: recommendedPackages.map((p: any) => p.name),
        lurqInstallSuccess: installResult.installed,
        lurqInstallTimeMs: installResult.durationMs,
        lurqError: installResult.error ?? null,
      };

      results.push(outcome);

      if (installResult.installed) {
        console.log(`Install successful`);
      } else {
        console.log(`Install failed due to peer-dependency/engine conflicts.`);
      }

      // Saving the final report
      writeFileSync('bakeoff_results.json', JSON.stringify(results, null, 2));
    }
  } finally {
    await dbHandler.close();
  }
}

async function getLLMBaseLine(document: string, modelName: string): Promise<string[]> {
  const config = getConfig();
  if (!config.SUMMARY_API_KEY) {
    throw new Error(`Please add SUMMARY_API_KEY to your .env to run the baseline test.`);
  }

  const prompt = `You are an AI coding assistant. The user wants to build this app:\n\n${document}\n\nReturn a JSON object with a single key
        "packages" containing an array of strings (the npm package names you recommend). No other text.`;

  const { data } = await httpRequest<any>(
    `${config.SUMMARY_BASE_URL.replace(/\/$/, '')}/chat/completions`,
    {
      host: new URL(config.SUMMARY_BASE_URL).host,
      method: 'POST',
      ttlMs: 0, // We don't need caching for the test
      headers: {
        Authorization: `Bearer ${config.SUMMARY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      }),
    },
  );
  try {
    const content = data?.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);
    return Array.isArray(parsed.packages) ? parsed.packages : [];
  } catch (err) {
    console.error(`LLM BASELINE failed to parse JSON`, err);
    return [];
  }
}
const fetchWithTimeout = (promise: Promise<any>, ms: number) => {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Request timeout')), ms)
  );
  return Promise.race([promise, timeout]);
};


runBakeOff().catch(console.error);
