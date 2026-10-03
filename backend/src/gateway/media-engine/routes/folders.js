import { Router } from 'express';

const router = Router();

router.get('/:id', async (req, res) => {
  try {
    const engine = req.app.locals.mediaEngine;
    if (!engine) return res.status(500).json({ error: 'MEDIA_ENGINE_NOT_READY' });

    const folder = await engine.getFolder(req.params.id);
    if (!folder) return res.status(404).json({ error: 'NOT_FOUND' });

    res.json({
      id: folder.id,
      path: folder.path,
      name: folder.path?.split('/').pop() || '',
      parent_id: folder.parentId ?? folder.parent_id,
      depth: folder.depth,
      file_count: folder.fileCount ?? folder.file_count,
      total_size: folder.totalSize ?? folder.total_size,
      subfolder_count: folder.subfolderCount ?? folder.subfolder_count,
    });
  } catch (err) {
    console.error('[gateway:folders]', err);
    res.status(500).json({ error: 'INTERNAL', reason: err.message });
  }
});

export default router;
