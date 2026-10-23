'use strict';
/* Behruz Vocab Trainer: Express + SQLite.
   Env: PORT, DATA_DIR (where vocab.db lives), ADMIN_KEY (teacher password), CLASS_CODE (optional join code). */
const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const CLASS_CODE = (process.env.CLASS_CODE || '').trim();
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'vocab.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS students(
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS days(
  id INTEGER PRIMARY KEY, badge TEXT NOT NULL, title TEXT NOT NULL, topic TEXT NOT NULL DEFAULT '',
  rows TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS progress(
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  day_id INTEGER NOT NULL REFERENCES days(id) ON DELETE CASCADE,
  state TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(student_id, day_id));
CREATE TABLE IF NOT EXISTS attempts(
  id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  day_id INTEGER NOT NULL REFERENCES days(id) ON DELETE CASCADE, session TEXT NOT NULL,
  pct INTEGER NOT NULL, stars INTEGER NOT NULL, correct INTEGER NOT NULL, total INTEGER NOT NULL,
  xp INTEGER NOT NULL, best_streak INTEGER NOT NULL, seconds INTEGER NOT NULL DEFAULT 0, misses TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ratings(
  student_id INTEGER PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  stars INTEGER NOT NULL, comment TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS att_student ON attempts(student_id, created_at);
`);

const now = () => Date.now();

/* ---------- seed the first days ---------- */
if (db.prepare('SELECT COUNT(*) c FROM days').get().c === 0) {
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'seed_days.json'), 'utf8'));
  const ins = db.prepare('INSERT INTO days(badge,title,topic,rows,sort,created_at) VALUES(?,?,?,?,?,?)');
  seed.forEach((d, i) => ins.run(d.badge, d.title, d.topic, JSON.stringify(d.rows), i + 1, now()));
  console.log('Seeded', seed.length, 'days');
}

/* ---------- parse pasted words: "English - Uzbek" per line, "# Topic" lines ---------- */
function parseWords(text) {
  const rows = [], bad = [];
  let sec = 'Vocabulary';
  String(text || '').split(/\r?\n/).forEach((line, n) => {
    line = line.trim();
    if (!line) return;
    if (line[0] === '#') { sec = line.replace(/^#+\s*/, '') || sec; return; }
    line = line.replace(/^\s*\d+\s*[.)]\s+/, '');
    let m = line.split('\t');
    if (m.length < 2) m = line.split(/\s+[-–—]\s+|\s*[=|;]\s*|\s*[–—]\s*/);
    if (m.length < 2) { bad.push(n + 1); return; }
    const en = m[0].trim(), uz = m.slice(1).join(' - ').trim();
    if (!en || !uz) { bad.push(n + 1); return; }
    rows.push([0, sec.slice(0, 80), en.slice(0, 120), uz.slice(0, 200)]);
  });
  return { rows, bad };
}

/* ---------- helpers ---------- */
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

function cookies(req) {
  const o = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return o;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const hits = new Map(); // tiny login rate limiter
function limited(key, max, ms) {
  const t = now(), a = (hits.get(key) || []).filter(x => t - x < ms);
  a.push(t); hits.set(key, a);
  return a.length > max;
}
setInterval(() => { const t = now(); for (const [k, a] of hits) if (!a.some(x => t - x < 3600e3)) hits.delete(k); }, 600e3).unref();

function auth(req, res, next) {
  const tok = cookies(req).sid;
  if (!tok) return res.status(401).json({ error: 'login' });
  const s = db.prepare('SELECT st.* FROM sessions se JOIN students st ON st.id=se.student_id WHERE se.token=?').get(tok);
  if (!s) return res.status(401).json({ error: 'login' });
  req.student = s;
  if (now() - s.last_seen > 60e3) db.prepare('UPDATE students SET last_seen=? WHERE id=?').run(now(), s.id);
  next();
}
function admin(req, res, next) {
  if (!ADMIN_KEY) return res.status(503).json({ error: 'ADMIN_KEY is not set on the server' });
  const k = Buffer.from(String(req.headers['x-admin-key'] || ''));
  const a = Buffer.from(ADMIN_KEY);
  if (k.length !== a.length || !crypto.timingSafeEqual(k, a)) {
    if (limited('adm:' + req.ip, 20, 600e3)) return res.status(429).json({ error: 'Too many tries' });
    return res.status(401).json({ error: 'Wrong key' });
  }
  next();
}
const dayInfo = d => {
  const n = JSON.parse(d.rows).length;
  return { id: d.id, badge: d.badge, title: d.title, topic: d.topic, words: n, sessions: Math.ceil(n / 25), hidden: !!d.hidden };
};

/* ---------- student API ---------- */
app.get('/api/config', (req, res) => res.json({ needsCode: !!CLASS_CODE }));

app.post('/api/login', (req, res) => {
  if (limited('login:' + req.ip, 30, 600e3)) return res.status(429).json({ error: 'Too many tries. Wait a few minutes.' });
  const email = String(req.body.email || '').trim().toLowerCase();
  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!EMAIL_RE.test(email) || email.length > 120) return res.status(400).json({ error: 'Please enter a valid email.' });
  if (name.length < 2) return res.status(400).json({ error: 'Please enter your name.' });
  if (CLASS_CODE && String(req.body.code || '').trim().toLowerCase() !== CLASS_CODE.toLowerCase())
    return res.status(403).json({ error: 'Wrong class code. Ask your teacher.' });
  let s = db.prepare('SELECT * FROM students WHERE email=?').get(email);
  if (!s) {
    const r = db.prepare('INSERT INTO students(email,name,created_at,last_seen) VALUES(?,?,?,?)').run(email, name, now(), now());
    s = { id: r.lastInsertRowid, email, name };
  } else {
    db.prepare('UPDATE students SET name=?, last_seen=? WHERE id=?').run(name, now(), s.id);
  }
  const tok = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token,student_id,created_at) VALUES(?,?,?)').run(tok, s.id, now());
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${180 * 86400}${secure}`);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const tok = cookies(req).sid;
  if (tok) db.prepare('DELETE FROM sessions WHERE token=?').run(tok);
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; Max-Age=0');
  res.json({ ok: true });
});

