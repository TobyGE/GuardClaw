/**
 * API routes for built-in model management.
 */
import { Router } from 'express';
import engine from '../llm-engine.js';

const router = Router();

/** GET /api/models — list available models with status */
router.get('/', (req, res) => {
  res.json({ models: engine.listModels() });
});

/** POST /api/models/:id/download — start downloading a model */
router.post('/:id/download', async (req, res) => {
  try {
    // Respond immediately, download runs in background
    res.json({ status: 'downloading', modelId: req.params.id });
    engine.downloadModel(req.params.id).catch(err => {
      console.error(`[Models] Download failed for ${req.params.id}:`, err.message);
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/models/:id/cancel — cancel an ongoing download */
router.post('/:id/cancel', (req, res) => {
  engine.cancelDownload(req.params.id);
  res.json({ status: 'cancelled' });
});

/** DELETE /api/models/:id — delete a downloaded model */
router.delete('/:id', (req, res) => {
  try {
    engine.deleteModel(req.params.id);
    res.json({ status: 'deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/models/:id/load — load a model into memory */
router.post('/:id/load', async (req, res) => {
  try {
    const result = await engine.loadModel(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/models/:id/setup — download (if needed) + load in one step */
router.post('/:id/setup', async (req, res) => {
  try {
    // Respond immediately, setup runs in background
    res.json({ status: 'setting_up', modelId: req.params.id });
    engine.setupAndLoad(req.params.id).catch(err => {
      console.error(`[Models] Setup failed for ${req.params.id}:`, err.message);
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/models/unload — unload current model */
router.post('/unload', async (req, res) => {
  await engine.unload();
  res.json({ status: 'unloaded' });
});

/** GET /api/models/status — current engine status */
router.get('/status', (req, res) => {
  res.json({
    ready: engine.isReady,
    loadedModel: engine.loadedModelId,
    downloading: engine.listModels().filter(m => m.downloading),
  });
});

/** SSE endpoint for download progress */
router.get('/progress', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const onProgress = (data) => {
    res.write(`data: ${JSON.stringify({ type: 'progress', ...data })}\n\n`);
  };
  const onComplete = (data) => {
    res.write(`data: ${JSON.stringify({ type: 'complete', ...data })}\n\n`);
  };
  const onError = (data) => {
    res.write(`data: ${JSON.stringify({ type: 'error', ...data })}\n\n`);
  };

  engine.on('download-progress', onProgress);
  engine.on('download-complete', onComplete);
  engine.on('download-error', onError);

  req.on('close', () => {
    engine.off('download-progress', onProgress);
    engine.off('download-complete', onComplete);
    engine.off('download-error', onError);
  });
});

export default router;
