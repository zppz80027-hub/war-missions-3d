# ⚔️ War Missions 3D

A simple **low-poly 3D co-op multiplayer** browser game. Create a room, share the
4-letter code, and fight through 3 missions with up to **4 friends** — on mobile
or desktop. Real 3D graphics (Three.js), no downloads.

## 🎮 How to play

| Mission | Enemies |
|---------|---------|
| Mission 1 | 8 enemies |
| Mission 2 | 12 enemies + 1 mini-boss |
| Mission 3 | 15 enemies + 1 big boss |

- **Mobile:** left thumb = virtual joystick to move, red ⚔️ button = sword attack
- **Desktop:** WASD / arrow keys to move, mouse click or SPACE to attack
- Downed players respawn after 5s if a teammate is alive.
- Whole team down → Game Over. Clear all 3 missions → Victory!

## 🚀 Run locally

```bash
cd war-game-3d
npm install
npm start
```

Then open **http://localhost:3000** (or the port shown). Open in 2 tabs/phones
to test multiplayer — one creates a room, the other joins with the code.

## ☁️ Deploy on Render (free)

1. Push this folder to a GitHub repo.
2. On [render.com](https://render.com) → **New +** → **Web Service** → connect the repo.
3. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - The server already reads `process.env.PORT`, so no extra config needed.
4. Open the Render URL, create a room, share the code — friends join from any phone.

## 🛠️ Tech

- **Server:** Node.js + Express + Socket.io — server-authoritative state
  (positions, HP, enemy AI, mission progress simulated at 20 ticks/sec).
- **Client:** `public/index.html` — Three.js (CDN) low-poly warriors, enemies,
  arena with torches/fog/particles, third-person follow camera, canvas name
  sprites, touch joystick + attack button, keyboard/mouse fallback.
- **Performance:** shared geometries/materials, pixel ratio capped at 2,
  pooled particles, no shadows — aimed at mid-range phones.

## 📁 Files

```
war-game-3d/
├── server.js          # Express + Socket.io game server (rooms, AI, missions)
├── package.json       # deps + start script (Render-compatible)
├── public/
│   └── index.html     # full 3D game client
└── README.md
```
