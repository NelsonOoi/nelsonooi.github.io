// Nightfall — a hidden-role village game (Mafia-style).
(function (root) {
    var SDG = root.SDG || require('./core.js');
    var esc = SDG.esc, act = SDG.act, tag = SDG.tag;

    var ROLES = {
        shadow: { name: 'Shadow', team: 'shadows', blurb: 'Each night, agree with the other Shadows on someone to eliminate. By day, blend in.' },
        healer: { name: 'Healer', team: 'village', blurb: 'Each night, protect one player from the Shadows. You can protect yourself, but not the same person two nights in a row.' },
        seer: { name: 'Seer', team: 'village', blurb: 'Each night, learn whether one player is a Shadow.' },
        villager: { name: 'Villager', team: 'village', blurb: 'You have no night power. Find the Shadows by day and vote them out.' }
    };

    function autoShadows(n) { return Math.max(1, Math.floor((n - 1) / 3)); }

    function alivePlayers(s) { return s.players.filter(function (p) { return s.alive[p.id]; }); }
    function name(s, pid) {
        for (var i = 0; i < s.players.length; i++) if (s.players[i].id === pid) return s.players[i].name;
        return '?';
    }
    function livingShadows(s) {
        return alivePlayers(s).filter(function (p) { return s.roles[p.id] === 'shadow'; }).map(function (p) { return p.id; });
    }

    function setup(players, opts) {
        var n = players.length;
        var k = opts.shadows === 'auto' ? autoShadows(n) : parseInt(opts.shadows, 10);
        var specials = (opts.healer ? 1 : 0) + (opts.seer ? 1 : 0);
        if (k * 2 >= n) SDG.fail('Too many Shadows for ' + n + ' players.');
        if (k + specials > n) SDG.fail('Not enough players for these roles.');
        var deck = [];
        for (var i = 0; i < k; i++) deck.push('shadow');
        if (opts.healer) deck.push('healer');
        if (opts.seer) deck.push('seer');
        while (deck.length < n) deck.push('villager');
        deck = SDG.shuffle(deck);
        var s = {
            opts: opts, phase: 'reveal', round: 0,
            players: players.map(function (p) { return { id: p.id, name: p.name }; }),
            roles: {}, alive: {}, ready: {},
            night: null, lastHealed: null, seerResults: [],
            dawn: null, votes: {}, locked: {}, verdict: null,
            winner: null, log: []
        };
        players.forEach(function (p, i) { s.roles[p.id] = deck[i]; s.alive[p.id] = true; });
        return s;
    }

    function startNight(s) {
        s.round++;
        s.phase = 'night';
        s.night = { picks: {}, locked: {} };
        s.log.push('Night ' + s.round + ' falls.');
    }

    function checkWin(s) {
        var shadows = livingShadows(s).length;
        var others = alivePlayers(s).length - shadows;
        if (shadows === 0) s.winner = 'village';
        else if (shadows >= others) s.winner = 'shadows';
        if (s.winner) {
            s.phase = 'over';
            s.log.push(s.winner === 'village' ? 'The village wins.' : 'The Shadows win.');
        }
        return !!s.winner;
    }

    function resolveNight(s) {
        var n = s.night, kill = null, heal = null;
        livingShadows(s).forEach(function (pid) { if (n.locked[pid]) kill = n.picks[pid]; });
        alivePlayers(s).forEach(function (p) {
            if (s.roles[p.id] === 'healer' && n.locked[p.id]) heal = n.picks[p.id];
        });
        s.lastHealed = heal;
        s.dawn = { killed: null };
        if (kill && kill !== heal) {
            s.alive[kill] = false;
            s.dawn.killed = kill;
            s.log.push(name(s, kill) + ' was found dead at dawn.');
        } else {
            s.log.push('Nobody died during night ' + s.round + '.');
        }
        s.night = null;
        if (checkWin(s)) return;
        s.phase = 'day';
        s.votes = {};
        s.locked = {};
    }

    function resolveDay(s) {
        var tally = {}, skip = 0;
        Object.keys(s.locked).forEach(function (pid) {
            if (!s.alive[pid]) return;
            var t = s.votes[pid];
            if (t === 'skip') skip++;
            else tally[t] = (tally[t] || 0) + 1;
        });
        var top = 0, leaders = [];
        Object.keys(tally).forEach(function (t) {
            if (tally[t] > top) { top = tally[t]; leaders = [t]; }
            else if (tally[t] === top) leaders.push(t);
        });
        var out = (leaders.length === 1 && top > skip) ? leaders[0] : null;
        var reason = out ? null : (top === 0 ? 'no votes' : leaders.length > 1 ? 'a tie' : 'too many skips');
        s.verdict = { eliminated: out, reason: reason, votes: {} };
        Object.keys(s.locked).forEach(function (pid) { s.verdict.votes[pid] = s.votes[pid]; });
        if (out) {
            s.alive[out] = false;
            s.log.push('The village voted out ' + name(s, out) +
                (s.opts.reveal ? ' (' + ROLES[s.roles[out]].name + ').' : '.'));
        } else {
            s.log.push('Day ' + s.round + ': nobody was voted out (' + reason + ').');
        }
        if (checkWin(s)) return;
        s.phase = 'verdict';
    }

    function validNightTarget(s, pid, target) {
        if (!s.alive[target]) return false;
        var role = s.roles[pid];
        if (role === 'shadow') return s.roles[target] !== 'shadow';
        if (role === 'healer') return target !== s.lastHealed;
        return target !== pid;
    }

    function handle(s, pid, a, ctx) {
        var alive = s.alive[pid];
        switch (a.type) {
            case 'ready':
                if (s.phase !== 'reveal') return;
                s.ready[pid] = true;
                if (s.players.every(function (p) { return s.ready[p.id]; })) startNight(s);
                return;
            case 'pick':
                if (s.phase !== 'night' || !alive) return;
                if (s.night.locked[pid]) SDG.fail('You already locked in.');
                if (!validNightTarget(s, pid, a.target)) SDG.fail('You can’t pick that player.');
                s.night.picks[pid] = a.target;
                return;
            case 'lock':
                if (s.phase !== 'night' || !alive || s.night.locked[pid]) return;
                var pick = s.night.picks[pid];
                if (!pick) SDG.fail('Pick someone first.');
                if (s.roles[pid] === 'shadow' && !livingShadows(s).every(function (id) { return s.night.picks[id] === pick; }))
                    SDG.fail('All Shadows must pick the same target.');
                if (s.roles[pid] === 'seer')
                    s.seerResults.push({ round: s.round, target: pick, shadow: s.roles[pick] === 'shadow' });
                s.night.locked[pid] = true;
                if (alivePlayers(s).every(function (p) { return s.night.locked[p.id]; })) resolveNight(s);
                return;
            case 'vote':
                if (s.phase !== 'day' || !alive) return;
                if (s.locked[pid]) SDG.fail('Your vote is locked.');
                if (a.target !== 'skip' && (!s.alive[a.target] || a.target === pid)) SDG.fail('You can’t vote for that player.');
                s.votes[pid] = a.target;
                return;
            case 'lockVote':
                if (s.phase !== 'day' || !alive || s.locked[pid]) return;
                if (!s.votes[pid]) SDG.fail('Vote first.');
                s.locked[pid] = true;
                if (alivePlayers(s).every(function (p) { return s.locked[p.id]; })) resolveDay(s);
                return;
            case 'force':
                if (!ctx.isHost) SDG.fail('Only the host can do that.');
                if (s.phase === 'reveal') startNight(s);
                else if (s.phase === 'night') resolveNight(s);
                else if (s.phase === 'day') resolveDay(s);
                return;
            case 'continue':
                if (!ctx.isHost) SDG.fail('Only the host can do that.');
                if (s.phase === 'verdict') startNight(s);
                return;
        }
    }

    function view(s, pid) {
        var role = s.roles[pid];
        var omniscient = s.phase === 'over' || (s.alive[pid] === false);
        var v = {
            phase: s.phase, round: s.round, opts: s.opts,
            players: s.players.map(function (p) { return { id: p.id, name: p.name, alive: s.alive[p.id] }; }),
            role: role, alive: s.alive[pid] !== false, omniscient: omniscient,
            roles: {}, publicRoles: {}, log: s.log, winner: s.winner, dawn: s.dawn, verdict: s.verdict
        };
        s.players.forEach(function (p) {
            var show = omniscient || p.id === pid ||
                (role === 'shadow' && s.roles[p.id] === 'shadow') ||
                (!s.alive[p.id] && s.opts.reveal);
            if (show) v.roles[p.id] = s.roles[p.id];
            if (s.phase === 'over' || (!s.alive[p.id] && s.opts.reveal)) v.publicRoles[p.id] = s.roles[p.id];
        });
        if (s.phase === 'reveal') {
            v.readyCount = Object.keys(s.ready).length;
            v.ready = !!s.ready[pid];
        }
        if (s.phase === 'night') {
            var n = s.night;
            v.night = {
                pick: n.picks[pid] || null, locked: !!n.locked[pid],
                lockedCount: Object.keys(n.locked).length, total: alivePlayers(s).length
            };
            if (role === 'shadow' || omniscient) {
                v.night.shadowPicks = {};
                s.players.forEach(function (p) {
                    if (s.roles[p.id] === 'shadow' && s.alive[p.id] && n.picks[p.id]) v.night.shadowPicks[p.id] = n.picks[p.id];
                });
            }
            if (omniscient) v.night.allPicks = n.picks;
        }
        if (role === 'healer') v.lastHealed = s.lastHealed;
        if (role === 'seer' || omniscient) v.seerResults = s.seerResults;
        if (s.phase === 'day') {
            v.votes = s.votes;
            v.locked = s.locked;
        }
        return v;
    }

    // ---------- rendering ----------

    function roleCard(v, ctx) {
        var r = ROLES[v.role];
        if (!ctx.ui.showRole) {
            return '<button class="rolecard hidden" data-ui="showRole">tap to reveal your role</button>';
        }
        var partners = v.role === 'shadow' ? v.players.filter(function (p) {
            return p.id !== ctx.me && v.roles[p.id] === 'shadow';
        }).map(function (p) { return esc(p.name); }) : [];
        return '<button class="rolecard ' + r.team + '" data-ui="showRole">' +
            '<span class="rc-label">you are a</span><span class="rc-name">' + r.name + '</span>' +
            '<span class="rc-blurb">' + r.blurb + '</span>' +
            (v.role === 'shadow' ? '<span class="rc-blurb">' +
                (partners.length ? 'Your fellow Shadows: ' + partners.join(', ') : 'You are the only Shadow.') + '</span>' : '') +
            '<span class="rc-hint">tap to hide</span></button>';
    }

    // Secret roles (your own, your partners') only show while the role card is open.
    function playerTags(v, pid, ctx) {
        var p = v.players.filter(function (x) { return x.id === pid; })[0];
        var role = v.publicRoles[pid] || ((ctx.ui.showRole || v.omniscient) ? v.roles[pid] : null);
        var t = '';
        if (role) t += tag(ROLES[role].name, ROLES[role].team);
        if (!p.alive) t += tag('dead', 'dead');
        return t;
    }

    function namesFor(v, map, target) {
        return v.players.filter(function (p) { return map[p.id] === target; }).map(function (p) { return p.name; });
    }

    function renderNight(v, ctx) {
        var n = v.night, h = '';
        if (!v.alive) {
            h += '<p class="muted">You are dead. Watch quietly.</p>';
            h += SDG.playerList({
                players: v.players.filter(function (p) { return p.alive; }),
                tags: function (pid) {
                    return playerTags(v, pid, ctx) + namesFor(v, n.allPicks || {}, pid).map(function (x) { return tag('← ' + x); }).join('');
                }
            });
            return h + '<p class="muted small">' + n.lockedCount + '/' + n.total + ' locked in</p>';
        }
        var prompts = {
            shadow: 'Choose a victim. All Shadows must agree.',
            healer: 'Choose someone to protect tonight.',
            seer: 'Choose someone to investigate.',
            villager: 'Choose someone you suspect. Everyone taps at night so nobody can tell who has a power.'
        };
        h += '<p>' + prompts[v.role] + '</p>';
        var candidates = v.players.filter(function (p) {
            if (!p.alive) return false;
            if (v.role === 'shadow') return v.roles[p.id] !== 'shadow';
            if (v.role === 'healer') return true;
            return p.id !== ctx.me;
        });
        h += SDG.playerList({
            players: candidates,
            selected: n.pick,
            selectable: function (pid) { return !n.locked && !(v.role === 'healer' && pid === v.lastHealed); },
            action: function (pid) { return { type: 'pick', target: pid }; },
            tags: function (pid) {
                var t = playerTags(v, pid, ctx);
                if (v.role === 'healer' && pid === v.lastHealed) t += tag('protected last night');
                if (n.shadowPicks) namesFor(v, n.shadowPicks, pid).forEach(function (x) { t += tag(x, 'shadows'); });
                return t;
            }
        });
        if (n.locked) {
            if (v.role === 'seer') {
                var r = v.seerResults[v.seerResults.length - 1];
                h += '<div class="card result ' + (r.shadow ? 'shadows' : 'village') + '">' + esc(nm(v, r.target)) +
                    (r.shadow ? ' <b>is a Shadow</b>.' : ' is <b>not</b> a Shadow.') + '</div>';
            }
            h += '<p class="muted">Locked in. Waiting for others… (' + n.lockedCount + '/' + n.total + ')</p>';
        } else {
            h += '<button class="btn primary wide" ' + act({ type: 'lock' }) + (n.pick ? '' : ' disabled') + '>lock in</button>';
        }
        return h;
    }

    function nm(v, pid) {
        for (var i = 0; i < v.players.length; i++) if (v.players[i].id === pid) return v.players[i].name;
        return '?';
    }

    function dawnBanner(v) {
        if (!v.dawn) return '';
        if (!v.dawn.killed) return '<div class="card banner">Nobody died last night.</div>';
        var r = v.opts.reveal && v.roles[v.dawn.killed] ? ' They were a <b>' + ROLES[v.roles[v.dawn.killed]].name + '</b>.' : '';
        return '<div class="card banner"><b>' + esc(nm(v, v.dawn.killed)) + '</b> was found dead at dawn.' + r + '</div>';
    }

    function renderDay(v, ctx) {
        var h = dawnBanner(v);
        var me = ctx.me, myVote = v.votes[me], locked = !!v.locked[me];
        var living = v.players.filter(function (p) { return p.alive; });
        var lockedCount = living.filter(function (p) { return v.locked[p.id]; }).length;
        h += '<p>' + (v.alive ? 'Discuss, then vote to eliminate a suspect.' : 'You are dead. Watch quietly.') + '</p>';
        var voters = function (target) {
            return v.players.filter(function (p) { return v.votes[p.id] === target; }).map(function (p) {
                return tag(p.name + (v.locked[p.id] ? ' ✓' : ''), 'vote');
            }).join('');
        };
        h += SDG.playerList({
            players: living,
            selected: myVote,
            selectable: function (pid) { return v.alive && !locked && pid !== me; },
            action: function (pid) { return { type: 'vote', target: pid }; },
            tags: function (pid) { return playerTags(v, pid, ctx) + voters(pid); }
        });
        h += '<div class="plist"><button class="prow' + (v.alive && !locked ? ' pick' : '') + (myVote === 'skip' ? ' sel' : '') + '" ' +
            (v.alive && !locked ? act({ type: 'vote', target: 'skip' }) : 'disabled') +
            '><span class="pname">skip vote</span><span class="ptags">' + voters('skip') + '</span></button></div>';
        if (v.alive && !locked) {
            h += '<button class="btn primary wide" ' + act({ type: 'lockVote' }) + (myVote ? '' : ' disabled') + '>lock vote</button>';
        }
        h += '<p class="muted small">' + lockedCount + '/' + living.length + ' votes locked. The top vote-getter is eliminated if they beat the skips and there’s no tie.</p>';
        if (ctx.isHost) h += '<button class="btn subtle" ' + act({ type: 'force' }) + ' data-confirm="Close voting now? Only locked votes count.">close voting now</button>';
        return h;
    }

    function renderVerdict(v, ctx) {
        var vd = v.verdict, h = '';
        if (vd.eliminated) {
            var r = v.opts.reveal && v.roles[vd.eliminated] ? ' They were a <b>' + ROLES[v.roles[vd.eliminated]].name + '</b>.' : '';
            h += '<div class="card banner">The village voted out <b>' + esc(nm(v, vd.eliminated)) + '</b>.' + r + '</div>';
        } else {
            h += '<div class="card banner">Nobody was voted out (' + esc(vd.reason) + ').</div>';
        }
        h += '<div class="card"><div class="small muted">votes</div>' + v.players.filter(function (p) { return vd.votes[p.id]; }).map(function (p) {
            var t = vd.votes[p.id];
            return '<div class="small">' + esc(p.name) + ' → ' + (t === 'skip' ? 'skip' : esc(nm(v, t))) + '</div>';
        }).join('') + '</div>';
        h += ctx.isHost ? '<button class="btn primary wide" ' + act({ type: 'continue' }) + '>night falls →</button>'
            : '<p class="muted">Waiting for the host to start the night…</p>';
        return h;
    }

    function render(v, ctx) {
        var titles = { reveal: 'Roles', night: 'Night ' + v.round, day: 'Day ' + v.round, verdict: 'Day ' + v.round, over: 'Game over' };
        var h = '<div class="phase ' + (v.phase === 'night' ? 'night' : '') + '"><h2>' + titles[v.phase] + '</h2></div>';

        if (v.phase === 'over') {
            h += '<div class="card banner ' + v.winner + '"><b>' + (v.winner === 'village' ? 'The village wins!' : 'The Shadows win!') + '</b></div>';
            h += SDG.playerList({ players: v.players, tags: function (pid) { return playerTags(v, pid, ctx); } });
            return h + SDG.logList(v.log, 30);
        }

        h += roleCard(v, ctx);

        if (v.phase === 'reveal') {
            h += v.ready ? '<p class="muted">Waiting for everyone to check their role… (' + v.readyCount + '/' + v.players.length + ')</p>'
                : '<button class="btn primary wide" ' + act({ type: 'ready' }) + '>I’ve seen my role</button>';
            if (ctx.isHost) h += '<button class="btn subtle" ' + act({ type: 'force' }) + ' data-confirm="Start the first night without waiting?">start night now</button>';
        } else if (v.phase === 'night') {
            h += renderNight(v, ctx);
            if (ctx.isHost) h += '<button class="btn subtle" ' + act({ type: 'force' }) + ' data-confirm="End the night now? Anyone not locked in does nothing.">end night now</button>';
        } else if (v.phase === 'day') {
            h += renderDay(v, ctx);
        } else if (v.phase === 'verdict') {
            h += renderVerdict(v, ctx);
        }

        if (v.seerResults && v.seerResults.length && v.role === 'seer' && ctx.ui.showRole) {
            h += '<details class="card" data-key="seer"><summary>your visions</summary>' + v.seerResults.map(function (r) {
                return '<div class="small">Night ' + r.round + ': ' + esc(nm(v, r.target)) + ' — ' + (r.shadow ? 'Shadow' : 'not a Shadow') + '</div>';
            }).join('') + '</details>';
        }
        if (v.phase !== 'day') {
            h += '<details class="card" data-key="players"><summary>players</summary>' +
                SDG.playerList({ players: v.players, tags: function (pid) { return playerTags(v, pid, ctx); } }) + '</details>';
        }
        return h + SDG.logList(v.log);
    }

    SDG.register({
        id: 'nightfall',
        name: 'Nightfall',
        tagline: 'Shadows hide among the villagers. Each night someone vanishes; each day the village votes.',
        minPlayers: 4,
        maxPlayers: 20,
        options: [
            { key: 'shadows', label: 'Shadows', type: 'select', def: 'auto', choices: [['auto', 'auto'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5']] },
            { key: 'healer', label: 'Include a Healer', type: 'bool', def: true },
            { key: 'seer', label: 'Include a Seer', type: 'bool', def: true },
            { key: 'reveal', label: 'Reveal roles when players die', type: 'bool', def: true }
        ],
        describeOptions: function (n, opts) {
            if (n < 4) return '';
            var k = opts.shadows === 'auto' ? autoShadows(n) : parseInt(opts.shadows, 10);
            return k + ' Shadow' + (k > 1 ? 's' : '') + ' with ' + n + ' players';
        },
        rules: '<p>Everyone secretly gets a role. The <b>Shadows</b> know each other; everyone else is in the <b>village</b>.</p>' +
            '<p><b>Night:</b> everyone taps a player on their phone. The Shadows agree on a victim, the <b>Healer</b> protects someone, and the <b>Seer</b> learns whether someone is a Shadow. Villagers tap too, so nobody can tell who has a power.</p>' +
            '<p><b>Day:</b> the victim is revealed. Talk it over, then vote. The top vote-getter is eliminated if they have more votes than “skip” and there’s no tie.</p>' +
            '<p>The village wins when every Shadow is gone. The Shadows win when they equal or outnumber the rest. Dead players can see every role, so they must stay silent.</p>',
        setup: setup,
        act: handle,
        view: view,
        render: render,
        roles: ROLES
    });
})(typeof window !== 'undefined' ? window : globalThis);
