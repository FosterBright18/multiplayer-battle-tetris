import { Tetris } from './tetrisEngine.js';
import { drawBoard, drawSnap, drawMini, burst } from './renderer.js';
import { Net } from './network.js';
import { sfx } from './soundManager.js';
const $ = id => document.getElementById(id);
const POW = {
  fog: { icon: '🌫', name: 'Fog / Blindness', color: '#9fb4c8', desc: 'Hides the top half of your opponent’s board for 6 seconds.' },
  surge: { icon: '⚡', name: 'Speed Surge', color: '#ffd166', desc: 'Doubles your opponent’s gravity (2x drop speed) for 8 seconds.' },
  clear3: { icon: '🧹', name: 'Clear Bottom 3', color: '#6ee7a0', desc: 'Instantly deletes the bottom 3 rows of your own board. Great for surviving garbage spikes.' },
  reverse: { icon: '🔀', name: 'Reverse Controls', color: '#ff6b9a', desc: 'Swaps your opponent’s Left and Right controls for 5 seconds.' },
  shield: { icon: '🛡', name: 'Shield', color: '#5b8cff', desc: 'Blocks the next incoming garbage attack or enemy power-up.' } };
const BLANK = '.'.repeat(220), fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
let net = null, user = null, game = null, running = false, last = 0, lastSnap = 0, fog = 0, revT = 0, surgeT = 0, oppSnap = '', koOpp = false;
let st = { inv: [], shield: false, pending: 0 }, lbTimer = null, toastT = null, oppName = '';

/* ---------- API + session ---------- */
async function api(path, body, token) {
  const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Request failed.'); return d;
}
function setUser(d) {
  user = { token: d.token, username: d.username, elo_rating: d.elo_rating, wins: d.wins, losses: d.losses, guest: !!d.guest };
  localStorage.setItem('tb-user', JSON.stringify(user)); renderBadge();
}
function renderBadge() {
  $('userbar').hidden = !user; if (!user) return;
  $('bName').textContent = user.username; $('bElo').textContent = user.guest ? 'Unranked guest' : `Elo ${user.elo_rating}`;
  $('bRec').textContent = user.guest ? '' : `${user.wins}W · ${user.losses}L`;
}
async function refreshProfile() { if (!user || user.guest) return; try { setUser({ ...(await api('/api/me', null, user.token)), token: user.token }); } catch {} }
async function loadBoard() {
  try { const rows = await (await fetch('/api/leaderboard')).json();
    $('lb').innerHTML = ''; if (!rows.length) { $('lb').innerHTML = '<li>No ranked players yet. Register and win a match.</li>'; return; }
    rows.forEach((r, i) => { const li = document.createElement('li'), a = document.createElement('span'), b = document.createElement('b');
      a.textContent = `${i + 1}. ${r.username}`; b.textContent = r.elo_rating; li.append(a, b); $('lb').append(li); });
  } catch {}
}
const show = s => ['auth', 'lobby', 'game'].forEach(x => $(x).hidden = x !== s);
async function enter(d) {
  setUser(d); if (net) { net.onMsg = () => {}; net.ws && net.ws.close(); }
  net = new Net(onMsg); net.lat = +$('lat').value; await net.connect(user.token);
  show('lobby'); $('status').textContent = ''; $('roomcode').textContent = ''; loadBoard();
  clearInterval(lbTimer); lbTimer = setInterval(() => { if (!$('lobby').hidden) loadBoard(); }, 10000);
}
function logout() {
  running = false; game = null; if (net) { net.onMsg = () => {}; net.ws && net.ws.close(); net = null; }
  clearInterval(lbTimer); localStorage.removeItem('tb-user'); user = null; renderBadge(); $('modal').hidden = true; show('auth'); tab('login');
}
$('logout').onclick = logout;

/* ---------- auth screen ---------- */
function tab(name) {
  document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === name));
  document.querySelectorAll('[data-panel]').forEach(p => p.hidden = p.dataset.panel !== name); $('err').textContent = '';
}
document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => tab(b.dataset.tab));
const submit = (path, fields) => async e => { e.preventDefault(); $('err').textContent = ''; try { await enter(await api(path, fields())); } catch (x) { $('err').textContent = x.message; } };
$('f-login').onsubmit = submit('/api/auth/login', () => ({ username: $('lu').value.trim(), password: $('lp').value }));
$('f-register').onsubmit = submit('/api/auth/register', () => ({ username: $('ru').value.trim(), password: $('rp').value }));
$('guest').onclick = submit('/api/auth/guest', () => ({}));

