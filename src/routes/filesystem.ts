import { Router } from 'express';
import path from 'path';
import { FileService } from '../services/FileService';

const router = Router();
const fileService = new FileService();

router.get('/roots', async (_req, res) => {
  const roots = await fileService.getRoots();
  res.json({ roots });
});

router.get('/browse', async (req, res) => {
  try {
    let dirPath = req.query.path as string;

    if (!dirPath) {
      const roots = await fileService.getRoots();
      dirPath = roots[0];
    }

    const entries = await fileService.listDirectory(dirPath);

    // parent is null when dirname === dirPath (e.g. C:\ or /)
    const parentPath = path.dirname(dirPath);
    const parent = parentPath !== dirPath ? parentPath : null;

    res.json({ path: dirPath, parent, entries });
  } catch {
    res.status(400).json({ error: 'Cannot read directory' });
  }
});

export default router;
