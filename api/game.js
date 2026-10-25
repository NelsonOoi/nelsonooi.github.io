// Game server: rooms live in storage; every request loads the room, applies a change
// with the shared game code, and returns only what the requesting player may see.
const crypto = require('crypto');
const SDG = require('../games/core.js');
require('../games/nightfall.js');
require('../games/usurper.js');
require('../games/mole.js');
require('../games/cipher.js');
require('../games/holdem.js');
require('../games/blackjack.js');
const { store } = require('./_store.js');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_PLAYERS = 20;
const ONLINE_MS = 25000; // a player who hasn't polled for this long shows as offline

class HttpError extends Error {
    constructor(status, message, reason) { super(message); this.status = status; this.reason = reason; }
}
const fail = (status, message, reason) => { throw new HttpError(status, message, reason); };

const randomHex = n => crypto.randomBytes(n).toString('hex');
const randomCode = () => Array.from({ length: 4 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
const cleanName = n => String(n || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 16);
const cleanCode = c => String(c || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

function defaultOptions(gameId) {
    const o = {};
    SDG.games[gameId].options.forEach(opt => { o[opt.key] = opt.def; });
    return o;
}

function uniqueName(room, name) {
    const taken = n => room.players.some(p => p.name.toLowerCase() === n.toLowerCase());
    if (!taken(name)) return name;
    for (let i = 2; ; i++) if (!taken(name + ' ' + i)) return name + ' ' + i;
}

function online(rec, pid, now) {
    return now - (rec.seen[pid] || 0) < ONLINE_MS;
}

// Presence signature: lets a poll skip the payload when nothing changed.
function presence(rec, me, now) {
    return rec.room.players.filter(p => p.id === me || online(rec, p.id, now)).map(p => p.id).join(',');
}

function makeView(rec, pid) {
    const room = rec.room, now = Date.now();
    const g = SDG.games[room.gameId];
    return {
        v: rec.v,
        ps: presence(rec, pid, now),
        now,
        view: {
            code: room.code, hostId: room.hostId, gameId: room.gameId, options: room.options,
            players: room.players.map(p => ({ id: p.id, name: p.name, connected: p.id === pid || online(rec, p.id, now) })),
            you: pid,
            game: room.game ? g.view(room.game, pid) : null
        }
    };
}

async function load(code) {
    const rec = await store().load(code);
    if (!rec) fail(404, 'That room doesn’t exist or has closed.', 'gone');
    return rec;
}

function auth(rec, pid, token) {
    const p = rec.room.players.find(x => x.id === pid);
    if (!p || !token || p.token !== token) fail(403, 'You’re no longer in this room.', 'auth');
    return p;
}

// Load → change → save, retrying if someone else saved in between.
async function update(code, change) {
    for (let attempt = 0; attempt < 6; attempt++) {
        const rec = await load(code);
        const result = change(rec);
        if (result === false) return rec;
        const v = await store().save(code, rec.room, rec.v);
        if (v) { rec.v = v; return rec; }
        await new Promise(r => setTimeout(r, 30 + Math.random() * 120));
    }
    fail(503, 'The server is busy. Try again.');
}

function roomAction(rec, a) {
    const room = rec.room, g = SDG.games[room.gameId];
    switch (a.type) {
        case 'room:game':
            if (room.game || !SDG.games[a.gameId]) return;
            room.gameId = a.gameId;
            room.options = defaultOptions(a.gameId);
            return;
        case 'room:option': {
            if (room.game) return;
            const opt = g.options.find(o => o.key === a.key);
            if (!opt) return;
            if (opt.type === 'bool') room.options[a.key] = !!a.value;
            else if (opt.choices.some(c => c[0] === a.value)) room.options[a.key] = a.value;
            return;
        }
        case 'room:kick':
            if (room.game || a.pid === room.hostId) return;
            room.players = room.players.filter(p => p.id !== a.pid);
            return;
        case 'room:move': {
            if (room.game) return;
            const i = room.players.findIndex(p => p.id === a.pid);
            if (i > 0) [room.players[i - 1], room.players[i]] = [room.players[i], room.players[i - 1]];
            return;
        }
        case 'room:start': {
            if (room.game) return;
            const n = room.players.length;
            if (n < g.minPlayers || n > g.maxPlayers) SDG.fail(g.name + ' needs ' + g.minPlayers + '–' + g.maxPlayers + ' players.');
            room.game = g.setup(room.players, room.options);
            return;
        }
        case 'room:lobby': {
            room.game = null;
            // Drop players who left mid-game.
            const now = Date.now();
            room.players = room.players.filter(p => p.id === room.hostId || online(rec, p.id, now));
            return;
        }
    }
}

const ops = {
    async create(body) {
        const name = cleanName(body.name);
        if (!name) fail(400, 'Please enter a name.');
        const pid = randomHex(8), token = randomHex(16);
        for (let i = 0; i < 8; i++) {
            const code = randomCode();
            const room = {
                code, hostId: pid, gameId: SDG.order[0], options: defaultOptions(SDG.order[0]),
                players: [{ id: pid, name, token }], game: null, createdAt: Date.now()
            };
            const v = await store().save(code, room, null);
            if (!v) continue; // code in use
            await store().touch(code, pid);
            const rec = { room, v, seen: { [pid]: Date.now() } };
            return Object.assign({ code, pid, token }, makeView(rec, pid));
        }
        fail(503, 'Couldn’t find a free room code. Try again.');
    },

    async join(body) {
        const code = cleanCode(body.code), name = cleanName(body.name);
        let pid = null, token = null;
        const rec = await update(code, rec => {
            const room = rec.room, now = Date.now();
            // Same device rejoining.
            let p = room.players.find(x => x.id === body.pid && x.token === body.token);
            if (!p && room.game) {
                // New device: reclaim an offline seat by name.
                p = room.players.find(x => x.name.toLowerCase() === name.toLowerCase() && !online(rec, x.id, now));
                if (!p) fail(409, 'This game has already started.');
                p.token = randomHex(16);
            }
            if (p) { pid = p.id; token = p.token; return p.token !== body.token; }
            if (!name) fail(400, 'Please enter a name.');
            if (room.players.length >= MAX_PLAYERS) fail(409, 'This room is full.');
            p = { id: randomHex(8), name: uniqueName(room, name), token: randomHex(16) };
            room.players.push(p);
            pid = p.id; token = p.token;
        });
        await store().touch(code, pid);
        rec.seen[pid] = Date.now();
        return Object.assign({ code, pid, token }, makeView(rec, pid));
    },

    async view(body) {
        const code = cleanCode(body.code);
        const rec = await load(code);
        auth(rec, body.pid, body.token);
        if (body.beat) {
            await store().touch(code, body.pid);
            rec.seen[body.pid] = Date.now();
        }
        if (body.v === rec.v && body.ps === presence(rec, body.pid, Date.now())) return { same: true, now: Date.now() };
        return makeView(rec, body.pid);
    },

    async act(body) {
        const code = cleanCode(body.code), a = body.action;
        if (!a || typeof a !== 'object' || typeof a.type !== 'string' || JSON.stringify(a).length > 500) fail(400, 'Bad action.');
        if (a.type === 'room:close') {
            const rec = await load(code);
            if (auth(rec, body.pid, body.token).id !== rec.room.hostId) fail(403, 'Only the host can do that.');
            await store().remove(code);
            return { closed: true };
        }
        const rec = await update(code, rec => {
            auth(rec, body.pid, body.token);
            const isHost = body.pid === rec.room.hostId;
            if (a.type.startsWith('room:')) {
                if (!isHost) SDG.fail('Only the host can do that.');
                roomAction(rec, a);
            } else if (rec.room.game) {
                SDG.games[rec.room.gameId].act(rec.room.game, body.pid, a, { isHost });
            }
        });
        return makeView(rec, body.pid);
    },

    async leave(body) {
        const code = cleanCode(body.code);
        await update(code, rec => {
            auth(rec, body.pid, body.token);
            if (rec.room.game || body.pid === rec.room.hostId) return false;
            rec.room.players = rec.room.players.filter(p => p.id !== body.pid);
        });
        return { ok: true };
    }
};

module.exports = async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') { res.statusCode = 405; return res.end('{"error":"POST only"}'); }
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
    const op = body && ops[body.op];
    try {
        if (!op) fail(400, 'Unknown request.');
        const out = await op(body);
        res.statusCode = 200;
        res.end(JSON.stringify(out));
    } catch (e) {
        if (!(e instanceof HttpError) && !e.userFacing) console.error(e);
        res.statusCode = e instanceof HttpError ? e.status : e.userFacing ? 400 : 500;
        res.end(JSON.stringify({ error: e instanceof HttpError || e.userFacing ? e.message : 'Something went wrong.', reason: e.reason }));
    }
};