function ratingSummary(sid) {
  const a = db.prepare('SELECT AVG(stars) avg, COUNT(*) n FROM ratings').get();
  const mine = db.prepare('SELECT stars FROM ratings WHERE student_id=?').get(sid);
  return { avg: a.n ? Math.round(a.avg * 10) / 10 : 0, count: a.n, mine: mine ? mine.stars : 0 };
}

app.get('/api/bootstrap', auth, (req, res) => {
  const days = db.prepare('SELECT * FROM days WHERE hidden=0 ORDER BY sort,id').all().map(dayInfo);
  const progress = {};
  db.prepare('SELECT day_id,state FROM progress WHERE student_id=?').all(req.student.id)
    .forEach(r => { try { progress[r.day_id] = JSON.parse(r.state); } catch (e) {} });
  res.json({ student: { name: req.student.name, email: req.student.email }, days, progress, rating: ratingSummary(req.student.id) });
});

app.get('/api/days/:id', auth, (req, res) => {
  const d = db.prepare('SELECT * FROM days WHERE id=? AND hidden=0').get(Number(req.params.id));
  if (!d) return res.status(404).json({ error: 'Not found' });
  res.json({ ...dayInfo(d), rows: JSON.parse(d.rows) });
});

app.put('/api/progress/:id', auth, (req, res) => {
  const day = Number(req.params.id), st = req.body && req.body.state;
  if (!st || typeof st !== 'object' || !db.prepare('SELECT 1 FROM days WHERE id=?').get(day)) return res.status(400).json({ error: 'Bad request' });
  const clean = {
    sessions: typeof st.sessions === 'object' && st.sessions ? st.sessions : {},
    xp: Math.max(0, Math.min(1e7, Number(st.xp) || 0)),
    weak: typeof st.weak === 'object' && st.weak ? st.weak : {}
  };
  const json = JSON.stringify(clean);
  if (json.length > 60000) return res.status(413).json({ error: 'Too large' });
  db.prepare(`INSERT INTO progress(student_id,day_id,state,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(student_id,day_id) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at`).run(req.student.id, day, json, now());
  res.json({ ok: true });
});

