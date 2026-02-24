const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const CARDS_PATH = path.join(ROOT, 'data', 'cards.json');
const PROGRESS_PATH = path.join(ROOT, 'data', 'progress.json');

const categories = [
  { id: 'vocabulary', label: '📖 Kata' },
  { id: 'sentences', label: '💬 Kalimat' },
  { id: 'conversation', label: '🗣 Percakapan' },
  { id: 'grammar', label: '🧠 Grammar dasar' }
];

const languages = ['Indonesia', 'English', 'Japanese', 'Korean'];

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function readCards() {
  return JSON.parse(fs.readFileSync(CARDS_PATH, 'utf8'));
}

function readProgress() {
  return JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));
}

function writeProgress(value) {
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(value, null, 2));
}

function ensureProfile(db, profileId) {
  if (!db.profiles[profileId]) {
    db.profiles[profileId] = { learnedByDate: {}, difficultByDate: {} };
  }
  return db.profiles[profileId];
}

function seededShuffle(items, seedText) {
  const output = [...items];
  let seed = 0;
  for (let i = 0; i < seedText.length; i += 1) seed += seedText.charCodeAt(i);
  for (let i = output.length - 1; i > 0; i -= 1) {
    seed = (seed * 9301 + 49297) % 233280;
    const j = Math.floor((seed / 233280) * (i + 1));
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function streakCount(learnedByDate) {
  let streak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  while (true) {
    const key = cursor.toISOString().slice(0, 10);
    if (!learnedByDate[key] || learnedByDate[key].length === 0) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function handleApi(req, res, urlObj) {
  if (req.method === 'GET' && urlObj.pathname === '/api/meta') {
    return json(res, 200, { languages, categories });
  }

  if (req.method === 'GET' && urlObj.pathname === '/api/cards') {
    const profileId = urlObj.searchParams.get('profileId') || 'guest';
    const date = urlObj.searchParams.get('date') || todayKey();
    const nativeLanguage = urlObj.searchParams.get('native') || 'Indonesia';
    const targetLanguage = urlObj.searchParams.get('target') || 'English';
    const category = urlObj.searchParams.get('category') || 'all';
    const undoneOnly = urlObj.searchParams.get('undoneOnly') === 'true';

    const cards = readCards();
    const db = readProgress();
    const profile = ensureProfile(db, profileId);
    const learned = new Set(profile.learnedByDate[date] || []);

    let ordered = seededShuffle(cards, `${profileId}-${date}`);
    if (category !== 'all') ordered = ordered.filter(card => card.category === category);
    if (undoneOnly) ordered = ordered.filter(card => !learned.has(card.id));

    const hydrated = ordered.map(card => ({
      id: card.id,
      category: card.category,
      target: card.translations[targetLanguage] || card.translations.English,
      native: card.translations[nativeLanguage] || card.translations.Indonesia,
      example: card.examples[nativeLanguage] || card.examples.Indonesia
    }));

    return json(res, 200, { cards: hydrated, totalAllCards: cards.length, learnedToday: learned.size, date });
  }

  if (req.method === 'POST' && urlObj.pathname === '/api/progress/mark') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const payload = JSON.parse(body || '{}');
      const { profileId, date, cardId, status } = payload;
      if (!profileId || !date || !cardId) return json(res, 400, { error: 'Invalid payload' });
      const db = readProgress();
      const profile = ensureProfile(db, profileId);
      if (!profile.learnedByDate[date]) profile.learnedByDate[date] = [];
      if (!profile.difficultByDate[date]) profile.difficultByDate[date] = [];

      if (status === 'learned') {
        if (!profile.learnedByDate[date].includes(cardId)) profile.learnedByDate[date].push(cardId);
        profile.difficultByDate[date] = profile.difficultByDate[date].filter(id => id !== cardId);
      } else if (status === 'difficult') {
        if (!profile.difficultByDate[date].includes(cardId)) profile.difficultByDate[date].push(cardId);
      }
      writeProgress(db);
      return json(res, 200, { ok: true });
    });
    return;
  }

  if (req.method === 'POST' && urlObj.pathname === '/api/progress/reset') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const { profileId } = JSON.parse(body || '{}');
      if (!profileId) return json(res, 400, { error: 'profileId required' });
      const db = readProgress();
      db.profiles[profileId] = { learnedByDate: {}, difficultByDate: {} };
      writeProgress(db);
      return json(res, 200, { ok: true });
    });
    return;
  }

  if (req.method === 'GET' && urlObj.pathname.startsWith('/api/progress/')) {
    const profileId = urlObj.pathname.split('/').pop();
    const db = readProgress();
    const profile = ensureProfile(db, profileId);
    const cards = readCards();
    const totalLearned = Object.values(profile.learnedByDate).reduce((acc, arr) => acc + arr.length, 0);
    const possible = Object.keys(profile.learnedByDate).length * cards.length;
    const completionRate = possible ? Math.round((totalLearned / possible) * 100) : 0;
    const today = todayKey();
    const learnedToday = profile.learnedByDate[today]?.length || 0;
    const difficultToday = profile.difficultByDate[today]?.length || 0;

    return json(res, 200, {
      totalLearned,
      completionRate,
      streak: streakCount(profile.learnedByDate),
      difficultToday,
      learnedToday,
      totalCards: cards.length
    });
  }

  return false;
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  if (urlObj.pathname.startsWith('/api/')) {
    const handled = handleApi(req, res, urlObj);
    if (handled === false) json(res, 404, { error: 'Not found' });
    return;
  }

  let filePath = path.join(ROOT, urlObj.pathname === '/' ? '/index.html' : urlObj.pathname);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Daily Language Card server running on http://0.0.0.0:${PORT}`);
});
