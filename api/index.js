const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const PORT = parseInt(process.env.PORT || '8080', 10);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ycimdtppexiwkbtjyusb.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_WPHz81KqhGFLVHYg_IfSFA_q52Cm21p';

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

const FRUIT_DIGITS = ['🍌', '🍒', '🍇', '🍍'];
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function normalizeName(input) {
  const cleaned = String(input || '').trim().replace(/\s+/g, ' ');
  return cleaned ? cleaned.slice(0, 18) : 'Spiller';
}

function normalizeUsername(input) {
  return String(input || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 18);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, oldHash] = stored.split(':');
  const currentHash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(oldHash, 'hex'), Buffer.from(currentHash, 'hex'));
}

function createSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getBearerToken(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return '';
  return auth.slice(7).trim();
}

async function getSessionUser(req) {
  const token = getBearerToken(req);
  if (!token) return null;
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('token, user_id')
    .eq('token', token)
    .maybeSingle();
  if (sessionError || !session) return null;
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, username')
    .eq('id', session.user_id)
    .maybeSingle();
  if (userError || !user) return null;
  return { token: session.token, id: user.id, username: user.username };
}

function toRoomCode(raw) {
  const s = String(raw || '');
  if (s.startsWith('sync:')) return s;
  const cleaned = s
    .replace(/\s+/g, '')
    .replaceAll('🍌', '0')
    .replaceAll('🍒', '1')
    .replaceAll('🍇', '2')
    .replaceAll('🍍', '3')
    .replace(/[^0-3]/g, '');
  return cleaned.length === 4 ? cleaned : '';
}

function codeToFruits(code) {
  return code.split('').map(n => FRUIT_DIGITS[Number(n)]).join(' ');
}

function randomRoomCode(existingRooms) {
  let code = '';
  do {
    code = Array.from({ length: 4 }, () => Math.floor(Math.random() * 4)).join('');
  } while (existingRooms.has(code));
  return code;
}

