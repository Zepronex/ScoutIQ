import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  readSmokeConfig,
  runSmokeCheck,
  validateEvaluationLatestResponse,
  validateFrontendHtml,
  validateHealthResponse
} from './smoke-app.mjs';

describe('smoke app helpers', () => {
  it('reads overridable smoke-test endpoints', () => {
    const config = readSmokeConfig({
      SCOUTIQ_API_URL: 'http://127.0.0.1:4001/',
      SCOUTIQ_WEB_URL: 'http://127.0.0.1:4000/',
      SCOUTIQ_SMOKE_TIMEOUT_MS: '2500'
    });

    assert.deepEqual(config, {
      apiBaseUrl: 'http://127.0.0.1:4001',
      webBaseUrl: 'http://127.0.0.1:4000',
      timeoutMs: 2500,
      requireReady: false
    });
  });

  it('validates the health response shape', () => {
    assert.equal(validateHealthResponse({
      status: 'ok',
      service: 'scoutiq-api',
      version: '1.0.0',
      timestamp: '2026-07-06T12:00:00.000Z'
    }).ok, true);

    assert.equal(validateHealthResponse({
      status: 'ok',
      service: 'scoutiq-api',
      timestamp: 'not-a-date'
    }).ok, false);
  });

  it('accepts evaluation empty-state responses', () => {
    assert.equal(validateEvaluationLatestResponse({
      success: true,
      data: {
        latestRun: null,
        latestPredictionRun: null,
        requiredCommands: ['pnpm run model:backtest'],
        limitations: [],
        warnings: ['No model evaluation data is loaded.']
      }
    }).ok, true);
  });

  it('validates Vite SPA route HTML', () => {
    assert.equal(validateFrontendHtml('<div id="root"></div><script type="module" src="/src/main.tsx"></script>').ok, true);
    assert.equal(validateFrontendHtml('<script type="module" crossorigin src="/assets/index.a123.js"></script><div id="root"></div>').ok, true);
    assert.equal(validateFrontendHtml('<html></html>').ok, false);
  });

  it('detects a production SPA rewrite swallowing its JavaScript entry', async () => {
    const html = '<div id="root"></div><script type="module" src="/assets/index.abc.js"></script>';
    const result = await runSmokeCheck({
      name: 'Production web', url: 'http://localhost/', validate: validateFrontendHtml, verifyEntry: true
    }, {
      fetchImpl: async () => new Response(html, { headers: { 'Content-Type': 'text/html' } })
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /non-JavaScript/);
  });

  it('reports failed fetch responses without throwing', async () => {
    const result = await runSmokeCheck({
      name: 'Example',
      url: 'http://localhost/example',
      validate: validateHealthResponse
    }, {
      timeoutMs: 100,
      fetchImpl: async () => new Response('not found', {
        status: 404,
        headers: { 'content-type': 'text/plain' }
      })
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    assert.equal(result.error, 'HTTP 404');
  });
});
