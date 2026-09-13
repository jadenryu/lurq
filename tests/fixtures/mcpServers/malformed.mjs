// Raw JSON-RPC over stdio, because the SDK server refuses to send what this one
// sends: nameless and duplicate tools, a mistyped annotation, a schema nested
// past any sane depth, a pagination cursor that loops, and a failing prompt list.
import readline from 'node:readline';

const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
const deep = (n) => (n === 0 ? { type: 'string' } : { type: 'object', properties: { x: deep(n - 1) } });

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.id === undefined) return;
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: msg.params.protocolVersion,
        capabilities: { tools: {}, prompts: {} },
        serverInfo: { name: 'fixture-malformed', version: '0.0.1' },
      },
    });
  } else if (msg.method === 'tools/list') {
    const cursor = msg.params?.cursor;
    const tools = cursor
      ? [{ name: 'second', annotations: { readOnlyHint: 'yes', destructiveHint: false } }]
      : [
          { name: 'ok', inputSchema: { type: 'object' } },
          { description: 'no name' },
          42,
          { name: 'ok', description: 'a duplicate' },
          { name: 'deep', inputSchema: deep(100) },
        ];
    send({ jsonrpc: '2.0', id: msg.id, result: { tools, nextCursor: 'page-2' } });
  } else if (msg.method === 'prompts/list') {
    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: 'prompt store offline' } });
  } else {
    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
  }
});
