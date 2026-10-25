// Usurper — a hidden-role legislative game (Secret Hitler-style).
(function (root) {
    var SDG = root.SDG || require('./core.js');
    var esc = SDG.esc, act = SDG.act, tag = SDG.tag;

    var ROLES = {
        loyal: { name: 'Loyalist', team: 'loyal', blurb: 'Enact 5 Loyalist decrees, or execute the Usurper.' },
        cabal: { name: 'Cabal', team: 'cabal', blurb: 'Enact 6 Cabal decrees, or get the Usurper elected Deputy once 3 Cabal decrees are in place. Keep the Usurper hidden.' },
        usurper: { name: 'the Usurper', team: 'cabal', blurb: 'You lead the Cabal. Win by being elected Deputy after 3 Cabal decrees, or when 6 Cabal decrees are enacted. Earn the Loyalists’ trust.' }
    };
    // [loyalists, cabal members (not counting the Usurper)]
    var SPLIT = { 5: [3, 1], 6: [4, 1], 7: [4, 2], 8: [5, 2], 9: [5, 3], 10: [6, 3] };
    var POWER_NAMES = {
        investigate: 'investigate loyalty', peek: 'peek at decrees',
        special: 'special election', execute: 'execution'
    };

    function powerTable(n) {
        if (n <= 6) return [null, null, 'peek', 'execute', 'execute', null];
        if (n <= 8) return [null, 'investigate', 'special', 'execute', 'execute', null];
        return ['investigate', 'investigate', 'special', 'execute', 'execute', null];
    }

    function name(s, pid) {
        for (var i = 0; i < s.players.length; i++) if (s.players[i].id === pid) return s.players[i].name;
        return '?';
    }
    function aliveCount(s) { return s.players.filter(function (p) { return s.alive[p.id]; }).length; }
    function idx(s, pid) { for (var i = 0; i < s.players.length; i++) if (s.players[i].id === pid) return i; return -1; }

    function setup(players, opts) {
        var n = players.length, split = SPLIT[n];
        if (!split) SDG.fail('Usurper needs 5–10 players.');
        var deck = ['usurper'], i;
        for (i = 0; i < split[0]; i++) deck.push('loyal');
        for (i = 0; i < split[1]; i++) deck.push('cabal');
        deck = SDG.shuffle(deck);
        var decrees = [];
        for (i = 0; i < 6; i++) decrees.push('loyal');
        for (i = 0; i < 11; i++) decrees.push('cabal');
        var s = {
            opts: opts, phase: 'reveal',
            players: players.map(function (p) { return { id: p.id, name: p.name }; }),
            roles: {}, alive: {}, ready: {},
            deck: SDG.shuffle(decrees), discard: [],
            enacted: { loyal: 0, cabal: 0 }, tracker: 0,
            powers: powerTable(n),
            rotation: SDG.randInt(n), president: null, chancellor: null,
            lastElected: null, votes: {}, lastVote: null,
            hand: null, vetoRefused: false, power: null,
            investigated: {}, notes: {},
            winner: null, winReason: null, log: []
        };
        players.forEach(function (p, i) { s.roles[p.id] = deck[i]; s.alive[p.id] = true; s.notes[p.id] = []; });
        s.president = s.players[s.rotation].id;
        return s;
    }

    function eligible(s, pid) {
        if (!s.alive[pid] || pid === s.president) return false;
        if (s.lastElected) {
            if (pid === s.lastElected.chancellor) return false;
            if (pid === s.lastElected.president && aliveCount(s) > 5) return false;
        }
        return true;
    }

    function win(s, team, reason) {
        s.winner = team;
        s.winReason = reason;
        s.phase = 'over';
        s.log.push(reason);
    }

    function nextRound(s) {
        var n = s.players.length, i = s.rotation;
        do { i = (i + 1) % n; } while (!s.alive[s.players[i].id]);
        s.rotation = i;
        startRound(s, s.players[i].id);
    }

    function startRound(s, president) {
        s.president = president;
        s.chancellor = null;
        s.hand = null;
        s.power = null;
        s.vetoRefused = false;
        s.phase = 'nominate';
    }

    function reshuffleIfLow(s) {
        if (s.deck.length < 3) {
            s.deck = SDG.shuffle(s.deck.concat(s.discard));
            s.discard = [];
            s.log.push('The decree deck was reshuffled.');
        }
    }

    function draw(s, k) {
        reshuffleIfLow(s);
        return s.deck.splice(0, k);
    }

    // Returns true if the game ended.
    function enact(s, card, byGovernment) {
        s.enacted[card]++;
        s.tracker = 0;
        s.log.push((byGovernment ? '' : 'Unrest! ') + 'A ' + (card === 'loyal' ? 'Loyalist' : 'Cabal') + ' decree was enacted' +
            (byGovernment ? '.' : ' from the top of the deck.'));
        if (s.enacted.loyal >= 5) { win(s, 'loyal', 'Five Loyalist decrees: the Loyalists win.'); return true; }
        if (s.enacted.cabal >= 6) { win(s, 'cabal', 'Six Cabal decrees: the Cabal wins.'); return true; }
        reshuffleIfLow(s);
        return false;
    }

    function failedGovernment(s) {
        s.tracker++;
        if (s.tracker >= 3) {
            s.lastElected = null;
            reshuffleIfLow(s);
            if (enact(s, s.deck.shift(), false)) return;
        }
        nextRound(s);
    }

    function afterEnact(s, card) {
        var power = card === 'cabal' ? s.powers[s.enacted.cabal - 1] : null;
        if (!power) return nextRound(s);
        s.power = power;
        s.phase = 'power';
        if (power === 'peek') {
            reshuffleIfLow(s);
            var top = s.deck.slice(0, 3).map(function (c) { return c === 'loyal' ? 'L' : 'C'; }).join(' ');
            s.notes[s.president].push('Top 3 decrees after decree ' + (s.enacted.loyal + s.enacted.cabal) + ': ' + top);
        }
    }

    function handle(s, pid, a, ctx) {
        var isPres = pid === s.president;
        switch (a.type) {
            case 'ready':
                if (s.phase !== 'reveal') return;
                s.ready[pid] = true;
                if (s.players.every(function (p) { return s.ready[p.id]; })) startRound(s, s.president);
                return;
            case 'force':
                if (!ctx.isHost) SDG.fail('Only the host can do that.');
                if (s.phase === 'reveal') startRound(s, s.president);
                return;
            case 'nominate':
                if (s.phase !== 'nominate' || !isPres) return;
                if (!eligible(s, a.target)) SDG.fail('That player isn’t eligible.');
                s.chancellor = a.target;
                s.votes = {};
                s.phase = 'vote';
                s.log.push(name(s, pid) + ' nominated ' + name(s, a.target) + ' as Deputy.');
                return;
            case 'vote':
                if (s.phase !== 'vote' || !s.alive[pid]) return;
                if (pid in s.votes) SDG.fail('You already voted.');
                s.votes[pid] = !!a.aye;
                var voters = s.players.filter(function (p) { return s.alive[p.id]; });
                if (!voters.every(function (p) { return p.id in s.votes; })) return;
                var ayes = voters.filter(function (p) { return s.votes[p.id]; }).length;
                var passed = ayes * 2 > voters.length;
                s.lastVote = { president: s.president, chancellor: s.chancellor, votes: s.votes, passed: passed };
                s.log.push('Vote ' + (passed ? 'passed' : 'failed') + ' ' + ayes + '–' + (voters.length - ayes) + '.');
                if (!passed) return failedGovernment(s);
                s.lastElected = { president: s.president, chancellor: s.chancellor };
                if (s.enacted.cabal >= 3 && s.roles[s.chancellor] === 'usurper') {
                    return win(s, 'cabal', name(s, s.chancellor) + ' was the Usurper, elected Deputy after 3 Cabal decrees: the Cabal wins.');
                }
                s.hand = draw(s, 3);
                s.phase = 'legislate-p';
                return;
            case 'discard':
                if (s.phase !== 'legislate-p' || !isPres) return;
                if (!(a.index >= 0 && a.index < 3)) SDG.fail('Pick a decree.');
                s.discard.push(s.hand.splice(a.index, 1)[0]);
                s.phase = 'legislate-c';
                return;
            case 'enact':
                if (s.phase !== 'legislate-c' || pid !== s.chancellor) return;
                if (!(a.index >= 0 && a.index < 2)) SDG.fail('Pick a decree.');
                var card = s.hand.splice(a.index, 1)[0];
                s.discard.push(s.hand[0]);
                s.hand = null;
                if (enact(s, card, true)) return;
                return afterEnact(s, card);
            case 'veto':
                if (s.phase !== 'legislate-c' || pid !== s.chancellor) return;
                if (s.enacted.cabal < 5 || s.vetoRefused) SDG.fail('Veto isn’t available.');
                s.phase = 'veto';
                s.log.push(name(s, pid) + ' proposed a veto.');
                return;
            case 'vetoAnswer':
                if (s.phase !== 'veto' || !isPres) return;
                if (a.accept) {
                    s.discard = s.discard.concat(s.hand);
                    s.hand = null;
                    s.log.push(name(s, pid) + ' accepted the veto. Both decrees were discarded.');
                    reshuffleIfLow(s);
                    return failedGovernment(s);
                }
                s.vetoRefused = true;
                s.phase = 'legislate-c';
                s.log.push(name(s, pid) + ' refused the veto.');
                return;
            case 'power':
                if (s.phase !== 'power' || !isPres) return;
                if (s.power === 'peek') {
                    s.log.push(name(s, pid) + ' peeked at the top 3 decrees.');
                    return nextRound(s);
                }
                var t = a.target;
                if (!s.alive[t] || t === pid) SDG.fail('Pick another living player.');
                if (s.power === 'investigate') {
                    if (s.investigated[t]) SDG.fail('That player was already investigated.');
                    s.investigated[t] = true;
                    s.notes[pid].push(name(s, t) + ' is ' + (s.roles[t] === 'loyal' ? 'a Loyalist' : 'in the Cabal') + '.');
                    s.log.push(name(s, pid) + ' investigated ' + name(s, t) + '.');
                    return nextRound(s);
                }
                if (s.power === 'special') {
                    s.log.push(name(s, pid) + ' called a special election: ' + name(s, t) + ' is the next Speaker.');
                    return startRound(s, t);
                }
                if (s.power === 'execute') {
                    s.alive[t] = false;
                    s.log.push(name(s, pid) + ' executed ' + name(s, t) + '.');
                    if (s.roles[t] === 'usurper') return win(s, 'loyal', name(s, t) + ' was the Usurper: the Loyalists win.');
                    return nextRound(s);
                }
                return;
        }
    }

    function view(s, pid) {
        var role = s.roles[pid], n = s.players.length, over = s.phase === 'over';
        var v = {
            phase: s.phase,
            players: s.players.map(function (p) { return { id: p.id, name: p.name, alive: s.alive[p.id] }; }),
            role: role, alive: s.alive[pid] !== false,
            known: {}, president: s.president, chancellor: s.chancellor,
            lastElected: s.lastElected, enacted: s.enacted, tracker: s.tracker,
            deckCount: s.deck.length, discardCount: s.discard.length,
            powers: s.powers, power: s.phase === 'power' ? s.power : null,
            lastVote: s.lastVote, notes: s.notes[pid] || [],
            investigated: s.investigated, vetoRefused: s.vetoRefused,
            log: s.log, winner: s.winner, winReason: s.winReason
        };
        s.players.forEach(function (p) {
            var r = s.roles[p.id];
            if (over || p.id === pid ||
                (role === 'cabal' && r !== 'loyal') ||
                (role === 'usurper' && r === 'cabal' && n <= 6)) v.known[p.id] = r;
        });
        v.eligible = s.players.filter(function (p) { return eligible(s, p.id); }).map(function (p) { return p.id; });
        if (s.phase === 'vote') {
            v.voted = Object.keys(s.votes);
            v.myVote = pid in s.votes ? s.votes[pid] : null;
        }
        if ((s.phase === 'legislate-p' && pid === s.president) ||
            ((s.phase === 'legislate-c' || s.phase === 'veto') && (pid === s.chancellor || pid === s.president && s.phase === 'veto'))) {
            v.hand = s.hand;
        }
        return v;
    }

    // ---------- rendering ----------

    function nm(v, pid) {
        for (var i = 0; i < v.players.length; i++) if (v.players[i].id === pid) return v.players[i].name;
        return '?';
    }

    function roleCard(v, ctx) {
        var r = ROLES[v.role];
        if (!ctx.ui.showRole) return '<button class="rolecard hidden" data-ui="showRole">tap to reveal your role</button>';
        var others = v.players.filter(function (p) { return p.id !== ctx.me && v.known[p.id]; });
        var know = '';
        if (v.role === 'cabal') {
            know = others.map(function (p) { return esc(p.name) + (v.known[p.id] === 'usurper' ? ' (the Usurper)' : ' (Cabal)'); }).join(', ');
            know = '<span class="rc-blurb">Your allies: ' + (know || 'none') + '</span>';
        } else if (v.role === 'usurper') {
            know = others.length ? '<span class="rc-blurb">Your Cabal: ' + others.map(function (p) { return esc(p.name); }).join(', ') + '</span>'
                : '<span class="rc-blurb">You don’t know who your Cabal allies are, but they know you.</span>';
        }
        return '<button class="rolecard ' + r.team + '" data-ui="showRole"><span class="rc-label">you are ' + (v.role === 'usurper' ? '' : 'a') + '</span>' +
            '<span class="rc-name">' + r.name + '</span><span class="rc-blurb">' + r.blurb + '</span>' + know +
            '<span class="rc-hint">tap to hide</span></button>';
    }

    function board(v) {
        var h = '<div class="card board">';
        h += '<div class="track loyal">';
        for (var i = 0; i < 5; i++) h += '<span class="slot' + (i < v.enacted.loyal ? ' on' : '') + '">' + (i === 4 ? '★' : '') + '</span>';
        h += '</div><div class="track cabal">';
        for (i = 0; i < 6; i++) {
            var p = v.powers[i];
            h += '<span class="slot' + (i < v.enacted.cabal ? ' on' : '') + '" title="' + (p ? POWER_NAMES[p] : '') + '">' +
                (i === 5 ? '★' : p ? { investigate: '🔍', peek: '👁', special: '⚑', execute: '✕' }[p] : '') + '</span>';
        }
        h += '</div><div class="small muted boardinfo"><span>unrest ' + [0, 1, 2].map(function (i) { return i < v.tracker ? '●' : '○'; }).join('') +
            '</span><span>deck ' + v.deckCount + ' · discard ' + v.discardCount + '</span></div>';
        if (v.enacted.cabal >= 3 && v.phase !== 'over') h += '<div class="small warn">3+ Cabal decrees: electing the Usurper as Deputy wins it for the Cabal.</div>';
        if (v.enacted.cabal >= 5 && v.phase !== 'over') h += '<div class="small muted">Veto power is unlocked.</div>';
        return h + '</div>';
    }

    function playerTags(v, pid, ctx) {
        var p = v.players.filter(function (x) { return x.id === pid; })[0], t = '';
        if (pid === v.president) t += tag('Speaker', 'office');
        if (pid === v.chancellor && v.phase !== 'nominate') t += tag('Deputy', 'office');
        if (v.lastElected && v.phase === 'nominate' && v.eligible.indexOf(pid) < 0 && pid !== v.president && p.alive) t += tag('term-limited');
        var r = v.phase === 'over' ? v.known[pid] : ctx.ui.showRole ? v.known[pid] : null;
        if (r) t += tag(ROLES[r].name, r);
        if (!p.alive) t += tag('executed', 'dead');
        return t;
    }

    function decreeButtons(cards, actType) {
        return '<div class="decrees">' + cards.map(function (c, i) {
            return '<button class="decree ' + c + '" ' + (actType ? act({ type: actType, index: i }) : 'disabled') + '>' +
                (c === 'loyal' ? 'Loyalist' : 'Cabal') + '</button>';
        }).join('') + '</div>';
    }

    function renderPhase(v, ctx) {
        var me = ctx.me, pres = esc(nm(v, v.president)), dep = esc(nm(v, v.chancellor)), h = '';
        switch (v.phase) {
            case 'reveal':
                return '';
            case 'nominate':
                if (me !== v.president) return '<p>Waiting for Speaker <b>' + pres + '</b> to nominate a Deputy…</p>';
                return '<p>You are the <b>Speaker</b>. Nominate a Deputy.</p>' + SDG.playerList({
                    players: v.players.filter(function (p) { return v.eligible.indexOf(p.id) >= 0; }),
                    selectable: function () { return true; },
                    action: function (pid) { return { type: 'nominate', target: pid }; },
                    tags: function (pid) { return playerTags(v, pid, ctx); }
                });
            case 'vote':
                h = '<p>Speaker <b>' + pres + '</b> nominated <b>' + dep + '</b> as Deputy.</p>';
                if (!v.alive) h += '<p class="muted">You were executed and can’t vote.</p>';
                else if (v.myVote === null) h += '<div class="row2"><button class="btn aye" ' + act({ type: 'vote', aye: true }) + '>Aye</button>' +
                    '<button class="btn nay" ' + act({ type: 'vote', aye: false }) + '>Nay</button></div>';
                else h += '<p class="muted">You voted <b>' + (v.myVote ? 'Aye' : 'Nay') + '</b>.</p>';
                var living = v.players.filter(function (p) { return p.alive; }).length;
                return h + '<p class="muted small">' + v.voted.length + '/' + living + ' voted. Votes are revealed once everyone has voted.</p>';
            case 'legislate-p':
                if (me !== v.president) return '<p>Speaker <b>' + pres + '</b> is choosing a decree to discard…</p>';
                return '<p>You drew 3 decrees. <b>Discard one</b>; the other two go to Deputy ' + dep + '.</p>' + decreeButtons(v.hand, 'discard');
            case 'legislate-c':
                if (me !== v.chancellor) return '<p>Deputy <b>' + dep + '</b> is choosing a decree to enact…</p>';
                h = '<p>Speaker ' + pres + ' passed you 2 decrees. <b>Enact one</b>.</p>' + decreeButtons(v.hand, 'enact');
                if (v.enacted.cabal >= 5 && !v.vetoRefused) h += '<button class="btn subtle" ' + act({ type: 'veto' }) + '>propose veto</button>';
                if (v.vetoRefused) h += '<p class="muted small">The Speaker refused the veto.</p>';
                return h;
            case 'veto':
                if (me === v.president) return '<p>Deputy ' + dep + ' wants to veto these decrees:</p>' + decreeButtons(v.hand) +
                    '<div class="row2"><button class="btn aye" ' + act({ type: 'vetoAnswer', accept: true }) + '>accept veto</button>' +
                    '<button class="btn nay" ' + act({ type: 'vetoAnswer', accept: false }) + '>refuse</button></div>' +
                    '<p class="muted small">Accepting discards both and advances unrest.</p>';
                return '<p>Deputy <b>' + dep + '</b> proposed a veto. Waiting for Speaker <b>' + pres + '</b>…</p>';
            case 'power':
                if (me !== v.president) return '<p>Speaker <b>' + pres + '</b> is using a power: <b>' + POWER_NAMES[v.power] + '</b>.</p>';
                if (v.power === 'peek') {
                    var last = v.notes[v.notes.length - 1];
                    return '<p>Power: <b>peek</b>. ' + esc(last) + '</p><p class="muted small">L = Loyalist, C = Cabal. This stays in your notes.</p>' +
                        '<button class="btn primary wide" ' + act({ type: 'power' }) + '>done</button>';
                }
                var prompts = {
                    investigate: 'Choose a player to learn their party (the Usurper shows as Cabal).',
                    special: 'Choose the next Speaker.',
                    execute: 'Choose a player to execute. If they are the Usurper, the Loyalists win.'
                };
                return '<p>Power: <b>' + POWER_NAMES[v.power] + '</b>. ' + prompts[v.power] + '</p>' + SDG.playerList({
                    players: v.players.filter(function (p) { return p.alive && p.id !== me; }),
                    selectable: function (pid) { return !(v.power === 'investigate' && v.investigated[pid]); },
                    action: function (pid) { return { type: 'power', target: pid }; },
                    tags: function (pid) { return playerTags(v, pid, ctx) + (v.power === 'investigate' && v.investigated[pid] ? tag('already investigated') : ''); }
                });
        }
        return h;
    }

    function lastVoteCard(v) {
        var lv = v.lastVote;
        if (!lv || v.phase === 'over') return '';
        var rows = v.players.filter(function (p) { return p.id in lv.votes; }).map(function (p) {
            return '<span class="vchip ' + (lv.votes[p.id] ? 'aye' : 'nay') + '">' + esc(p.name) + '</span>';
        }).join('');
        return '<details class="card" data-key="lastvote"' + '><summary>last vote: ' + esc(nm(v, lv.president)) + ' + ' + esc(nm(v, lv.chancellor)) +
            ' ' + (lv.passed ? 'passed' : 'failed') + '</summary><div class="vchips">' + rows + '</div></details>';
    }

    function render(v, ctx) {
        var titles = { reveal: 'Roles', nominate: 'Nomination', vote: 'Election', 'legislate-p': 'Legislation', 'legislate-c': 'Legislation', veto: 'Veto', power: 'Executive power', over: 'Game over' };
        var h = '<div class="phase"><h2>' + titles[v.phase] + '</h2></div>';
        if (v.phase === 'over') {
            h += '<div class="card banner ' + v.winner + '"><b>' + esc(v.winReason) + '</b></div>' + board(v);
            h += SDG.playerList({ players: v.players, tags: function (pid) { return playerTags(v, pid, ctx); } });
            return h + SDG.logList(v.log, 40);
        }
        h += roleCard(v, ctx);
        if (v.phase === 'reveal') {
            h += '<p class="muted">Check your role privately. The game starts once everyone is ready.</p>';
            h += '<button class="btn primary wide" ' + act({ type: 'ready' }) + '>I’ve seen my role</button>';
            if (ctx.isHost) h += '<button class="btn subtle" ' + act({ type: 'force' }) + ' data-confirm="Start without waiting for everyone?">start now</button>';
            return h;
        }
        h += '<div class="card">' + renderPhase(v, ctx) + '</div>';
        h += board(v);
        h += SDG.playerList({ players: v.players, tags: function (pid) { return playerTags(v, pid, ctx); } });
        h += lastVoteCard(v);
        if (v.notes.length) h += '<details class="card" data-key="notes"><summary>your secret notes</summary>' +
            v.notes.map(function (n) { return '<div class="small">' + esc(n) + '</div>'; }).join('') + '</details>';
        return h + SDG.logList(v.log);
    }

    SDG.register({
        id: 'usurper',
        name: 'Usurper',
        tagline: 'Loyalists pass decrees while a hidden Cabal schemes to put the Usurper in power.',
        minPlayers: 5,
        maxPlayers: 10,
        seated: true,
        options: [],
        rules: '<p>Players are secretly <b>Loyalists</b> or members of the <b>Cabal</b>; one Cabal member is <b>the Usurper</b>. The Cabal know each other. The Usurper only knows them in 5–6 player games.</p>' +
            '<p><b>Each round</b> the Speaker role passes to the next player, who nominates a Deputy. Everyone votes Aye or Nay. If the vote fails, unrest rises; at 3 unrest the top decree is enacted automatically.</p>' +
            '<p>If the vote passes, the Speaker draws 3 decrees and discards one. The Deputy enacts one of the remaining two. The deck has 6 Loyalist and 11 Cabal decrees, so lying about what you drew is part of the game.</p>' +
            '<p>Some Cabal decrees give the Speaker a power: investigate a player, peek at the deck, call a special election, or execute someone. After 5 Cabal decrees, the Deputy can propose a veto.</p>' +
            '<p><b>Loyalists win</b> with 5 Loyalist decrees or by executing the Usurper. <b>The Cabal wins</b> with 6 Cabal decrees, or by electing the Usurper as Deputy after 3 Cabal decrees.</p>',
        setup: setup,
        act: handle,
        view: view,
        render: render,
        roles: ROLES
    });
})(typeof window !== 'undefined' ? window : globalThis);
