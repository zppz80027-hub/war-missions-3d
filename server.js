// War Missions 3D — server-authoritative multiplayer game server
// Node.js + Express + Socket.io. Render-ready (process.env.PORT).

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
app.use(express.static(__dirname));
app.get('/health', (req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;

// ---------- tuning ----------
const TICK_MS = 50;              // 20 ticks/sec
const ARENA = 19;                // playable half-size
const PLAYER_SPEED = 8;
const PLAYER_HP = 100;
const ATTACK_RANGE = 3.6;
const ATTACK_DMG = 25;
const ATTACK_CD_MS = 450;
const MAX_ALIVE_ENEMIES = 6;
const RESPAWN_MS = 5000;

const COLORS = [0x3b82f6, 0x22c55e, 0xf59e0b, 0xc084fc];

const MISSIONS = [
  { normal: 8,  miniboss: 0, boss: 0 },
  { normal: 12, miniboss: 1, boss: 0 },
  { normal: 15, miniboss: 0, boss: 1 },
];

const ENEMY_STATS = {
  normal:   { hp: 95,  speed: 5.8, dmg: 14, range: 2.0, cd: 1000, scale: 1.0 },
  miniboss: { hp: 480, speed: 4.8, dmg: 26, range: 2.4, cd: 900,  scale: 1.6 },
  boss:     { hp: 1200, speed: 4.4, dmg: 38, range: 2.9, cd: 800,  scale: 2.3 },
};

let enemySeq = 1;
const rooms = new Map(); // code -> room

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do {
    c = Array.from({ length: 4 }, () => chars[(Math.random() * chars.length) | 0]).join('');
  } while (rooms.has(c));
  return c;
}

function edgeSpawn() {
  const a = Math.random() * Math.PI * 2;
  const r = 11 + Math.random() * 5;
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}

function makeEnemy(kind) {
  const s = ENEMY_STATS[kind];
  const p = edgeSpawn();
  return {
    id: enemySeq++, kind,
    x: p.x, z: p.z, angle: 0,
    hp: s.hp, maxHp: s.hp,
    speed: s.speed, dmg: s.dmg, range: s.range, cd: s.cd, scale: s.scale,
    nextAttack: 0, hitAt: 0, dead: false,
  };
}

function missionSub(n) {
  const m = MISSIONS[n - 1];
  let s = `${m.normal} enemies`;
  if (m.miniboss) s += ' + MINI-BOSS';
  if (m.boss) s += ' + BOSS';
  return s;
}

function startMission(room, n) {
  room.mission = n;
  const m = MISSIONS[n - 1];
  room.spawnQueue = [];
  for (let i = 0; i < m.normal; i++) room.spawnQueue.push('normal');
  for (let i = 0; i < m.miniboss; i++) room.spawnQueue.push('miniboss');
  for (let i = 0; i < m.boss; i++) room.spawnQueue.push('boss');
  room.spawnQueue.sort(() => Math.random() - 0.5);
  room.enemies = [];
  room.lastSpawn = 0;
  room.missionClearAt = 0;
  io.to(room.code).emit('banner', { type: 'mission', text: `MISSION ${n}`, sub: missionSub(n) });
}

function resetPlayers(room) {
  let i = 0;
  const n = Math.max(1, room.players.size);
  for (const p of room.players.values()) {
    const a = (i / n) * Math.PI * 2;
    p.x = Math.cos(a) * 4; p.z = Math.sin(a) * 4;
    p.angle = 0; p.hp = PLAYER_HP; p.alive = true;
    p.kills = 0; p.respawnAt = 0; p.nextAttack = 0; p.attackAt = 0;
    p.input = { x: 0, z: 0 };
    i++;
  }
}

function startGame(room) {
  room.state = 'playing';
  resetPlayers(room);
  startMission(room, 1);
}

function lobbyInfo(room) {
  return {
    code: room.code,
    state: room.state,
    host: room.hostId,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, color: p.color })),
  };
}

