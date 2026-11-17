import db from '../db.js';

const KNOWN_CATEGORIES = ['electronics', 'fashion', 'gaming', 'furniture', 'sports', 'books', 'home', 'vehicles', 'other'];

const CATEGORY_KEYWORDS = {
  electronics: ['phone', 'laptop', 'computer', 'camera', 'headphone', 'headset', 'earbud', 'tablet', 'tv', 'speaker', 'console', 'keyboard', 'router', 'drone', 'tech'],
  fashion: ['shirt', 'dress', 'jacket', 'shoe', 'sneaker', 'bag', 'watch', 'jeans', 'hoodie', 'sweater', 'coat', 'hat', 'clothing'],
  gaming: ['nintendo', 'playstation', 'ps4', 'ps5', 'xbox', 'game', 'console', 'switch', 'gaming'],
  furniture: ['sofa', 'table', 'chair', 'desk', 'bed', 'shelf', 'cabinet', 'dresser', 'couch', 'lamp'],
  sports: ['bike', 'bicycle', 'ball', 'gym', 'yoga', 'fitness', 'dumbbell', 'skate', 'racket', 'weight'],
  books: ['book', 'novel', 'textbook'],
  home: ['pan', 'kitchen', 'vacuum', 'blender', 'towel', 'decor', 'plant', 'garden', 'mug'],
  vehicles: ['car', 'truck', 'motorcycle', 'bike', 'scooter', 'atv'],
};

const AUTO_DESCRIPTIONS = {
  electronics: 'In excellent working condition. Fully tested and functioning properly. Includes all original accessories and packaging. Minor signs of normal use.',
  fashion: 'Gently used item in great condition. Clean and well-maintained. No stains, tears, or significant wear. True to size. Perfect for everyday wear or special occasions.',
  gaming: 'Well-maintained and fully functional. Tested and working perfectly. Includes all cables and accessories. Minor cosmetic wear from normal use. Smoke-free environment.',
  furniture: 'Used but in great condition. Sturdy and structurally sound. Minor cosmetic wear consistent with normal use. Clean and ready for immediate use. Local pickup preferred.',
  sports: 'Used but well-maintained. Clean and in good working order. No major damage or defects. Ready for use. Price reflects normal wear and tear from regular use.',
  books: 'Used book in good condition. Pages are clean with no marking or highlighting. Cover shows minor wear. No missing pages. Great condition for the price.',
  home: 'Gently used item in good condition. Clean and well-cared for. No major defects or damage functions as intended. Ready to use in your home.',
  vehicles: 'Well-maintained and in good running condition. Regular maintenance performed. Clean title. No major mechanical issues. Available for inspection and test drive.',
  other: 'Used item in good condition. Clean and fully functional. Well-cared for and ready to use. Please see photos for details on condition.',
};

const CONDITION_LABELS = { new: 'new', like_new: 'like new', good: 'good', fair: 'fair' };

export const AI_PROVIDERS = ['openai', 'openai-compatible', 'anthropic', 'google'];

export const AI_PROMPT_DEFAULTS = {
  listing:
    'You are a marketplace listing copywriter. Write a compelling, honest secondhand listing. ' +
    'Respond with valid JSON ONLY, no prose, using this exact shape: ' +
    '{"title": string, "description": string (2-4 sentences, no emojis), "price": number|null}. ' +
    'Give a single integer price in Nigerian naira (NGN). If you cannot estimate a price, set price to null.',
  search:
    'You parse marketplace search phrases into filters. Respond with valid JSON ONLY: ' +
    '{"category": string (one of: {{categories}}, or "" if none), ' +
    '"minPrice": number|null, "maxPrice": number|null, "query": string (the cleaned, non-numeric keywords)}. ' +
    'Only set minPrice/maxPrice when the phrase clearly states a budget.',
  question:
    'You are a helpful, honest assistant answering a buyer question about a listing on TradeHub, a local buy-and-sell marketplace with escrow-protected payments. ' +
    'Answer in 2-4 short sentences. Be friendly, factual, and never invent details not present in the listing. ' +
    'If the question is about buying/shipping/meeting, suggest the buyer message the seller or check out via escrow.',
};

