try { require('dotenv').config(); } catch {}
const express = require('express'), http = require('http'), path = require('path');
const { WebSocketServer } = require('ws'), jwt = require('jsonwebtoken'), bcrypt = require('bcryptjs');
const db = require('./db'), { Room } = require('./gameRoom');
const SECRET = process.env.JWT_SECRET || 'dev-secret', PORT = process.env.PORT || 3000;
const app = express(); app.use(express.json()); app.use(express.static(path.join(__dirname, 'public')));
const sign = u => jwt.sign({ id: u.id, username: u.username, guest: !!u.guest, elo: u.elo_rating }, SECRET, { expiresIn: '7d' });
const prof = u => ({ username: u.username, elo_rating: u.elo_rating, wins: u.wins || 0, losses: u.losses || 0, guest: !!u.guest });
const ok = b => /^\w{3,16}$/.test(b.username || '') && typeof b.password === 'string' && b.password.length >= 4;

app.post('/api/auth/register', async (q, r) => {
  if (!ok(q.body)) return r.status(400).json({ error: 'Username: 3-16 letters or numbers. Password: 4+ characters.' });
  const u = await db.createUser(q.body.username, await bcrypt.hash(q.body.password, 10));
  if (!u) return r.status(409).json({ error: 'That username is taken.' });
  r.json({ token: sign(u), ...prof(u) });
});
app.post('/api/auth/login', async (q, r) => {
  const u = await db.getUser(q.body.username || '');
  if (!u || !(await bcrypt.compare(q.body.password || '', u.password_hash))) return r.status(401).json({ error: 'Wrong username or password.' });
  r.json({ token: sign(u), ...prof(u) });
});
app.post('/api/auth/guest', (q, r) => {
  const u = { id: 'g' + Math.random().toString(36).slice(2, 9), username: 'Guest' + Math.floor(1000 + Math.random() * 9000), guest: true, elo_rating: 1000 };
  r.json({ token: sign(u), ...prof(u) });
});
app.get('/api/me', async (q, r) => {
  try {
    const d = jwt.verify((q.headers.authorization || '').replace('Bearer ', ''), SECRET);
    if (d.guest) return r.json({ username: d.username, elo_rating: 1000, wins: 0, losses: 0, guest: true });
    const u = await db.getById(d.id); if (!u) return r.status(404).json({ error: 'Account not found. Please log in again.' });
    r.json(prof(u));
  } catch { r.status(401).json({ error: 'Session expired. Please log in again.' }); }
});
app.get('/api/leaderboard', async (q, r) => r.json(await db.leaderboard()));
app.get('/api/matches/:username', async (q, r) => r.json(await db.matches(q.params.username)));

const server = http.createServer(app), wss = new WebSocketServer({ server });
let queue = [], rooms = new Map(), tick = 0;

function startRoom(players, opts = {}) {
  const room = new Room(players, opts);
  room.onEnd = () => players.forEach(p => { p.room = null; p.want = false; p.last = { opp: players.find(x => x !== p), bot: !!opts.bot, level: opts.level }; });
  players.forEach(p => { p.room = room; p.want = false; });
}
const mkBot = (p, level = 'medium') => ({ id: 'bot', name: 'Bot · ' + level[0].toUpperCase() + level.slice(1), elo: p.elo, isBot: true, guest: true, send() {} });
function leaveAll(p) { queue = queue.filter(e => e.p !== p); for (const [c, h] of rooms) if (h === p) rooms.delete(c); }
function dropRematch(p) {            // tell a waiting opponent that this player is gone
  const o = p.last && !p.last.bot && p.last.opp;
  if (o && o.want) o.send({ t: 'rematch_fail' });
  p.want = false; p.last = null;
}
function rematch(p) {
  const l = p.last; if (!l) return p.send({ t: 'rematch_fail' });
  if (l.bot) return startRoom([p, mkBot(p, l.level)], { bot: true, level: l.level });
  const o = l.opp;
  if (!o.last || o.last.opp !== p || o.ws.readyState !== 1 || o.room) return p.send({ t: 'rematch_fail' });
  if (o.want) return startRoom([o, p]);
  p.want = true; o.send({ t: 'rematch_req' }); p.send({ t: 'rematch_wait' });
}

setInterval(() => {            // matchmaking: window = 100 + 100 per 5s waited
  const now = Date.now();
  for (let i = 0; i < queue.length; i++) for (let j = i + 1; j < queue.length; j++) {
    const a = queue[i], b = queue[j], w = 100 + 100 * Math.floor((now - Math.min(a.t, b.t)) / 5000);
    if (Math.abs(a.p.elo - b.p.elo) <= w) { queue = queue.filter(e => e !== a && e !== b); startRoom([a.p, b.p]); return; }
  }
  queue.forEach(e => e.p.send({ t: 'queue', waited: Math.round((now - e.t) / 1000), window: 100 + 100 * Math.floor((now - e.t) / 5000) }));
}, 1000);
setInterval(() => { tick++; if (tick % 20 === 0) wss.clients.forEach(c => c.readyState === 1 && c.send(JSON.stringify({ t: 'tick', n: tick }))); }, 50);

wss.on('connection', ws => {
  const p = { ws, send: o => ws.readyState === 1 && ws.send(JSON.stringify(o)), room: null, last: null, want: false };
  ws.on('message', async raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'ping') return p.send({ t: 'pong', ts: m.ts, tick });
    if (m.t === 'auth') {
      try { const d = jwt.verify(m.token, SECRET); Object.assign(p, { id: d.id, name: d.username, guest: d.guest, elo: d.elo || 1000 });
        if (!d.guest) { const u = await db.getById(d.id); if (u) p.elo = u.elo_rating; }
        return p.send({ t: 'authed', name: p.name, elo: p.elo }); }
      catch { return p.send({ t: 'error', msg: 'Session expired. Log in again.' }); }
    }
    if (!p.name) return;
    if (p.room) return p.room.handle(p, m);
    if (m.t === 'rematch') return rematch(p);
    if (m.t === 'cancel') { leaveAll(p); dropRematch(p); return p.send({ t: 'idle' }); }
    leaveAll(p); dropRematch(p);
    if (m.t === 'queue') queue.push({ p, t: Date.now() });
    else if (m.t === 'bot') { const level = ['easy', 'medium', 'hard'].includes(m.level) ? m.level : 'medium'; startRoom([p, mkBot(p, level)], { bot: true, level }); }
    else if (m.t === 'create') { let c; do c = Math.random().toString(36).slice(2, 6).toUpperCase(); while (rooms.has(c)); rooms.set(c, p); p.send({ t: 'code', code: c }); }
    else if (m.t === 'join') {
      const code = String(m.code || '').toUpperCase(), h = rooms.get(code);
      if (!h || h === p || h.room) return p.send({ t: 'error', msg: 'No open room with that code.' });
      rooms.delete(code); startRoom([h, p]);
    }
  });
  ws.on('close', () => { leaveAll(p); dropRematch(p); p.room && p.room.leave(p); });
});
db.init().then(() => server.listen(PORT, () => console.log(`Battle Tetris on http://localhost:${PORT}`)));