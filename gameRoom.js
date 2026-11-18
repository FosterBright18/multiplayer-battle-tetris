// Authoritative room: shared seed, garbage queues, power-up inventory/validation, bot.
const db = require('./db');
const POWERS = ['fog', 'surge', 'clear3', 'reverse', 'shield'];
const rnd = n => Math.floor(Math.random() * n);
// Bot difficulty. period = ms per piece-lock, w = chance of clearing 0/1/2/3/4 lines, grow = stack growth on a
// non-clearing lock, top = stack height at which the bot tops out, pw/cast = power-up earn/cast chances.
const LEVELS = {
  easy:   { period: 3800, w: [.50, .30, .14, .05, .01], tspin: 0,   pw: .10, cast: .15, grow: 1.0, top: 12 },
  medium: { period: 2800, w: [.40, .30, .20, .08, .02], tspin: .05, pw: .20, cast: .25, grow: .6,  top: 14 },
  hard:   { period: 1500, w: [.25, .30, .25, .12, .08], tspin: .10, pw: .30, cast: .45, grow: .5,  top: 18 } };

class Room {
  constructor(players, { bot = false, level = 'medium' } = {}) {
    this.level = level;
    this.seed = rnd(2 ** 31); this.bot = bot; this.t0 = Date.now(); this.over = false;
    this.ps = players.map(p => Object.assign(p, { inv: [], shield: false, pending: 0, earned: 0, combo: -1, lines: 0, sent: 0, pu: 0, pieces: 0 }));
    this.ps.forEach((p, i) => p.send({ t: 'match', seed: this.seed, you: i, opp: { name: this.ps[1 - i].name, elo: this.ps[1 - i].elo, bot: !!this.ps[1 - i].isBot } }));
    if (bot) this.startBot();
  }
  opp(p) { return this.ps[1 - this.ps.indexOf(p)]; }
  feed(msg) { this.ps.forEach(p => p.send({ t: 'feed', msg })); }
  sync(p) { p.send({ t: 'state', inv: p.inv, shield: p.shield, pending: p.pending }); }

  handle(p, m) {
    if (this.over) return;
    if (m.t === 'lock') this.lock(p, m);
    else if (m.t === 'cast') this.cast(p, m.slot | 0);
    else if (m.t === 'board' && typeof m.s === 'string' && m.s.length === 220) this.opp(p).send({ t: 'board', s: m.s });
    else if (m.t === 'top') this.end(this.opp(p), 'topout');
  }

  lock(p, m) {
    const lines = Math.max(0, Math.min(4, m.lines | 0)), o = this.opp(p), n = m.n | 0, got = [];
    if (n <= p.pieces) return;                         // piece counter must advance
    p.pieces = n;
    // Power-up validation: a power block only exists on every 6th piece, so earnings are capped.
    const allowed = Math.floor(n / 6) - p.earned, k = lines ? Math.min(m.pw | 0, allowed, 2) : 0;
    if (k > 0) {
      p.earned += k;
      for (let i = 0; i < k; i++) if (p.inv.length < 2) { const type = POWERS[rnd(5)]; p.inv.push(type); got.push({ type, slot: p.inv.length - 1 }); }
    }
    if (lines) {
      p.combo++; p.lines += lines;
      let g = m.tspin && lines < 4 ? lines * 2 : [0, 0, 1, 2, 4][lines];
      if (p.combo >= 2) g += p.combo >= 5 ? 2 : 1;
      const c = Math.min(g, p.pending); p.pending -= c; g -= c; let blocked = false;
      if (g > 0) {
        p.sent += g;
        if (o.shield) { blocked = true; o.shield = false; o.send({ t: 'shieldhit', n: g }); this.feed(`${o.name}'s shield blocked ${g} garbage`); this.sync(o); }
        else { o.pending += g; this.sync(o); this.feed(`${p.name} sends ${g} garbage${m.tspin ? ' (T-Spin)' : ''}${p.combo >= 2 ? ` x${p.combo} combo` : ''}`); }
      }
      if (c || g) p.send({ t: 'atk', sent: blocked ? 0 : g, cancelled: c, blocked });
    } else {
      p.combo = -1;
      const rows = Math.min(p.pending, 8); p.pending -= rows;
      if (rows) p.send({ t: 'apply', holes: Array.from({ length: rows }, () => rnd(10)) });
    }
    this.sync(p);
    if (got.length) { p.send({ t: 'got', got }); this.feed(`${p.name} picked up ${got.map(x => x.type).join(', ')}`); }
  }

