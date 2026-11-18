import { COLORS, cells } from './tetrisEngine.js';
const parts = [];
export function burst(x, y, color, n = 24) { for (let i = 0; i < n; i++) parts.push({ x, y, vx: (Math.random() - .5) * 8, vy: (Math.random() - .8) * 7, life: 1, color }); }
function block(ctx, x, y, s, color, pw) {
  ctx.fillStyle = color; ctx.fillRect(x, y, s, s);
  ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fillRect(x, y, s, Math.max(2, s / 7));
  if (!pw) return;
  // Power-up block: dark core, hue-cycling neon border that pulses, star in the middle.
  const t = performance.now(), g = .5 + .5 * Math.sin(t / 140), h = (t / 8) % 360;
  ctx.save(); ctx.fillStyle = '#1b0f33'; ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
  ctx.shadowColor = `hsl(${h},100%,60%)`; ctx.shadowBlur = 8 + 12 * g;
  ctx.strokeStyle = `hsl(${h},100%,${60 + 15 * g}%)`; ctx.lineWidth = 2.5; ctx.strokeRect(x + 2, y + 2, s - 4, s - 4); ctx.restore();
  ctx.fillStyle = '#fff'; ctx.font = `900 ${s * .62}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('★', x + s / 2, y + s / 2 + 1); ctx.textBaseline = 'alphabetic';
}
function koOverlay(ctx, w, h, s, sub) {
  ctx.fillStyle = 'rgba(10,5,20,.74)'; ctx.fillRect(0, 0, w, h); ctx.textAlign = 'center';
  ctx.fillStyle = '#ff6b9a'; ctx.font = `900 ${s * 2.4}px "Arial Black",Impact,sans-serif`; ctx.fillText('KO', w / 2, h / 2);
  ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.max(11, s * .62)}px sans-serif`; ctx.fillText(sub === true ? 'TOPPED OUT' : sub, w / 2, h / 2 + s * 1.2);
}
// ko: false, true (shows "TOPPED OUT"), or a custom subtitle string
export function drawBoard(cv, g, s, fog, ko) {
  const ctx = cv.getContext('2d'), w = 10 * s, h = 20 * s; cv.width = w; cv.height = h; ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,.05)'; for (let i = 1; i < 10; i++) { ctx.beginPath(); ctx.moveTo(i * s, 0); ctx.lineTo(i * s, h); ctx.stroke(); }
  g.b.forEach((row, y) => row.forEach((c, x) => y >= 2 && c && block(ctx, x * s, (y - 2) * s, s, COLORS[c.c], c.pw)));
  if (!g.dead) {
    const gy = g.ghostY(); cells(g.p.t, g.p.r).forEach(([cx, cy]) => { const Y = gy + cy - 2; if (Y >= 0) { ctx.strokeStyle = COLORS[g.p.t]; ctx.globalAlpha = .5; ctx.strokeRect((g.p.x + cx) * s + 1, Y * s + 1, s - 2, s - 2); ctx.globalAlpha = 1; } });
    cells(g.p.t, g.p.r).forEach(([cx, cy], i) => { const Y = g.p.y + cy - 2; if (Y >= 0) block(ctx, (g.p.x + cx) * s, Y * s, s, COLORS[g.p.t], i === g.p.pw); });
  }
  if (fog > 0) { ctx.fillStyle = 'rgba(190,200,215,.96)'; ctx.fillRect(0, 0, w, h / 2); ctx.fillStyle = '#556'; ctx.font = '16px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('FOG', w / 2, h / 4); }
  parts.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += .35; p.life -= .03; ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 5, 5); });
  ctx.globalAlpha = 1; for (let i = parts.length - 1; i >= 0; i--) if (parts[i].life <= 0) parts.splice(i, 1);
  if (ko) koOverlay(ctx, w, h, s, ko);
}
export function drawSnap(cv, str, s, ko) {
  const ctx = cv.getContext('2d'), w = 10 * s, h = 20 * s; cv.width = w; cv.height = h; ctx.clearRect(0, 0, w, h);
  for (let y = 2; y < 22; y++) for (let x = 0; x < 10; x++) { const c = str[y * 10 + x]; if (c && c !== '.') block(ctx, x * s, (y - 2) * s, s, COLORS[c], false); }
  if (ko) koOverlay(ctx, w, h, s, ko);
}
export function drawMini(cv, t) {
  const ctx = cv.getContext('2d'), s = 16; cv.width = 4 * s + 8; cv.height = 3 * s; ctx.clearRect(0, 0, cv.width, cv.height);
  if (!t) return; const c = cells(t, 0); const minX = Math.min(...c.map(a => a[0])), maxX = Math.max(...c.map(a => a[0])), minY = Math.min(...c.map(a => a[1]));
  const ox = (cv.width - (maxX - minX + 1) * s) / 2;
  c.forEach(([x, y]) => block(ctx, ox + (x - minX) * s, 4 + (y - minY) * s, s - 1, COLORS[t], false));
}