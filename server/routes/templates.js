import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

router.get('/', authenticateToken, (req, res) => {
  try {
    const templates = db.prepare(
      'SELECT * FROM templates WHERE user_id = ? ORDER BY created_at DESC'
    ).all(req.user.id);
    res.json({ templates });
  } catch (err) {
    console.error('Get templates error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', authenticateToken, (req, res) => {
  try {
    const { name, title, description, price, category, condition, quantity, sale_price, variants } = req.body;
    if (!name) return res.status(400).json({ error: 'Template name required' });

    const id = uuidv4();
    db.prepare(`
      INSERT INTO templates (id, user_id, name, title, description, price, category, condition, quantity, sale_price, variants)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.user.id, name, title || '', description || '', price || '', category || '', condition || '', quantity || 1, sale_price || '', JSON.stringify(variants || []));

    const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
    res.status(201).json({ template });
  } catch (err) {
    console.error('Create template error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', authenticateToken, (req, res) => {
  try {
    db.prepare('DELETE FROM templates WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete template error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