function sanitizeScores(list) {
  return (Array.isArray(list) ? list : [])
    .filter(row => row && typeof row.name === 'string' && Number.isFinite(row.score))
    .map(row => ({ name: normalizeName(row.name), score: Math.max(0, Math.floor(row.score)), ts: Number(row.ts) || Date.now() }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);
}

function serveStatic(req, res, pathname) {
  let urlPath = pathname === '/' ? '/index.html' : pathname;
  const normalized = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, normalized);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': mime[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (req.method === 'POST' && pathname === '/api/auth/register') {
    try {
      const body = await parseBody(req);
      const username = normalizeUsername(body.username);
      const password = String(body.password || '');
      if (username.length < 3) return sendJson(res, 400, { ok: false, error: 'Brukernavn må ha minst 3 tegn' });
      if (password.length < 6) return sendJson(res, 400, { ok: false, error: 'Passord må ha minst 6 tegn' });

      const { data: existing } = await supabase.from('users').select('id').eq('username', username).maybeSingle();
      if (existing) return sendJson(res, 409, { ok: false, error: 'Brukernavn finnes allerede' });

      const { data: user, error: userErr } = await supabase
        .from('users')
        .insert({ username, password_hash: hashPassword(password) })
        .select('id, username')
        .single();
      if (userErr || !user) throw userErr;

      const token = createSessionToken();
      const { error: sessionErr } = await supabase.from('sessions').insert({ token, user_id: user.id });
      if (sessionErr) throw sessionErr;

      return sendJson(res, 200, { ok: true, token, user: { id: user.id, username: user.username } });
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: 'Kunne ikke registrere konto' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/auth/login') {
    try {
      const body = await parseBody(req);
      const username = normalizeUsername(body.username);
      const password = String(body.password || '');
      const { data: user, error: userErr } = await supabase
        .from('users')
        .select('id, username, password_hash')
        .eq('username', username)
        .maybeSingle();
      if (userErr) throw userErr;
      if (!user || !verifyPassword(password, user.password_hash)) {
        return sendJson(res, 401, { ok: false, error: 'Feil brukernavn eller passord' });
      }

      const token = createSessionToken();
      const { error: sessionErr } = await supabase.from('sessions').insert({ token, user_id: user.id });
      if (sessionErr) throw sessionErr;

      return sendJson(res, 200, { ok: true, token, user: { id: user.id, username: user.username } });
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: 'Kunne ikke logge inn' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    const token = getBearerToken(req);
    if (!token) return sendJson(res, 200, { ok: true });
    await supabase.from('sessions').delete().eq('token', token);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathname === '/api/auth/me') {
    try {
      const user = await getSessionUser(req);
      return sendJson(res, 200, { ok: true, user: user ? { id: user.id, username: user.username } : null });
    } catch (e) {
      return sendJson(res, 200, { ok: true, user: null });
    }
  }

  if (req.method === 'GET' && pathname === '/api/leaderboard') {
    try {
      const roomCode = toRoomCode(url.searchParams.get('room') || '') || 'global';
      
      // Hent alle poeng for dette rommet
      const { data, error } = await supabase
        .from('scores')
        .select('player_name, score, user_id, created_at')
        .eq('room_code', roomCode);
      
      if (error) throw error;

      // Grupper poeng per bruker
      const grouped = {};
      (data || []).forEach(row => {
        // Bruk user_id som nøkkel hvis den finnes, ellers player_name
        const key = row.user_id || row.player_name;
        if (!grouped[key]) {
          grouped[key] = { name: row.player_name, score: 0, ts: 0 };
        }
        grouped[key].score += row.score;
        // Hold styr på nyeste tidspunkt
        const rowTs = new Date(row.created_at).getTime();
        if (rowTs > grouped[key].ts) grouped[key].ts = rowTs;
      });

      // Konverter til liste, sorter og ta topp 30
      const leaderboard = Object.values(grouped)
        .sort((a, b) => b.score - a.score || b.ts - a.ts)
        .slice(0, 30);

      return sendJson(res, 200, { roomCode, leaderboard });
    } catch (e) {
      console.error('Leaderboard fetch error:', e);
      return sendJson(res, 500, { error: 'Kunne ikke hente toppliste' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/scores') {
    try {
      const sessionUser = await getSessionUser(req);
      if (!sessionUser) return sendJson(res, 401, { ok: false, error: 'Logg inn for å lagre poeng' });
      const body = await parseBody(req);
      const roomCode = toRoomCode(body.roomCode || '') || 'global';
      const newScore = Math.max(0, Math.floor(Number(body.score) || 0));

      const isSync = roomCode.startsWith('sync:');

      // Sjekk om brukeren allerede har poeng i dette rommet (kan være flere rader fra før)
      const { data: existingRows, error: fetchError } = await supabase
        .from('scores')
        .select('id, score')
        .eq('room_code', roomCode)
        .eq('user_id', sessionUser.id);
      
      if (fetchError) throw fetchError;

      if (existingRows && existingRows.length > 0) {
        // Konsolider alle eksisterende rader til én
        const totalExistingScore = isSync ? 0 : existingRows.reduce((sum, r) => sum + r.score, 0);
        const mainId = existingRows[0].id;
        const otherIds = existingRows.slice(1).map(r => r.id);

        // Oppdater den første raden med totalen + den nye scoren
        const { error: updateError } = await supabase
          .from('scores')
          .update({ 
            score: totalExistingScore + newScore,
            player_name: normalizeName(sessionUser.username)
          })
          .eq('id', mainId);
        if (updateError) throw updateError;

        // Slett de overflødige radene
        if (otherIds.length > 0) {
          await supabase.from('scores').delete().in('id', otherIds);
        }
      } else {
        // Sett inn helt ny rad
        const { error: insertError } = await supabase
          .from('scores')
          .insert({
            room_code: roomCode,
            player_name: normalizeName(sessionUser.username),
            score: newScore,
            user_id: sessionUser.id,
          });
        if (insertError) throw insertError;
      }

      // Hent oppdatert og gruppert toppliste (samme logikk som GET)
      const { data: allScores, error: lbError } = await supabase
        .from('scores')
        .select('player_name, score, user_id, created_at')
        .eq('room_code', roomCode);
      
      if (lbError) throw lbError;

      const grouped = {};
      (allScores || []).forEach(row => {
        const key = row.user_id || row.player_name;
        if (!grouped[key]) grouped[key] = { name: row.player_name, score: 0, ts: 0 };
        grouped[key].score += row.score;
        const rowTs = new Date(row.created_at).getTime();
        if (rowTs > grouped[key].ts) grouped[key].ts = rowTs;
      });

      const leaderboard = Object.values(grouped)
        .sort((a, b) => b.score - a.score || b.ts - a.ts)
        .slice(0, 30);

      return sendJson(res, 200, { ok: true, leaderboard });
    } catch (e) {
      console.error('Score save error:', e);
      return sendJson(res, 400, { ok: false, error: 'Kunne ikke lagre poeng' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/rooms/create') {
    try {
      const sessionUser = await getSessionUser(req);
      if (!sessionUser) return sendJson(res, 401, { ok: false, error: 'Logg inn for å lage rom' });
      const body = await parseBody(req);
      const host = normalizeName(sessionUser.username || body.name);
      const { data: existingRows, error: existingError } = await supabase
        .from('rooms')
        .select('code');
      if (existingError) throw existingError;
      const existingCodes = new Set((existingRows || []).map(row => row.code));
      const roomCode = randomRoomCode(existingCodes);

      const { error: insertError } = await supabase.from('rooms').insert({
        code: roomCode,
        host,
        members: [host],
      });
      if (insertError) throw insertError;

      return sendJson(res, 200, {
        ok: true,
        roomCode,
        fruits: codeToFruits(roomCode),
        joinPath: `/?room=${roomCode}`,
      });
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: 'Could not create room' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/rooms/join') {
    try {
      const sessionUser = await getSessionUser(req);
      if (!sessionUser) return sendJson(res, 401, { ok: false, error: 'Logg inn for å koble til rom' });
      const body = await parseBody(req);
      const roomCode = toRoomCode(body.roomCode);
      if (!roomCode) return sendJson(res, 400, { ok: false, error: 'Ugyldig fruktkode' });

      const { data: room, error: roomError } = await supabase
        .from('rooms')
        .select('code, members')
        .eq('code', roomCode)
        .maybeSingle();
      if (roomError) throw roomError;
      if (!room) return sendJson(res, 404, { ok: false, error: 'Fant ikke rommet' });

      const name = normalizeName(sessionUser.username || body.name);
      const members = new Set(Array.isArray(room.members) ? room.members : []);
      members.add(name);
      const membersList = Array.from(members).slice(0, 20);

      const { error: updateError } = await supabase
        .from('rooms')
        .update({ members: membersList })
        .eq('code', roomCode);
      if (updateError) throw updateError;

      return sendJson(res, 200, {
        ok: true,
        roomCode,
        fruits: codeToFruits(roomCode),
        members: membersList,
        joinPath: `/?room=${roomCode}`,
      });
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: 'Could not join room' });
    }
  }

  // Fallback
  res.writeHead(404);
  res.end('Not found');
}

// Local development server
if (require.main === module) {
  const server = http.createServer(handler);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Spillet kjører på http://localhost:${PORT}`);
  });
}

module.exports = handler;