function snapshot(room) {
  const now = Date.now();
  return {
    state: room.state,
    mission: room.mission,
    totalMissions: MISSIONS.length,
    remaining: room.enemies.length + room.spawnQueue.length,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, color: p.color,
      x: +p.x.toFixed(2), z: +p.z.toFixed(2), angle: +p.angle.toFixed(2),
      hp: Math.max(0, Math.round(p.hp)), alive: p.alive,
      kills: p.kills, attacking: now - p.attackAt < 350,
    })),
    enemies: room.enemies.map(e => ({
      id: e.id, kind: e.kind,
      x: +e.x.toFixed(2), z: +e.z.toFixed(2), angle: +e.angle.toFixed(2),
      hp: Math.max(0, Math.round(e.hp)), maxHp: e.maxHp, scale: e.scale,
      hit: now - e.hitAt < 150,
    })),
  };
}

function tickRoom(room) {
  const now = Date.now();

  if (room.state !== 'playing') {
    io.to(room.code).emit('state', snapshot(room));
    return;
  }

  // --- players ---
  for (const p of room.players.values()) {
    if (!p.alive) {
      if (p.respawnAt && now >= p.respawnAt) {
        p.x = (Math.random() - 0.5) * 6;
        p.z = (Math.random() - 0.5) * 6;
        p.hp = PLAYER_HP; p.alive = true; p.respawnAt = 0;
        io.to(room.code).emit('banner', { type: 'info', text: `${p.name} is back!`, sub: '' });
      }
      continue;
    }
    const ix = p.input.x || 0, iz = p.input.z || 0;
    if (Math.hypot(ix, iz) > 0.05) {
      const len = Math.hypot(ix, iz);
      const nx = ix / Math.max(1, len), nz = iz / Math.max(1, len);
      p.x += nx * PLAYER_SPEED * (TICK_MS / 1000);
      p.z += nz * PLAYER_SPEED * (TICK_MS / 1000);
      p.angle = Math.atan2(nx, nz);
      const d = Math.hypot(p.x, p.z);
      if (d > ARENA) { p.x *= ARENA / d; p.z *= ARENA / d; }
    }
  }

  // --- spawn enemies (waves) ---
  if (room.spawnQueue.length > 0 && room.enemies.length < MAX_ALIVE_ENEMIES && now - room.lastSpawn > 700) {
    room.enemies.push(makeEnemy(room.spawnQueue.shift()));
    room.lastSpawn = now;
  }

  // --- enemy AI ---
  const alivePlayers = [...room.players.values()].filter(p => p.alive);
  for (const e of room.enemies) {
    let best = null, bd = Infinity;
    for (const p of alivePlayers) {
      const d = Math.hypot(p.x - e.x, p.z - e.z);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best) continue;
    e.angle = Math.atan2(best.x - e.x, best.z - e.z);
    if (bd > e.range) {
      e.x += Math.sin(e.angle) * e.speed * (TICK_MS / 1000);
      e.z += Math.cos(e.angle) * e.speed * (TICK_MS / 1000);
    } else if (now >= e.nextAttack) {
      e.nextAttack = now + e.cd;
      best.hp -= e.dmg;
      if (best.hp <= 0) {
        best.hp = 0; best.alive = false;
        const anyAlive = [...room.players.values()].some(p => p.alive);
        if (anyAlive) {
          best.respawnAt = now + RESPAWN_MS;
          io.to(room.code).emit('banner', { type: 'info', text: `${best.name} is down!`, sub: 'Respawning in 5s — survive!' });
        } else {
          room.state = 'gameover';
          io.to(room.code).emit('banner', { type: 'gameover', text: 'GAME OVER', sub: 'The whole team was defeated' });
        }
      }
    }
  }

  // --- mission clear? ---
  if (!room.missionClearAt && room.enemies.length === 0 && room.spawnQueue.length === 0) {
    if (room.mission < MISSIONS.length) {
      room.missionClearAt = now + 2500;
      io.to(room.code).emit('banner', { type: 'complete', text: `MISSION ${room.mission} COMPLETE!`, sub: 'Get ready for the next one...' });
    } else {
      room.state = 'victory';
      io.to(room.code).emit('banner', { type: 'victory', text: 'VICTORY!', sub: 'All 3 missions cleared. Legends!' });
    }
  }
  if (room.missionClearAt && now >= room.missionClearAt) {
    startMission(room, room.mission + 1);
  }

  io.to(room.code).emit('state', snapshot(room));
}