const DEFAULT_MODELS = {
  openai: 'gpt-4o-mini',
  'openai-compatible': 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
  google: 'gemini-1.5-flash',
};

function settingValue(key, fallback = '') {
  try {
    const row = db.prepare('SELECT value FROM platform_settings WHERE key = ?').get(key);
    if (row && row.value !== undefined && row.value !== null) return String(row.value);
  } catch {
    // The database may not be loaded yet during boot-time feature checks.
  }
  return fallback;
}

function normalizeProvider(value) {
  const raw = String(value || '').trim().toLowerCase();
  const aliases = {
    compatible: 'openai-compatible',
    custom: 'openai-compatible',
    gemini: 'google',
    'google-gemini': 'google',
    claude: 'anthropic',
  };
  const provider = aliases[raw] || raw;
  return AI_PROVIDERS.includes(provider) ? provider : 'openai';
}

function envApiKey(provider) {
  const byProvider = {
    openai: process.env.OPENAI_API_KEY,
    'openai-compatible': process.env.AI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    google: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
  };
  return String(byProvider[provider] || process.env.AI_API_KEY || '').trim();
}

function envBaseUrl(provider) {
  const byProvider = {
    openai: process.env.OPENAI_BASE_URL,
    'openai-compatible': process.env.AI_BASE_URL,
    anthropic: process.env.ANTHROPIC_BASE_URL,
    google: process.env.GOOGLE_BASE_URL,
  };
  return String(byProvider[provider] || process.env.AI_BASE_URL || '').trim();
}

export function aiConfig() {
  const provider = normalizeProvider(settingValue('ai_provider', process.env.AI_PROVIDER || 'openai'));
  const storedKey = settingValue('ai_api_key', '').trim();
  const fallbackKey = envApiKey(provider);
  const apiKey = storedKey || fallbackKey;
  return {
    enabled: settingValue('ai_enabled', '1') !== '0',
    provider,
    model: settingValue('ai_model', '').trim() || process.env.AI_MODEL || DEFAULT_MODELS[provider],
    baseUrl: settingValue('ai_base_url', '').trim() || envBaseUrl(provider),
    apiKey,
    apiKeySource: storedKey ? 'database' : fallbackKey ? 'environment' : 'none',
  };
}

export function hasLLM() {
  const config = aiConfig();
  return config.enabled && Boolean(config.apiKey);
}

function promptFor(settingKey, defaultKey, knownCategories = KNOWN_CATEGORIES) {
  const custom = settingValue(settingKey, '').trim();
  const prompt = custom || AI_PROMPT_DEFAULTS[defaultKey];
  return prompt.replace(/\{\{categories\}\}/g, knownCategories.join(', '));
}

function trimBaseUrl(baseUrl, fallback) {
  return String(baseUrl || fallback).replace(/\/+$/, '');
}

function parseJsonContent(content) {
  if (typeof content !== 'string') return null;
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch { return null; }
  }
}

