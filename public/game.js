const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const viewContainer = document.getElementById('viewContainer');
const navbar = document.getElementById('navbar');
const rulesModal = document.getElementById('rulesModal');
const PLAYER_KEY = 'bananjakt_player';
const AUTH_TOKEN_KEY = 'bananjakt_auth_token';
const DIGIT_TO_FRUIT = ['🍌', '🍒', '🍇', '🍍'];

let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);

function resize() {
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// --- Audio (WebAudio beeps, no files) ---
let audioCtx = null;
function audio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
  }
  return audioCtx;
}
function beep(freq, dur = 0.1, type = 'sine', vol = 0.15) {
  const a = audio(); if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g); g.connect(a.destination);
  o.start(); o.stop(a.currentTime + dur);
}

// --- Game state ---
const ITEMS = {
  banana:  { emoji: '🍌', score: 10, kind: 'good',  weight: 60 },
  cherry:  { emoji: '🍒', score: 15, kind: 'good',  weight: 20 },
  grape:   { emoji: '🍇', score: 20, kind: 'good',  weight: 12 },
  apple:   { emoji: '🍎', score: 25, kind: 'good',  weight: 10 },
  pear:    { emoji: '🍐', score: 30, kind: 'good',  weight: 8  },
  melon:   { emoji: '🍉', score: 35, kind: 'good',  weight: 6  },
  pineapple:{ emoji: '🍍', score: 45, kind: 'good', weight: 4  },
  star:    { emoji: '🌟', score: 0,  kind: 'life',  weight: 3  },
  heart:   { emoji: '💖', score: 0,  kind: 'heart', weight: 6  },
  bolt:    { emoji: '⚡', score: 0,  kind: 'slow',  weight: 4  },
  gem:     { emoji: '💎', score: 0,  kind: 'double', weight: 3 },
  magnet:  { emoji: '🧲', score: 0,  kind: 'magnet', weight: 3 },
  coconut: { emoji: '🥥', score: 0,  kind: 'bad',   weight: 30 },
  bomb:    { emoji: '💣', score: 0,  kind: 'boom',  weight: 18 },
  nuke:    { emoji: '☢️', score: 0,  kind: 'nuke',  weight: 8  },
};

const state = {
  running: false,
  score: 0, combo: 1, comboCount: 0,
  lives: 3,
  best: 0,
  playerName: localStorage.getItem(PLAYER_KEY) || '',
  authToken: localStorage.getItem(AUTH_TOKEN_KEY) || '',
  user: null,
  roomCode: '',
  roomFruits: '',
  joinDraft: '',
  friendsPanelOpen: false,
  joinSectionOpen: false,
  cloudReady: false,
  homeMessage: '',
  leaderboard: [],
  currentView: 'home', // 'home', 'login', 'profile', 'leaderboard'
  paused: false,
  monkey: { x: 0, y: 0, w: 70, vx: 0, target: null },
  items: [],
  particles: [],
  spawnTimer: 0,
  spawnInterval: 900,
  speedMul: 1,
  slowUntil: 0,
  doubleUntil: 0,
  magnetUntil: 0,
  elapsed: 0,
  shake: 0,
  roomPlayers: {}, // { username: { x, playing, lastSeen } }
};

function togglePause() {
  if (!state.running) return;
  state.paused = !state.paused;
  document.getElementById('pauseOverlay').classList.toggle('show', state.paused);
  if (!state.paused) {
    last = performance.now();
    requestAnimationFrame(loop);
  }
}

function updateBestFromLeaderboard() {
  state.best = state.leaderboard[0] ? state.leaderboard[0].score : 0;
  localStorage.setItem('bananjakt_best', String(state.best));
  document.getElementById('best').textContent = state.best;
}

function toRoomCode(raw) {
  const normalized = String(raw || '')
    .replace(/\s+/g, '')
    .replaceAll('🍌', '0')
    .replaceAll('🍒', '1')
    .replaceAll('🍇', '2')
    .replaceAll('🍍', '3')
    .replace(/[^0-3]/g, '');
  return normalized.length === 4 ? normalized : '';
}

