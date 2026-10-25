'use strict';
// Behruz Vocab Trainer: Express + Neon PostgreSQL
// Render environment variables: DATABASE_URL, PORT, ADMIN_KEY, CLASS_CODE, TZ_OFFSET_MIN
const express = require('express');
const { Pool } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const CLASS_CODE = (process.env.CLASS_CODE || '').trim();
const TZ_MIN = Number(process.env.TZ_OFFSET_MIN || 300);
const DAY_MS = 86400e3;

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL environment variable.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000
});

pool.on('error', err => console.error('Unexpected PostgreSQL pool error:', err));

const now = () => Date.now();
const localDay = t => Math.floor((Number(t) + TZ_MIN * 60e3) / DAY_MS);

function weekStartMs(t = now()) {
  const d = localDay(t);
  return (d - ((d + 3) % 7)) * DAY_MS - TZ_MIN * 60e3;
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS students (
      id BIGSERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      last_seen BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS days (
      id BIGSERIAL PRIMARY KEY,
      badge TEXT NOT NULL,
      title TEXT NOT NULL,
      topic TEXT NOT NULL DEFAULT '',
      rows TEXT NOT NULL,
      hidden INTEGER NOT NULL DEFAULT 0,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS progress (
      student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      day_id BIGINT NOT NULL REFERENCES days(id) ON DELETE CASCADE,
      state TEXT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY(student_id, day_id)
    );

    CREATE TABLE IF NOT EXISTS attempts (
      id BIGSERIAL PRIMARY KEY,
      student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      day_id BIGINT NOT NULL REFERENCES days(id) ON DELETE CASCADE,
      session TEXT NOT NULL,
      pct INTEGER NOT NULL,
      stars INTEGER NOT NULL,
      correct INTEGER NOT NULL,
      total INTEGER NOT NULL,
      xp INTEGER NOT NULL,
      best_streak INTEGER NOT NULL,
      seconds INTEGER NOT NULL DEFAULT 0,
      misses TEXT NOT NULL DEFAULT '[]',
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ratings (
      student_id BIGINT PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
      stars INTEGER NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      updated_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS att_student
      ON attempts(student_id, created_at);
  `);

  const count = Number(
    (await pool.query('SELECT COUNT(*) AS c FROM days')).rows[0].c
  );

  if (count === 0) {
    const seedPath = path.join(__dirname, 'data', 'seed_days.json');

    if (!fs.existsSync(seedPath)) {
      console.warn('No data/seed_days.json found; starting with no vocabulary days.');
      return;
    }

    const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

    for (let i = 0; i < seed.length; i++) {
      const d = seed[i];

      await pool.query(
        `INSERT INTO days(badge, title, topic, rows, sort, created_at)
         VALUES($1, $2, $3, $4, $5, $6)`,
        [
          d.badge,
          d.title,
          d.topic || '',
          JSON.stringify(d.rows),
          i + 1,
          now()
        ]
      );
    }

    console.log('Seeded', seed.length, 'vocabulary days');
  }
}

async function streakFor(sid) {
  const result = await pool.query(
    `SELECT created_at FROM attempts
     WHERE student_id = $1
     ORDER BY created_at DESC
     LIMIT 500`,
    [sid]
  );

  const days = new Set(result.rows.map(r => localDay(r.created_at)));
  const today = localDay(now());

  let d = days.has(today)
    ? today
    : days.has(today - 1)
      ? today - 1
      : null;

  let count = 0;

  while (d !== null && days.has(d)) {
    count++;
    d--;
  }

  return { count, today: days.has(today) };
}

function parseWords(text) {
  const rows = [];
  const bad = [];
  let sec = 'Vocabulary';

  String(text || '').split(/\r?\n/).forEach((line, n) => {
    line = line.trim();

    if (!line) return;

    if (line[0] === '#') {
      sec = line.replace(/^#+\s*/, '') || sec;
      return;
    }

    line = line.replace(/^\s*\d+\s*[.)]\s+/, '');

    let m = line.split('\t');

    if (m.length < 2) {
      m = line.split(/\s+[-–—]\s+|\s*[=|;]\s*|\s*[–—]\s*/);
    }

    if (m.length < 2) {
      bad.push(n + 1);
      return;
    }

    const en = m[0].trim();
    const uz = m.slice(1).join(' - ').trim();

    if (!en || !uz) {
      bad.push(n + 1);
      return;
    }

    rows.push([
      0,
      sec.slice(0, 80),
      en.slice(0, 120),
      uz.slice(0, 200)
    ]);
  });

  return { rows, bad };
}

// ---------- Part 2: Express setup and auth helpers ----------

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
    if (i > 0) {
      try {
        o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
      } catch (_) {}
    }
  });
  return o;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const hits = new Map();

function limited(key, max, ms) {
  const t = now();
  const a = (hits.get(key) || []).filter(x => t - x < ms);
  a.push(t);
  hits.set(key, a);
  return a.length > max;
}

setInterval(() => {
  const t = now();
  for (const [k, a] of hits) {
    if (!a.some(x => t - x < 3600e3)) hits.delete(k);
  }
}, 600e3).unref();

async function auth(req, res, next) {
  try {
    const tok = cookies(req).sid;
    if (!tok) return res.status(401).json({ error: 'login' });

    const result = await pool.query(
      `SELECT st.*
       FROM sessions se
       JOIN students st ON st.id = se.student_id
       WHERE se.token = $1`,
      [tok]
    );

    const s = result.rows[0];
    if (!s) return res.status(401).json({ error: 'login' });

    req.student = s;

    if (now() - Number(s.last_seen) > 60e3) {
      await pool.query(
        'UPDATE students SET last_seen = $1 WHERE id = $2',
        [now(), s.id]
      );
    }

    next();
  } catch (e) {
    next(e);
  }
}

function admin(req, res, next) {
  if (!ADMIN_KEY) {
    return res.status(503).json({
      error: 'ADMIN_KEY is not set on the server'
    });
  }

  const k = Buffer.from(String(req.headers['x-admin-key'] || ''));
  const a = Buffer.from(ADMIN_KEY);

  if (k.length !== a.length || !crypto.timingSafeEqual(k, a)) {
    if (limited('adm:' + req.ip, 20, 600e3)) {
      return res.status(429).json({ error: 'Too many tries' });
    }
    return res.status(401).json({ error: 'Wrong key' });
  }

  next();
}

const dayInfo = d => {
  const n = JSON.parse(d.rows).length;

  return {
    id: Number(d.id),
    badge: d.badge,
    title: d.title,
    topic: d.topic,
    words: n,
    sessions: Math.ceil(n / 25),
    hidden: !!Number(d.hidden)
  };
};

// =====================================================================
// MISSING: STUDENT-FACING ROUTES (login/register, me, days list, progress,
// quiz attempts, leaderboard, rating). They were NOT in the code you pasted.
// Paste them here, after the setup block and before the admin stats below.
// =====================================================================

// ---------- Part 3: student statistics and admin endpoints ----------

async function studentStats() {
  const days = (await pool.query('SELECT id,rows FROM days')).rows;
  const sess = {};

  days.forEach(d => {
    sess[String(d.id)] = Math.ceil(JSON.parse(d.rows).length / 25);
  });

  const total = Object.values(sess).reduce((a, b) => a + b, 0);

  const rows = (await pool.query(`
    SELECT
      st.id,
      st.name,
      st.email,
      st.created_at,
      st.last_seen,
      (SELECT COUNT(*) FROM attempts a WHERE a.student_id=st.id) AS attempts,
      (SELECT AVG(pct) FROM attempts a WHERE a.student_id=st.id) AS avg_pct,
      (SELECT MAX(created_at) FROM attempts a WHERE a.student_id=st.id) AS last_attempt,
      (SELECT stars FROM ratings r WHERE r.student_id=st.id) AS rating
    FROM students st
    ORDER BY st.last_seen DESC
  `)).rows;

  const prog = (
    await pool.query('SELECT student_id,day_id,state FROM progress')
  ).rows;

  const by = {};

  prog.forEach(p => {
    let s;
    try {
      s = JSON.parse(p.state);
    } catch (_) {
      return;
    }

    const key = String(p.student_id);
    const o = by[key] || (by[key] = {
      done: 0,
      stars: 0,
      xp: 0,
      weak: 0
    });

    Object.keys(s.sessions || {}).forEach(k => {
      if (sess[String(p.day_id)]) {
        o.done++;
        o.stars += Number(s.sessions[k].stars) || 0;
      }
    });

    o.xp += Number(s.xp) || 0;
    o.weak += Object.keys(s.weak || {}).length;
  });

  return rows.map(r => {
    const b = by[String(r.id)] || {};

    return {
      id: Number(r.id),
      name: r.name,
      email: r.email,
      joined: Number(r.created_at),
      lastSeen: Number(r.last_seen),
      lastAttempt: r.last_attempt == null
        ? null
        : Number(r.last_attempt),
      attempts: Number(r.attempts),
      avgPct: r.avg_pct == null
        ? null
        : Math.round(Number(r.avg_pct)),
      rating: r.rating == null
        ? null
        : Number(r.rating),
      sessionsDone: b.done || 0,
      sessionsTotal: total,
      stars: b.stars || 0,
      xp: b.xp || 0,
      weakWords: b.weak || 0
    };
  });
}

app.get('/api/admin/overview', admin, async (req, res, next) => {
  try {
    const students = await studentStats();

    const a = (
      await pool.query(
        'SELECT AVG(stars) AS avg, COUNT(*) AS n FROM ratings'
      )
    ).rows[0];

    const week = now() - 7 * DAY_MS;

    const attempts = Number(
      (await pool.query('SELECT COUNT(*) AS c FROM attempts')).rows[0].c
    );

    const comments = (
      await pool.query(`
        SELECT st.name,r.stars,r.comment,r.updated_at
        FROM ratings r
        JOIN students st ON st.id=r.student_id
        WHERE r.comment <> ''
        ORDER BY r.updated_at DESC
        LIMIT 30
      `)
    ).rows;

    res.json({
      students,
      totals: {
        students: students.length,
        active7: students.filter(s => s.lastSeen > week).length,
        attempts,
        rating: Number(a.n)
          ? Math.round(Number(a.avg) * 10) / 10
          : 0,
        ratings: Number(a.n)
      },
      comments
    });
  } catch (e) {
    next(e);
  }
});

app.get('/api/admin/students/:id', admin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const st = (
      await pool.query(
        'SELECT id,name,email,created_at,last_seen FROM students WHERE id=$1',
        [id]
      )
    ).rows[0];

    if (!st) return res.status(404).json({ error: 'Not found' });

    const days = (
      await pool.query('SELECT * FROM days ORDER BY sort,id')
    ).rows;

    const out = [];

    for (const d of days) {
      const rows = JSON.parse(d.rows);

      const p = (
        await pool.query(
          'SELECT state FROM progress WHERE student_id=$1 AND day_id=$2',
          [id, d.id]
        )
      ).rows[0];

      let state = { sessions: {}, xp: 0, weak: {} };

      if (p) {
        try {
          state = JSON.parse(p.state);
        } catch (_) {}
      }

      out.push({
        id: Number(d.id),
        badge: d.badge,
        title: d.title,
        sessions: Math.ceil(rows.length / 25),
        progress: state.sessions || {},
        xp: state.xp || 0,
        weak: Object.keys(state.weak || {})
          .map(i => rows[Number(i)] ? {
            en: rows[Number(i)][2],
            uz: rows[Number(i)][3],
            times: state.weak[i]
          } : null)
          .filter(Boolean)
          .sort((a, b) => b.times - a.times)
          .slice(0, 25)
      });
    }

    const attempts = (
      await pool.query(`
        SELECT
          a.id,a.day_id,d.badge,a.session,a.pct,a.stars,
          a.correct,a.total,a.xp,a.best_streak,a.seconds,a.created_at
        FROM attempts a
        JOIN days d ON d.id=a.day_id
        WHERE a.student_id=$1
        ORDER BY a.created_at DESC
        LIMIT 100
      `, [id])
    ).rows;

    res.json({ student: st, days: out, attempts });
  } catch (e) {
    next(e);
  }
});

app.delete('/api/admin/students/:id', admin, async (req, res, next) => {
  try {
    await pool.query(
      'DELETE FROM students WHERE id=$1',
      [Number(req.params.id)]
    );

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

const csv = v => {
  v = v == null ? '' : String(v);
  return /[",\n]/.test(v)
    ? '"' + v.replace(/"/g, '""') + '"'
    : v;
};

app.get('/api/admin/export.csv', admin, async (req, res, next) => {
  try {
    const iso = t => t ? new Date(Number(t)).toISOString() : '';

    const lines = [[
      'Name','Email','Joined','Last seen','Sessions done',
      'Sessions total','Stars','XP','Quiz rounds','Average %',
      'Weak words','Rating'
    ]];

    (await studentStats()).forEach(s => {
      lines.push([
        s.name,s.email,iso(s.joined),iso(s.lastSeen),
        s.sessionsDone,s.sessionsTotal,s.stars,s.xp,
        s.attempts,s.avgPct,s.weakWords,s.rating
      ]);
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="students.csv"'
    );

    res.send('\uFEFF' + lines.map(l => l.map(csv).join(',')).join('\n'));
  } catch (e) {
    next(e);
  }
});

app.get('/api/admin/attempts.csv', admin, async (req, res, next) => {
  try {
    const rows = (
      await pool.query(`
        SELECT
          st.name,st.email,d.badge,a.session,a.pct,a.stars,
          a.correct,a.total,a.xp,a.best_streak,a.seconds,a.created_at
        FROM attempts a
        JOIN students st ON st.id=a.student_id
        JOIN days d ON d.id=a.day_id
        ORDER BY a.created_at DESC
      `)
    ).rows;

    const lines = [[
      'Name','Email','Day','Session','Percent','Stars',
      'Correct','Total','XP','Best streak','Seconds','When'
    ]];

    rows.forEach(r => {
      lines.push([
        r.name,r.email,r.badge,r.session,r.pct,r.stars,
        r.correct,r.total,r.xp,r.best_streak,r.seconds,
        new Date(Number(r.created_at)).toISOString()
      ]);
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="quiz_rounds.csv"'
    );

    res.send('\uFEFF' + lines.map(l => l.map(csv).join(',')).join('\n'));
  } catch (e) {
    next(e);
  }
});

// ---------- Part 4: vocabulary management and server startup ----------

app.get('/api/admin/days', admin, async (req, res, next) => {
  try {
    res.json(
      (await pool.query('SELECT * FROM days ORDER BY sort,id'))
        .rows.map(dayInfo)
    );
  } catch (e) {
    next(e);
  }
});

app.post('/api/admin/days', admin, async (req, res, next) => {
  try {
    const b = req.body || {};

    const badge = String(b.badge || '').trim().slice(0, 30);
    const title = String(b.title || '').trim().slice(0, 60);
    const topic = String(b.topic || '').trim().slice(0, 80);

    if (!badge || !title) {
      return res.status(400).json({
        error: 'Badge and title are required (e.g. "Day 4", "Reading Vocab").'
      });
    }

    const p = parseWords(b.text);

    if (p.rows.length < 4) {
      return res.status(400).json({
        error: 'Need at least 4 words in the format English - Uzbek.'
      });
    }

    const sort = Number(
      (await pool.query('SELECT COALESCE(MAX(sort),0) AS m FROM days')).rows[0].m
    ) + 1;

    const r = await pool.query(
      `INSERT INTO days(badge,title,topic,rows,sort,created_at)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [badge, title, topic, JSON.stringify(p.rows), sort, now()]
    );

    res.json({
      ok: true,
      id: Number(r.rows[0].id),
      words: p.rows.length,
      skipped: p.bad
    });
  } catch (e) {
    next(e);
  }
});

app.patch('/api/admin/days/:id', admin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const b = req.body || {};

    const d = (
      await pool.query('SELECT * FROM days WHERE id=$1', [id])
    ).rows[0];

    if (!d) return res.status(404).json({ error: 'Not found' });

    const badge = b.badge != null
      ? String(b.badge).trim().slice(0, 30) || d.badge
      : d.badge;

    const title = b.title != null
      ? String(b.title).trim().slice(0, 60) || d.title
      : d.title;

    const topic = b.topic != null
      ? String(b.topic).trim().slice(0, 80)
      : d.topic;

    const hidden = b.hidden != null
      ? (b.hidden ? 1 : 0)
      : Number(d.hidden);

    const sort = b.sort != null
      ? Number(b.sort) || Number(d.sort)
      : Number(d.sort);

    let rows = d.rows;
    let skipped = [];

    if (b.text != null) {
      const p = parseWords(b.text);

      if (p.rows.length < 4) {
        return res.status(400).json({ error: 'Need at least 4 words.' });
      }

      rows = JSON.stringify(p.rows);
      skipped = p.bad;
    }

    await pool.query(
      `UPDATE days
       SET badge=$1,title=$2,topic=$3,hidden=$4,sort=$5,rows=$6
       WHERE id=$7`,
      [badge, title, topic, hidden, sort, rows, id]
    );

    res.json({ ok: true, skipped });
  } catch (e) {
    next(e);
  }
});

