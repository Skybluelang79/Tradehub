import { Router } from 'express';
import multer from 'multer';
import { join, extname } from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken } from '../middleware/auth.js';
import { uploadLimiter } from '../src/rateLimiter.js';
import { __dirname } from '../src/paths.js';
import { uploadToFirebaseStorage } from '../src/firebase.js';

const USE_BLOB = process.env.NETLIFY === 'true' || process.env.DB_BLOB === 'true' || !!process.env.AWS_LAMBDA_FUNCTION_NAME;
const USE_FIREBASE_STORAGE = process.env.FIREBASE_STORAGE === 'true';

// Defaults to the repo, but a host with a persistent disk needs UPLOADS_DIR to
// point at it. Left on the ephemeral checkout, every uploaded image disappears
// on the next deploy. This must stay the same variable app.js serves from, or
// uploads are written to one directory and read from another.
const UPLOADS_DIR = process.env.UPLOADS_DIR || join(__dirname, '..', 'uploads');

if (!USE_BLOB && !USE_FIREBASE_STORAGE) {
  try {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  } catch (err) {
    console.error(`Could not create uploads dir ${UPLOADS_DIR}:`, err.message);
  }
}

const storage = (USE_BLOB || USE_FIREBASE_STORAGE)
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (req, file, cb) => cb(null, UPLOADS_DIR),
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

const IMAGE_TYPES = ['jpeg', 'jpg', 'png', 'gif', 'webp', 'bmp', 'svg'];
const DOC_TYPES = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'rtf', 'ppt', 'pptx', 'odt'];
const ARCHIVE_TYPES = ['zip', 'rar', '7z', 'tar', 'gz'];
const AUDIO_TYPES = ['mp3', 'm4a', 'wav', 'ogg', 'aac', 'opus', 'webm'];
const VIDEO_TYPES = ['mp4', 'mov', 'avi', 'mkv', 'webm'];

const chatAttachment = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase().replace('.', '');
    const allowed = [...IMAGE_TYPES, ...DOC_TYPES, ...ARCHIVE_TYPES, ...AUDIO_TYPES, ...VIDEO_TYPES];
    if (allowed.includes(ext) || file.mimetype.startsWith('image/') || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('File type not supported for chat attachments'));
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

async function storeSingle(file) {
  if (USE_FIREBASE_STORAGE) {
    const ext = extname(file.originalname);
    const path = `tradehub/uploads/${uuidv4()}${ext}`;
    const url = await uploadToFirebaseStorage(file.buffer, path, file.mimetype);
    return { url, filename: file.originalname };
  }
  if (USE_BLOB) {
    const filename = await saveBlobFile(file.buffer, extname(file.originalname));
    return { url: `/uploads/${filename}`, filename: file.originalname };
  }
  return { url: `/uploads/${file.filename}`, filename: file.originalname };
}

function attachmentKind(file) {
  const mime = file.mimetype || '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

router.post('/', authenticateToken, uploadLimiter, upload.array('images', 6), async (req, res) => {
  try {
    const files = [];
    for (const f of req.files) {
      if (USE_FIREBASE_STORAGE) {
        const ext = extname(f.originalname);
        const path = `tradehub/uploads/${uuidv4()}${ext}`;
        const url = await uploadToFirebaseStorage(f.buffer, path, f.mimetype);
        files.push({ url, filename: path });
      } else if (USE_BLOB) {
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
    const stored = await storeSingle(req.file);
    res.json({ file: stored });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

router.post('/attachment', authenticateToken, uploadLimiter, chatAttachment.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const stored = await storeSingle(req.file);
    res.json({
      file: {
        url: stored.url,
        filename: stored.filename || 'file',
        kind: attachmentKind(req.file),
        mime: req.file.mimetype || extname(req.file.originalname).replace('.', ''),
        size: req.file.size,
      }
    });
  } catch (err) {
    console.error('Attachment upload error:', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

export default router;