function roomCodeToFruits(code) {
  if (!code || code.length !== 4) return '';
  return code.split('').map(n => DIGIT_TO_FRUIT[Number(n)]).join(' ');
}

function draftToFruits(draft) {
  return String(draft || '').split('').map(n => DIGIT_TO_FRUIT[Number(n)] || '').join(' ');
}

function apiFetch(path, options = {}) {
  const authHeader = state.authToken ? { Authorization: `Bearer ${state.authToken}` } : {};
  return fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeader,
      ...(options.headers || {}),
    },
  }).then(async resp => {
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err = data && data.error ? data.error : 'Serverfeil';
      throw new Error(err);
    }
    return data;
  });
}

async function refreshAuthMe() {
  const data = await apiFetch('/api/auth/me', { method: 'GET' });
  state.user = data.user || null;
  if (state.user) {
    state.playerName = state.user.username;
  }
}

async function refreshLeaderboard() {
  const roomPart = state.roomCode ? `?room=${state.roomCode}` : '';
  const data = await apiFetch(`/api/leaderboard${roomPart}`);
  state.leaderboard = Array.isArray(data.leaderboard) ? data.leaderboard.slice(0, 15) : [];
  state.cloudReady = true;
  updateBestFromLeaderboard();
}

function normalizeName(raw) {
  const cleaned = (raw || '').trim().replace(/\s+/g, ' ');
  return cleaned ? cleaned.slice(0, 18) : 'Spiller';
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function savePlayerName() {
  const input = document.getElementById('playerName');
  if (!input) return;
  state.playerName = normalizeName(input.value);
  input.value = state.playerName;
  localStorage.setItem(PLAYER_KEY, state.playerName);
}

async function submitScoreToCloud() {
  if (state.score <= 0) return;
  const data = await apiFetch('/api/scores', {
    method: 'POST',
    body: JSON.stringify({
      roomCode: state.roomCode,
      name: normalizeName(state.playerName),
      score: state.score,
    }),
  });
  state.leaderboard = Array.isArray(data.leaderboard) ? data.leaderboard.slice(0, 15) : state.leaderboard;
  updateBestFromLeaderboard();
}

function renderLeaderboardRows() {
  if (!state.leaderboard.length) {
    return `<tr><td colspan="3" class="empty">Ingen resultater ennå. Bli den første!</td></tr>`;
  }
  return state.leaderboard.map((row, idx) => `
    <tr class="${idx === 0 ? 'top1' : ''}">
      <td>${idx + 1}</td>
      <td>${escapeHtml(row.name)}</td>
      <td>${row.score}</td>
    </tr>
  `).join('');
}

function switchView(view) {
  state.currentView = view;
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  renderCurrentView();
}

function renderCurrentView(opts = {}) {
  const navLoginBtn = document.getElementById('navLoginBtn');
  const navProfileBtn = document.getElementById('navProfileBtn');
  
  if (state.user) {
    navLoginBtn.style.display = 'none';
    navProfileBtn.style.display = 'flex';
  } else {
    navLoginBtn.style.display = 'flex';
    navProfileBtn.style.display = 'none';
  }

  switch (state.currentView) {
    case 'leaderboard':
      renderLeaderboardView();
      break;
    case 'login':
      renderLoginView();
      break;
    case 'profile':
      renderProfileView();
      break;
    default:
      renderHomeView(opts);
  }
}

function renderHomeView(opts = {}) {
  const {
    title = '🐵 Bananjakt',
    subtitle = 'Fang frukt og hold deg unna farer!',
    actionLabel = '▶ START',
  } = opts;

  viewContainer.innerHTML = `
    <h1>${title}</h1>
    <p class="sub">${subtitle}</p>
    
    <div class="actions">
      <button id="startBtn" class="big">${actionLabel}</button>
    </div>

    <div class="actions">
      <button id="friendsBtn" class="big secondary">👥 Spill med venner</button>
      <button id="rulesBtn" class="big secondary">📘 Se regler</button>
    </div>

    <div id="friendsPanel" class="friends-panel ${state.friendsPanelOpen ? '' : 'hidden'}">
      <p class="sub">${state.roomFruits ? 'Aktivt vennrom: ' + state.roomFruits : 'Ingen vennrom aktivt'}</p>
      ${state.roomFruits ? `
        <div class="share-code-box">
          <p class="hint">Vis denne koden til vennen din</p>
          <div class="share-code">${escapeHtml(state.roomFruits)}</div>
        </div>
      ` : ''}
      <div class="actions">
        <button id="createRoomBtn" class="big secondary">🔐 Lag kode</button>
        <button id="enterCodeBtn" class="big secondary">⌨️ Skriv kode</button>
      </div>
      <div id="joinSection" class="${state.joinSectionOpen ? '' : 'hidden'}">
        <p class="hint">Skriv koden med spillets emoji-tastatur</p>
        <div id="joinCodePreview" class="join-code-preview">${draftToFruits(state.joinDraft) || '••••'}</div>
        <div class="emoji-keyboard">
          <button class="emoji-key" data-fruit="0">🍌</button>
          <button class="emoji-key" data-fruit="1">🍒</button>
          <button class="emoji-key" data-fruit="2">🍇</button>
          <button class="emoji-key" data-fruit="3">🍍</button>
        </div>
        <div class="actions">
          <button id="removeEmojiBtn" class="big secondary">⌫ Slett</button>
          <button id="joinRoomBtn" class="big secondary">✅ Koble til</button>
        </div>
      </div>
      ${state.roomCode ? `<button id="leaveRoomBtn" class="big secondary" style="margin-top:10px">Forlat vennrom</button>` : ''}
    </div>

    <p class="hint" id="statusMsg">${escapeHtml(state.homeMessage || '')}</p>
  `;

  document.getElementById('startBtn').addEventListener('click', () => {
    if (!state.user) {
      state.homeMessage = 'Logg inn for å lagre poeng!';
      switchView('login');
      return;
    }
    startGame();
  });

  document.getElementById('friendsBtn').addEventListener('click', () => {
    state.friendsPanelOpen = !state.friendsPanelOpen;
    renderCurrentView();
  });

  document.getElementById('rulesBtn').addEventListener('click', openRules);

  if (document.getElementById('enterCodeBtn')) {
    document.getElementById('enterCodeBtn').addEventListener('click', () => {
      state.joinSectionOpen = !state.joinSectionOpen;
      renderCurrentView();
    });
  }

  viewContainer.querySelectorAll('.emoji-key').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.joinDraft.length < 4) {
        state.joinDraft += btn.dataset.fruit;
        const el = document.getElementById('joinCodePreview');
        if (el) el.textContent = draftToFruits(state.joinDraft) || '••••';
      }
    });
  });

  if (document.getElementById('removeEmojiBtn')) {
    document.getElementById('removeEmojiBtn').addEventListener('click', () => {
      state.joinDraft = state.joinDraft.slice(0, -1);
      const el = document.getElementById('joinCodePreview');
      if (el) el.textContent = draftToFruits(state.joinDraft) || '••••';
    });
  }

  if (document.getElementById('joinRoomBtn')) {
    document.getElementById('joinRoomBtn').addEventListener('click', async () => {
      try {
        const data = await apiFetch('/api/rooms/join', {
          method: 'POST',
          body: JSON.stringify({ roomCode: state.joinDraft }),
        });
        state.roomCode = data.roomCode;
        state.roomFruits = data.fruits;
        state.joinDraft = '';
        state.joinSectionOpen = false;
        state.homeMessage = 'Tilkoblet!';
        startSync();
        await refreshLeaderboard();
        renderCurrentView();
      } catch (e) {
        state.homeMessage = e.message;
        renderCurrentView();
      }
    });
  }

  if (document.getElementById('createRoomBtn')) {
    document.getElementById('createRoomBtn').addEventListener('click', async () => {
      try {
        if (!state.user) throw new Error('Logg inn først for å lage rom.');
        const data = await apiFetch('/api/rooms/create', { method: 'POST' });
        state.roomCode = data.roomCode;
        state.roomFruits = data.fruits;
        state.homeMessage = 'Rom opprettet!';
        startSync();
        await refreshLeaderboard();
        renderCurrentView();
      } catch (e) {
        state.homeMessage = e.message;
        renderCurrentView();
      }
    });
  }

  if (document.getElementById('leaveRoomBtn')) {
    document.getElementById('leaveRoomBtn').addEventListener('click', async () => {
      state.roomCode = '';
      state.roomFruits = '';
      stopSync();
      await refreshLeaderboard();
      renderCurrentView();
    });
  }
}
// --- Multiplayer Sync ---
let syncInterval = null;
async function syncWithFriends() {
  if (!state.roomCode || !state.user) return;
  
  try {
    // Pack status into score: x (0-2000) + (playing ? 1000000 : 0)
    const packed = Math.floor(state.monkey.x) + (state.running ? 1000000 : 0);
    const data = await apiFetch('/api/scores', {
      method: 'POST',
      body: JSON.stringify({ roomCode: 'sync:' + state.roomCode, score: packed })
    });

    const now = Date.now();
    const players = {};
    (data.leaderboard || []).forEach(p => {
      if (p.name === state.user.username) return;
      // Filter out stale players (> 3s)
      if (now - p.ts > 3000) return;
      
      const playing = p.score >= 1000000;
      const x = p.score % 1000000;
      players[p.name] = { x, playing, lastSeen: p.ts };

      // Auto-start if buddy is playing and we aren't
      if (playing && !state.running && !state.paused) {
        startGame();
      }
    });
    state.roomPlayers = players;
  } catch (e) {
    console.error('Sync error:', e);
  }
}

