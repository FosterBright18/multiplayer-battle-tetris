export const COLORS = { I: '#4cc9f0', O: '#ffd166', T: '#b388ff', S: '#6ee7a0', Z: '#ff6b6b', J: '#5b8cff', L: '#ff9f5a', G: '#6b6f80' };
const SH = { I: [[0,1],[1,1],[2,1],[3,1]], O: [[1,0],[2,0],[1,1],[2,1]], T: [[1,0],[0,1],[1,1],[2,1]], S: [[1,0],[2,0],[0,1],[1,1]],
  Z: [[0,0],[1,0],[1,1],[2,1]], J: [[0,0],[0,1],[1,1],[2,1]], L: [[2,0],[0,1],[1,1],[2,1]] };
// SRS kicks as (x, y-up) pairs
const KJ = { '01':[0,0,-1,0,-1,1,0,-2,-1,-2], '10':[0,0,1,0,1,-1,0,2,1,2], '12':[0,0,1,0,1,-1,0,2,1,2], '21':[0,0,-1,0,-1,1,0,-2,-1,-2],
  '23':[0,0,1,0,1,1,0,-2,1,-2], '32':[0,0,-1,0,-1,-1,0,2,-1,2], '30':[0,0,-1,0,-1,-1,0,2,-1,2], '03':[0,0,1,0,1,1,0,-2,1,-2] };
const KI = { '01':[0,0,-2,0,1,0,-2,-1,1,2], '10':[0,0,2,0,-1,0,2,1,-1,-2], '12':[0,0,-1,0,2,0,-1,2,2,-1], '21':[0,0,1,0,-2,0,1,-2,-2,1],
  '23':[0,0,2,0,-1,0,2,1,-1,-2], '32':[0,0,-2,0,1,0,-2,-1,1,2], '30':[0,0,1,0,-2,0,1,-2,-2,1], '03':[0,0,-1,0,2,0,-1,2,2,-1] };
export const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
export function cells(t, r) {
  let c = SH[t]; if (t === 'O') return c; const n = t === 'I' ? 4 : 3;
  for (let i = 0; i < r; i++) c = c.map(([x, y]) => [n - 1 - y, x]); return c;
}
const empty = () => Array(10).fill(null);

export class Tetris {
  constructor(seed, hooks) {
    this.seed = seed; this.h = hooks; this.rng = mulberry(seed); this.bag = []; this.q = [];
    this.b = Array.from({ length: 22 }, empty); this.n = 0; this.locked = 0; this.hold = null; this.canHold = true;
    this.speed = 1; this.rev = false; this.soft = false; this.dead = false; this.gt = 0; this.lt = 0; this.resets = 0;
    while (this.q.length < 6) this.q.push(this.draw());
    this.spawn();
  }
  draw() {
    if (!this.bag.length) { this.bag = ['I','O','T','S','Z','J','L'];
      for (let i = 6; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]]; } }
    return this.bag.pop();
  }
  mkPiece(t, idx) { return { t, r: 0, x: 3, y: 0, pw: idx % 6 === 5 ? Math.floor(mulberry(this.seed + idx * 977)() * 4) : -1, idx }; }
  spawn(swap) {
    if (swap) this.p = swap; else { this.p = this.mkPiece(this.q.shift(), this.n++); this.q.push(this.draw()); }
    this.p.r = 0; this.p.x = 3; this.p.y = 0; this.gt = this.lt = 0; this.resets = 0; this.last = null;
    if (!this.fits(this.p.t, 0, 3, 0)) this.die();
  }
  die() { if (!this.dead) { this.dead = true; this.h.onTop && this.h.onTop(); } }
  fits(t, r, x, y) {
    return cells(t, r).every(([cx, cy]) => { const X = x + cx, Y = y + cy; return X >= 0 && X < 10 && Y < 22 && (Y < 0 || !this.b[Y][X]); });
  }
  grounded() { return !this.fits(this.p.t, this.p.r, this.p.x, this.p.y + 1); }
  touched() { if (this.grounded() && this.resets < 15) { this.lt = 0; this.resets++; } }
  mv(dx) { if (this.dead) return; if (this.rev) dx = -dx; const p = this.p;
    if (this.fits(p.t, p.r, p.x + dx, p.y)) { p.x += dx; this.last = 'm'; this.touched(); } }
  rot(d) {
    if (this.dead || this.p.t === 'O') return; const p = this.p, to = (p.r + d + 4) % 4, k = (p.t === 'I' ? KI : KJ)['' + p.r + to];
    for (let i = 0; i < 5; i++) { const x = p.x + k[2 * i], y = p.y - k[2 * i + 1];
      if (this.fits(p.t, to, x, y)) { p.r = to; p.x = x; p.y = y; this.last = 'r'; this.touched(); return; } }
  }
  ghostY() { let y = this.p.y; while (this.fits(this.p.t, this.p.r, this.p.x, y + 1)) y++; return y; }
  hardDrop() { if (this.dead) return; this.p.y = this.ghostY(); this.lock(); }
  doHold() {
    if (!this.canHold || this.dead) return; const cur = this.p, prev = this.hold; this.hold = cur; this.canHold = false;
    if (prev) this.spawn(prev); else this.spawn();
  }
  tick(dt) {
    if (this.dead) return;
    if (this.grounded()) { this.lt += dt; if (this.lt >= 500) return this.lock(); }
    const iv = 700 / this.speed / (this.soft ? 20 : 1); this.gt += dt;
    while (this.gt >= iv) { this.gt -= iv; if (!this.grounded()) { this.p.y++; this.last = 'g'; } else break; }
  }
  lock() {
    const p = this.p; let tspin = false;
    if (p.t === 'T' && this.last === 'r') {
      const c = [[0,0],[2,0],[0,2],[2,2]].filter(([dx, dy]) => { const X = p.x + dx, Y = p.y + dy; return X < 0 || X >= 10 || Y >= 22 || (Y >= 0 && this.b[Y][X]); }).length;
      tspin = c >= 3;
    }
    cells(p.t, p.r).forEach(([cx, cy], i) => { const Y = p.y + cy; if (Y >= 0) this.b[Y][p.x + cx] = { c: p.t, pw: i === p.pw }; });
    const full = []; this.b.forEach((row, y) => row.every(Boolean) && full.push(y));
    let pw = 0; full.forEach(y => this.b[y].forEach(c => c.pw && pw++));
    full.forEach(y => { this.b.splice(y, 1); this.b.unshift(empty()); });
    this.locked++; this.canHold = true;
    const hidden = cells(p.t, p.r).every(([, cy]) => p.y + cy < 2);
    this.h.onLock({ n: this.locked, lines: full.length, tspin, pw, cleared: full });
    if (hidden && !full.length) return this.die();
    this.spawn();
  }
  applyGarbage(holes) {
    for (const hole of holes) {
      if (this.b[0].some(Boolean)) return this.die();
      this.b.shift(); this.b.push(Array.from({ length: 10 }, (_, x) => x === hole ? null : { c: 'G' }));
    }
    while (!this.fits(this.p.t, this.p.r, this.p.x, this.p.y) && this.p.y > -2) this.p.y--;
  }
  clearBottom(k) { for (let i = 0; i < k; i++) { this.b.pop(); this.b.unshift(empty()); } }
  snapshot() { return this.b.map(r => r.map(c => c ? c.c : '.').join('')).join(''); }
}