app.post('/api/attempts', auth, (req, res) => {
  const b = req.body || {}, day = Number(b.dayId);
  if (!db.prepare('SELECT 1 FROM days WHERE id=?').get(day)) return res.status(400).json({ error: 'Bad day' });
  const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
  db.prepare(`INSERT INTO attempts(student_id,day_id,session,pct,stars,correct,total,xp,best_streak,seconds,misses,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(req.student.id, day, String(b.session).slice(0, 12), int(b.pct, 0, 100), int(b.stars, 0, 3),
    int(b.correct, 0, 1000), int(b.total, 0, 1000), int(b.xp, 0, 100000), int(b.bestStreak, 0, 1000), int(b.seconds, 0, 86400),
    JSON.stringify((Array.isArray(b.misses) ? b.misses : []).slice(0, 100).map(Number)), now());
  res.json({ ok: true });
});

app.post('/api/rating', auth, (req, res) => {
  const stars = Math.round(Number(req.body.stars));
  if (!(stars >= 1 && stars <= 5)) return res.status(400).json({ error: 'Stars 1-5' });
  const comment = String(req.body.comment || '').slice(0, 300);
  db.prepare(`INSERT INTO ratings(student_id,stars,comment,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(student_id) DO UPDATE SET stars=excluded.stars, comment=excluded.comment, updated_at=excluded.updated_at`)
    .run(req.student.id, stars, comment, now());
  res.json(ratingSummary(req.student.id));
});


/* ---------- leaderboard (first name + last initial only, no emails) ---------- */
function shortName(n) {
  const p = String(n).trim().split(/\s+/);
  return p.length > 1 ? p[0] + ' ' + p[p.length - 1][0].toUpperCase() + '.' : p[0];
}
app.get('/api/leaderboard', auth, (req, res) => {
  const sess = {};
  db.prepare('SELECT id,rows FROM days WHERE hidden=0').all().forEach(d => { sess[d.id] = Math.ceil(JSON.parse(d.rows).length / 25); });
  const by = {};
  db.prepare('SELECT student_id,day_id,state FROM progress').all().forEach(p => {
    if (!sess[p.day_id]) return;
    let st; try { st = JSON.parse(p.state); } catch (e) { return; }
    const o = by[p.student_id] || (by[p.student_id] = { stars: 0, xp: 0 });
    Object.keys(st.sessions || {}).forEach(k => { if (Number(k) <= sess[p.day_id]) o.stars += Math.min(3, Number(st.sessions[k].stars) || 0); });
    o.xp += Math.max(0, Number(st.xp) || 0);
  });
  const rows = db.prepare('SELECT id,name FROM students').all()
    .map(r => ({ id: r.id, name: shortName(r.name), stars: (by[r.id] || {}).stars || 0, xp: (by[r.id] || {}).xp || 0 }))
    .filter(r => r.stars > 0 || r.xp > 0 || r.id === req.student.id);
  res.json({ me: req.student.id, rows: rows.slice(0, 500) });
});

/* ---------- teacher API ---------- */
function studentStats() {
  const days = db.prepare('SELECT id,rows FROM days').all();
  const sess = {}; days.forEach(d => { sess[d.id] = Math.ceil(JSON.parse(d.rows).length / 25); });
  const total = Object.values(sess).reduce((a, b) => a + b, 0);
  const rows = db.prepare(`SELECT st.id,st.name,st.email,st.created_at,st.last_seen,
      (SELECT COUNT(*) FROM attempts a WHERE a.student_id=st.id) attempts,
      (SELECT AVG(pct) FROM attempts a WHERE a.student_id=st.id) avg_pct,
      (SELECT MAX(created_at) FROM attempts a WHERE a.student_id=st.id) last_attempt,
      (SELECT stars FROM ratings r WHERE r.student_id=st.id) rating
    FROM students st ORDER BY st.last_seen DESC`).all();
  const prog = db.prepare('SELECT student_id,day_id,state FROM progress').all();
  const by = {};
  prog.forEach(p => {
    let s; try { s = JSON.parse(p.state); } catch (e) { return; }
    const o = by[p.student_id] || (by[p.student_id] = { done: 0, stars: 0, xp: 0, weak: 0 });
    Object.keys(s.sessions || {}).forEach(k => { if (sess[p.day_id]) { o.done++; o.stars += (s.sessions[k].stars || 0); } });
    o.xp += s.xp || 0; o.weak += Object.keys(s.weak || {}).length;
  });
  return rows.map(r => ({
    id: r.id, name: r.name, email: r.email, joined: r.created_at, lastSeen: r.last_seen, lastAttempt: r.last_attempt,
    attempts: r.attempts, avgPct: r.avg_pct == null ? null : Math.round(r.avg_pct), rating: r.rating,
    sessionsDone: (by[r.id] || {}).done || 0, sessionsTotal: total, stars: (by[r.id] || {}).stars || 0,
    xp: (by[r.id] || {}).xp || 0, weakWords: (by[r.id] || {}).weak || 0
  }));
}

app.get('/api/admin/overview', admin, (req, res) => {
  const students = studentStats();
  const a = db.prepare('SELECT AVG(stars) avg, COUNT(*) n FROM ratings').get();
  const week = now() - 7 * 86400e3;
  res.json({
    students,
    totals: {
      students: students.length,
      active7: students.filter(s => s.lastSeen > week).length,
      attempts: db.prepare('SELECT COUNT(*) c FROM attempts').get().c,
      rating: a.n ? Math.round(a.avg * 10) / 10 : 0, ratings: a.n
    },
    comments: db.prepare(`SELECT st.name, r.stars, r.comment, r.updated_at FROM ratings r JOIN students st ON st.id=r.student_id
      WHERE r.comment<>'' ORDER BY r.updated_at DESC LIMIT 30`).all()
  });
});

app.get('/api/admin/students/:id', admin, (req, res) => {
  const id = Number(req.params.id);
  const st = db.prepare('SELECT id,name,email,created_at,last_seen FROM students WHERE id=?').get(id);
  if (!st) return res.status(404).json({ error: 'Not found' });
  const days = db.prepare('SELECT * FROM days ORDER BY sort,id').all();
  const out = days.map(d => {
    const rows = JSON.parse(d.rows);
    const p = db.prepare('SELECT state FROM progress WHERE student_id=? AND day_id=?').get(id, d.id);
    let state = { sessions: {}, xp: 0, weak: {} }; if (p) try { state = JSON.parse(p.state); } catch (e) {}
    return {
      id: d.id, badge: d.badge, title: d.title, sessions: Math.ceil(rows.length / 25), progress: state.sessions || {}, xp: state.xp || 0,
      weak: Object.keys(state.weak || {}).map(i => rows[Number(i)] ? { en: rows[Number(i)][2], uz: rows[Number(i)][3], times: state.weak[i] } : null).filter(Boolean)
        .sort((a, b) => b.times - a.times).slice(0, 25)
    };
  });
  const attempts = db.prepare(`SELECT a.id,a.day_id,d.badge,a.session,a.pct,a.stars,a.correct,a.total,a.xp,a.best_streak,a.seconds,a.created_at
    FROM attempts a JOIN days d ON d.id=a.day_id WHERE a.student_id=? ORDER BY a.created_at DESC LIMIT 100`).all(id);
  res.json({ student: st, days: out, attempts });
});

app.delete('/api/admin/students/:id', admin, (req, res) => {
  db.prepare('DELETE FROM students WHERE id=?').run(Number(req.params.id));
  res.json({ ok: true });
});

const csv = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
app.get('/api/admin/export.csv', admin, (req, res) => {
  const iso = t => t ? new Date(t).toISOString() : '';
  const lines = [['Name', 'Email', 'Joined', 'Last seen', 'Sessions done', 'Sessions total', 'Stars', 'XP', 'Quiz rounds', 'Average %', 'Weak words', 'Rating']];
  studentStats().forEach(s => lines.push([s.name, s.email, iso(s.joined), iso(s.lastSeen), s.sessionsDone, s.sessionsTotal, s.stars, s.xp, s.attempts, s.avgPct, s.weakWords, s.rating]));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="students.csv"');
  res.send('﻿' + lines.map(l => l.map(csv).join(',')).join('\n'));
});
app.get('/api/admin/attempts.csv', admin, (req, res) => {
  const rows = db.prepare(`SELECT st.name,st.email,d.badge,a.session,a.pct,a.stars,a.correct,a.total,a.xp,a.best_streak,a.seconds,a.created_at
    FROM attempts a JOIN students st ON st.id=a.student_id JOIN days d ON d.id=a.day_id ORDER BY a.created_at DESC`).all();
  const lines = [['Name', 'Email', 'Day', 'Session', 'Percent', 'Stars', 'Correct', 'Total', 'XP', 'Best streak', 'Seconds', 'When']];
  rows.forEach(r => lines.push([r.name, r.email, r.badge, r.session, r.pct, r.stars, r.correct, r.total, r.xp, r.best_streak, r.seconds, new Date(r.created_at).toISOString()]));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="quiz_rounds.csv"');
  res.send('﻿' + lines.map(l => l.map(csv).join(',')).join('\n'));
});

app.get('/api/admin/days', admin, (req, res) => {
  res.json(db.prepare('SELECT * FROM days ORDER BY sort,id').all().map(dayInfo));
});
app.post('/api/admin/days', admin, (req, res) => {
  const b = req.body || {};
  const badge = String(b.badge || '').trim().slice(0, 30), title = String(b.title || '').trim().slice(0, 60), topic = String(b.topic || '').trim().slice(0, 80);
  if (!badge || !title) return res.status(400).json({ error: 'Badge and title are required (e.g. "Day 4", "Reading Vocab").' });
  const p = parseWords(b.text);
  if (p.rows.length < 4) return res.status(400).json({ error: 'Need at least 4 words in the format English - Uzbek.' });
  const sort = (db.prepare('SELECT COALESCE(MAX(sort),0) m FROM days').get().m) + 1;
  const r = db.prepare('INSERT INTO days(badge,title,topic,rows,sort,created_at) VALUES(?,?,?,?,?,?)').run(badge, title, topic, JSON.stringify(p.rows), sort, now());
  res.json({ ok: true, id: r.lastInsertRowid, words: p.rows.length, skipped: p.bad });
});
app.patch('/api/admin/days/:id', admin, (req, res) => {
  const id = Number(req.params.id), b = req.body || {};
  const d = db.prepare('SELECT * FROM days WHERE id=?').get(id);
  if (!d) return res.status(404).json({ error: 'Not found' });
  const badge = b.badge != null ? String(b.badge).trim().slice(0, 30) || d.badge : d.badge;
  const title = b.title != null ? String(b.title).trim().slice(0, 60) || d.title : d.title;
  const topic = b.topic != null ? String(b.topic).trim().slice(0, 80) : d.topic;
  const hidden = b.hidden != null ? (b.hidden ? 1 : 0) : d.hidden;
  const sort = b.sort != null ? Number(b.sort) || d.sort : d.sort;
  let rows = d.rows, skipped = [];
  if (b.text != null) {
    const p = parseWords(b.text);
    if (p.rows.length < 4) return res.status(400).json({ error: 'Need at least 4 words.' });
    rows = JSON.stringify(p.rows); skipped = p.bad;
  }
  db.prepare('UPDATE days SET badge=?,title=?,topic=?,hidden=?,sort=?,rows=? WHERE id=?').run(badge, title, topic, hidden, sort, rows, id);
  res.json({ ok: true, skipped });
});
app.get('/api/admin/days/:id/text', admin, (req, res) => {
  const d = db.prepare('SELECT * FROM days WHERE id=?').get(Number(req.params.id));
  if (!d) return res.status(404).json({ error: 'Not found' });
  let last = null; const out = [];
  JSON.parse(d.rows).forEach(r => { if (r[1] !== last) { out.push('# ' + r[1]); last = r[1]; } out.push(r[2] + ' - ' + r[3]); });
  res.json({ text: out.join('\n') });
});
app.delete('/api/admin/days/:id', admin, (req, res) => {
  db.prepare('DELETE FROM days WHERE id=?').run(Number(req.params.id));
  res.json({ ok: true });
});

/* ---------- static ---------- */
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: '5m' }));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Server error' }); });

app.listen(PORT, () => console.log(`Vocab site on http://localhost:${PORT}  (admin ${ADMIN_KEY ? 'enabled' : 'DISABLED: set ADMIN_KEY'}${CLASS_CODE ? ', class code on' : ''})`));
