import { Router } from 'express';
import { SafeguardService } from '../safeguard.js';
import { runBenchmark, BENCHMARK_TRACES } from '../benchmark.js';

export function benchmarkRoutes(deps) {
  const router = Router();
  let benchmarkRunning = false;
  let benchmarkAbort = null; // AbortController for current run

  router.get('/api/benchmark/cases', (_req, res) => {
    res.json({
      cases: BENCHMARK_TRACES.length,
      traces: BENCHMARK_TRACES.map(t => ({
        id: t.id, label: t.label, expected: t.expected,
        traceLength: t.trace.length, tools: t.trace.map(s => s.tool)
      }))
    });
  });

  router.get('/api/benchmark/results', (_req, res) => {
    try {
      const all = deps.getBenchmarkStore().getAll();
      res.json({ results: all });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/benchmark/abort', (_req, res) => {
    if (!benchmarkRunning || !benchmarkAbort) {
      return res.json({ ok: false, error: 'No benchmark running' });
    }
    benchmarkAbort.abort();
    res.json({ ok: true });
  });

  router.get('/api/benchmark/run', async (req, res) => {
    if (benchmarkRunning) return res.status(409).json({ error: 'Benchmark already running' });
    benchmarkRunning = true;
    benchmarkAbort = new AbortController();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Abort if client disconnects
    req.on('close', () => { if (benchmarkAbort) benchmarkAbort.abort(); });

    const requestedModel = req.query.model;
    const requestedBackend = req.query.backend || deps.getSafeguardService().backend;
    let testSafeguard = deps.getSafeguardService();
    if (requestedModel) {
      testSafeguard = new SafeguardService(
        process.env.ANTHROPIC_API_KEY, requestedBackend,
        { ...deps.getSafeguardService().config, lmstudioModel: requestedModel, ollamaModel: requestedModel }
      );
    }

    try {
      const result = await runBenchmark(testSafeguard, {
        signal: benchmarkAbort.signal,
        onProgress: (progress) => {
          try { res.write(`data: ${JSON.stringify({ type: 'progress', ...progress })}\n\n`); } catch {}
        }
      });

      // Persist result
      const modelName = requestedModel || 'default';
      try {
        deps.getBenchmarkStore().save(modelName, { ...result, backend: requestedBackend });
      } catch (e) {
        console.error('[GuardClaw] Failed to save benchmark result:', e.message);
      }

      res.write(`data: ${JSON.stringify({ type: 'complete', ...result })}\n\n`);
    } catch (err) {
      if (err.name === 'AbortError') {
        res.write(`data: ${JSON.stringify({ type: 'aborted', message: 'Benchmark aborted by user' })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
      }
    } finally {
      benchmarkRunning = false;
      benchmarkAbort = null;
      res.end();
    }
  });

  return router;
}
