// PostgreSQL when DATABASE_URL is set, otherwise in-memory (same API).
const K = 32;
let pool = null;
const mem = { users: new Map(), matches: [], uid: 1, mid: 1 };

async function init() {
  if (!process.env.DATABASE_URL) return console.log('[db] in-memory storage (no DATABASE_URL)');
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL ? { rejectUnauthorized: false } : undefined });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users(
      id SERIAL PRIMARY KEY, username VARCHAR(16) UNIQUE NOT NULL, password_hash TEXT NOT NULL,
      elo_rating INT NOT NULL DEFAULT 1000, wins INT NOT NULL DEFAULT 0, losses INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS matches(
      id SERIAL PRIMARY KEY, player1_id INT REFERENCES users(id), player2_id INT REFERENCES users(id),
      winner_id INT REFERENCES users(id), duration_sec INT, lines_cleared_p1 INT, lines_cleared_p2 INT,
      powerups_used INT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());`);
  console.log('[db] PostgreSQL ready');
}

async function createUser(username, hash) {
  if (pool) {
    try { return (await pool.query('INSERT INTO users(username,password_hash) VALUES($1,$2) RETURNING *', [username, hash])).rows[0]; }
    catch (e) { if (e.code === '23505') return null; throw e; }
  }
  if ([...mem.users.values()].some(u => u.username.toLowerCase() === username.toLowerCase())) return null;
  const u = { id: mem.uid++, username, password_hash: hash, elo_rating: 1000, wins: 0, losses: 0, created_at: new Date() };
  mem.users.set(u.id, u); return u;
}
async function getUser(username) {
  if (pool) return (await pool.query('SELECT * FROM users WHERE lower(username)=lower($1)', [username])).rows[0];
  return [...mem.users.values()].find(u => u.username.toLowerCase() === username.toLowerCase());
}
async function getById(id) {
  if (pool) return (await pool.query('SELECT * FROM users WHERE id=$1', [id])).rows[0];
  return mem.users.get(id);
}
async function leaderboard() {
  if (pool) return (await pool.query('SELECT username,elo_rating,wins,losses FROM users ORDER BY elo_rating DESC LIMIT 20')).rows;
  return [...mem.users.values()].sort((a, b) => b.elo_rating - a.elo_rating).slice(0, 20)
    .map(({ username, elo_rating, wins, losses }) => ({ username, elo_rating, wins, losses }));
}
async function matches(username) {
  const u = await getUser(username); if (!u) return [];
  if (pool) return (await pool.query(`SELECT m.*, a.username p1, b.username p2 FROM matches m
    JOIN users a ON a.id=m.player1_id JOIN users b ON b.id=m.player2_id
    WHERE m.player1_id=$1 OR m.player2_id=$1 ORDER BY m.created_at DESC LIMIT 20`, [u.id])).rows;
  return mem.matches.filter(m => m.player1_id === u.id || m.player2_id === u.id).slice(-20).reverse()
    .map(m => ({ ...m, p1: mem.users.get(m.player1_id).username, p2: mem.users.get(m.player2_id).username }));
}

// Standard Elo, K=32. Returns { [id]: {old,new} }.
async function recordMatch(m) {
  const a = await getById(m.p1), b = await getById(m.p2);
  const ea = 1 / (1 + 10 ** ((b.elo_rating - a.elo_rating) / 400));
  const sa = m.winner === a.id ? 1 : 0;
  const na = Math.round(a.elo_rating + K * (sa - ea)), nb = Math.round(b.elo_rating + K * ((1 - sa) - (1 - ea)));
  const upd = [[a, na, sa], [b, nb, 1 - sa]];
  if (pool) {
    for (const [u, n, s] of upd) await pool.query('UPDATE users SET elo_rating=$1, wins=wins+$2, losses=losses+$3 WHERE id=$4', [n, s, 1 - s, u.id]);
    await pool.query(`INSERT INTO matches(player1_id,player2_id,winner_id,duration_sec,lines_cleared_p1,lines_cleared_p2,powerups_used)
      VALUES($1,$2,$3,$4,$5,$6,$7)`, [a.id, b.id, m.winner, m.dur, m.l1, m.l2, m.pu]);
  } else {
    for (const [u, n, s] of upd) { u.elo_rating = n; u.wins += s; u.losses += 1 - s; }
    mem.matches.push({ id: mem.mid++, player1_id: a.id, player2_id: b.id, winner_id: m.winner, duration_sec: m.dur,
      lines_cleared_p1: m.l1, lines_cleared_p2: m.l2, powerups_used: m.pu, created_at: new Date() });
  }
  return { [a.id]: { old: a.elo_rating, new: na }, [b.id]: { old: b.elo_rating, new: nb } };
}
module.exports = { init, createUser, getUser, getById, leaderboard, matches, recordMatch };