function openAIEndpoint(baseUrl) {
  const base = trimBaseUrl(baseUrl, 'https://api.openai.com/v1');
  return /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`;
}

async function callOpenAICompatible(config, messages, { json, maxTokens, temperature, signal }) {
  const body = {
    model: config.model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };
  if (json) body.response_format = { type: 'json_object' };
  const res = await fetch(openAIEndpoint(config.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? null;
}

async function callAnthropic(config, messages, { maxTokens, temperature, signal }) {
  const base = trimBaseUrl(config.baseUrl, 'https://api.anthropic.com/v1');
  const endpoint = /\/messages$/i.test(base) ? base : `${base}/messages`;
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const body = {
    model: config.model,
    max_tokens: maxTokens,
    temperature,
    messages: messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
  };
  if (system) body.system = system;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!Array.isArray(data?.content)) return null;
  return data.content.filter((part) => part?.type === 'text').map((part) => part.text).join('') || null;
}

async function callGoogle(config, messages, { json, maxTokens, temperature, signal }) {
  const base = trimBaseUrl(config.baseUrl, 'https://generativelanguage.googleapis.com/v1beta');
  const endpoint = `${base}/models/${encodeURIComponent(config.model)}:generateContent`;
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const body = {
    contents: messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': config.apiKey,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) return null;
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  return parts.map((part) => part?.text || '').join('') || null;
}

async function llm(messages, { json = false, maxTokens = 500, temperature = 0.6 } = {}) {
  const config = aiConfig();
  if (!config.enabled || !config.apiKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  const options = { json, maxTokens, temperature, signal: controller.signal };
  try {
    let content;
    if (config.provider === 'anthropic') content = await callAnthropic(config, messages, options);
    else if (config.provider === 'google') content = await callGoogle(config, messages, options);
    else content = await callOpenAICompatible(config, messages, options);
    if (typeof content !== 'string' || !content.trim()) return null;
    return json ? parseJsonContent(content) : content.trim();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function clampPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

export function similarStats(category, { excludeIds = [], title = '' } = {}) {
  const exclusions = [excludeIds].flat().filter(Boolean);
  const placeholders = exclusions.map(() => '?').join(', ');
  const params = [];
  let rows = [];

  if (title) {
    const tokens = title.split(/\s+/).filter((t) => t.length > 2).slice(0, 3);
    if (tokens.length > 0) {
      const likeParts = tokens.map(() => `title LIKE ?`).join(' OR ');
      params.push(...tokens.map((t) => `%${t}%`));
      if (exclusions.length) {
        params.push(...exclusions);
        rows = db.prepare(
          `SELECT title, price FROM items WHERE (${likeParts}) AND status = 'active' AND price > 0 AND id NOT IN (${placeholders}) LIMIT 30`
        ).all(...params);
      } else {
        rows = db.prepare(
          `SELECT title, price FROM items WHERE (${likeParts}) AND status = 'active' AND price > 0 LIMIT 30`
        ).all(...params);
      }
    }
  }

  if (rows.length < 3 && category && category !== 'all') {
    const catParams = [category];
    let sql = `SELECT title, price FROM items WHERE category = ? AND status = 'active' AND price > 0`;
    if (exclusions.length) {
      catParams.push(...exclusions);
      sql += ` AND id NOT IN (${placeholders})`;
    }
    sql += ' LIMIT 30';
    rows = db.prepare(sql).all(...catParams);
  }

  if (rows.length < 2) return null;

  const prices = rows.map((r) => r.price).sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
  const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
  return {
    count: rows.length,
    avg: Math.round(avg * 100) / 100,
    median: Math.round(median * 100) / 100,
    min: prices[0],
    max: prices[prices.length - 1],
  };
}

export async function generateListing({ title = '', description = '', category = '', condition = '', imageHints = '' } = {}) {
  const stats = similarStats(category, { title });
  const aiData = await llm([
    {
      role: 'system',
      content: promptFor('ai_prompt_listing', 'listing'),
    },
    {
      role: 'user',
      content: `Title so far: "${title || '(not given)'}"\nCategory: ${category || 'other'}\nCondition: ${condition || 'good'}\nExisting description: "${description || '(empty)'}"${imageHints ? `\nVisual hints: ${imageHints}` : ''}${stats ? `\nMarket reference for the category: median ₦${stats.median}, range ₦${stats.min}-₦${stats.max} across ${stats.count} similar items.` : ''}`,
    },
  ], { json: true, maxTokens: 400 });

  if (aiData && (aiData.title || aiData.description)) {
    return {
      title: String(aiData.title || title).slice(0, 120),
      description: String(aiData.description || description).slice(0, 3000),
      price: clampPrice(aiData.price),
    };
  }

  const catKey = KNOWN_CATEGORIES.includes(category) ? category : 'other';
  return {
    title: title.slice(0, 120),
    description: description || `"${title}" - ${AUTO_DESCRIPTIONS[catKey]}`.slice(0, 3000),
    price: stats ? clampPrice(stats.median) : null,
  };
}

export async function parseSearch(query = '', knownCategories = KNOWN_CATEGORIES) {
  const aiData = await llm([
    {
      role: 'system',
      content: promptFor('ai_prompt_search', 'search', knownCategories),
    },
    { role: 'user', content: `Search phrase: "${query}"` },
  ], { json: true, maxTokens: 200 });

  if (aiData) {
    let category = aiData.category && knownCategories.includes(aiData.category) ? aiData.category : '';
    if (!category) {
      const lower = String(aiData.query || query).toLowerCase();
      for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
        if (words.some((w) => lower.includes(w))) { category = cat; break; }
      }
    }
    return {
      category,
      minPrice: clampPrice(aiData.minPrice) || '',
      maxPrice: clampPrice(aiData.maxPrice) || '',
      query: String(aiData.query || query).trim().slice(0, 120),
    };
  }

  const lower = String(query).toLowerCase();
  let category = '';
  for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
    if (words.some((w) => lower.includes(w))) { category = cat; break; }
  }
  let minPrice = '';
  let maxPrice = '';
  const rangeMatch = lower.match(/(?:\$)?(\d+)\s*[-–to]+\s*(?:\$)?(\d+)/);
  if (rangeMatch) {
    minPrice = clampPrice(rangeMatch[1]) || '';
    maxPrice = clampPrice(rangeMatch[2]) || '';
  } else {
    const under = lower.match(/(?:under|below|less than|max|up to|within)\s*(?:\$)?\s*(\d+)/);
    const over = lower.match(/(?:over|above|more than|from|min)\s*(?:\$)?\s*(\d+)/);
    if (under) maxPrice = clampPrice(under[1]) || '';
    if (over) minPrice = clampPrice(over[1]) || '';
  }
  const cleaned = query.replace(/under|below|less than|over|above|more than|from|up to|max|min|within|\$|\d+/gi, ' ').replace(/\s+/g, ' ').trim();
  return { category, minPrice, maxPrice, query: cleaned.slice(0, 120) };
}

export async function answerListingQuestion({ item, sellerName = '', question = '' }) {
  if (!item || !item.title) return 'Sorry, this listing could not be found.';
  const aiData = await llm([
    {
      role: 'system',
      content: promptFor('ai_prompt_question', 'question'),
    },
    {
      role: 'user',
      content:
        `Item: ${item.title}\nPrice: ₦${item.price}${item.sale_price ? ` (on sale: ₦${item.sale_price})` : ''}\nCondition: ${CONDITION_LABELS[item.condition] || item.condition || 'good'}\n` +
        `Location: ${item.location_address || 'local'}\nSeller: ${sellerName || 'a local seller'}\nDescription: ${String(item.description || '').slice(0, 600)}\n---\nBuyer question: ${question}`,
    },
  ], { maxTokens: 220, temperature: 0.4 });

  if (aiData) return aiData;

  const q = String(question).toLowerCase();
  if (/(still )?available|in stock|is this item/i.test(q)) {
    return `Yes — "${item.title}" is an active listing and should be available to buy. You can check out securely through TradeHub's escrow, which only releases payment once you confirm the item.`;
  }
  if (/condition|damage|scratch|defect|used/i.test(q)) {
    return `The item is listed in ${CONDITION_LABELS[item.condition] || item.condition || 'good'} condition. ${String(item.description).slice(0, 200) || ''} For precise details, send the seller a message from this listing.`;
  }
  if (/price|negotiate|discount|offer|cheaper|deal/.test(q)) {
    return `The listed price is ₦${Number(item.price).toLocaleString()}. You can make an offer through the app — the seller can accept, decline, or counter. Escrow keeps your money safe until the item is delivered to your satisfaction.`;
  }
  if (/ship|delivery|mail|deliver|post/.test(q)) {
    return `Shipping availability depends on the seller. Use the message button to ask about delivery options — if you agree on terms, TradeHub escrow protects your payment until the deal is completed.`;
  }
  if (/meet|pickup|location|where/.test(q)) {
    return `This item is listed near ${item.location_address || 'the seller'}. Reach out to the seller to arrange a local meetup — and check the safe-trading tips in the app before meeting.`;
  }
  return `"${item.title}" is listed for ₦${Number(item.price).toLocaleString()} in ${CONDITION_LABELS[item.condition] || 'good'} condition. For anything specific, the best next step is to message the seller through the app — every TradeHub transaction is protected by escrow.`;
}

