import express from "express";
import http from "node:http";
import crypto from "node:crypto";
import helmet from "helmet";
import bcrypt from "bcryptjs";
import pg from "pg";
import { Server } from "socket.io";

const { Pool } = pg;
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.NODE_ENV === "production" ? false : "*" } });
const PORT = process.env.PORT || 3000;
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
}) : null;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "20kb" }));
app.use(express.static("public"));

const online = new Map();
const sessions = new Map();
const TARGET = 1_000_000;
const jobs = {
  delivery: { label: "Repartidor", reward: 120, cooldown: 20 },
  mechanic: { label: "Mecánico", reward: 180, cooldown: 35 },
  trucker: { label: "Transportista", reward: 250, cooldown: 50 }
};
const lastJob = new Map();

async function initDb() {
  if (!pool) return;
  const fs = await import("node:fs/promises");
  await pool.query(await fs.readFile(new URL("./schema.sql", import.meta.url), "utf8"));
}
async function getBalance(client = pool) {
  if (!client) return Number(globalThis.memoryBalance || 0);
  const { rows } = await client.query("SELECT team_balance FROM game_state WHERE id=1");
  return Number(rows[0]?.team_balance || 0);
}
async function changeBalance({ playerId, username, amount, reason }) {
  if (!Number.isSafeInteger(amount) || amount === 0) throw new Error("Importe inválido");
  if (!pool) {
    globalThis.memoryBalance = Math.max(0, Number(globalThis.memoryBalance || 0) + amount);
    const balance = globalThis.memoryBalance;
    io.emit("economy:update", { balance, target: TARGET, transaction: { username, amount, reason } });
    return balance;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      "UPDATE game_state SET team_balance = team_balance + $1, updated_at=NOW() WHERE id=1 AND team_balance + $1 >= 0 RETURNING team_balance",
      [amount]
    );
    if (!result.rows[0]) throw new Error("Saldo colectivo insuficiente");
    const balance = Number(result.rows[0].team_balance);
    const actual = amount;
    await client.query(
      "INSERT INTO transactions(player_id, username, amount, reason, team_balance_after) VALUES($1,$2,$3,$4,$5)",
      [playerId || null, username, actual, reason, balance]
    );
    if (actual > 0 && playerId) await client.query(
      "INSERT INTO player_progress(player_id,total_contributed,total_earned) VALUES($1,$2,$2) ON CONFLICT(player_id) DO UPDATE SET total_contributed=player_progress.total_contributed+$2,total_earned=player_progress.total_earned+$2,updated_at=NOW()",
      [playerId, actual]
    );
    await client.query("COMMIT");
    io.emit("economy:update", { balance, target: TARGET, transaction: { username, amount: actual, reason } });
    if (balance >= TARGET) io.emit("game:victory", { balance });
    return balance;
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}
function publicPlayers() {
  return [...online.values()].map(p => ({ id:p.id, username:p.username, x:p.x, y:p.y, z:p.z, rotation:p.rotation }));
}
async function auth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer /, "");
  const session = token && sessions.get(token);
  if (!session) return res.status(401).json({ error: "Inicia sesión para continuar" });
  req.player = session;
  next();
}

app.get("/health", async (_req, res) => {
  try { res.json({ ok:true, database: pool ? "postgres-configured" : "memory-demo", players:online.size }); }
  catch { res.status(500).json({ ok:false }); }
});
app.get("/api/state", async (_req, res) => {
  res.json({ balance: await getBalance(), target: TARGET, players: publicPlayers(), jobs });
});
app.post("/api/register", async (req,res) => {
  const username = String(req.body.username || "").trim().slice(0,18);
  const password = String(req.body.password || "");
  if (!/^[\p{L}\p{N}_-]{3,18}$/u.test(username) || password.length < 8)
    return res.status(400).json({ error:"Usuario: 3-18 caracteres. Contraseña: mínimo 8." });
  try {
    const id = crypto.randomUUID();
    const hash = await bcrypt.hash(password, 12);
    if (pool) {
      await pool.query("INSERT INTO players(id,username,password_hash) VALUES($1,$2,$3)", [id,username,hash]);
      await pool.query("INSERT INTO player_progress(player_id) VALUES($1)", [id]);
    } else if ([...sessions.values()].some(s => s.username.toLowerCase() === username.toLowerCase())) {
      return res.status(409).json({ error:"Nombre ocupado en esta sesión de demostración" });
    }
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token,{ id, username });
    res.json({ token, player:{ id, username } });
  } catch(e) { res.status(409).json({ error:"No se pudo crear la cuenta. ¿Usuario ya registrado?" }); }
});
app.post("/api/login", async (req,res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  if (!pool) return res.status(503).json({ error:"El inicio de sesión persistente requiere PostgreSQL. Configura DATABASE_URL." });
  const { rows } = await pool.query("SELECT id,username,password_hash FROM players WHERE username=$1", [username]);
  if (!rows[0] || !(await bcrypt.compare(password, rows[0].password_hash)))
    return res.status(401).json({ error:"Credenciales incorrectas" });
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token,{ id:rows[0].id, username:rows[0].username });
  await pool.query("UPDATE players SET last_seen=NOW() WHERE id=$1",[rows[0].id]);
  res.json({ token, player:{ id:rows[0].id, username:rows[0].username } });
});
app.get("/api/history", auth, async (req,res) => {
  if (!pool) return res.json([]);
  const { rows } = await pool.query("SELECT username,amount,reason,team_balance_after,created_at FROM transactions ORDER BY id DESC LIMIT 30");
  res.json(rows);
});
app.get("/api/me", auth, async (req,res) => {
  if (!pool) return res.json({ player:req.player, contributed:0, balance:await getBalance() });
  const { rows } = await pool.query("SELECT total_contributed,total_earned,level FROM player_progress WHERE player_id=$1",[req.player.id]);
  res.json({ player:req.player, ...(rows[0] || {}), balance:await getBalance() });
});

