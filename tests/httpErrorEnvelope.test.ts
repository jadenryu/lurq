import { describe, it, expect } from 'vitest';
import { errorEnvelope } from '../src/mcp/http';

/**
 * Before the terminal error handler existed, a malformed body fell through to
 * Express's default handler and came back as an HTML page. Verified against
 * production at the time: `POST /mcp --data '{"bad"'` answered
 * `text/html` + `<pre>Bad Request</pre>`, so lurq's own parseRpcBody got
 * undefined and the user saw "failed with HTTP 400" with no reason.
 */
const parseError = () =>
  Object.assign(new SyntaxError('Unexpected end of JSON input'), {
    status: 400,
    type: 'entity.parse.failed',
  });

const tooLarge = () =>
  Object.assign(new Error('request entity too large'), {
    status: 413,
    type: 'entity.too.large',
  });

describe('errorEnvelope', () => {
  it('answers a malformed /mcp body with JSON-RPC, not HTML', () => {
    const { status, body, clientFault } = errorEnvelope(parseError(), '/mcp');
    expect(status).toBe(400);
    expect(clientFault).toBe(true);
    expect(body).toEqual({
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Request body is not valid JSON.' },
      id: null,
    });
  });

  it('uses the { error } shape on the dashboard and CI routes', () => {
    const { status, body } = errorEnvelope(parseError(), '/upgrade-plan');
    expect(status).toBe(400);
    expect(body).toEqual({ error: 'Request body is not valid JSON.' });
  });

  it('names the limit on an oversized body', () => {
    const { status, body } = errorEnvelope(tooLarge(), '/mcp');
    expect(status).toBe(413);
    expect((body as { error: { message: string } }).error.message).toContain('1mb');
  });

  it('never echoes a non-body error message, which may name internals', () => {
    const leaky = Object.assign(new Error('connect ECONNREFUSED 10.0.0.4:5432 (postgres)'), {
      status: 500,
    });
    const { status, body, clientFault } = errorEnvelope(leaky, '/keys');
    expect(status).toBe(500);
    expect(clientFault).toBe(false);
    expect(body).toEqual({ error: 'Internal error.' });
    expect(JSON.stringify(body)).not.toContain('10.0.0.4');
  });

  it('ignores a nonsense status rather than sending it downstream', () => {
    const weird = Object.assign(new Error('nope'), { status: 0 });
    expect(errorEnvelope(weird, '/keys').status).toBe(500);
  });
});
