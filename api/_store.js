// Room storage. Upstash Redis (REST API) when configured, in-memory for local dev.
// Each room is one Redis hash: { room: JSON, v: version, 'seen:<pid>': last poll time }.
const TTL = 6 * 3600; // rooms expire 6h after last activity

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

// Write only if nobody else wrote since we read (compare-and-set on version).
const CAS = `local v = redis.call('HGET', KEYS[1], 'v')
if (v or '') ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[1], 'room', ARGV[2], 'v', ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[4])
return 1`;

const key = code => 'sdg:room:' + code;

async function call(path, body) {
    const r = await fetch(url + path, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        body: JSON.stringify(body)
    });
    const j = await r.json();
    if (j.error) throw new Error('redis: ' + j.error);
    return j;
}

const redisStore = {
    async load(code) {
        const flat = (await call('', ['HGETALL', key(code)])).result || [];
        const h = {};
        for (let i = 0; i < flat.length; i += 2) h[flat[i]] = flat[i + 1];
        if (!h.room) return null;
        const seen = {};
        Object.keys(h).forEach(f => { if (f.startsWith('seen:')) seen[f.slice(5)] = +h[f]; });
        return { room: JSON.parse(h.room), v: +h.v, seen };
    },
    // expected = null creates the room only if the code is free. Returns the new version or 0.
    async save(code, room, expected) {
        const v = (expected || 0) + 1;
        const ok = (await call('', ['EVAL', CAS, '1', key(code), expected == null ? '' : String(expected), JSON.stringify(room), String(v), String(TTL)])).result;
        return ok === 1 ? v : 0;
    },
    async touch(code, pid) {
        await call('/pipeline', [['HSET', key(code), 'seen:' + pid, String(Date.now())], ['EXPIRE', key(code), String(TTL)]]);
    },
    async remove(code) {
        await call('', ['DEL', key(code)]);
    }
};

const mem = new Map();
const memoryStore = {
    async load(code) {
        const r = mem.get(code);
        return r ? { room: JSON.parse(r.room), v: r.v, seen: Object.assign({}, r.seen) } : null;
    },
    async save(code, room, expected) {
        const r = mem.get(code);
        if ((r ? r.v : null) !== (expected == null ? null : expected)) return 0;
        const v = (expected || 0) + 1;
        mem.set(code, { room: JSON.stringify(room), v, seen: r ? r.seen : {} });
        return v;
    },
    async touch(code, pid) {
        const r = mem.get(code);
        if (r) r.seen[pid] = Date.now();
    },
    async remove(code) {
        mem.delete(code);
    }
};

function store() {
    if (url && token) return redisStore;
    if (process.env.VERCEL) throw new Error('Storage is not configured: connect an Upstash Redis database to this Vercel project.');
    return memoryStore;
}

module.exports = { store };