  cast(p, slot) {
    const type = p.inv[slot]; if (!type) return;       // can't cast what you haven't earned
    p.inv.splice(slot, 1); p.pu++;
    const o = this.opp(p), me = this.ps.indexOf(p), self = type === 'clear3' || type === 'shield';
    let blocked = false;
    if (type === 'shield') { p.shield = true; this.feed(`${p.name} raised a shield`); }
    else if (type === 'clear3') { p.pending = Math.max(0, p.pending - 3); this.feed(`${p.name} cleared their bottom 3 rows`); }
    else if (o.shield) { blocked = true; o.shield = false; this.feed(`${o.name}'s shield blocked ${p.name}'s ${type}`); this.sync(o); }
    else this.feed(`${p.name} cast ${type} on ${o.name}`);
    this.ps.forEach(x => x.send({ t: 'power', type, from: p.name, fromIdx: me, target: self ? me : 1 - me, blocked }));
    this.sync(p);
  }

  // Simplified bot: simulates stack height and clear cadence from the chosen difficulty.
  startBot() {
    const L = LEVELS[this.level] || LEVELS.medium, bot = this.ps[1], human = this.ps[0]; bot.h = 2;
    const pick = () => { let r = Math.random(); for (let i = 0; i < 5; i++) if ((r -= L.w[i]) < 0) return i; return 0; };
    this.botTimer = setInterval(() => {
      if (this.over) return;
      const lines = pick(), before = bot.pending;
      this.lock(bot, { n: bot.pieces + 1 + rnd(3), lines, tspin: lines && Math.random() < L.tspin, pw: lines && Math.random() < L.pw ? 1 : 0 });
      bot.h = Math.max(0, bot.h - lines + (lines ? 0 : L.grow) + (!lines ? before - bot.pending : 0));
      if (bot.inv.length && Math.random() < L.cast) this.cast(bot, 0);
      if (bot.h >= L.top) this.end(human, 'topout');
    }, L.period);
    this.boardTimer = setInterval(() => {
      let s = ''; for (let y = 0; y < 22; y++) { const filled = y >= 22 - Math.round(bot.h); const hole = rnd(10);
        for (let x = 0; x < 10; x++) s += filled && x !== hole ? 'G' : '.'; }
      human.send({ t: 'board', s });
    }, 400);
  }

  leave(p) { if (!this.over) this.end(this.opp(p), 'disconnect'); }

  async end(winner, reason) {
    if (this.over) return; this.over = true;
    clearInterval(this.botTimer); clearInterval(this.boardTimer);
    const [a, b] = this.ps; let elo = null;
    const dur = Math.round((Date.now() - this.t0) / 1000);
    if (!this.bot && !a.guest && !b.guest) {
      try {
        elo = await db.recordMatch({ p1: a.id, p2: b.id, winner: winner.id, dur, l1: a.lines, l2: b.lines, pu: a.pu + b.pu });
        a.elo = elo[a.id].new; b.elo = elo[b.id].new;   // keep matchmaking rating fresh
      } catch (e) { console.error('recordMatch', e); }
    }
    const stat = p => ({ lines: p.lines, sent: p.sent, pu: p.pu });
    this.ps.forEach((p, i) => { const o = this.ps[1 - i];
      p.send({ t: 'over', win: p === winner, winner: winner.name, reason, dur, elo: elo && elo[p.id], oppElo: elo && elo[o.id], stats: { you: stat(p), opp: stat(o) } }); });
    this.onEnd && this.onEnd(this);
  }
}
module.exports = { Room };