function startSync() {
  stopSync();
  syncWithFriends();
  syncInterval = setInterval(syncWithFriends, 500); // 500ms for balance
}
function stopSync() {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = null;
  state.roomPlayers = {};
}
  const first = state.leaderboard[0];
  const firstText = first ? `🥇 Ledet av ${first.name} with ${first.score}!` : 'Ingen poeng ennå';

  viewContainer.innerHTML = `
    <h1>🏆 Toppliste</h1>
    <p class="sub">${state.roomCode ? 'Vennrom: ' + state.roomFruits : 'Global Toppliste'}</p>
    <p class="first-place">${escapeHtml(firstText)}</p>
    
    <table class="leaderboard">
      <thead>
        <tr><th>#</th><th>Spiller</th><th>Poeng</th></tr>
      </thead>
      <tbody>${renderLeaderboardRows()}</tbody>
    </table>
    
    <div class="actions">
      <button onclick="switchView('home')" class="big secondary">Tilbake</button>
    </div>
  `;
}

function renderLoginView() {
  viewContainer.innerHTML = `
    <h1>🔐 Logg inn</h1>
    <p class="sub">Logg inn for å lagre dine banan-poeng!</p>
    
    <div class="input-group">
      <div class="input-row">
        <input id="authUsername" placeholder="Brukernavn" maxlength="18">
      </div>
      <div class="input-row">
        <input id="authPassword" type="password" placeholder="Passord" maxlength="40">
      </div>
    </div>

    <div class="actions">
      <button id="loginBtn" class="big">Logg inn</button>
      <button id="registerBtn" class="big secondary">Registrer</button>
    </div>

    <div class="actions">
      <button id="loginGuestBtn" class="big secondary">👤 Spill som gjest</button>
    </div>

    <p class="hint" id="authMsg">${escapeHtml(state.homeMessage || '')}</p>
  `;

  document.getElementById('loginGuestBtn').addEventListener('click', () => {
    state.user = null;
    state.playerName = 'Gjest';
    startGame();
  });

  document.getElementById('loginBtn').addEventListener('click', async () => {
    const u = document.getElementById('authUsername').value;
    const p = document.getElementById('authPassword').value;
    try {
      const data = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: u, password: p }),
      });
      state.authToken = data.token;
      localStorage.setItem(AUTH_TOKEN_KEY, state.authToken);
      await refreshAuthMe();
      state.homeMessage = 'Velkommen tilbake!';
      switchView('home');
    } catch (e) {
      document.getElementById('authMsg').textContent = e.message;
    }
  });

  document.getElementById('registerBtn').addEventListener('click', async () => {
    const u = document.getElementById('authUsername').value;
    const p = document.getElementById('authPassword').value;
    try {
      const data = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username: u, password: p }),
      });
      state.authToken = data.token;
      localStorage.setItem(AUTH_TOKEN_KEY, state.authToken);
      await refreshAuthMe();
      state.homeMessage = 'Konto opprettet!';
      switchView('home');
    } catch (e) {
      document.getElementById('authMsg').textContent = e.message;
    }
  });
}