io.use((socket,next) => {
  const token = socket.handshake.auth?.token;
  const session = token && sessions.get(token);
  if (!session) return next(new Error("AUTH_REQUIRED"));
  socket.data.player = session;
  next();
});
io.on("connection", async socket => {
  const p = socket.data.player;
  online.set(socket.id,{ id:p.id, username:p.username, x:0, y:0, z:18, rotation:0 });
  socket.emit("world:init",{ players:publicPlayers(), balance:await getBalance(), target:TARGET });
  io.emit("players:update",publicPlayers());
  socket.on("player:move", data => {
    const player = online.get(socket.id);
    if (!player || !data || ![data.x,data.y,data.z,data.rotation].every(Number.isFinite)) return;
    // Server clamps movement deltas to prevent obvious teleporting.
    const dx=data.x-player.x, dz=data.z-player.z;
    if (Math.hypot(dx,dz)>2.5) return;
    player.x=data.x; player.y=Math.max(0,Math.min(5,data.y)); player.z=data.z; player.rotation=data.rotation;
    socket.broadcast.emit("player:moved",player);
  });
  socket.on("chat:send", message => {
    const text=String(message || "").trim().slice(0,240);
    if (text) io.emit("chat:message",{ username:p.username, text, at:Date.now() });
  });
  socket.on("job:complete", async type => {
    const job=jobs[type], now=Date.now(), key=p.id+":"+type;
    if (!job) return socket.emit("action:error","Trabajo desconocido");
    if (now-(lastJob.get(key)||0)<job.cooldown*1000) return socket.emit("action:error","Ese trabajo todavía está en descanso");
    lastJob.set(key,now);
    try { const balance=await changeBalance({playerId:p.id,username:p.username,amount:job.reward,reason:"Trabajo: "+job.label});
      socket.emit("action:success",{message:`Trabajo completado: +${job.reward} $ para el equipo`,balance});
    } catch { socket.emit("action:error","No se pudo completar el trabajo"); }
  });
  socket.on("casino:bet", async bet => {
    const amount=Number(bet?.amount), game=String(bet?.game||"");
    if (!Number.isSafeInteger(amount) || amount<10 || amount>500) return socket.emit("action:error","Apuesta permitida: 10–500 $");
    const balance=await getBalance();
    if (balance<amount) return socket.emit("action:error","El equipo no tiene saldo suficiente");
    // Outcomes are generated only on the server. This is a simple slot prototype.
    if (game!=="slots") return socket.emit("action:error","En esta versión solo están habilitadas las tragaperras");
    const symbols=["🍒","🍋","🔔","💎","7️⃣"];
    const reels=Array.from({length:3},()=>symbols[crypto.randomInt(symbols.length)]);
    const win=reels.every(s=>s===reels[0]) ? amount*5 : (reels[0]===reels[1] || reels[1]===reels[2] ? amount : 0);
    try {
      await changeBalance({playerId:p.id,username:p.username,amount:-amount,reason:"Apuesta en tragaperras"});
      if (win) await changeBalance({playerId:p.id,username:p.username,amount:win,reason:"Premio de tragaperras"});
      socket.emit("casino:result",{reels,win,net:win-amount});
    } catch { socket.emit("action:error","No se pudo procesar la apuesta"); }
  });
  socket.on("disconnect",()=>{ online.delete(socket.id); io.emit("players:update",publicPlayers()); });
});

initDb().then(()=>server.listen(PORT,()=>console.log(`Millionaire City listening on ${PORT}`)))
  .catch(err=>{ console.error("Database initialization failed:",err); process.exit(1); });
