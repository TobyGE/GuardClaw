import { Router } from 'express';
import { SafeguardService } from '../safeguard.js';
import { runBenchmark, BENCHMARK_TRACES } from '../benchmark.js';

export function benchmarkRoutes(deps) {
  const router = Router();
  let benchmarkRunning = false;

  router.get('/api/benchmark/cases', (_req, res) => {
    res.json({
      cases: BENCHMARK_TRACES.length,
      traces: BENCHMARK_TRACES.map(t => ({
        id: t.id, label: t.label, expected: t.expected,
        traceLength: t.trace.length, tools: t.trace.map(s => s.tool)
      }))
    });
  });

  router.get('/api/benchmark/run', async (req, res) => {
    if (benchmarkRunning) return res.status(409).json({ error: 'Benchmark already running' });
    benchmarkRunning = true;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

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
        onProgress: (progress) => res.write(`data: ${JSON.stringify({ type: 'progress', ...progress })}\n\n`)
      });
      res.write(`data: ${JSON.stringify({ type: 'complete', ...result })}\n\n`);
    } catch (err) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    } finally {
      benchmarkRunning = false;
      res.end();
    }
  });

  return router;
}
