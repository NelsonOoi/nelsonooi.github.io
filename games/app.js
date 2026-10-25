// Rooms, networking and screens. The host's browser holds the real game state and
// sends each player only their own view over a WebRTC data channel (PeerJS).
(function () {
    var SDG = window.SDG, esc = SDG.esc;
    var PREFIX = 'nelsonooi-sdg-';
    var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    var MAX_PLAYERS = 20;
    // Optional TURN relay, e.g. from a free Metered (metered.ca) or Cloudflare account:
    //   [{ urls: 'turn:…:3478', username: '…', credential: '…' }]
    // Without one, phones connect directly. That works on most wifi and cellular
    // networks, but a few strict networks need a relay, and the "hide my IP" option
    // only appears when a relay is set. (PeerJS's own relay servers no longer exist.)
    var TURN_SERVERS = [];
    var app = document.getElementById('app');

    // ---------- storage (may be unavailable) ----------
    var store = {
        get: function (k) { try { return JSON.parse(localStorage.getItem('sdg-' + k)); } catch (e) { return null; } },
        set: function (k, v) { try { localStorage.setItem('sdg-' + k, JSON.stringify(v)); } catch (e) { } },
        del: function (k) { try { localStorage.removeItem('sdg-' + k); } catch (e) { } }
    };

    function randomId() {
        var a = new Uint8Array(8);
        crypto.getRandomValues(a);
        return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    }
    function randomCode() {
        var s = '';
        for (var i = 0; i < 4; i++) s += CODE_CHARS[SDG.randInt(CODE_CHARS.length)];
        return s;
    }

    var myId = store.get('id');
    if (!myId) { myId = randomId(); store.set('id', myId); }

    // ---------- state ----------
    var screen = 'home';      // home | room
    var mode = null;          // host | client
    var peer = null;
    var status = 'connecting';
    var view = null;          // what this device renders
    var ui = { open: {} };    // local-only UI state (role card shown, open <details>)
    var notice = '';

    // host
    var room = null;
    var conns = {};           // pid -> DataConnection
    var lastSeen = {};
    // client
    var conn = null, clientInfo = null, lastHeard = 0, everConnected = false, retryTimer = null;

    function peerOptions() {
        var config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }].concat(TURN_SERVERS) };
        if (TURN_SERVERS.length && store.get('relay')) config.iceTransportPolicy = 'relay';
        return { debug: store.get('debug') || 1, config: config };
    }

    function cleanName(n) {
        return String(n || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 16);
    }

    // =====================================================================
    // Host
    // =====================================================================

    function defaultOptions(gameId) {
        var o = {};
        SDG.games[gameId].options.forEach(function (opt) { o[opt.key] = opt.def; });
        return o;
    }

    function hostCreate(name) {
        room = {
            code: randomCode(), hostId: myId, gameId: SDG.order[0],
            options: defaultOptions(SDG.order[0]),
            players: [{ id: myId, name: name, connected: true }],
            game: null, savedAt: Date.now()
        };
        startHost(true);
    }

    function hostResume(saved) {
        room = saved;
        room.players.forEach(function (p) { p.connected = p.id === myId; });
        startHost(false);
    }

    function startHost(fresh) {
        mode = 'host';
        screen = 'room';
        status = 'connecting';
        persist();
        history.replaceState(null, '', '?room=' + room.code);
        view = null;
        setView(makeView(myId));
        openHostPeer(fresh, 0);
        requestWakeLock();
    }

    function openHostPeer(fresh, attempt) {
        if (peer) peer.destroy();
        peer = new Peer(PREFIX + room.code, peerOptions());
        peer.on('open', function () { status = 'online'; render(); });
        peer.on('connection', hostAccept);
        peer.on('disconnected', function () {
            status = 'reconnecting';
            render();
            setTimeout(function () { if (peer && !peer.destroyed && peer.disconnected) peer.reconnect(); }, 1000);
        });
        peer.on('error', function (err) {
            if (err.type === 'unavailable-id') {
                if (fresh && room.players.length === 1 && attempt < 5) {
                    room.code = randomCode();
                    persist();
                    history.replaceState(null, '', '?room=' + room.code);
                    return openHostPeer(true, attempt + 1);
                }
                // Our old registration hasn't expired yet (e.g. after a reload). Keep trying.
                status = 'reclaiming room';
                render();
                return setTimeout(function () { if (mode === 'host') openHostPeer(false, attempt + 1); }, 3000);
            }
            if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed') {
                status = 'reconnecting';
                render();
                setTimeout(function () {
                    if (mode !== 'host') return;
                    if (peer.destroyed) openHostPeer(false, attempt + 1);
                    else if (peer.disconnected) peer.reconnect();
                }, 2000);
            }
        });
    }

    function hostAccept(c) {
        var pid = null;
        c.on('data', function (msg) {
            if (!msg || typeof msg !== 'object') return;
            if (msg.t === 'hello') {
                pid = hostHello(c, msg);
                return;
            }
            if (!pid || conns[pid] !== c) return;
            lastSeen[pid] = Date.now();
            if (msg.t === 'ping') return c.send({ t: 'pong' });
            if (msg.t === 'act') return hostAction(pid, msg.a);
            if (msg.t === 'leave') return hostLeave(pid);
        });
        c.on('close', function () {
            if (pid && conns[pid] === c) {
                delete conns[pid];
                setConnected(pid, false);
            }
        });
    }

    function findPlayer(pid) {
        for (var i = 0; i < room.players.length; i++) if (room.players[i].id === pid) return room.players[i];
        return null;
    }

    function hostHello(c, msg) {
        var pid = String(msg.pid || '').slice(0, 32), name = cleanName(msg.name);
        var p = findPlayer(pid);
        if (!p && room.game) {
            // Lost their device id (new browser?) — let them reclaim a disconnected seat by name.
            p = room.players.filter(function (x) {
                return !x.connected && x.name.toLowerCase() === name.toLowerCase();
            })[0];
            if (!p) { c.send({ t: 'reject', reason: 'This game has already started.' }); return null; }
        }
        if (!p) {
            if (!name) { c.send({ t: 'reject', reason: 'Please enter a name.' }); return null; }
            if (room.players.length >= MAX_PLAYERS) { c.send({ t: 'reject', reason: 'This room is full.' }); return null; }
            p = { id: pid, name: uniqueName(name), connected: true };
            room.players.push(p);
        }
        if (conns[p.id] && conns[p.id] !== c) conns[p.id].close();
        conns[p.id] = c;
        lastSeen[p.id] = Date.now();
        p.connected = true;
        c.send({ t: 'welcome', pid: p.id });
        changed();
        return p.id;
    }

    function uniqueName(name) {
        var taken = function (n) { return room.players.some(function (p) { return p.name.toLowerCase() === n.toLowerCase(); }); };
        if (!taken(name)) return name;
        for (var i = 2; ; i++) if (!taken(name + ' ' + i)) return name + ' ' + i;
    }

    function setConnected(pid, on) {
        var p = findPlayer(pid);
        if (p && p.connected !== on) { p.connected = on; changed(); }
    }

    function hostLeave(pid) {
        if (conns[pid]) { conns[pid].close(); delete conns[pid]; }
        if (!room.game) room.players = room.players.filter(function (p) { return p.id !== pid; });
        else setConnected(pid, false);
        changed();
    }

    function hostAction(pid, a) {
        if (!a || typeof a !== 'object' || typeof a.type !== 'string') return;
        var isHost = pid === room.hostId;
        try {
            if (a.type.indexOf('room:') === 0) {
                if (!isHost) SDG.fail('Only the host can do that.');
                roomAction(a);
            } else {
                if (!room.game) return;
                SDG.games[room.gameId].act(room.game, pid, a, { isHost: isHost });
            }
        } catch (e) {
            if (!e.userFacing) console.error(e);
            var msg = e.userFacing ? e.message : 'Something went wrong.';
            if (pid === myId) toast(msg);
            else if (conns[pid]) conns[pid].send({ t: 'error', msg: msg });
            return;
        }
        changed();
    }

    function roomAction(a) {
        var g = SDG.games[room.gameId];
        switch (a.type) {
            case 'room:game':
                if (room.game || !SDG.games[a.gameId]) return;
                room.gameId = a.gameId;
                room.options = defaultOptions(a.gameId);
                return;
            case 'room:option':
                if (room.game) return;
                var opt = g.options.filter(function (o) { return o.key === a.key; })[0];
                if (!opt) return;
                if (opt.type === 'bool') room.options[a.key] = !!a.value;
                else if (opt.choices.some(function (c) { return c[0] === a.value; })) room.options[a.key] = a.value;
                return;
            case 'room:kick':
                if (room.game || a.pid === myId) return;
                if (conns[a.pid]) { conns[a.pid].send({ t: 'kicked' }); setTimeout(closeLater(conns[a.pid]), 300); delete conns[a.pid]; }
                room.players = room.players.filter(function (p) { return p.id !== a.pid; });
                return;
            case 'room:move':
                if (room.game) return;
                var i = room.players.findIndex(function (p) { return p.id === a.pid; });
                if (i > 0) { var t = room.players[i - 1]; room.players[i - 1] = room.players[i]; room.players[i] = t; }
                return;
            case 'room:start':
                if (room.game) return;
                var n = room.players.length;
                if (n < g.minPlayers || n > g.maxPlayers) SDG.fail(g.name + ' needs ' + g.minPlayers + '–' + g.maxPlayers + ' players.');
                room.game = g.setup(room.players, room.options);
                return;
            case 'room:lobby':
                room.game = null;
                // Drop players who left mid-game.
                room.players = room.players.filter(function (p) { return p.connected; });
                return;
        }
    }

    function closeLater(c) { return function () { try { c.close(); } catch (e) { } }; }

    function makeView(pid) {
        var g = SDG.games[room.gameId];
        return {
            code: room.code, hostId: room.hostId, gameId: room.gameId, options: room.options,
            players: room.players.map(function (p) { return { id: p.id, name: p.name, connected: p.connected }; }),
            you: pid,
            game: room.game ? g.view(room.game, pid) : null
        };
    }

    function persist() {
        room.savedAt = Date.now();
        store.set('host', room);
    }

    function changed() {
        persist();
        room.players.forEach(function (p) {
            if (p.id === myId) return;
            var c = conns[p.id];
            if (c && c.open) {
                try { c.send({ t: 'view', v: makeView(p.id) }); } catch (e) { }
            }
        });
        setView(makeView(myId));
    }

    function hostClose() {
        Object.keys(conns).forEach(function (pid) { try { conns[pid].send({ t: 'closed' }); } catch (e) { } });
        store.del('host');
        setTimeout(function () { goHome(''); }, 300);
    }

    // Mark players offline if they stop pinging (data channel 'close' can lag).
    setInterval(function () {
        if (mode !== 'host') return;
        var now = Date.now();
        room.players.forEach(function (p) {
            if (p.id !== myId && p.connected && now - (lastSeen[p.id] || 0) > 15000) {
                if (conns[p.id]) { closeLater(conns[p.id])(); delete conns[p.id]; }
                setConnected(p.id, false);
            }
        });
    }, 5000);

    // =====================================================================
    // Client
    // =====================================================================

    function clientJoin(code, name, pid) {
        mode = 'client';
        screen = 'room';
        status = 'connecting';
        everConnected = false;
        view = null;
        clientInfo = { code: code, name: name, pid: pid || myId };
        store.set('client', clientInfo);
        history.replaceState(null, '', '?room=' + code);
        render();
        if (peer) peer.destroy();
        peer = new Peer(peerOptions());
        peer.on('open', clientConnect);
        peer.on('disconnected', function () {
            setTimeout(function () { if (peer && !peer.destroyed && peer.disconnected) peer.reconnect(); }, 1000);
        });
        peer.on('error', function (err) {
            if (mode !== 'client') return;
            if (err.type === 'peer-unavailable') {
                status = everConnected ? 'host offline, retrying' : 'room not found, retrying';
                render();
                scheduleRetry(3000);
            } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed') {
                status = 'reconnecting';
                render();
                setTimeout(function () {
                    if (mode !== 'client') return;
                    if (peer.destroyed) clientJoin(clientInfo.code, clientInfo.name, clientInfo.pid);
                    else if (peer.disconnected) peer.reconnect();
                }, 2000);
            }
        });
    }

    function scheduleRetry(ms) {
        clearTimeout(retryTimer);
        retryTimer = setTimeout(function () { if (mode === 'client') clientConnect(); }, ms);
    }

    function clientConnect() {
        if (!peer || peer.destroyed) return;
        if (peer.disconnected) { peer.reconnect(); return scheduleRetry(2000); }
        if (conn) { try { conn.close(); } catch (e) { } }
        var c = conn = peer.connect(PREFIX + clientInfo.code, { reliable: true, serialization: 'json' });
        c.on('open', function () {
            lastHeard = Date.now();
            c.send({ t: 'hello', pid: clientInfo.pid, name: clientInfo.name });
        });
        c.on('data', function (msg) {
            if (c !== conn || !msg) return;
            lastHeard = Date.now();
            switch (msg.t) {
                case 'welcome':
                    everConnected = true;
                    status = 'online';
                    clientInfo.pid = msg.pid;
                    store.set('client', clientInfo);
                    render();
                    break;
                case 'view':
                    status = 'online';
                    setView(msg.v);
                    break;
                case 'error': toast(msg.msg); break;
                case 'reject': store.del('client'); goHome(msg.reason); break;
                case 'kicked': store.del('client'); goHome('The host removed you from the room.'); break;
                case 'closed': store.del('client'); goHome('The host closed the room.'); break;
            }
        });
        c.on('close', function () {
            if (c !== conn || mode !== 'client') return;
            status = 'reconnecting';
            render();
            scheduleRetry(1500);
        });
    }

    function clientSend(msg) {
        if (conn && conn.open) conn.send(msg);
        else toast('Not connected — reconnecting…');
    }

    setInterval(function () {
        if (mode !== 'client' || !conn) return;
        if (conn.open) conn.send({ t: 'ping' });
        if (everConnected && Date.now() - lastHeard > 12000 && status !== 'reconnecting') {
            status = 'reconnecting';
            render();
            clientConnect();
        }
    }, 4000);

    // Phones suspend background tabs; resync as soon as we're visible again.
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible') return;
        if (mode === 'client' && (!conn || !conn.open || Date.now() - lastHeard > 6000)) {
            status = 'reconnecting';
            render();
            clientConnect();
        }
        if (mode === 'host') {
            if (peer && peer.destroyed) openHostPeer(false, 0);
            else if (peer && peer.disconnected) peer.reconnect();
            requestWakeLock();
        }
    });

    var wakeLock = null;
    function requestWakeLock() {
        if (!navigator.wakeLock || wakeLock) return;
        navigator.wakeLock.request('screen').then(function (l) {
            wakeLock = l;
            l.addEventListener('release', function () { wakeLock = null; });
        }).catch(function () { });
    }

    // =====================================================================
    // Shared
    // =====================================================================

    function setView(v) {
        // New game: start with the role card face down.
        if (v.game && !(view && view.game)) ui.showRole = false;
        view = v;
        render();
    }

    function sendAction(a) {
        if (mode === 'host') hostAction(myId, a);
        else clientSend({ t: 'act', a: a });
    }

    function goHome(msg) {
        clearTimeout(retryTimer);
        if (peer) { try { peer.destroy(); } catch (e) { } }
        peer = null; conn = null; mode = null; room = null; conns = {}; view = null;
        screen = 'home';
        notice = msg || '';
        history.replaceState(null, '', location.pathname);
        render();
    }

    function leave() {
        if (mode === 'host') {
            if (!confirm('Close this room for everyone?')) return;
            return hostClose();
        }
        if (!confirm('Leave this room?')) return;
        clientSend({ t: 'leave' });
        store.del('client');
        setTimeout(function () { goHome(''); }, 200);
    }

    var toastTimer = null;
    function toast(msg) {
        var el = document.getElementById('toast');
        el.textContent = msg;
        el.className = 'show';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { el.className = ''; }, 3000);
    }

    function joinLink(code) {
        return location.origin + location.pathname + '?room=' + code;
    }

    // ---------- screens ----------

    function renderHome() {
        var params = new URLSearchParams(location.search);
        var code = (params.get('room') || '').toUpperCase();
        var saved = store.get('host');
        if (saved && Date.now() - saved.savedAt > 12 * 3600 * 1000) { store.del('host'); saved = null; }
        var name = (store.get('client') || {}).name || store.get('name') || '';
        var h = '';
        if (notice) h += '<div class="card banner">' + esc(notice) + '</div>';
        h += '<div class="card"><label class="lbl" for="name">your name</label>' +
            '<input id="name" maxlength="16" autocomplete="off" placeholder="name" value="' + esc(name) + '">' +
            '<label class="lbl" for="code">room code</label>' +
            '<div class="row2"><input id="code" maxlength="4" autocomplete="off" autocapitalize="characters" placeholder="ABCD" value="' + esc(code) + '">' +
            '<button class="btn primary" id="join">join</button></div>' +
            '<div class="or">or</div><button class="btn wide" id="host">host a new room</button>';
        if (saved) h += '<button class="btn subtle wide" id="resume">resume hosting room ' + esc(saved.code) + '</button>';
        h += '</div>';
        h += '<details class="card" data-key="privacy"><summary>privacy</summary>' +
            '<p class="small">Phones connect directly to the host’s browser (WebRTC). That means the host’s device can see each player’s IP address, and players can see the host’s. Players never connect to each other. Game messages are encrypted in transit.</p>' +
            (TURN_SERVERS.length ? '<p class="small">Turn this on to route your connection through a relay server so your IP stays hidden from other players. It may be slightly slower.</p>' +
                '<label class="check"><input type="checkbox" id="relay"' + (store.get('relay') ? ' checked' : '') + '> route through relay (hide my IP)</label>' : '') +
            '</details>';
        h += '<h3 class="sub">games</h3>';
        SDG.order.forEach(function (id) {
            var g = SDG.games[id];
            h += '<details class="card" data-key="rules-' + id + '"><summary><b>' + esc(g.name) + '</b> <span class="muted small">' +
                g.minPlayers + '–' + g.maxPlayers + ' players</span><div class="small muted tagline">' + esc(g.tagline) + '</div></summary>' +
                '<div class="rules">' + g.rules + '</div></details>';
        });
        return h;
    }

    function renderLobby(v) {
        var isHost = v.hostId === v.you, g = SDG.games[v.gameId], h = '';
        h += '<div class="card center"><div class="small muted">room code</div><div class="code">' + esc(v.code) + '</div>' +
            '<div id="qr"></div><div class="small muted linkline">' + esc(joinLink(v.code)) + '</div>' +
            (navigator.share ? '<button class="btn subtle" id="share">share link</button>' : '<button class="btn subtle" id="copy">copy link</button>') + '</div>';

        h += '<div class="card"><div class="small muted">players (' + v.players.length + ')</div><div class="plist">';
        v.players.forEach(function (p, i) {
            h += '<div class="prow"><span class="pname">' + esc(p.name) + (p.id === v.you ? ' <span class="muted">(you)</span>' : '') + '</span><span class="ptags">' +
                (p.id === v.hostId ? SDG.tag('host') : '') + (p.connected ? '' : SDG.tag('offline', 'dead'));
            if (isHost) {
                if (i > 0) h += '<button class="mini" title="move up" ' + SDG.act({ type: 'room:move', pid: p.id }) + '>↑</button>';
                if (p.id !== v.you) h += '<button class="mini" title="remove" ' + SDG.act({ type: 'room:kick', pid: p.id }) + ' data-confirm="Remove ' + esc(p.name) + '?">✕</button>';
            }
            h += '</span></div>';
        });
        h += '</div>' + (isHost ? '<div class="small muted">Seating order matters in Usurper. Use ↑ to match how you’re sitting.</div>' : '') + '</div>';

        h += '<div class="card"><div class="small muted">game</div>';
        if (isHost) {
            h += '<div class="seg">' + SDG.order.map(function (id) {
                return '<button class="' + (id === v.gameId ? 'on' : '') + '" ' + SDG.act({ type: 'room:game', gameId: id }) + '>' + esc(SDG.games[id].name) + '</button>';
            }).join('') + '</div>';
        } else {
            h += '<div class="gname">' + esc(g.name) + '</div>';
        }
        h += '<div class="small muted tagline">' + esc(g.tagline) + ' (' + g.minPlayers + '–' + g.maxPlayers + ' players)</div>';
        g.options.forEach(function (o) {
            var val = v.options[o.key];
            if (o.type === 'bool') {
                h += '<label class="check"><input type="checkbox" data-opt="' + o.key + '"' + (val ? ' checked' : '') + (isHost ? '' : ' disabled') + '> ' + esc(o.label) + '</label>';
            } else {
                h += '<label class="check">' + esc(o.label) + ' <select data-opt="' + o.key + '"' + (isHost ? '' : ' disabled') + '>' +
                    o.choices.map(function (c) { return '<option value="' + c[0] + '"' + (c[0] === val ? ' selected' : '') + '>' + esc(c[1]) + '</option>'; }).join('') +
                    '</select></label>';
            }
        });
        var desc = g.describeOptions && g.describeOptions(v.players.length, v.options);
        if (desc) h += '<div class="small muted">' + esc(desc) + '</div>';
        h += '<details data-key="lobby-rules"><summary class="small">rules</summary><div class="rules">' + g.rules + '</div></details></div>';

        if (isHost) {
            var n = v.players.length, ok = n >= g.minPlayers && n <= g.maxPlayers;
            h += '<button class="btn primary wide" ' + SDG.act({ type: 'room:start' }) + (ok ? '' : ' disabled') + '>start ' + esc(g.name) + '</button>';
            if (!ok) h += '<p class="small muted center">' + (n < g.minPlayers ? 'Waiting for ' + (g.minPlayers - n) + ' more player' + (g.minPlayers - n > 1 ? 's' : '') : 'Too many players') + '.</p>';
        } else {
            h += '<p class="muted center">Waiting for the host to start…</p>';
        }
        return h;
    }

    function renderRoom() {
        var h = '<div class="bar"><span class="code-sm">' + esc(view ? view.code : clientInfo ? clientInfo.code : '') + '</span>' +
            '<span class="status ' + (status === 'online' ? 'ok' : 'bad') + '">' + esc(status) + '</span>' +
            '<button class="mini" id="leave">' + (mode === 'host' ? 'close room' : 'leave') + '</button></div>';
        if (!view) return h + '<p class="muted center">Connecting to room…</p>';
        if (!view.game) return h + renderLobby(view);
        var g = SDG.games[view.gameId];
        var offline = view.players.filter(function (p) { return !p.connected; });
        if (offline.length) h += '<div class="small warn">Offline: ' + offline.map(function (p) { return esc(p.name); }).join(', ') + '</div>';
        h += '<div class="game ' + view.gameId + '">' + g.render(view.game, { me: view.you, isHost: view.hostId === view.you, ui: ui }) + '</div>';
        if (view.hostId === view.you) {
            h += '<button class="btn subtle" ' + SDG.act({ type: 'room:lobby' }) +
                (view.game.phase === 'over' ? '>back to lobby' : ' data-confirm="End this game for everyone and return to the lobby?">end game') + '</button>';
        } else if (view.game.phase === 'over') {
            h += '<p class="muted small center">The host can start a new game from the lobby.</p>';
        }
        return h;
    }

    var qr = null;
    function render() {
        var focused = document.activeElement && document.activeElement.id;
        var scroll = window.scrollY;
        app.innerHTML = screen === 'home' ? renderHome() : renderRoom();
        app.querySelectorAll('details[data-key]').forEach(function (d) {
            if (ui.open[d.dataset.key]) d.open = true;
        });
        var qrEl = document.getElementById('qr');
        if (qrEl && window.QRCode && view) {
            new QRCode(qrEl, { text: joinLink(view.code), width: 168, height: 168, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
        }
        if (focused && document.getElementById(focused)) document.getElementById(focused).focus();
        window.scrollTo(0, scroll);
    }

    // ---------- events ----------

    document.addEventListener('toggle', function (e) {
        var d = e.target;
        if (d.tagName === 'DETAILS' && d.dataset.key) ui.open[d.dataset.key] = d.open;
    }, true);

    document.addEventListener('click', function (e) {
        var el = e.target.closest('[data-act],[data-ui],button[id]');
        if (!el || el.disabled) return;
        if (el.dataset.confirm && !confirm(el.dataset.confirm)) return;
        if (el.dataset.act) return sendAction(JSON.parse(el.dataset.act));
        if (el.dataset.ui) { ui[el.dataset.ui] = !ui[el.dataset.ui]; return render(); }
        switch (el.id) {
            case 'join': return doJoin();
            case 'host': return doHost();
            case 'resume': return hostResume(store.get('host'));
            case 'leave': return leave();
            case 'share': return navigator.share({ title: 'Join my game', url: joinLink(view.code) }).catch(function () { });
            case 'copy':
                return navigator.clipboard.writeText(joinLink(view.code)).then(function () { toast('Link copied'); }, function () { });
        }
    });

    document.addEventListener('change', function (e) {
        var el = e.target;
        if (el.id === 'relay') return el.checked ? store.set('relay', true) : store.del('relay');
        if (el.dataset.opt) sendAction({ type: 'room:option', key: el.dataset.opt, value: el.type === 'checkbox' ? el.checked : el.value });
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && (e.target.id === 'code' || e.target.id === 'name')) doJoin();
    });

    function readName() {
        var name = cleanName(document.getElementById('name').value);
        if (!name) { toast('Enter your name first'); document.getElementById('name').focus(); return null; }
        store.set('name', name);
        return name;
    }

    function doJoin() {
        var name = readName();
        if (!name) return;
        var code = document.getElementById('code').value.toUpperCase().replace(/[^A-Z]/g, '');
        if (code.length !== 4) { toast('Room codes are 4 letters'); return; }
        var saved = store.get('host');
        if (saved && saved.code === code) return hostResume(saved);
        store.del('host');
        clientJoin(code, name);
    }

    function doHost() {
        var name = readName();
        if (!name) return;
        var saved = store.get('host');
        if (saved && saved.game && !confirm('Start a new room? Your unfinished game in room ' + saved.code + ' will be lost.')) return;
        store.del('client');
        hostCreate(name);
    }

    // ---------- boot ----------

    (function boot() {
        if (!window.Peer) {
            app.innerHTML = '<div class="card banner">Couldn’t load the networking library. Check your connection and reload.</div>';
            return;
        }
        var code = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
        var savedHost = store.get('host'), savedClient = store.get('client');
        if (code && savedHost && savedHost.code === code) return hostResume(savedHost);
        if (code && savedClient && savedClient.code === code) return clientJoin(code, savedClient.name, savedClient.pid);
        render();
    })();
})();