function renderProfileView() {
  viewContainer.innerHTML = `
    <h1>👤 Min profil</h1>
    <p class="sub">Hei, ${escapeHtml(state.user?.username || 'Spiller')}!</p>
    
    <div class="profile-stats">
      <p>Beste poengsum: <strong>${state.best}</strong></p>
    </div>

    <div class="actions">
      <button id="logoutBtn" class="big secondary">Logg ut</button>
    </div>
  `;

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch(e) {}
    state.authToken = '';
    state.user = null;
    localStorage.removeItem(AUTH_TOKEN_KEY);
    state.homeMessage = 'Du er logget ut.';
    switchView('home');
  });
}

// Navbar event listeners
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    switchView(btn.dataset.view);
  });
});

function openRules() {
  rulesModal.classList.add('show');
  rulesModal.setAttribute('aria-hidden', 'false');
}

function closeRules() {
  rulesModal.classList.remove('show');
  rulesModal.setAttribute('aria-hidden', 'true');
}

document.getElementById('closeRulesBtn').addEventListener('click', closeRules);
rulesModal.addEventListener('click', e => {
  if (e.target === rulesModal) closeRules();
});
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeRules();
});

async function initHome() {
  const initialRoom = toRoomCode(new URLSearchParams(window.location.search).get('room') || '');
  state.roomCode = initialRoom;
  state.roomFruits = roomCodeToFruits(initialRoom);
  if (!state.playerName) state.playerName = 'Spiller';
  try {
    await refreshAuthMe();
    await refreshLeaderboard();
  } catch (e) {
    state.cloudReady = false;
    state.homeMessage = 'Sky-toppliste utilgjengelig akkurat nå.';
    state.leaderboard = [];
    updateBestFromLeaderboard();
  }
  renderCurrentView();
}

