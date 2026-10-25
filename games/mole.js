// Mole — everyone shares a secret location except the Mole (Spyfall-style).
(function (root) {
    var SDG = root.SDG || require('./core.js');
    var esc = SDG.esc, act = SDG.act, tag = SDG.tag;

    var LOCATIONS = [
        ['Airport lounge', 'pilot', 'flight attendant', 'jet-lagged traveler', 'bartender', 'business traveler', 'security officer'],
        ['Aquarium', 'diver', 'tour guide', 'marine biologist', 'kid on a field trip', 'gift shop clerk', 'janitor'],
        ['Art museum', 'curator', 'security guard', 'art student', 'tourist', 'forger', 'docent'],
        ['Bakery', 'baker', 'cashier', 'regular customer', 'delivery driver', 'food critic', 'apprentice'],
        ['Campsite', 'park ranger', 'scout leader', 'lost hiker', 'camp cook', 'photographer', 'kid roasting marshmallows'],
        ['Cruise ship', 'captain', 'cruise director', 'retiree', 'honeymooner', 'stowaway', 'chef'],
        ['Data center', 'sysadmin', 'security guard', 'electrician', 'auditor', 'intern', 'cooling engineer'],
        ['Film set', 'director', 'lead actor', 'stunt double', 'makeup artist', 'boom operator', 'extra'],
        ['Fire station', 'fire chief', 'firefighter', 'dispatcher', 'dalmatian trainer', 'cook', 'school visitor'],
        ['Haunted house', 'ghost hunter', 'paranormal skeptic', 'caretaker', 'actor in costume', 'scared teen', 'medium'],
        ['Hospital', 'surgeon', 'nurse', 'patient', 'paramedic', 'visitor', 'hospital administrator'],
        ['Ice rink', 'figure skater', 'hockey player', 'zamboni driver', 'skate renter', 'coach', 'first-timer'],
        ['Karaoke bar', 'host', 'bartender', 'birthday guest', 'shy coworker', 'regular', 'sound tech'],
        ['Library', 'librarian', 'student cramming', 'retiree', 'author on tour', 'toddler at story time', 'IT volunteer'],
        ['Lighthouse', 'keeper', 'shipwreck survivor', 'tourist', 'historian', 'painter', 'coast guard'],
        ['Mountain cabin', 'host', 'skier', 'snowed-in guest', 'firewood chopper', 'hunter', 'novelist'],
        ['Movie theater', 'projectionist', 'ticket taker', 'snack bar clerk', 'film critic', 'couple on a date', 'person on their phone'],
        ['Night market', 'noodle vendor', 'fortune teller', 'pickpocket', 'tourist', 'street musician', 'night owl'],
        ['Observatory', 'astronomer', 'grad student', 'tour guide', 'amateur stargazer', 'janitor', 'telescope technician'],
        ['Office', 'manager', 'intern', 'accountant', 'IT support', 'receptionist', 'new hire'],
        ['Pirate ship', 'captain', 'first mate', 'cook', 'prisoner', 'lookout', 'parrot keeper'],
        ['Ramen shop', 'chef', 'server', 'food blogger', 'regular', 'dishwasher', 'tourist'],
        ['Recording studio', 'producer', 'singer', 'drummer', 'sound engineer', 'manager', 'session musician'],
        ['Research lab', 'principal investigator', 'postdoc', 'grad student', 'lab manager', 'safety inspector', 'undergrad'],
        ['High school', 'principal', 'teacher', 'student', 'janitor', 'coach', 'substitute teacher'],
        ['Space station', 'commander', 'engineer', 'scientist', 'space tourist', 'doctor', 'mission control on video'],
        ['Submarine', 'captain', 'sonar operator', 'cook', 'engineer', 'navigator', 'new recruit'],
        ['Subway car', 'conductor', 'commuter', 'street performer', 'tourist with a map', 'sleeping passenger', 'transit cop'],
        ['Supermarket', 'cashier', 'stocker', 'butcher', 'shopper', 'store manager', 'free sample person'],
        ['Train station', 'conductor', 'ticket agent', 'traveler', 'porter', 'pigeon feeder', 'busker'],
        ['Wedding', 'bride', 'groom', 'best man', 'officiant', 'photographer', 'uninvited guest'],
        ['Zoo', 'zookeeper', 'veterinarian', 'visitor', 'photographer', 'ice cream vendor', 'escaped monkey'],
        ['Music festival', 'headliner', 'roadie', 'security', 'food truck owner', 'raver', 'lost friend'],
        ['Courtroom', 'judge', 'defendant', 'lawyer', 'juror', 'witness', 'court reporter'],
        ['Gym', 'personal trainer', 'bodybuilder', 'yoga instructor', 'front desk clerk', 'beginner', 'cleaner'],
        ['Hotel', 'concierge', 'bellhop', 'housekeeper', 'guest', 'manager', 'room service waiter']
    ];

    function name(s, pid) {
        for (var i = 0; i < s.players.length; i++) if (s.players[i].id === pid) return s.players[i].name;
        return '?';
    }

    function setup(players, opts) {
        var s = {
            opts: opts, phase: 'reveal', round: 0,
            players: players.map(function (p) { return { id: p.id, name: p.name }; }),
            scores: {}, log: []
        };
        players.forEach(function (p) { s.scores[p.id] = 0; });
        deal(s);
        return s;
    }

    function deal(s) {
        s.round++;
        s.phase = 'reveal';
        s.ready = {};
        s.location = SDG.randInt(LOCATIONS.length);
        s.mole = s.players[SDG.randInt(s.players.length)].id;
        s.first = s.players[SDG.randInt(s.players.length)].id;
        s.roles = {};
        var roles = SDG.shuffle(LOCATIONS[s.location].slice(1));
        s.players.forEach(function (p, i) { if (p.id !== s.mole) s.roles[p.id] = roles[i % roles.length]; });
        s.endsAt = null;
        s.remaining = null;
        s.accusation = null;
        s.usedAccusation = {};
        s.finalVotes = {};
        s.winner = null;
        s.reason = null;
        s.guess = null;
    }

    function startClock(s, ms) {
        s.phase = 'play';
        s.endsAt = SDG.now() + ms;
    }

    function finish(s, winner, reason) {
        s.winner = winner;
        s.reason = reason;
        s.phase = 'over';
        s.endsAt = null;
        s.log.push('Round ' + s.round + ': ' + reason);
        s.players.forEach(function (p) {
            if (winner === 'mole' && p.id === s.mole) s.scores[p.id] += s.guess === s.location ? 4 : 2;
            if (winner === 'crew' && p.id !== s.mole) s.scores[p.id] += 1;
        });
    }

    // The clock has no server process behind it: the first action after time runs out moves the game on.
    function checkClock(s) {
        if (s.phase === 'play' && SDG.now() >= s.endsAt - 1500) {
            s.phase = 'final';
            s.finalVotes = {};
        }
    }

    function resolveAccusation(s) {
        var acc = s.accusation, voters = s.players.filter(function (p) { return p.id !== acc.target; });
        var guilty = voters.every(function (p) { return acc.votes[p.id] === true; });
        s.accusation = null;
        if (!guilty) {
            s.log.push(name(s, acc.by) + ' accused ' + name(s, acc.target) + ', but the vote wasn’t unanimous.');
            return startClock(s, s.remaining);
        }
        if (acc.target === s.mole) finish(s, 'crew', 'The crew caught the Mole, ' + name(s, s.mole) + '.');
        else finish(s, 'mole', 'The crew convicted ' + name(s, acc.target) + ', who was innocent. The Mole was ' + name(s, s.mole) + '.');
    }

    function resolveFinal(s) {
        var tally = {};
        Object.keys(s.finalVotes).forEach(function (pid) { var t = s.finalVotes[pid]; tally[t] = (tally[t] || 0) + 1; });
        var top = 0, leaders = [];
        Object.keys(tally).forEach(function (t) {
            if (tally[t] > top) { top = tally[t]; leaders = [t]; }
            else if (tally[t] === top) leaders.push(t);
        });
        if (leaders.length === 1 && leaders[0] === s.mole) finish(s, 'crew', 'Time ran out and the crew picked the Mole, ' + name(s, s.mole) + '.');
        else finish(s, 'mole', 'Time ran out and the crew ' + (leaders.length === 1 ? 'picked ' + name(s, leaders[0]) : 'couldn’t agree') + '. The Mole was ' + name(s, s.mole) + '.');
    }

    function handle(s, pid, a, ctx) {
        checkClock(s);
        switch (a.type) {
            case 'ready':
                if (s.phase !== 'reveal') return;
                s.ready[pid] = true;
                if (s.players.every(function (p) { return s.ready[p.id]; })) startClock(s, parseInt(s.opts.minutes, 10) * 60000);
                return;
            case 'accuse':
                if (s.phase !== 'play') return;
                if (s.usedAccusation[pid]) SDG.fail('You’ve already used your accusation this round.');
                if (a.target === pid || !s.players.some(function (p) { return p.id === a.target; })) SDG.fail('Pick someone else.');
                s.usedAccusation[pid] = true;
                s.remaining = Math.max(10000, s.endsAt - SDG.now());
                s.endsAt = null;
                s.phase = 'accuse';
                s.accusation = { by: pid, target: a.target, votes: {} };
                s.accusation.votes[pid] = true;
                s.log.push(name(s, pid) + ' accused ' + name(s, a.target) + '.');
                return;
            case 'verdict':
                if (s.phase !== 'accuse' || pid === s.accusation.target) return;
                s.accusation.votes[pid] = !!a.guilty;
                if (s.players.every(function (p) { return p.id === s.accusation.target || s.accusation.votes[p.id] != null; })) resolveAccusation(s);
                return;
            case 'guessLocation':
                if (pid !== s.mole || (s.phase !== 'play' && s.phase !== 'final')) return;
                if (!(a.i >= 0 && a.i < LOCATIONS.length)) return;
                s.guess = a.i;
                if (a.i === s.location) finish(s, 'mole', name(s, pid) + ' was the Mole and guessed the location: ' + LOCATIONS[a.i][0] + '.');
                else finish(s, 'crew', name(s, pid) + ' was the Mole and guessed ' + LOCATIONS[a.i][0] + '. It was ' + LOCATIONS[s.location][0] + '.');
                return;
            case 'finalVote':
                if (s.phase !== 'final') SDG.fail('There’s still time on the clock.');
                if (a.target === pid || !s.players.some(function (p) { return p.id === a.target; })) SDG.fail('Pick someone else.');
                s.finalVotes[pid] = a.target;
                if (s.players.every(function (p) { return s.finalVotes[p.id]; })) resolveFinal(s);
                return;
            case 'force':
                if (!ctx.isHost) SDG.fail('Only the host can do that.');
                if (s.phase === 'reveal') startClock(s, parseInt(s.opts.minutes, 10) * 60000);
                else if (s.phase === 'play') { s.phase = 'final'; s.finalVotes = {}; s.endsAt = null; }
                else if (s.phase === 'accuse') resolveAccusation(s);
                else if (s.phase === 'final') resolveFinal(s);
                return;
            case 'again':
                if (!ctx.isHost) SDG.fail('Only the host can do that.');
                if (s.phase === 'over') deal(s);
                return;
        }
    }

    function view(s, pid) {
        var over = s.phase === 'over', isMole = pid === s.mole;
        var v = {
            phase: s.phase, round: s.round, players: s.players, scores: s.scores,
            locations: LOCATIONS.map(function (l) { return l[0]; }),
            isMole: isMole,
            location: isMole && !over ? null : s.location,
            role: s.roles[pid] || null,
            first: s.first, endsAt: s.endsAt,
            readyCount: Object.keys(s.ready).length, ready: !!s.ready[pid],
            accusation: s.accusation, usedAccusation: !!s.usedAccusation[pid],
            finalVotes: s.finalVotes, myFinalVote: s.finalVotes[pid] || null,
            winner: s.winner, reason: s.reason, log: s.log
        };
        if (over) { v.mole = s.mole; v.roles = s.roles; v.guess = s.guess; }
        return v;
    }

    // ---------- rendering ----------

    function nm(v, pid) {
        for (var i = 0; i < v.players.length; i++) if (v.players[i].id === pid) return v.players[i].name;
        return '?';
    }

    function card(v, ctx) {
        if (!ctx.ui.showRole) return '<button class="rolecard hidden" data-ui="showRole">tap to reveal your card</button>';
        if (v.isMole) {
            return '<button class="rolecard cabal" data-ui="showRole"><span class="rc-label">you are the</span><span class="rc-name">Mole</span>' +
                '<span class="rc-blurb">You don’t know where you are. Blend in, and work out the location from everyone’s questions.</span><span class="rc-hint">tap to hide</span></button>';
        }
        return '<button class="rolecard loyal" data-ui="showRole"><span class="rc-label">location</span><span class="rc-name">' + esc(v.locations[v.location]) + '</span>' +
            '<span class="rc-blurb">You are the <b>' + esc(v.role) + '</b>. One player is the Mole and doesn’t know where you are.</span><span class="rc-hint">tap to hide</span></button>';
    }

    // The Mole picks from here; everyone else uses it to see what the Mole might be thinking.
    function locationList(v, ctx, canGuess) {
        var open = canGuess ? ' open' : '';
        return '<details class="card" data-key="locations"' + open + '><summary>' + (canGuess ? 'guess the location' : 'possible locations') + '</summary>' +
            (canGuess ? '<p class="small muted">Guessing ends the round: right and you win, wrong and you lose.</p>' : '') +
            '<div class="mlocs">' + v.locations.map(function (l, i) {
                return canGuess ? '<button class="mloc pick" ' + act({ type: 'guessLocation', i: i }) + ' data-confirm="Guess ' + esc(l) + '? This ends the round.">' + esc(l) + '</button>'
                    : '<span class="mloc">' + esc(l) + '</span>';
            }).join('') + '</div></details>';
    }

    function scoreboard(v) {
        return '<details class="card" data-key="scores"><summary>scores</summary>' + v.players.slice().sort(function (a, b) {
            return v.scores[b.id] - v.scores[a.id];
        }).map(function (p) { return '<div class="small">' + esc(p.name) + ': ' + v.scores[p.id] + '</div>'; }).join('') + '</details>';
    }

    function render(v, ctx) {
        var timeUp = v.phase === 'play' && SDG.now() >= v.endsAt;
        var phase = timeUp ? 'final' : v.phase;
        var titles = { reveal: 'Round ' + v.round, play: 'Round ' + v.round, accuse: 'Accusation', final: 'Time’s up', over: 'Round over' };
        var h = '<div class="phase"><h2>' + titles[phase] + (phase === 'play' ? ' <span class="muted">· ' + SDG.timer(v.endsAt) + '</span>' : '') + '</h2></div>';

        if (phase === 'over') {
            h += '<div class="card banner ' + (v.winner === 'mole' ? 'cabal' : 'loyal') + '"><b>' + esc(v.reason) + '</b></div>';
            h += '<div class="card"><div class="small muted">location</div><div class="gname">' + esc(v.locations[v.location]) + '</div>' +
                v.players.map(function (p) {
                    return '<div class="small">' + esc(p.name) + ': ' + (p.id === v.mole ? '<span class="cabal-text">Mole</span>' : esc(v.roles[p.id])) + '</div>';
                }).join('') + '</div>';
            h += ctx.isHost ? '<button class="btn primary wide" ' + act({ type: 'again' }) + '>next round</button>' : '<p class="muted center">Waiting for the host to start the next round…</p>';
            return h + scoreboard(v) + SDG.logList(v.log);
        }

        h += card(v, ctx);

        if (phase === 'reveal') {
            h += v.ready ? '<p class="muted">Waiting for everyone… (' + v.readyCount + '/' + v.players.length + ')</p>'
                : '<button class="btn primary wide" ' + act({ type: 'ready' }) + '>I’ve seen my card</button>';
            if (ctx.isHost) h += '<button class="btn subtle" ' + act({ type: 'force' }) + ' data-confirm="Start the clock without waiting?">start the clock now</button>';
            return h + locationList(v, ctx, false);
        }

        if (phase === 'play') {
            h += '<p><b>' + esc(nm(v, v.first)) + '</b> asks first. Take turns asking one person a question about the location; whoever answers asks next.</p>';
            h += '<div class="card"><div class="small muted">' + (v.usedAccusation ? 'You’ve used your accusation this round.' : 'Think you know who the Mole is? Accuse them: everyone else must agree unanimously.') + '</div>' +
                SDG.playerList({
                    players: v.players.filter(function (p) { return p.id !== ctx.me; }),
                    selectable: function () { return !v.usedAccusation; },
                    action: function (pid) { return { type: 'accuse', target: pid }; },
                    confirm: function (pid) { return 'Accuse ' + nm(v, pid) + '? Everyone else will vote.'; }
                }) + '</div>';
            if (ctx.isHost) h += '<button class="btn subtle" ' + act({ type: 'force' }) + ' data-confirm="Stop the clock and go to the final vote?">stop the clock</button>';
        } else if (phase === 'accuse') {
            var acc = v.accusation, mine = acc.votes[ctx.me];
            h += '<div class="card banner"><b>' + esc(nm(v, acc.by)) + '</b> accuses <b>' + esc(nm(v, acc.target)) + '</b> of being the Mole.</div>';
            if (ctx.me === acc.target) h += '<p>Make your case. Everyone else is voting.</p>';
            else if (mine == null) h += '<div class="row2"><button class="btn aye" ' + act({ type: 'verdict', guilty: true }) + '>guilty</button><button class="btn nay" ' + act({ type: 'verdict', guilty: false }) + '>not guilty</button></div>';
            else h += '<p class="muted">You voted ' + (mine ? 'guilty' : 'not guilty') + '.</p>';
            h += '<p class="muted small">' + Object.keys(acc.votes).length + '/' + (v.players.length - 1) + ' voted. It must be unanimous; the clock is paused.</p>';
            if (ctx.isHost) h += '<button class="btn subtle" ' + act({ type: 'force' }) + ' data-confirm="Close the vote now? Missing votes count as not guilty.">close the vote</button>';
        } else if (phase === 'final') {
            h += '<p>Time’s up. Vote for who you think the Mole is. The Mole is caught only if they get the most votes outright.</p>';
            h += SDG.playerList({
                players: v.players.filter(function (p) { return p.id !== ctx.me; }),
                selected: v.myFinalVote,
                selectable: function () { return true; },
                action: function (pid) { return { type: 'finalVote', target: pid }; }
            });
            h += '<p class="muted small">' + Object.keys(v.finalVotes).length + '/' + v.players.length + ' voted. You can change your vote until everyone has voted.</p>';
            if (ctx.isHost) h += '<button class="btn subtle" ' + act({ type: 'force' }) + ' data-confirm="Close voting now?">close voting</button>';
        }

        h += locationList(v, ctx, v.isMole && (phase === 'play' || phase === 'final'));
        return h + scoreboard(v) + SDG.logList(v.log);
    }

    SDG.register({
        id: 'mole',
        name: 'Mole',
        tagline: 'Everyone knows the secret location except the Mole. Ask questions to sniff them out.',
        minPlayers: 3,
        maxPlayers: 12,
        options: [
            { key: 'minutes', label: 'Round length', type: 'select', def: '8', choices: [['5', '5 min'], ['6', '6 min'], ['8', '8 min'], ['10', '10 min']] }
        ],
        rules: '<p>Everyone gets the same secret <b>location</b> and a role there, except one player: the <b>Mole</b>, who only sees a list of possible locations.</p>' +
            '<p>Take turns asking each other questions about the location (“how often do you come here?”). Answers should prove you know where you are without giving it away to the Mole.</p>' +
            '<p>Once per round you can <b>accuse</b> someone. If everyone else agrees, they’re revealed: catch the Mole and the crew wins; convict an innocent and the Mole wins.</p>' +
            '<p>The Mole can stop the game at any time to <b>guess the location</b>. Right, the Mole wins; wrong, the crew wins. If time runs out, everyone votes.</p>' +
            '<p>Scoring: each crew member gets 1 point for a crew win. The Mole gets 2, or 4 for guessing the location.</p>',
        setup: setup,
        act: handle,
        view: view,
        render: render
    });
})(typeof window !== 'undefined' ? window : globalThis);
