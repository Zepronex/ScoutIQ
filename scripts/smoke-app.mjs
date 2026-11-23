import { pathToFileURL } from 'node:url';

const DEFAULT_API_BASE_URL = 'http://localhost:3001';
const DEFAULT_WEB_BASE_URL = 'http://localhost:3000';
const DEFAULT_TIMEOUT_MS = 5000;

export function readSmokeConfig(env = process.env) {
  return {
    apiBaseUrl: stripTrailingSlash(env.SCOUTIQ_API_URL ?? DEFAULT_API_BASE_URL),
    webBaseUrl: stripTrailingSlash(env.SCOUTIQ_WEB_URL ?? DEFAULT_WEB_BASE_URL),
    timeoutMs: readPositiveInteger(env.SCOUTIQ_SMOKE_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS,
    requireReady: env.SCOUTIQ_SMOKE_REQUIRE_READY === '1'
  };
}

export function createSmokeChecks(config = readSmokeConfig()) {
  return [
    {
      name: 'API health',
      url: `${config.apiBaseUrl}/api/health`,
      validate: validateHealthResponse
    },
    {
      name: 'Agent status',
      url: `${config.apiBaseUrl}/api/agent/status`,
      validate: body => validateSuccessEnvelope(body, 'agent status')
    },
    {
      name: 'Evaluation latest',
      url: `${config.apiBaseUrl}/api/evaluation/latest`,
      validate: validateEvaluationLatestResponse
    },
    {
      name: 'Frontend root',
      url: `${config.webBaseUrl}/`,
      validate: validateFrontendHtml,
      verifyEntry: true
    },
    {
      name: 'Frontend evaluation route',
      url: `${config.webBaseUrl}/evaluation`,
      validate: validateFrontendHtml
    },
    {
      name: 'Frontend analyze route',
      url: `${config.webBaseUrl}/analyze`,
      validate: validateFrontendHtml
    },
    {
      name: 'Frontend player rankings route',
      url: `${config.webBaseUrl}/top-players`,
      validate: validateFrontendHtml
    },
    ...(config.requireReady ? [
      {
        name: 'FPL gameweek readiness',
        url: `${config.apiBaseUrl}/api/ready`,
        validate: body => body?.status === 'ready' && Number.isInteger(body.gameweek?.runId)
          ? passed() : failed('current gameweek projections are unavailable')
      },
      {
        name: 'Current player projections',
        url: `${config.apiBaseUrl}/api/predictions/planning`,
        validate: body => body?.success === true && body.data?.source === 'fpl' && body.data.players?.length > 0
          ? passed() : failed('no current FPL player projections')
      }
    ] : [])
  ];
}

export async function runSmokeChecks({
  config = readSmokeConfig(),
  checks = createSmokeChecks(config),
  fetchImpl = fetch,
  writer = process.stdout
} = {}) {
  const results = [];

  for (const check of checks) {
    const result = await runSmokeCheck(check, { fetchImpl, timeoutMs: config.timeoutMs });
    results.push(result);
    writer.write(`${result.ok ? 'PASS' : 'FAIL'} ${check.name} ${check.url}${result.ok ? '' : ` - ${result.error}`}\n`);
  }

  return results;
}

export async function runSmokeCheck(check, { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  try {
    const signal = AbortSignal.timeout(timeoutMs);
    const response = await fetchImpl(check.url, { signal });
    const contentType = response.headers.get('content-type') ?? '';
    const body = contentType.includes('application/json') ? await response.json() : await response.text();

    if (!response.ok) {
      return {
        ok: false,
        name: check.name,
        url: check.url,
        status: response.status,
        error: `HTTP ${response.status}${typeof body?.status === 'string' ? ` (${body.status})` : ''}`
      };
    }

    let validation = check.validate(body);
    if (validation.ok && check.verifyEntry) {
      const entry = await fetchImpl(new URL(readEntryScript(body), check.url), { signal });
      if (!entry.ok || !/javascript|ecmascript/.test(entry.headers.get('content-type') ?? '')) {
        validation = failed('frontend entry returned a non-JavaScript response');
      }
      await entry.body?.cancel();
    }

    return {
      ok: validation.ok,
      name: check.name,
      url: check.url,
      status: response.status,
      error: validation.ok ? null : validation.error
    };
  } catch (error) {
    return {
      ok: false,
      name: check.name,
      url: check.url,
      status: null,
      error: error instanceof Error ? error.message : 'Unknown smoke-test error'
    };
  }
}

export function validateHealthResponse(body) {
  if (!isRecord(body)) {
    return failed('health response is not a JSON object');
  }

  if (body.status !== 'ok') {
    return failed('health status is not ok');
  }

  if (typeof body.service !== 'string' || body.service.length === 0) {
    return failed('health service is missing');
  }

  if (typeof body.timestamp !== 'string' || Number.isNaN(Date.parse(body.timestamp))) {
    return failed('health timestamp is invalid');
  }

  if ('version' in body && typeof body.version !== 'string') {
    return failed('health version is not a string');
  }

  return passed();
}

export function validateEvaluationLatestResponse(body) {
  const envelope = validateSuccessEnvelope(body, 'evaluation latest');
  if (!envelope.ok) {
    return envelope;
  }

  if (!isRecord(body.data)) {
    return failed('evaluation latest data is missing');
  }

  if (!Array.isArray(body.data.requiredCommands)) {
    return failed('evaluation setup commands are missing');
  }

  if (!('latestRun' in body.data)) {
    return failed('evaluation latestRun field is missing');
  }

  return passed();
}

export function validateFrontendHtml(body) {
  if (typeof body !== 'string') {
    return failed('frontend response is not HTML text');
  }

  if (!body.includes('<div id="root"></div>')) {
    return failed('frontend root mount is missing');
  }

  if (!readEntryScript(body)) {
    return failed('frontend entry script is missing');
  }

  return passed();
}

function readEntryScript(body) {
  const entry = body.match(/<script\b(?=[^>]*\btype="module")[^>]*\bsrc="([^"]+)"/)?.[1];
  return entry === '/src/main.tsx' || /^\/assets\/[a-zA-Z0-9_.-]+\.js$/.test(entry ?? '') ? entry : null;
}

function validateSuccessEnvelope(body, label) {
  if (!isRecord(body)) {
    return failed(`${label} response is not a JSON object`);
  }

  if (body.success !== true) {
    return failed(`${label} success flag is not true`);
  }

  if (!('data' in body)) {
    return failed(`${label} data field is missing`);
  }

  return passed();
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function passed() {
  return { ok: true, error: null };
}

function failed(error) {
  return { ok: false, error };
}

function readPositiveInteger(value) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

async function main() {
  const results = await runSmokeChecks();
  const failures = results.filter(result => !result.ok);

  if (failures.length > 0) {
    process.stderr.write(`Smoke test failed: ${failures.length} check(s) failed.\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write('Smoke test passed.\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Smoke test failed.'}\n`);
    process.exitCode = 1;
  });
}