app.get('/api/admin/days/:id/text', admin, async (req, res, next) => {
  try {
    const d = (
      await pool.query(
        'SELECT * FROM days WHERE id=$1',
        [Number(req.params.id)]
      )
    ).rows[0];

    if (!d) return res.status(404).json({ error: 'Not found' });

    let last = null;
    const out = [];

    JSON.parse(d.rows).forEach(r => {
      if (r[1] !== last) {
        out.push('# ' + r[1]);
        last = r[1];
      }

      out.push(r[2] + ' - ' + r[3]);
    });

    res.json({ text: out.join('\n') });
  } catch (e) {
    next(e);
  }
});

app.delete('/api/admin/days/:id', admin, async (req, res, next) => {
  try {
    await pool.query(
      'DELETE FROM days WHERE id=$1',
      [Number(req.params.id)]
    );

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// Admin-only JSON export for a private database backup.
app.get('/api/admin/backup.json', admin, async (req, res, next) => {
  try {
    const tables = {};

    for (const table of [
      'students',
      'sessions',
      'days',
      'progress',
      'attempts',
      'ratings'
    ]) {
      tables[table] = (
        await pool.query(`SELECT * FROM ${table}`)
      ).rows;
    }

    res.setHeader(
      'Content-Disposition',
      'attachment; filename="vocabulary-backup.json"'
    );

    res.json({
      exportedAt: new Date().toISOString(),
      tables
    });
  } catch (e) {
    next(e);
  }
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use(express.static(
  path.join(__dirname, 'public'),
  { extensions: ['html'], maxAge: '5m' }
));

app.use((err, req, res, next) => {
  console.error(err);

  if (res.headersSent) return next(err);

  res.status(500).json({ error: 'Server error' });
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(
        `Vocab site listening on port ${PORT} ` +
        `(admin ${ADMIN_KEY ? 'enabled' : 'DISABLED: set ADMIN_KEY'}` +
        `${CLASS_CODE ? ', class code on' : ''})`
      );
    });
  })
  .catch(err => {
    console.error('Database initialization failed:', err);
    process.exit(1);
  });