/* ---------- lobby ---------- */
$('pgrid').innerHTML = Object.values(POW).map(p => `<div class="pcard" style="--c:${p.color}"><span class="pi">${p.icon}</span><div><b>${p.name}</b><p>${p.desc}</p></div></div>`).join('');
$('qm').onclick = () => { net.send({ t: 'queue' }); $('status').textContent = 'Searching within ±100 Elo…'; };
const LVL = { easy: 'Slow and forgiving. It stacks up easily, so it’s a good place to learn power-ups.', medium: 'Steady pressure with occasional combos and power-ups.', hard: 'Fast. Chains combos and casts power-ups often.' };
let lvl = localStorage.getItem('tb-lvl'); if (!LVL[lvl]) lvl = 'easy';
function setLvl(l) { lvl = l; localStorage.setItem('tb-lvl', l); document.querySelectorAll('[data-lvl]').forEach(b => b.setAttribute('aria-checked', b.dataset.lvl === l)); $('lvlhelp').textContent = LVL[l]; }
document.querySelectorAll('[data-lvl]').forEach(b => b.onclick = () => setLvl(b.dataset.lvl)); setLvl(lvl);
$('bot').onclick = () => net.send({ t: 'bot', level: lvl });
$('mk').onclick = () => net.send({ t: 'create' });
$('jn').onclick = () => net.send({ t: 'join', code: $('code').value });
$('lat').oninput = e => { $('latv').textContent = e.target.value + 'ms'; if (net) net.lat = +e.target.value; };
$('vol').value = Math.round(sfx.volume() * 100);
const syncMute = () => { $('mute').textContent = sfx.isMuted() ? '🔇' : '🔊'; $('mute').setAttribute('aria-label', sfx.isMuted() ? 'Unmute sound' : 'Mute sound'); };
$('vol').oninput = e => { sfx.setVolume(e.target.value / 100); if (sfx.isMuted()) { sfx.setMuted(false); syncMute(); } };
$('mute').onclick = () => { sfx.setMuted(!sfx.isMuted()); syncMute(); }; syncMute();
['pointerdown', 'keydown'].forEach(ev => addEventListener(ev, () => sfx.unlock(), { once: true }));

/* ---------- feedback helpers ---------- */
const feed = msg => { const li = document.createElement('li'); li.textContent = msg; $('feed').prepend(li); while ($('feed').children.length > 40) $('feed').lastChild.remove(); };
const shake = () => { $('stage').classList.remove('shake'); void $('stage').offsetWidth; $('stage').classList.add('shake'); };
const hit = () => { const b = document.querySelector('.bw'); b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit'); };
function toast(msg, color) {
  const t = $('toast'); t.textContent = msg; t.style.setProperty('--c', color || '#ffd166'); t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3400);
}
function glow(i) { const b = $('s' + i); b.classList.remove('glow'); void b.offsetWidth; b.classList.add('glow'); }
function renderInv() {
  [0, 1].forEach(i => { const t = st.inv[i], b = $('s' + i), p = t && POW[t];
    b.querySelector('span').textContent = p ? `${p.icon} ${p.name}` : 'Empty'; b.className = 'slot' + (p ? ' full' : ''); b.style.setProperty('--c', p ? p.color : '');
    if (b.dataset.g) b.classList.add('glow'); });
  $('shield').hidden = !st.shield; $('pend').style.height = Math.min(560, st.pending * 28) + 'px'; $('pend').classList.toggle('danger', st.pending >= 8); $('pendn').textContent = st.pending ? '+' + st.pending : '';
}

