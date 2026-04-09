import { Router } from 'express';
import { AdbService } from '../services/AdbService';

const router = Router();
const adb = new AdbService();

router.get('/status', async (_req, res) => {
  const info = await adb.getDeviceStatus();
  res.json(info);
});

router.get('/browse', async (req, res) => {
  const phonePath = (req.query.path as string) || '/sdcard';

  const entries = await adb.listDirectory(phonePath);

  // Calculate parent path, stopping at filesystem root
  let parent: string | null = null;
  if (phonePath !== '/') {
    const parts = phonePath.split('/').filter(Boolean);
    parent = parts.length > 1 ? '/' + parts.slice(0, -1).join('/') : '/';
  }

  res.json({ path: phonePath, parent, entries });
});

export default router;