initHome();

function reset() {
  state.score = 0; state.combo = 1; state.comboCount = 0;
  state.lives = 3;
  state.items = []; state.particles = [];
  state.spawnTimer = 0; state.spawnInterval = 900;
  state.speedMul = 1; state.slowUntil = 0;
  state.doubleUntil = 0; state.magnetUntil = 0;
  state.elapsed = 0; state.shake = 0;
  state.monkey.x = W / 2;
  state.monkey.y = H - 80;
  state.monkey.target = null;
  updateHud();
}

function updateHud() {
  document.getElementById('score').textContent = state.score;
  document.getElementById('combo').textContent = 'x' + state.combo;
  document.getElementById('lives').textContent = '❤️'.repeat(Math.max(0, state.lives)) || '0';
  document.getElementById('best').textContent = state.best;
}

function pickItemKey() {
  const total = Object.values(ITEMS).reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const [k, v] of Object.entries(ITEMS)) {
    r -= v.weight;
    if (r <= 0) return k;
  }
  return 'banana';
}

function spawnItem() {
  if (state.lives <= 3 && Math.random() < 0.14) {
    const heart = ITEMS.heart;
    state.items.push({
      key: 'heart', def: heart,
      x: 30 + Math.random() * (W - 60),
      y: -40,
      vy: (1.5 + Math.random() * 1.2 + state.elapsed / 17000) * 60,
      vx: (Math.random() - 0.5) * 40,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 4,
      size: 38,
    });
    return;
  }
  const key = pickItemKey();
  const def = ITEMS[key];
  state.items.push({
    key, def,
    x: 30 + Math.random() * (W - 60),
    y: -40,
    vy: (1.5 + Math.random() * 1.5 + state.elapsed / 15000) * 60, // px/sec
    vx: (Math.random() - 0.5) * 40,
    rot: Math.random() * Math.PI * 2,
    vrot: (Math.random() - 0.5) * 4,
    size: 38,
  });
}