/* ---------- network messages ---------- */
function onMsg(m) {
  if (m.t === 'queue') $('status').textContent = `Searching… ${m.waited}s, Elo window ±${m.window}`;
  else if (m.t === 'code') { $('roomcode').textContent = m.code; $('status').textContent = 'Share this code with a friend. Waiting for them to join…'; }
  else if (m.t === 'error') ($('modal').hidden ? $('status') : $('mNote')).textContent = m.msg;
  else if (m.t === 'match') start(m);
  else if (m.t === 'state') { if (m.pending > st.pending) { sfx.warn(); hit(); toast(`⚠ INCOMING: +${m.pending - st.pending} GARBAGE`, '#ff6b9a'); } st = m; renderInv(); }
  else if (m.t === 'atk') toast(m.blocked ? '🛡 THEY BLOCKED YOUR ATTACK' : m.sent ? `➡ SENT ${m.sent} GARBAGE${m.cancelled ? ` (cancelled ${m.cancelled})` : ''}` : `✂ CANCELLED ${m.cancelled} INCOMING`, m.blocked ? '#5b8cff' : '#6ee7a0');
  else if (m.t === 'shieldhit') toast(`🛡 SHIELD BLOCKED ${m.n} GARBAGE`, '#5b8cff');
  else if (m.t === 'got') m.got.forEach(g => { const p = POW[g.type]; sfx.pickup(); glow(g.slot); toast(`${p.icon} PICKED UP: ${p.name.toUpperCase()}! Press [${g.slot + 1}] to cast`, p.color); });
  else if (m.t === 'apply' && game) { game.applyGarbage(m.holes); shake(); sfx.hard(); hit(); toast(`💥 ${m.holes.length} GARBAGE ${m.holes.length > 1 ? 'ROWS' : 'ROW'} LANDED`, '#ff6b9a'); }
  else if (m.t === 'board') oppSnap = m.s;
  else if (m.t === 'feed') feed(m.msg);
  else if (m.t === 'power' && game) power(m);
  else if (m.t === 'over') finish(m);
  else if (m.t === 'rematch_req') $('mNote').textContent = 'Your opponent wants a rematch.';
  else if (m.t === 'rematch_fail') { $('mNote').textContent = 'Your opponent left. Return to the lobby to find a new match.'; $('rematch').disabled = true; }
  else if (m.t === 'closed' && running) finish({ win: false, reason: 'closed' });
}
function power(m) {
  const mine = m.fromIdx === net.you, p = POW[m.type];
  shake(); burst(150, 250, p.color, 40); mine ? sfx.cast() : sfx.warn();
  if (m.blocked) return;
  if (!mine && m.target === net.you) toast(`⚠ ${m.from} cast ${p.name.toUpperCase()} on you!`, '#ff6b9a');
  if (m.target !== net.you) return;
  if (m.type === 'clear3') game.clearBottom(3);
  else if (m.type === 'fog') fog = 6;
  else if (m.type === 'surge') { surgeT = 8; game.speed = 2; }
  else if (m.type === 'reverse') { revT = 5; game.rev = true; }
}

/* ---------- match lifecycle ---------- */
function start(m) {
  net.you = m.you; oppName = m.opp.name; show('game'); $('modal').hidden = true; $('toast').classList.remove('show'); $('feed').innerHTML = '';
  st = { inv: [], shield: false, pending: 0 }; renderInv(); fog = revT = surgeT = 0; oppSnap = ''; koOpp = false;
  $('oppname').textContent = `${m.opp.name} · Elo ${m.opp.elo}`;
  game = new Tetris(m.seed, {
    onLock: e => { net.send({ t: 'lock', n: e.n, lines: e.lines, tspin: e.tspin, pw: e.pw }); if (e.lines) { burst(150, 400, '#fff', 14 * e.lines); sfx.clear(e.lines); } },
    onTop: () => net.send({ t: 'top' }) });
  running = true; last = performance.now(); requestAnimationFrame(loop);
}
const reasonText = m => m.reason === 'closed' ? 'Connection lost' : m.reason === 'disconnect' ? 'Opponent disconnected' : m.win ? 'Opponent topped out' : 'You topped out';
const eloText = e => { if (!e) return 'Unranked'; const d = e.new - e.old; return `${e.old} → ${e.new} (${d >= 0 ? '+' : ''}${d} ELO)`; };
function finish(m) {
  if (!running) return; running = false;
  if (!m.win && game) game.dead = true;                    // freeze + KO overlay on my board
  koOpp = m.win ? (m.reason === 'disconnect' ? 'DISCONNECTED' : true) : false;
  render(); m.win ? sfx.win() : sfx.lose();
  setTimeout(() => showModal(m), 900); refreshProfile().then(loadBoard);
}
function showModal(m) {
  const s = m.stats || { you: {}, opp: {} };
  $('mTitle').textContent = m.win ? 'VICTORY' : 'DEFEAT'; $('mTitle').className = m.win ? 'win' : 'lose'; $('mReason').textContent = reasonText(m);
  $('mOpp').textContent = oppName;
  [['L', 'lines'], ['G', 'sent'], ['P', 'pu']].forEach(([k, f]) => { $('m' + k + '0').textContent = s.you[f] ?? '–'; $('m' + k + '1').textContent = s.opp[f] ?? '–'; });
  $('mDur').textContent = m.dur != null ? fmt(m.dur) : '–'; $('mE0').textContent = eloText(m.elo); $('mE1').textContent = eloText(m.oppElo);
  $('mNote').textContent = m.reason === 'closed' ? 'Reconnect by returning to the lobby.' : ''; $('rematch').disabled = m.reason === 'closed';
  $('modal').hidden = false; $('rematch').focus();
}
$('rematch').onclick = () => { net.send({ t: 'rematch' }); $('rematch').disabled = true; $('mNote').textContent = 'Waiting for your opponent…'; };
$('home').onclick = () => { $('modal').hidden = true; running = false; if (net && net.ready) net.send({ t: 'cancel' }); show('lobby'); $('status').textContent = ''; loadBoard(); };

