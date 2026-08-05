import { Router } from 'express';
import multer from 'multer';
import { join, extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken } from '../middleware/auth.js';
import { uploadLimiter } from '../src/rateLimiter.js';
import { __dirname } from '../src/paths.js';

const USE_BLOB = process.env.NETLIFY === 'true' || process.env.DB_BLOB === 'true' || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

const storage = USE_BLOB
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: join(__dirname, '..', 'uploads'),
      filename: (req, file, cb) => {
        const ext = extname(file.originalname);
        cb(null, `${uuidv4()}${ext}`);
      },
    });

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const extOk = allowed.test(extname(file.originalname).toLowerCase());
    const mimeOk = allowed.test(file.mimetype);
    if (extOk && mimeOk) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

const router = Router();

async function saveBlobFile(buffer, ext) {
  const { getStore } = await import('@netlify/blobs');
  const store = getStore({ name: 'tradehub-uploads' });
  const filename = `${uuidv4()}${ext}`;
  await store.set(`uploads/${filename}`, buffer);
  return filename;
}

router.post('/', authenticateToken, uploadLimiter, upload.array('images', 6), async (req, res) => {
  try {
    const files = [];
    for (const f of req.files) {
      if (USE_BLOB) {
        const filename = await saveBlobFile(f.buffer, extname(f.originalname));
        files.push({ url: `/uploads/${filename}`, filename });
      } else {
        files.push({ url: `/uploads/${f.filename}`, filename: f.filename });
      }
    }
    res.json({ files });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

router.post('/single', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (USE_BLOB) {
      const filename = await saveBlobFile(req.file.buffer, extname(req.file.originalname));
      return res.json({ file: { url: `/uploads/${filename}`, filename } });
    }
    res.json({
      file: {
        url: `/uploads/${req.file.filename}`,
        filename: req.file.filename,
      }
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

export default router;