function getRoomOf(socket) {
  for (const room of rooms.values()) {
    if (room.players.has(socket.id)) return room;
  }
  return null;
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name }) => {
    const clean = String(name || 'Player').slice(0, 12) || 'Player';
    const code = makeCode();
    const room = {
      code, players: new Map(), state: 'lobby',
      mission: 1, enemies: [], spawnQueue: [],
      hostId: socket.id, timer: null, missionClearAt: 0, lastSpawn: 0,
    };
    const color = COLORS[0];
    room.players.set(socket.id, {
      id: socket.id, name: clean, color, x: 0, z: 0, angle: 0,
      hp: PLAYER_HP, alive: true, kills: 0, input: { x: 0, z: 0 },
      nextAttack: 0, attackAt: 0, respawnAt: 0,
    });
    rooms.set(code, room);
    socket.join(code);
    socket.emit('joined', lobbyInfo(room));
    io.to(code).emit('roomUpdate', lobbyInfo(room));
  });

  socket.on('joinRoom', ({ name, code }) => {
    const clean = String(name || 'Player').slice(0, 12) || 'Player';
    const c = String(code || '').toUpperCase().trim();
    const room = rooms.get(c);
    if (!room) return socket.emit('errorMsg', 'Room not found. Check the code.');
    if (room.state !== 'lobby') return socket.emit('errorMsg', 'Game already running in this room.');
    if (room.players.size >= 4) return socket.emit('errorMsg', 'Room is full (4 players max).');
    const color = COLORS[room.players.size % COLORS.length];
    room.players.set(socket.id, {
      id: socket.id, name: clean, color, x: 0, z: 0, angle: 0,
      hp: PLAYER_HP, alive: true, kills: 0, input: { x: 0, z: 0 },
      nextAttack: 0, attackAt: 0, respawnAt: 0,
    });
    socket.join(code);
    socket.emit('joined', lobbyInfo(room));
    io.to(room.code).emit('roomUpdate', lobbyInfo(room));
  });

  socket.on('startGame', () => {
    const room = getRoomOf(socket);
    if (!room || room.state !== 'lobby') return;
    if (room.hostId !== socket.id) return socket.emit('errorMsg', 'Only the host can start.');
    startGame(room);
    room.timer = setInterval(() => tickRoom(room), TICK_MS);
  });

  socket.on('restart', () => {
    const room = getRoomOf(socket);
    if (!room || (room.state !== 'victory' && room.state !== 'gameover')) return;
    if (room.hostId !== socket.id) return socket.emit('errorMsg', 'Only the host can restart.');
    startGame(room);
  });

  socket.on('input', ({ x, z }) => {
    const room = getRoomOf(socket);
    const p = room && room.players.get(socket.id);
    if (!p) return;
    const cx = Math.max(-1, Math.min(1, Number(x) || 0));
    const cz = Math.max(-1, Math.min(1, Number(z) || 0));
    p.input = { x: cx, z: cz };
  });

  socket.on('attack', () => {
    const room = getRoomOf(socket);
    const p = room && room.players.get(socket.id);
    if (!room || room.state !== 'playing' || !p || !p.alive) return;
    const now = Date.now();
    if (now < p.nextAttack) return;
    p.nextAttack = now + ATTACK_CD_MS;
    p.attackAt = now;
    for (const e of room.enemies) {
      const dx = e.x - p.x, dz = e.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > ATTACK_RANGE + e.scale * 0.6) continue;
      let diff = Math.atan2(dx, dz) - p.angle;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (Math.abs(diff) > 1.25) continue;
      e.hp -= ATTACK_DMG;
      e.hitAt = now;
      const push = 1.3;
      e.x += (dx / Math.max(0.01, d)) * push;
      e.z += (dz / Math.max(0.01, d)) * push;
      if (e.hp <= 0) { e.dead = true; p.kills++; }
    }
    if (room.enemies.some(e => e.dead)) {
      room.enemies = room.enemies.filter(e => !e.dead);
    }
  });

  socket.on('disconnect', () => {
    const room = getRoomOf(socket);
    if (!room) return;
    room.players.delete(socket.id);
    socket.leave(room.code);
    if (room.players.size === 0) {
      if (room.timer) clearInterval(room.timer);
      rooms.delete(room.code);
      return;
    }
    if (room.hostId === socket.id) {
      room.hostId = [...room.players.keys()][0];
    }
    io.to(room.code).emit('roomUpdate', lobbyInfo(room));
  });
});

server.listen(PORT, () => console.log(`War Missions 3D listening on ${PORT}`));