function spawnParticles(x, y, color, count = 12) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 80 + Math.random() * 160;
    state.particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 50,
      life: 0.7,
      max: 0.7,
      color,
      size: 3 + Math.random() * 4,
    });
  }
}

function popText(x, y, text, color) {
  state.particles.push({
    x, y, vx: 0, vy: -60,
    life: 0.9, max: 0.9, text, color, size: 22, isText: true,
  });
}

// --- Input ---
const keys = {};
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  keys[k] = true;
  if (k === 'p') {
    togglePause();
  }
  if (e.key === ' ' || e.key === 'Enter') {
    if (!state.running && !rulesModal.classList.contains('show') && state.user) {
      startGame();
    }
  }
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

function pointerMove(e) {
  if (!state.running) return;
  const t = e.touches ? e.touches[0] : e;
  state.monkey.target = t.clientX;
}
canvas.addEventListener('mousemove', pointerMove);
canvas.addEventListener('touchmove', e => { e.preventDefault(); pointerMove(e); }, { passive: false });
canvas.addEventListener('touchstart', e => { e.preventDefault(); pointerMove(e); }, { passive: false });

function startGame() {
  closeRules();
  overlay.classList.remove('show');
  navbar.style.transform = 'translateX(-50%) translateY(100px)'; // Explicit hide
  reset();
  state.running = true;
  state.paused = false;
  document.getElementById('pauseOverlay').classList.remove('show');
  last = performance.now();
  requestAnimationFrame(loop);
}

function gameOver() {
  state.running = false;
  state.paused = false;
  document.getElementById('pauseOverlay').classList.remove('show');
  navbar.style.transform = ''; // Show navbar again

  const onComplete = () => {
    updateHud();
    const isNew = state.score === state.best && state.score > 0;
    renderCurrentView({
      title: isNew ? '🏆 NY FØRSTEPLASS!' : '💀 Runde ferdig',
      subtitle: `Du fikk ${state.score} poeng${isNew ? ' og tok ledelsen!' : '.'}`,
      actionLabel: '↻ SPILL IGJEN',
    });
    overlay.classList.add('show');
    beep(200, 0.2, 'sawtooth', 0.2);
    setTimeout(() => beep(150, 0.3, 'sawtooth', 0.2), 150);
    setTimeout(() => beep(100, 0.4, 'sawtooth', 0.2), 320);
  };

  if (state.user) {
    submitScoreToCloud()
      .catch(() => {
        state.homeMessage = 'Kunne ikke lagre score i skyen.';
      })
      .finally(onComplete);
  } else {
    onComplete();
  }
}