export function priceGuide({ category = 'other', price, title = '', excludeId = '' } = {}) {
  const stats = similarStats(category, { excludeIds: excludeId ? [excludeId] : [], title: title || undefined });
  const p = clampPrice(price);

  if (!stats) {
    return {
      stats: null,
      advice: p
        ? `Not enough similar listings to compare yet. At ₦${p.toLocaleString()}, pricing ~10% above or below similar new-in-category items is a safe starting point.`
        : `Not enough similar listings to compare yet. Check what similar items sell for nearby, then set a fair price.`,
    };
  }

  const range = `₦${stats.min.toLocaleString()} – ₦${stats.max.toLocaleString()}`;
  let advice;
  if (!p) {
    advice = `Similar items range ${range} (median ₦${stats.median.toLocaleString()}, avg ₦${stats.avg.toLocaleString()}). Listing around the median is your best shot at a quick sale.`;
  } else {
    const diff = Math.round(((p - stats.median) / stats.median) * 100);
    const closeness = stats.median > 0 ? Math.abs(diff) : 100;
    if (closeness <= 10) {
      advice = `Your ₦${p.toLocaleString()} is right in line with ${stats.count} similar items (median ₦${stats.median.toLocaleString()}). Fairly priced.`;
    } else if (diff < 0) {
      advice = `Your ₦${p.toLocaleString()} is ~${Math.abs(diff)}% below the median ₦${stats.median.toLocaleString()} — priced to sell fast. Consider ₦${stats.median.toLocaleString()} if you want top value.`;
    } else {
      advice = `Your ₦${p.toLocaleString()} is ~${diff}% above the median ₦${stats.median.toLocaleString()}. You may need to negotiate; a sweet spot is around ₦${stats.median.toLocaleString()} (range ${range}).`;
    }
  }
  return { stats: { ...stats, range }, advice };
}

