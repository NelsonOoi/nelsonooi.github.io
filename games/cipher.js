// Cipher — a team word-guessing game (Codenames-style).
(function (root) {
    var SDG = root.SDG || require('./core.js');
    var esc = SDG.esc, act = SDG.act, tag = SDG.tag;

    var WORDS = ('acid agent alien alley amber anchor angel apple arch arrow atlas attic avalanche axe ' +
        'badge bag ball band bank bark barrel bat battery beach beam bean bear bed bee bell belt bench berry bike bill ' +
        'bird blade blanket block board boat bolt bomb bone book boot bottle bow box brain branch brick bridge brush ' +
        'bubble bucket bug bulb bull button cabin cable cactus cake camera camp canal candle cannon canvas cap capital ' +
        'card carpet castle cat cave cell chain chair chalk charge check cheese chest chip circle circus clay cliff clock ' +
        'cloud club coach coal coast coat code coin comet compass cone copper coral cotton court crane crash crown crystal ' +
        'cup current curtain dance dart deck desert diamond dice dinosaur disc doctor dog doll dragon drill drum duck dust ' +
        'eagle earth echo egg engine eye fair fan feather fence field file film fire fish flag flame flash flute fog ' +
        'forest fork fossil fountain fox frame frog frost galaxy game garden gas ghost giant glass glove glue gold grape ' +
        'grass gravity guitar hammer hand harbor hat hawk heart helmet hero honey hook horn horse hospital ice ink iron ' +
        'island ivory jacket jam jet jewel joker judge jungle key king kite knife knight ladder lake lamp laser lead leaf ' +
        'lemon letter light lightning line lion lock log loop magnet mail mammoth map marble mask match maze medal ' +
        'mercury metal meteor microscope milk mine mint mirror missile model mole moon moss motor mountain mouse mud ' +
        'nail needle nest net night note novel nurse nut oak ocean octopus oil olive opera orange orbit organ owl paint ' +
        'palm pan paper parachute park pass pearl pen pencil penguin pepper piano pilot pin pipe pirate pit pitch planet ' +
        'plant plate plot pocket point poison pole pool port post pot powder press prince prism pump pupil puzzle pyramid ' +
        'queen quilt rabbit racket radar rail rain ram ranch ray record reef ring river robot rock rocket roll root rope ' +
        'rose ruler saddle sail salt sand satellite saw scale school scope scorpion screen screw seal season shadow shark ' +
        'shell ship shoe shop shot signal silk silver sink skate skull sky slip slug smoke snake snow soap sock soldier ' +
        'sound space spell spider spike spine spirit spoon spring spy square squid stable staff stamp star steam steel ' +
        'stick storm straw stream string sub sugar suit sun swamp swan switch sword table tail tank tape telescope temple ' +
        'tent thread throne thunder ticket tide tiger timber tooth torch tornado tower track train trap tree triangle ' +
        'trumpet trunk tube tunnel turkey turtle umbrella unicorn vacuum valley vampire van vault violin volcano wagon ' +
        'wall wand watch water wave web well whale wheel whip whistle wind window wing wire witch wolf worm yard yarn').split(' ');

    var TEAMS = ['red', 'blue'];
    var other = function (t) { return t === 'red' ? 'blue' : 'red'; };

    function name(s, pid) {
        for (var i = 0; i < s.players.length; i++) if (s.players[i].id === pid) return s.players[i].name;
        return '?';
    }
    function members(s, team) { return s.players.filter(function (p) { return s.team[p.id] === team; }); }
    function left(s, team) {
        return s.key.filter(function (k, i) { return k === team && !s.revealed[i]; }).length;
    }

    function shuffleTeams(s) {
        SDG.shuffle(s.players).forEach(function (p, i) { s.team[p.id] = TEAMS[i % 2]; });
        s.master = { red: null, blue: null };
    }

    function setup(players, opts) {
        var s = {
            opts: opts, phase: 'teams',
            players: players.map(function (p) { return { id: p.id, name: p.name }; }),
            team: {}, master: { red: null, blue: null },
            words: [], key: [], revealed: [], turn: null, clue: null, guessesLeft: 0,
            history: [], winner: null, winReason: null, log: []
        };
        shuffleTeams(s);
        return s;
    }

    function deal(s) {
        var start = TEAMS[SDG.randInt(2)];
        var key = ['assassin'], i;
        for (i = 0; i < 9; i++) key.push(start);
        for (i = 0; i < 8; i++) key.push(other(start));
        while (key.length < 25) key.push('neutral');
        s.words = SDG.shuffle(WORDS).slice(0, 25);
        s.key = SDG.shuffle(key);
        s.revealed = s.words.map(function () { return false; });
        s.turn = start;
        s.phase = 'clue';
        s.clue = null;
        s.history = [];
        s.log.push(start + ' goes first.');
    }

    function endTurn(s) {
        s.turn = other(s.turn);
        s.phase = 'clue';
        s.clue = null;
        s.guessesLeft = 0;
    }

    function win(s, team, reason) {
        s.winner = team;
        s.winReason = reason;
        s.phase = 'over';
        s.log.push(reason);
    }

    function reveal(s, pid, i) {
        s.revealed[i] = true;
        var k = s.key[i], w = s.words[i];
        s.history[s.history.length - 1].guesses.push(i);
        s.log.push(name(s, pid) + ' guessed ' + w + ' (' + k + ').');
        if (k === 'assassin') return win(s, other(s.turn), s.turn + ' hit the assassin. ' + other(s.turn) + ' wins.');
        if (!left(s, 'red')) return win(s, 'red', 'Red found all their agents.');
        if (!left(s, 'blue')) return win(s, 'blue', 'Blue found all their agents.');
        if (k !== s.turn) return endTurn(s);
        s.guessesLeft--;
        if (s.guessesLeft <= 0) endTurn(s);
    }

    function handle(s, pid, a, ctx) {
        var myTeam = s.team[pid], amMaster = s.master[myTeam] === pid;
        switch (a.type) {
            case 'join':
                if (s.phase !== 'teams' || TEAMS.indexOf(a.team) < 0) return;
                if (amMaster) s.master[myTeam] = null;
                s.team[pid] = a.team;
                return;
            case 'master':
                if (s.phase !== 'teams') return;
                s.master[myTeam] = amMaster ? null : pid;
                return;
            case 'shuffle':
                if (!ctx.isHost) SDG.fail('Only the host can do that.');
                if (s.phase === 'teams') shuffleTeams(s);
                return;
            case 'begin':
                if (!ctx.isHost) SDG.fail('Only the host can do that.');
                if (s.phase !== 'teams') return;
                TEAMS.forEach(function (t) {
                    if (members(s, t).length < 2) SDG.fail('Each team needs at least 2 players.');
                    if (!s.master[t]) SDG.fail('Each team needs a spymaster.');
                });
                return deal(s);
            case 'clue': {
                if (s.phase !== 'clue' || pid !== s.master[s.turn]) return;
                var word = String(a.clue || '').trim().toLowerCase().slice(0, 30);
                if (!word || /\s/.test(word)) SDG.fail('Your clue must be one word.');
                if (s.words.some(function (w, i) { return !s.revealed[i] && (w === word || w + 's' === word || word + 's' === w); }))
                    SDG.fail('Your clue can’t be a word on the board.');
                var count = a.count === 'inf' ? 'inf' : parseInt(a.count, 10);
                if (count !== 'inf' && !(count >= 0 && count <= 9)) SDG.fail('Pick a number.');
                s.clue = { team: s.turn, word: word, count: count };
                s.guessesLeft = count === 'inf' || count === 0 ? 25 : count + 1;
                s.history.push({ team: s.turn, word: word, count: count, guesses: [] });
                s.phase = 'guess';
                s.log.push(name(s, pid) + ' (' + s.turn + '): ' + word + ' ' + (count === 'inf' ? '∞' : count) + '.');
                return;
            }
            case 'guess':
                if (s.phase !== 'guess' || myTeam !== s.turn || amMaster) return;
                if (!(a.i >= 0 && a.i < 25) || s.revealed[a.i]) SDG.fail('Pick an unrevealed word.');
                return reveal(s, pid, a.i);
            case 'pass':
                if (s.phase !== 'guess') return;
                if (!ctx.isHost && (myTeam !== s.turn || amMaster)) return;
                if (!s.history[s.history.length - 1].guesses.length && !ctx.isHost) SDG.fail('Make at least one guess first.');
                s.log.push(s.turn + ' ended their turn.');
                return endTurn(s);
            case 'again':
                if (!ctx.isHost) SDG.fail('Only the host can do that.');
                if (s.phase !== 'over') return;
                s.winner = s.winReason = null;
                s.phase = 'teams';
                return;
        }
    }

    function view(s, pid) {
        var myTeam = s.team[pid];
        var seeKey = s.phase === 'over' || (s.phase !== 'teams' && s.master[myTeam] === pid);
        return {
            phase: s.phase,
            players: s.players, team: s.team, master: s.master,
            words: s.words, revealed: s.revealed,
            key: s.key.map(function (k, i) { return seeKey || s.revealed[i] ? k : null; }),
            seeKey: seeKey, turn: s.turn, clue: s.clue, guessesLeft: s.guessesLeft,
            left: s.words.length ? { red: left(s, 'red'), blue: left(s, 'blue') } : null,
            history: s.history, winner: s.winner, winReason: s.winReason, log: s.log
        };
    }

    // ---------- rendering ----------

    function teamColumn(v, t, ctx) {
        var list = v.players.filter(function (p) { return v.team[p.id] === t; });
        return '<div class="card cteam ' + t + '"><div class="small">' + t + ' team</div>' +
            list.map(function (p) {
                return '<div class="cname">' + esc(p.name) + (p.id === ctx.me ? ' <span class="muted">(you)</span>' : '') +
                    (v.master[t] === p.id ? ' ' + tag('spymaster', t) : '') + '</div>';
            }).join('') + '</div>';
    }

    function renderTeams(v, ctx) {
        var mine = v.team[ctx.me], h = '<div class="cteams">' + teamColumn(v, 'red', ctx) + teamColumn(v, 'blue', ctx) + '</div>';
        h += '<div class="row2"><button class="btn" ' + act({ type: 'join', team: other(mine) }) + '>switch to ' + other(mine) + '</button>' +
            '<button class="btn" ' + act({ type: 'master' }) + '>' + (v.master[mine] === ctx.me ? 'step down' : 'be ' + mine + ' spymaster') + '</button></div>';
        h += '<p class="muted small">Each team needs a spymaster and at least one guesser. Spymasters should sit across from their team.</p>';
        if (ctx.isHost) {
            var ok = TEAMS.every(function (t) {
                return v.master[t] && v.players.filter(function (p) { return v.team[p.id] === t; }).length >= 2;
            });
            h += '<button class="btn primary wide" ' + act({ type: 'begin' }) + (ok ? '' : ' disabled') + '>deal the board</button>' +
                '<button class="btn subtle" ' + act({ type: 'shuffle' }) + '>shuffle teams</button>';
        } else {
            h += '<p class="muted center">Waiting for the host to deal…</p>';
        }
        return h;
    }

    function grid(v, ctx, canGuess) {
        return '<div class="cgrid">' + v.words.map(function (w, i) {
            var k = v.key[i], cls = 'wcard';
            if (v.revealed[i]) cls += ' up ' + k;
            else if (k) cls += ' key ' + k;
            if (canGuess && !v.revealed[i]) cls += ' pick';
            if (canGuess && ctx.ui.cipherPick === i) cls += ' sel';
            var attr = canGuess && !v.revealed[i] ? SDG.uiset({ cipherPick: ctx.ui.cipherPick === i ? null : i }) : 'disabled';
            return '<button class="' + cls + '" ' + attr + '>' + esc(w) + '</button>';
        }).join('') + '</div>';
    }

    function render(v, ctx) {
        if (v.phase === 'teams') return '<div class="phase"><h2>Teams</h2></div>' + renderTeams(v, ctx);

        var mine = v.team[ctx.me], amMaster = v.master[mine] === ctx.me;
        var myTurn = v.turn === mine;
        var canGuess = v.phase === 'guess' && myTurn && !amMaster;
        var h = '<div class="phase"><h2>' + (v.phase === 'over' ? 'Game over' : '<span class="cturn ' + v.turn + '">' + v.turn + '</span>’s turn') + '</h2></div>';
        h += '<div class="cscore"><span class="red">red ' + v.left.red + ' left</span><span class="muted small">you: ' + mine + (amMaster ? ' spymaster' : '') + '</span><span class="blue">blue ' + v.left.blue + ' left</span></div>';

        if (v.phase === 'over') {
            h += '<div class="card banner ' + (v.winner === 'red' ? 'cabal' : 'loyal') + '"><b>' + esc(v.winReason) + '</b></div>';
        } else if (v.phase === 'clue') {
            if (amMaster && myTurn) {
                var count = ctx.ui.cipherCount == null ? 1 : ctx.ui.cipherCount;
                h += '<div class="card"><label class="lbl" for="clue">your clue (one word)</label>' +
                    '<input id="clue" maxlength="30" autocomplete="off" autocapitalize="none" placeholder="clue">' +
                    '<div class="lbl">how many words</div><div class="seg nums">' +
                    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 'inf'].map(function (n) {
                        return '<button class="' + (n === count ? 'on' : '') + '" ' + SDG.uiset({ cipherCount: n }) + '>' + (n === 'inf' ? '∞' : n) + '</button>';
                    }).join('') + '</div>' +
                    '<button class="btn primary wide" ' + act({ type: 'clue', count: count }) + ' data-fields="clue">give clue</button></div>';
            } else {
                h += '<p class="muted">Waiting for the ' + v.turn + ' spymaster’s clue…</p>';
            }
        } else if (v.phase === 'guess') {
            h += '<div class="card banner ' + (v.turn === 'red' ? 'cabal' : 'loyal') + '">clue: <b>' + esc(v.clue.word) + '</b> ' +
                (v.clue.count === 'inf' ? '∞' : v.clue.count) + ' <span class="muted small">· ' +
                (v.guessesLeft >= 25 ? 'unlimited guesses' : v.guessesLeft + ' guess' + (v.guessesLeft > 1 ? 'es' : '') + ' left') + '</span></div>';
            if (!canGuess) h += '<p class="muted small">' + (myTurn ? 'Your team is guessing. Keep a straight face.' : v.turn + ' is guessing.') + '</p>';
        }

        h += grid(v, ctx, canGuess);
        if (v.seeKey && v.phase !== 'over') h += '<p class="small muted center">only you see the outlines: <span class="red">red</span> · <span class="blue">blue</span> · grey neutral · white assassin</p>';

        if (canGuess) {
            var p = ctx.ui.cipherPick;
            var picked = p != null && !v.revealed[p];
            h += '<button class="btn primary wide" ' + (picked ? act({ type: 'guess', i: p }) : 'disabled') + '>' +
                (picked ? 'guess “' + esc(v.words[p]) + '”' : 'tap a word, then confirm') + '</button>' +
                '<button class="btn subtle" ' + act({ type: 'pass' }) + '>end our turn</button>';
        } else if (v.phase === 'guess' && ctx.isHost) {
            h += '<button class="btn subtle" ' + act({ type: 'pass' }) + ' data-confirm="End ' + v.turn + '’s turn?">end ' + v.turn + '’s turn</button>';
        }
        if (v.phase === 'over' && ctx.isHost) h += '<button class="btn primary wide" ' + act({ type: 'again' }) + '>new board, same room</button>';

        h += '<div class="cteams">' + teamColumn(v, 'red', ctx) + teamColumn(v, 'blue', ctx) + '</div>';
        if (v.history.length) {
            h += '<details class="card" data-key="clues"><summary>clues</summary>' + v.history.slice().reverse().map(function (c) {
                return '<div class="small"><span class="' + c.team + '">' + esc(c.word) + ' ' + (c.count === 'inf' ? '∞' : c.count) + '</span> → ' +
                    (c.guesses.map(function (i) { return esc(v.words[i]); }).join(', ') || '—') + '</div>';
            }).join('') + '</details>';
        }
        return h;
    }

    SDG.register({
        id: 'cipher',
        name: 'Cipher',
        tagline: 'Two teams race to find their agents on a 5×5 word grid, guided by one-word clues.',
        minPlayers: 4,
        maxPlayers: 20,
        options: [],
        rules: '<p>Split into <b>red</b> and <b>blue</b> teams, each with one <b>spymaster</b>. Everyone sees the same 25 words; only the spymasters see which words belong to which team.</p>' +
            '<p>On your turn, your spymaster gives a one-word clue and a number: how many words it points to. Your team then taps words to guess, up to the number plus one.</p>' +
            '<p>Your word: keep going. A neutral word or the other team’s word ends your turn. The <b>assassin</b> loses the game instantly.</p>' +
            '<p>The first team to find all their words wins. The team that starts has 9 words; the other has 8.</p>',
        setup: setup,
        act: handle,
        view: view,
        render: render
    });
})(typeof window !== 'undefined' ? window : globalThis);