// --- Loop ---
let last = 0;
function loop(now) {
  if (!state.running || state.paused) return;
  const dt = Math.min(0.04, (now - last) / 1000); // Slightly more aggressive dt
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

function update(dt) {
  state.elapsed += dt * 1000;

  // Faster difficulty ramp
  state.spawnInterval = Math.max(220, 900 - state.elapsed / 25);

  // Monkey movement
  const m = state.monkey;
  if (m.target != null) {
    const diff = m.target - m.x;
    m.x += diff * Math.min(1, dt * 12);
  }
  if (keys['arrowleft'] || keys['a']) m.x -= 380 * dt;
  if (keys['arrowright'] || keys['d']) m.x += 380 * dt;
  m.x = Math.max(35, Math.min(W - 35, m.x));
  m.y = H - 80;

  // Spawn
  state.spawnTimer += dt * 1000;
  if (state.spawnTimer >= state.spawnInterval) {
    state.spawnTimer = 0;
    spawnItem();
  }

  const slowMul = (now() < state.slowUntil) ? 0.4 : 1;
  const magnetActive = now() < state.magnetUntil;

  // Items
  for (let i = state.items.length - 1; i >= 0; i--) {
    const it = state.items[i];
    if (magnetActive && ['good', 'life', 'heart', 'slow', 'double'].includes(it.def.kind)) {
      const mx = m.x - it.x;
      const my = m.y - it.y;
      const dist = Math.hypot(mx, my) || 1;
      if (dist < 260) {
        const pull = (260 - dist) * 2.6;
        it.vx += (mx / dist) * pull * dt;
        it.vy += (my / dist) * pull * dt;
      }
    }
    it.y += it.vy * dt * slowMul;
    it.x += it.vx * dt * slowMul;
    it.rot += it.vrot * dt;

    // catch detection
    const dx = it.x - m.x;
    const dy = it.y - m.y;
    if (Math.abs(dx) < 45 && Math.abs(dy) < 40 && it.y > m.y - 30) {
      onCatch(it);
      state.items.splice(i, 1);
      continue;
    }

    if (it.y > H + 40) {
      // missed
      if (it.def.kind === 'good') {
        state.combo = 1; state.comboCount = 0;
      }
      state.items.splice(i, 1);
    }
  }

  // Particles
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 200 * dt;
    if (p.life <= 0) state.particles.splice(i, 1);
  }

  if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 30);
}

function now() { return performance.now(); }

function onCatch(it) {
  const k = it.def.kind;
  if (k === 'good') {
    state.comboCount++;
    if (state.comboCount % 5 === 0 && state.combo < 8) state.combo++;
    const pointsMul = now() < state.doubleUntil ? 2 : 1;
    const points = it.def.score * state.combo * pointsMul;
    state.score += points;
    spawnParticles(it.x, it.y, '#ffeb3b', 10);
    popText(it.x, it.y - 20, '+' + points, '#fff176');
    beep(600 + state.combo * 80, 0.08, 'square', 0.1);
    flash('flash-good');
  } else if (k === 'life') {
    state.lives = Math.min(8, state.lives + 1);
    spawnParticles(it.x, it.y, '#ff80ab', 16);
    popText(it.x, it.y - 20, '+1 ❤️', '#ff80ab');
    beep(880, 0.15, 'triangle', 0.2);
    setTimeout(() => beep(1320, 0.15, 'triangle', 0.2), 80);
  } else if (k === 'heart') {
    state.lives = Math.min(8, state.lives + 2);
    spawnParticles(it.x, it.y, '#f06292', 20);
    popText(it.x, it.y - 20, '+2 ❤️', '#f06292');
    beep(980, 0.16, 'triangle', 0.25);
    setTimeout(() => beep(1480, 0.16, 'triangle', 0.25), 90);
  } else if (k === 'slow') {
    state.slowUntil = now() + 4000;
    spawnParticles(it.x, it.y, '#80d8ff', 16);
    popText(it.x, it.y - 20, 'SAKTEFILM!', '#80d8ff');
    beep(440, 0.3, 'sine', 0.2);
  } else if (k === 'double') {
    state.doubleUntil = now() + 6000;
    spawnParticles(it.x, it.y, '#b388ff', 16);
    popText(it.x, it.y - 20, '2X POENG!', '#b388ff');
    beep(760, 0.2, 'square', 0.2);
  } else if (k === 'magnet') {
    state.magnetUntil = now() + 6000;
    spawnParticles(it.x, it.y, '#80cbc4', 16);
    popText(it.x, it.y - 20, 'MAGNET!', '#80cbc4');
    beep(520, 0.24, 'sine', 0.2);
  } else if (k === 'bad') {
    state.combo = 1; state.comboCount = 0;
    state.lives--;
    state.shake = 1;
    spawnParticles(it.x, it.y, '#a1887f', 14);
    popText(it.x, it.y - 20, '-1 ❤️', '#ff5252');
    beep(220, 0.2, 'sawtooth', 0.2);
    flash('flash-bad');
    if (state.lives <= 0) gameOver();
  } else if (k === 'boom') {
    state.combo = 1; state.comboCount = 0;
    state.lives -= 2;
    state.shake = 2;
    spawnParticles(it.x, it.y, '#ff5722', 30);
    popText(it.x, it.y - 20, '💥 BOOM!', '#ff5722');
    beep(120, 0.3, 'sawtooth', 0.3);
    setTimeout(() => beep(80, 0.3, 'sawtooth', 0.3), 100);
    flash('flash-bad');
    if (state.lives <= 0) gameOver();
  } else if (k === 'nuke') {
    state.lives = 0;
    state.shake = 5;
    spawnParticles(it.x, it.y, '#00ff00', 60);
    popText(it.x, it.y - 20, '☢️ ATOMBOMBE!', '#ff3d00');
    beep(50, 0.8, 'sawtooth', 0.5);
    flash('flash-bad');
    gameOver();
  }
  updateHud();
}