export async function recommendations({ userId = '', itemId = '', limit = 6 } = {}) {
  const take = Math.min(Math.max(Number(limit) || 6, 1), 20);
  let rows = [];
  const params = [];
  const excluded = [];

  if (itemId) {
    const base = db.prepare('SELECT id, category, price FROM items WHERE id = ?').get(itemId);
    if (base) {
      excluded.push(base.id);
      rows = db.prepare(
        `SELECT * FROM items WHERE status = 'active' AND category = ? AND id != ? AND price > 0
         ORDER BY ABS(price - ?) ASC, favorites DESC
         LIMIT ?`
      ).all(base.category, base.id, base.price || 0, take);
    }
  }

  if (rows.length === 0) {
    if (userId && userId !== 'currentUserId') excluded.push(userId);
    const excl = [excluded].flat().filter(Boolean);
    const placeholders = excl.map(() => '?').join(', ');
    let sql = `SELECT * FROM items WHERE status = 'active' AND price > 0`;
    const catParams = [...params];
    if (excl.length) sql += ` AND seller_id NOT IN (${placeholders})`;
    sql += ` ORDER BY CASE WHEN boosted = 1 THEN 0 ELSE 1 END, favorites DESC, views DESC, created_at DESC LIMIT ?`;
    rows = db.prepare(sql).all(...[...catParams, ...excl, take]);
  }

  return rows.map((row) => serializeItem(row));
}

function serializeItem(row) {
  const images = db.prepare('SELECT url FROM item_images WHERE item_id = ? ORDER BY sort_order, id').all(row.id);
  return { ...row, images: images.map((i) => i.url) };
}