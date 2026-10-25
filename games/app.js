// Screens and syncing. The game runs on the server (api/game.js); each phone sends
// actions and polls for its own view of the room.
(function () {
    var SDG = window.SDG, esc = SDG.esc;
    var API = '/api/game';
    var POLL_MS = 1500, BEAT_MS = 8000;
    var app = document.getElementById('app');

    // ---------- storage (may be unavailable) ----------
    var store = {
        get: function (k) { try { return JSON.parse(localStorage.getItem('sdg-' + k)); } catch (e) { return null; } },
        set: function (k, v) { try { localStorage.setItem('sdg-' + k, JSON.stringify(v)); } catch (e) { } },
        del: function (k) { try { localStorage.removeItem('sdg-' + k); } catch (e) { } }
    };

    // ---------- state ----------
    var screen = 'home';      // home | room
    var session = null;       // { code, pid, token, name }
    var status = 'connecting';
    var view = null;          // what this device renders
    var known = { v: 0, ps: '' };
    var ui = { open: {} };    // local-only UI state (role card shown, open <details>)
    var notice = '';
    var pollTimer = null, polling = false, lastBeat = 0, failures = 0, busy = false;

    function api(op, data) {
        return fetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign({ op: op }, data))
        }).then(function (r) {
            return r.json().catch(function () { return { error: 'Bad response from the server.' }; }).then(function (j) {
                if (!r.ok || j.error) {
                    var e = new Error(j.error || 'Server error (' + r.status + ').');
                    e.reason = j.reason;
                    e.http = true;
                    throw e;
                }
                return j;
            });
        });
    }

    function creds() {
        return { code: session.code, pid: session.pid, token: session.token };
    }

    function cleanName(n) {
        return String(n || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 16);
    }

    // ---------- session ----------

    function enterRoom(res, name) {
        session = { code: res.code, pid: res.pid, token: res.token, name: name };
        store.set('session', session);
        screen = 'room';
        status = 'online';
        view = null;
        known = { v: 0, ps: '' };
        lastBeat = Date.now();
        history.replaceState(null, '', '?room=' + res.code);
        apply(res);
        schedulePoll(POLL_MS);
    }

    function endSession(msg) {
        clearTimeout(pollTimer);
        store.del('session');
        session = null;
        view = null;
        screen = 'home';
        notice = msg || '';
        history.replaceState(null, '', location.pathname);
        render();
    }

    function apply(res) {
        if (res && res.now) SDG.clockOffset = res.now - Date.now();
        if (!res || res.same || res.v < known.v) return;
        known = { v: res.v, ps: res.ps };
        setView(res.view);
    }

    function setView(v) {
        // New game: start with the role card face down.
        if (v.game && !(view && view.game)) ui.showRole = false;
        view = v;
        render();
    }

    function handleError(e) {
        if (e.reason === 'gone') return endSession('The room has closed.');
        if (e.reason === 'auth') return endSession('You’re no longer in this room.');
        toast(e.http ? e.message : 'Can’t reach the server. Check your connection.');
    }

    // ---------- polling ----------

    function schedulePoll(ms) {
        clearTimeout(pollTimer);
        pollTimer = setTimeout(poll, ms);
    }

    function poll() {
        if (!session || polling) return;
        if (document.hidden) return schedulePoll(POLL_MS);
        polling = true;
        var beat = Date.now() - lastBeat > BEAT_MS;
        if (beat) lastBeat = Date.now();
        api('view', Object.assign(creds(), { v: known.v, ps: known.ps, beat: beat })).then(function (res) {
            polling = false;
            failures = 0;
            if (!session) return;
            if (status !== 'online') { status = 'online'; render(); }
            apply(res);
            schedulePoll(POLL_MS);
        }, function (e) {
            polling = false;
            if (!session) return;
            if (e.reason === 'gone' || e.reason === 'auth') return handleError(e);
            failures++;
            if (status !== 'reconnecting') { status = 'reconnecting'; render(); }
            schedulePoll(Math.min(POLL_MS * (failures + 1), 6000));
        });
    }

    // Phones pause background tabs; catch up as soon as we're visible again.
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden && session) { lastBeat = 0; schedulePoll(0); }
    });

    // ---------- actions ----------

    function sendAction(a) {
        if (!session || busy) return;
        busy = true;
        api('act', Object.assign(creds(), { action: a })).then(function (res) {
            busy = false;
            if (res.closed) return endSession('');
            apply(res);
        }, function (e) {
            busy = false;
            handleError(e);
        });
    }

    function leave() {
        var isHost = view && view.hostId === view.you;
        if (!confirm(isHost ? 'Close this room for everyone?' : 'Leave this room?')) return;
        if (isHost) return sendAction({ type: 'room:close' });
        api('leave', creds()).catch(function () { });
        endSession('');
    }

    function doHost() {
        var name = readName();
        if (!name || busy) return;
        busy = true;
        api('create', { name: name }).then(function (res) {
            busy = false;
            enterRoom(res, name);
        }, function (e) { busy = false; handleError(e); });
    }

    function doJoin(code, name) {
        name = name || readName();
        if (!name || busy) return;
        code = code || document.getElementById('code').value.toUpperCase().replace(/[^A-Z]/g, '');
        if (code.length !== 4) { toast('Room codes are 4 letters'); return; }
        var prev = store.get('session');
        var mine = prev && prev.code === code ? { pid: prev.pid, token: prev.token } : {};
        busy = true;
        api('join', Object.assign({ code: code, name: name }, mine)).then(function (res) {
            busy = false;
            enterRoom(res, name);
        }, function (e) {
            busy = false;
            if (!e.http && screen === 'room') {
                // Auto-rejoin after a reload hit a network blip: keep trying.
                status = 'reconnecting';
                render();
                return setTimeout(function () { if (screen === 'room' && !view) doJoin(code, name); }, 3000);
            }
            if (e.reason === 'gone') store.del('session');
            if (screen === 'room' && !view) { session = null; screen = 'home'; render(); }
            toast(e.http ? e.message : 'Can’t reach the server. Check your connection.');
        });
    }

    function readName() {
        var el = document.getElementById('name');
        var name = cleanName(el && el.value);
        if (!name) { toast('Enter your name first'); if (el) el.focus(); return null; }
        store.set('name', name);
        return name;
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
        var code = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
        var saved = store.get('session');
        var name = store.get('name') || '';
        var h = '<div class="home-cols"><div>';
        if (notice) h += '<div class="card banner">' + esc(notice) + '</div>';
        h += '<div class="card"><label class="lbl" for="name">your name</label>' +
            '<input id="name" maxlength="16" autocomplete="off" placeholder="name" value="' + esc(name) + '">' +
            '<label class="lbl" for="code">room code</label>' +
            '<div class="row2"><input id="code" maxlength="4" autocomplete="off" autocapitalize="characters" placeholder="ABCD" value="' + esc(code) + '">' +
            '<button class="btn primary" id="join">join</button></div>' +
            '<div class="or">or</div><button class="btn wide" id="host">host a new room</button>';
        if (saved) h += '<button class="btn subtle wide" id="rejoin">rejoin room ' + esc(saved.code) + '</button>';
        h += '</div></div><div>';
        SDG.order.forEach(function (id) {
            var g = SDG.games[id];
            h += '<details class="card" data-key="rules-' + id + '"><summary><b>' + esc(g.name) + '</b> <span class="muted small">' +
                g.minPlayers + '–' + g.maxPlayers + ' players</span><div class="small muted tagline">' + esc(g.tagline) + '</div></summary>' +
                '<div class="rules">' + g.rules + '</div></details>';
        });
        return h + '</div></div>';
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
        h += '</div>' + (isHost && g.seated ? '<div class="small muted">Seating order matters in ' + esc(g.name) + '. Use ↑ to match how you’re sitting.</div>' : '') + '</div>';

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
        var isHost = view && view.hostId === view.you;
        var h = '<div class="bar"><span class="code-sm">' + esc(session ? session.code : '') + '</span>' +
            '<span class="status ' + (status === 'online' ? 'ok' : 'bad') + '">' + esc(status) + '</span>' +
            '<button class="mini" id="leave">' + (isHost ? 'close room' : 'leave') + '</button></div>';
        if (!view) return h + '<p class="muted center">Joining room…</p>';
        if (!view.game) return h + renderLobby(view);
        var g = SDG.games[view.gameId];
        var offline = view.players.filter(function (p) { return !p.connected; });
        if (offline.length) h += '<div class="small warn">Offline: ' + offline.map(function (p) { return esc(p.name); }).join(', ') + '</div>';
        h += '<div class="game ' + view.gameId + '">' + g.render(view.game, { me: view.you, isHost: isHost, ui: ui }) + '</div>';
        if (isHost) {
            h += '<button class="btn subtle" ' + SDG.act({ type: 'room:lobby' }) +
                (view.game.phase === 'over' ? '>back to lobby' : ' data-confirm="End this game for everyone and return to the lobby?">end game') + '</button>';
        } else if (view.game.phase === 'over') {
            h += '<p class="muted small center">The host can start a new game from the lobby.</p>';
        }
        return h;
    }

    function render() {
        var focused = document.activeElement && document.activeElement.id;
        var scroll = window.scrollY;
        // Keep what's typed in game inputs (e.g. a clue) when someone else's move re-renders the screen.
        var typed = {};
        app.querySelectorAll('input[id]:not([type=checkbox])').forEach(function (el) { typed[el.id] = el.value; });
        app.classList.toggle('home-screen', screen === 'home');
        app.innerHTML = screen === 'home' ? renderHome() : renderRoom();
        if (screen === 'room') Object.keys(typed).forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.value = typed[id];
        });
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
        var el = e.target.closest('[data-act],[data-ui],[data-uiset],button[id]');
        if (!el || el.disabled) return;
        if (el.dataset.confirm && !confirm(el.dataset.confirm)) return;
        if (el.dataset.act) {
            // data-fields="a,b": copy those inputs' values into the action before sending.
            var a = JSON.parse(el.dataset.act);
            (el.dataset.fields || '').split(',').filter(Boolean).forEach(function (f) {
                var input = document.getElementById(f);
                a[f] = input ? input.value : '';
            });
            return sendAction(a);
        }
        if (el.dataset.ui) { ui[el.dataset.ui] = !ui[el.dataset.ui]; return render(); }
        if (el.dataset.uiset) { Object.assign(ui, JSON.parse(el.dataset.uiset)); return render(); }
        switch (el.id) {
            case 'join': return doJoin();
            case 'host': return doHost();
            case 'rejoin': var s = store.get('session'); return s && doJoin(s.code, s.name);
            case 'leave': return leave();
            case 'share': return navigator.share({ title: 'Join my game', url: joinLink(view.code) }).catch(function () { });
            case 'copy':
                return navigator.clipboard.writeText(joinLink(view.code)).then(function () { toast('Link copied'); }, function () { });
        }
    });

    document.addEventListener('change', function (e) {
        var el = e.target;
        if (el.dataset.opt) sendAction({ type: 'room:option', key: el.dataset.opt, value: el.type === 'checkbox' ? el.checked : el.value });
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && (e.target.id === 'code' || e.target.id === 'name')) doJoin();
    });

    // Countdowns tick locally; when one runs out, re-render once so the game can show what comes next.
    var expired = {};
    setInterval(function () {
        app.querySelectorAll('[data-deadline]').forEach(function (el) {
            var left = Math.max(0, Math.ceil((+el.dataset.deadline - SDG.now()) / 1000));
            el.textContent = Math.floor(left / 60) + ':' + ('0' + left % 60).slice(-2);
            if (!left && !expired[el.dataset.deadline]) { expired[el.dataset.deadline] = true; render(); }
        });
    }, 500);

    // ---------- boot ----------

    (function boot() {
        var code = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
        var saved = store.get('session');
        render();
        // Reloaded mid-game: rejoin automatically.
        if (code && saved && saved.code === code) {
            screen = 'room';
            session = saved;
            render();
            doJoin(code, saved.name);
        }
    })();
})();