function flash(cls) {
  const d = document.createElement('div');
  d.className = cls;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 400);
}

// --- Draw ---
function draw() {
  ctx.save();
  if (state.shake > 0) {
    const s = state.shake * 6;
    ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
  }

  // Sky gradient already in CSS; draw clouds
  ctx.clearRect(0, 0, W, H);

  // Ground
  ctx.fillStyle = 'rgba(46, 125, 50, 0.9)';
  ctx.fillRect(0, H - 40, W, 40);
  ctx.fillStyle = 'rgba(76, 175, 80, 0.8)';
  for (let i = 0; i < W; i += 30) {
    ctx.beginPath();
    ctx.arc(i + 15, H - 40, 6, Math.PI, 0);
    ctx.fill();
  }

  // Items
  ctx.font = '38px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const it of state.items) {
    ctx.save();
    ctx.translate(it.x, it.y);
    ctx.rotate(it.rot);
    ctx.fillText(it.def.emoji, 0, 0);
    ctx.restore();
  }

  // Draw other players
  ctx.globalAlpha = 0.5;
  Object.entries(state.roomPlayers).forEach(([name, p]) => {
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'white';
    ctx.fillText(name, p.x, H - 90);
    ctx.font = '40px sans-serif';
    ctx.fillText('🐒', p.x, H - 50);
  });
  ctx.globalAlpha = 1.0;

  // Monkey
  const m = state.monkey;
  ctx.font = '60px serif';
  ctx.fillText('🐵', m.x, m.y);
  // basket
  ctx.font = '50px serif';
  ctx.fillText('🧺', m.x, m.y - 40);

  // Slow-mo overlay
  if (now() < state.slowUntil) {
    ctx.fillStyle = 'rgba(128, 216, 255, 0.1)';
    ctx.fillRect(0, 0, W, H);
  }
  if (now() < state.doubleUntil) {
    ctx.fillStyle = 'rgba(179, 136, 255, 0.08)';
    ctx.fillRect(0, 0, W, H);
  }
  if (now() < state.magnetUntil) {
    ctx.beginPath();
    ctx.arc(m.x, m.y - 30, 85, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(128, 203, 196, 0.45)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // Particles
  for (const p of state.particles) {
    const alpha = p.life / p.max;
    ctx.globalAlpha = alpha;
    if (p.isText) {
      ctx.font = `bold ${p.size}px sans-serif`;
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

// initial draw so canvas isn't blank behind overlay
state.monkey.x = W / 2;
state.monkey.y = H - 80;
draw();

// Pause listeners
document.getElementById('pauseBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  togglePause();
});
document.getElementById('resumeBtn').addEventListener('click', togglePause);
document.getElementById('quitBtn').addEventListener('click', async () => {
  const currentScore = state.score;
  state.running = false;
  state.paused = false;
  document.getElementById('pauseOverlay').classList.remove('show');
  overlay.classList.add('show');
  navbar.style.transform = '';
  switchView('home');
  
  if (state.user && currentScore > 0) {
    try { await submitScoreToCloud(); } catch(e) {}
  }
});