/* ---------- render loop ---------- */
function render() {
  drawBoard($('me'), game, 28, fog, game.dead);
  drawSnap($('opp'), oppSnap || BLANK, 16, koOpp);
  drawMini($('hold'), game.hold && game.hold.t); drawMini($('n0'), game.q[0]); drawMini($('n1'), game.q[1]); drawMini($('n2'), game.q[2]);
}
function loop(now) {
  if (!running) return; const dt = Math.min(50, now - last); last = now; game.tick(dt); const d = dt / 1000;
  fog = Math.max(0, fog - d); if (revT > 0 && (revT -= d) <= 0) game.rev = false; if (surgeT > 0 && (surgeT -= d) <= 0) game.speed = 1;
  render();
  $('fx').textContent = [fog > 0 && `Fog ${fog.toFixed(0)}s`, surgeT > 0 && `Surge ${surgeT.toFixed(0)}s`, revT > 0 && `Reversed ${revT.toFixed(0)}s`].filter(Boolean).join('  ');
  $('hud').textContent = `ping ${net.ping}ms · sim latency ${net.lat}ms · server tick ${net.tickRate || '–'}/s`;
  if (now - lastSnap > 200) { lastSnap = now; net.send({ t: 'board', s: game.snapshot() }); }
  requestAnimationFrame(loop);
}
const cast = i => net.send({ t: 'cast', slot: i }); $('s0').onclick = () => cast(0); $('s1').onclick = () => cast(1);
addEventListener('keydown', e => {
  if (!running || !game || game.dead || e.target.tagName === 'INPUT') return; const k = e.key; let used = true;
  if (k === 'ArrowLeft') { game.mv(-1); sfx.move(); } else if (k === 'ArrowRight') { game.mv(1); sfx.move(); }
  else if (k === 'ArrowDown') { game.soft = true; sfx.soft(); }
  else if (k === 'ArrowUp' || k === 'x') { game.rot(1); sfx.rotate(); } else if (k === 'z') { game.rot(-1); sfx.rotate(); }
  else if (k === ' ') { game.hardDrop(); sfx.hard(); } else if (k === 'c' || k === 'C' || k === 'Shift') { game.doHold(); sfx.move(); }
  else if (k === '1' || k === 'q') cast(0); else if (k === '2' || k === 'e') cast(1); else used = false;
  if (used) e.preventDefault();
});
addEventListener('keyup', e => { if (e.key === 'ArrowDown' && game) game.soft = false; });

/* ---------- startup: resume a saved account session, otherwise show the auth screen ---------- */
(async () => {
  show('auth'); renderBadge();
  try { const s = JSON.parse(localStorage.getItem('tb-user') || 'null');
    if (s && s.token && !s.guest) await enter({ ...(await api('/api/me', null, s.token)), token: s.token });
  } catch { localStorage.removeItem('tb-user'); user = null; renderBadge(); show('auth'); }
})();