# Battle Tetris

Real-time 1v1 Tetris with power-ups, Elo matchmaking, leaderboard and a server-side bot.

## Run
```
npm install
cp .env.example .env     # optional
npm start                # http://localhost:3000
```
Without `DATABASE_URL`, data is stored in memory (resets on restart). With it, tables are created on startup.
Open two browser tabs, play as guest in each, and use Quick match or a room code. Or press "Duel adaptive bot".

## WebSocket protocol (JSON)
Client → server: `auth{token}`, `ping{ts}`, `queue`, `bot`, `create`, `join{code}`,
`lock{n,lines,tspin,pw}` (every piece lock), `cast{slot}`, `board{s}` (220-char snapshot relay), `top`.
Server → client: `authed`, `queue{waited,window}`, `code{code}`, `match{seed,you,opp}`, `state{inv,shield,pending}`,
`apply{holes[]}` (garbage rows to insert), `power{type,from,to,target}`, `feed{msg}`, `board{s}`, `tick{n}`, `pong{ts,tick}`, `over{win,winner,elo,lines}`, `error{msg}`.

Server authority: the seed (shared 7-bag), garbage amounts, pending-garbage queues and cancelling, power-up grants
(a ★ block exists only on every 6th piece, so earnings are capped by the reported piece count), inventory and casting, shields, Elo.
The client simulates its own board for responsiveness and reports locks and line clears.

## Database
`users(id, username, password_hash, elo_rating=1000, wins, losses, created_at)`
`matches(id, player1_id, player2_id, winner_id, duration_sec, lines_cleared_p1, lines_cleared_p2, powerups_used, created_at)`
Elo uses K=32. Only matches between two registered players are ranked.

REST: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/guest`, `GET /api/leaderboard`, `GET /api/matches/:username`.
