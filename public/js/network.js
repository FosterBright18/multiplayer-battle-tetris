// WebSocket client with a simulated latency slider applied to both directions.
export class Net {
  constructor(onMsg) { this.onMsg = onMsg; this.lat = 0; this.ping = 0; this.ticks = 0; this.tickRate = 0; this.lastTick = 0; this.ready = false; }
  connect(token) {
    return new Promise(res => {
      this.ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
      this.ws.onopen = () => { this.ready = true; this.send({ t: 'auth', token }); res(); this.timer = setInterval(() => this.send({ t: 'ping', ts: performance.now() }), 1000); };
      this.ws.onmessage = e => { const m = JSON.parse(e.data); setTimeout(() => {
        if (m.t === 'pong') this.ping = Math.round(performance.now() - m.ts);
        if (m.t === 'tick') { const now = performance.now(); if (this.lastTick) this.tickRate = +(20 * 1000 / (now - this.lastTick)).toFixed(1); this.lastTick = now; this.tick = m.n; }
        this.onMsg(m); }, this.lat); };
      this.ws.onclose = () => { this.ready = false; clearInterval(this.timer); this.onMsg({ t: 'closed' }); };
    });
  }
  send(o) { setTimeout(() => this.ready && this.ws.readyState === 1 && this.ws.send(JSON.stringify(o)), this.lat); }
}
