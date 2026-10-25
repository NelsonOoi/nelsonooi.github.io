// Hold'em — no-limit Texas Hold'em, played for chips.
(function (root) {
    var SDG = root.SDG || require('./core.js');
    var esc = SDG.esc, act = SDG.act, tag = SDG.tag;

    var RANKS = '23456789TJQKA';
    var STREETS = { preflop: 'flop', flop: 'turn', turn: 'river' };

    // ---------- hand evaluation ----------

    function rv(c) { return RANKS.indexOf(c[0]) + 2; }

    // Scores 5 cards as [category, tiebreakers...]; compare() orders them.
    function score5(cards) {
        var vals = cards.map(rv).sort(function (a, b) { return b - a; });
        var counts = {};
        vals.forEach(function (v) { counts[v] = (counts[v] || 0) + 1; });
        var groups = Object.keys(counts).map(Number).sort(function (a, b) { return counts[b] - counts[a] || b - a; });
        var flush = cards.every(function (c) { return c[1] === cards[0][1]; });
        var high = groups.length === 5 ? (vals[0] - vals[4] === 4 ? vals[0] : vals[0] === 14 && vals[1] === 5 ? 5 : 0) : 0;
        if (high && flush) return [8, high];
        if (counts[groups[0]] === 4) return [7].concat(groups);
        if (counts[groups[0]] === 3 && counts[groups[1]] === 2) return [6].concat(groups);
        if (flush) return [5].concat(vals);
        if (high) return [4, high];
        if (counts[groups[0]] === 3) return [3].concat(groups);
        if (counts[groups[0]] === 2 && counts[groups[1]] === 2) return [2].concat(groups);
        if (counts[groups[0]] === 2) return [1].concat(groups);
        return [0].concat(vals);
    }

    function compare(a, b) {
        for (var i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
        return 0;
    }

    // Best 5 of up to 7 cards.
    function best(cards) {
        var top = null, n = cards.length;
        for (var a = 0; a < n; a++) for (var b = a + 1; b < n; b++) for (var c = b + 1; c < n; c++)
            for (var d = c + 1; d < n; d++) for (var e = d + 1; e < n; e++) {
                var sc = score5([cards[a], cards[b], cards[c], cards[d], cards[e]]);
                if (!top || compare(sc, top) > 0) top = sc;
            }
        return top;
    }

    var NAMES = ['', '', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'jack', 'queen', 'king', 'ace'];
    var PLURALS = ['', '', 'twos', 'threes', 'fours', 'fives', 'sixes', 'sevens', 'eights', 'nines', 'tens', 'jacks', 'queens', 'kings', 'aces'];

    function describe(sc) {
        switch (sc[0]) {
            case 8: return sc[1] === 14 ? 'royal flush' : 'straight flush, ' + NAMES[sc[1]] + ' high';
            case 7: return 'four ' + PLURALS[sc[1]];
            case 6: return 'full house, ' + PLURALS[sc[1]] + ' over ' + PLURALS[sc[2]];
            case 5: return 'flush, ' + NAMES[sc[1]] + ' high';
            case 4: return 'straight, ' + NAMES[sc[1]] + ' high';
            case 3: return 'three ' + PLURALS[sc[1]];
            case 2: return 'two pair, ' + PLURALS[sc[1]] + ' and ' + PLURALS[sc[2]];
            case 1: return 'pair of ' + PLURALS[sc[1]];
            default: return NAMES[sc[1]] + ' high';
        }
    }

    // ---------- table ----------

    function name(s, pid) {
        for (var i = 0; i < s.players.length; i++) if (s.players[i].id === pid) return s.players[i].name;
        return '?';
    }
    function blinds(s) { return s.opts.blinds.split('/').map(Number); }
    function total(o) { return Object.keys(o).reduce(function (t, k) { return t + o[k]; }, 0); }

    // First player after `from` (in seat order, wrapping) for whom pred(pid) holds.
    function nextSeat(s, from, pred) {
        var n = s.players.length, i0 = 0;
        for (var i = 0; i < n; i++) if (s.players[i].id === from) i0 = i;
        for (var k = 1; k <= n; k++) {
            var pid = s.players[(i0 + k) % n].id;
            if (pred(pid)) return pid;
        }
        return null;
    }

    function inPlay(h, pid) { return h.inHand[pid] && !h.folded[pid]; }
    function canAct(h, pid) { return inPlay(h, pid) && !h.allIn[pid]; }
    function needsToAct(h, pid) { return canAct(h, pid) && (!h.acted[pid] || h.bet[pid] < h.currentBet); }
    function contenders(s) { return s.players.filter(function (p) { return inPlay(s.hand, p.id); }).map(function (p) { return p.id; }); }

    function setup(players, opts) {
        var s = {
            opts: opts, phase: 'between', handNo: 0,
            players: players.map(function (p) { return { id: p.id, name: p.name }; }),
            chips: {}, rebuys: {}, dealer: players[SDG.randInt(players.length)].id,
            hand: null, result: null, winner: null, log: []
        };
        players.forEach(function (p) { s.chips[p.id] = parseInt(opts.stack, 10); s.rebuys[p.id] = 0; });
        startHand(s);
        return s;
    }

    function post(s, pid, amount) {
        var h = s.hand, a = Math.min(amount, s.chips[pid]);
        s.chips[pid] -= a;
        h.bet[pid] = (h.bet[pid] || 0) + a;
        h.contrib[pid] = (h.contrib[pid] || 0) + a;
        if (!s.chips[pid]) h.allIn[pid] = true;
        return a;
    }

    function startHand(s) {
        var live = function (pid) { return s.chips[pid] > 0; };
        var seated = s.players.filter(function (p) { return live(p.id); });
        if (seated.length < 2) SDG.fail('Need at least two players with chips. Someone has to rebuy.');
        var bl = blinds(s);
        s.handNo++;
        s.dealer = nextSeat(s, s.dealer, live);
        var h = s.hand = {
            deck: SDG.newDeck(1), hole: {}, board: [], street: 'preflop',
            inHand: {}, folded: {}, allIn: {}, bet: {}, contrib: {}, acted: {}, last: {},
            currentBet: 0, minRaise: bl[1], toAct: null, sb: null, bb: null
        };
        seated.forEach(function (p) { h.inHand[p.id] = true; h.bet[p.id] = 0; h.contrib[p.id] = 0; });
        seated.forEach(function (p) { h.hole[p.id] = [h.deck.pop(), h.deck.pop()]; });
        // Heads-up, the dealer posts the small blind and acts first before the flop.
        h.sb = seated.length === 2 ? s.dealer : nextSeat(s, s.dealer, live);
        h.bb = nextSeat(s, h.sb, live);
        post(s, h.sb, bl[0]);
        post(s, h.bb, bl[1]);
        h.currentBet = bl[1];
        s.phase = 'hand';
        s.result = null;
        s.log.push('Hand ' + s.handNo + ': ' + name(s, s.dealer) + ' deals.');
        advance(s, h.bb);
    }

    // Moves the turn on from `from`, ending the betting round or the hand when nobody is left to act.
    function advance(s, from) {
        var h = s.hand, alive = contenders(s);
        if (alive.length === 1) return award(s, alive);
        var next = nextSeat(s, from, function (pid) { return needsToAct(h, pid); });
        if (next) { h.toAct = next; return; }
        h.toAct = null;
        while (true) {
            h.bet = {}; h.acted = {}; h.currentBet = 0; h.minRaise = blinds(s)[1];
            alive.forEach(function (pid) { h.bet[pid] = 0; });
            if (h.street === 'river') return showdown(s);
            h.deck.pop(); // burn
            var n = h.street === 'preflop' ? 3 : 1;
            for (var i = 0; i < n; i++) h.board.push(h.deck.pop());
            h.street = STREETS[h.street];
            // With fewer than two players able to bet, deal the rest of the board straight out.
            if (alive.filter(function (pid) { return canAct(h, pid); }).length >= 2) {
                h.toAct = nextSeat(s, s.dealer, function (pid) { return canAct(h, pid); });
                return;
            }
        }
    }

    function award(s, winners) {
        var h = s.hand, pot = total(h.contrib);
        s.chips[winners[0]] += pot;
        s.result = { pots: [{ amount: pot, winners: winners, desc: null }], shown: {}, desc: {} };
        s.log.push(name(s, winners[0]) + ' wins ' + pot + ' uncontested.');
        endHand(s);
    }

    function showdown(s) {
        var h = s.hand, alive = contenders(s), scores = {};
        s.result = { pots: [], shown: {}, desc: {} };
        alive.forEach(function (pid) {
            scores[pid] = best(h.hole[pid].concat(h.board));
            s.result.shown[pid] = h.hole[pid];
            s.result.desc[pid] = describe(scores[pid]);
        });
        // Side pots: one layer per distinct all-in level among the players still in.
        var levels = alive.map(function (pid) { return h.contrib[pid]; })
            .filter(function (x, i, a) { return a.indexOf(x) === i; }).sort(function (a, b) { return a - b; });
        var prev = 0, paid = 0, everyone = Object.keys(h.contrib);
        levels.forEach(function (lvl, li) {
            var amount = everyone.reduce(function (t, pid) {
                return t + Math.min(h.contrib[pid], lvl) - Math.min(h.contrib[pid], prev);
            }, 0);
            if (li === levels.length - 1) amount = total(h.contrib) - paid;
            prev = lvl;
            paid += amount;
            if (!amount) return;
            var eligible = alive.filter(function (pid) { return h.contrib[pid] >= lvl; });
            var top = null;
            eligible.forEach(function (pid) { if (!top || compare(scores[pid], top) > 0) top = scores[pid]; });
            var winners = eligible.filter(function (pid) { return compare(scores[pid], top) === 0; });
            // Split evenly; odd chips go to the first winner after the dealer.
            var share = Math.floor(amount / winners.length), odd = amount - share * winners.length;
            winners.forEach(function (pid) { s.chips[pid] += share; });
            if (odd) s.chips[nextSeat(s, s.dealer, function (pid) { return winners.indexOf(pid) >= 0; })] += odd;
            s.result.pots.push({ amount: amount, winners: winners, desc: describe(top) });
            s.log.push(winners.map(function (pid) { return name(s, pid); }).join(' & ') + ' win' + (winners.length > 1 ? '' : 's') + ' ' + amount + ' with ' + describe(top) + '.');
        });
        endHand(s);
    }

    function endHand(s) {
        s.hand.toAct = null;
        s.phase = 'between';
        var left = s.players.filter(function (p) { return s.chips[p.id] > 0; });
        if (left.length === 1 && !s.opts.rebuy) {
            s.phase = 'over';
            s.winner = left[0].id;
            s.log.push(name(s, s.winner) + ' has all the chips.');
        }
    }

    function handle(s, pid, a, ctx) {
        var h = s.hand;
        switch (a.type) {
            case 'next':
                if (s.phase === 'between') startHand(s);
                return;
            case 'rebuy':
                if (s.phase !== 'between' || !s.opts.rebuy || s.chips[pid] > 0) return;
                s.chips[pid] = parseInt(s.opts.stack, 10);
                s.rebuys[pid]++;
                s.log.push(name(s, pid) + ' rebought.');
                return;
            case 'force': {
                if (!ctx.isHost) SDG.fail('Only the host can do that.');
                if (s.phase !== 'hand' || !h.toAct) return;
                var who = h.toAct;
                if (h.bet[who] === h.currentBet) h.last[who] = 'check';
                else { h.folded[who] = true; h.last[who] = 'fold'; }
                h.acted[who] = true;
                s.log.push('The host ' + (h.folded[who] ? 'folded' : 'checked') + ' for ' + name(s, who) + '.');
                return advance(s, who);
            }
        }
        if (s.phase !== 'hand' || h.toAct !== pid) return;
        var toCall = h.currentBet - h.bet[pid];
        switch (a.type) {
            case 'fold':
                h.folded[pid] = true;
                h.last[pid] = 'fold';
                break;
            case 'check':
                if (toCall > 0) SDG.fail('You can’t check; it’s ' + toCall + ' to call.');
                h.last[pid] = 'check';
                break;
            case 'call':
                if (toCall <= 0) SDG.fail('Nothing to call.');
                h.last[pid] = 'call ' + post(s, pid, toCall);
                break;
            case 'raise': {
                var max = h.bet[pid] + s.chips[pid];
                var to = Math.min(Math.floor(Number(a.to)) || 0, max);
                if (to <= h.currentBet) SDG.fail('Raise to more than ' + h.currentBet + '.');
                var inc = to - h.currentBet;
                if (inc < h.minRaise && to < max) SDG.fail('The minimum is ' + (h.currentBet + h.minRaise) + '.');
                var wasBet = h.currentBet === 0;
                post(s, pid, to - h.bet[pid]);
                if (inc >= h.minRaise) { h.minRaise = inc; h.acted = {}; }
                h.currentBet = to;
                h.last[pid] = (h.allIn[pid] ? 'all in ' : wasBet ? 'bet ' : 'raise to ') + to;
                break;
            }
            default:
                return;
        }
        h.acted[pid] = true;
        advance(s, pid);
    }

    function view(s, pid) {
        var h = s.hand;
        var v = {
            phase: s.phase, handNo: s.handNo, opts: s.opts, blinds: blinds(s),
            players: s.players.map(function (p) { return { id: p.id, name: p.name, chips: s.chips[p.id], rebuys: s.rebuys[p.id] }; }),
            dealer: s.dealer, result: s.result, winner: s.winner, log: s.log
        };
        if (h) {
            v.hand = {
                board: h.board, street: h.street, inHand: h.inHand, folded: h.folded, allIn: h.allIn,
                bet: h.bet, pot: total(h.contrib), currentBet: h.currentBet, minRaise: h.minRaise,
                toAct: h.toAct, last: h.last, sb: h.sb, bb: h.bb, mine: h.hole[pid] || null
            };
        }
        return v;
    }

    // ---------- rendering ----------

    function nm(v, pid) {
        for (var i = 0; i < v.players.length; i++) if (v.players[i].id === pid) return v.players[i].name;
        return '?';
    }
    function me(v, ctx) { return v.players.filter(function (p) { return p.id === ctx.me; })[0]; }

    function actionPanel(v, ctx) {
        var h = v.hand, chips = me(v, ctx).chips, myBet = h.bet[ctx.me] || 0;
        var toCall = h.currentBet - myBet, maxTo = myBet + chips;
        var out = '<div class="card hactions">';
        var callBtn = toCall <= 0 ? '<button class="btn" ' + act({ type: 'check' }) + '>check</button>'
            : '<button class="btn" ' + act({ type: 'call' }) + '>call ' + Math.min(toCall, chips) + (toCall >= chips ? ' (all in)' : '') + '</button>';
        out += '<div class="row2"><button class="btn nay" ' + act({ type: 'fold' }) +
            (toCall <= 0 ? ' data-confirm="Fold? You could check for free."' : '') + '>fold</button>' + callBtn + '</div>';
        if (maxTo > h.currentBet && chips > toCall) {
            var minTo = Math.min(h.currentBet + h.minRaise, maxTo);
            // The chosen amount belongs to this exact betting spot; anything older resets to the minimum.
            var key = v.handNo + h.street + h.currentBet;
            var to = ctx.ui.holdemKey === key && ctx.ui.holdemTo ? ctx.ui.holdemTo : minTo;
            to = Math.max(minTo, Math.min(maxTo, to));
            var pot = h.pot + toCall, step = v.blinds[1];
            var pick = function (x) { return SDG.uiset({ holdemKey: key, holdemTo: Math.max(minTo, Math.min(maxTo, Math.round(x))) }); };
            out += '<div class="hraise"><button class="btn" ' + pick(to - step) + '>−</button><span class="hamt">' + to + '</span>' +
                '<button class="btn" ' + pick(to + step) + '>+</button></div>' +
                '<div class="seg"><button ' + pick(minTo) + '>min</button><button ' + pick(h.currentBet + pot / 2) + '>½ pot</button>' +
                '<button ' + pick(h.currentBet + pot) + '>pot</button><button ' + pick(maxTo) + '>all in</button></div>' +
                '<button class="btn primary wide" ' + act({ type: 'raise', to: to }) + '>' +
                (to === maxTo ? 'all in (' + to + ')' : (h.currentBet === 0 ? 'bet ' : 'raise to ') + to) + '</button>';
        }
        return out + '</div>';
    }

    function seats(v, ctx) {
        var h = v.hand, r = v.phase !== 'hand' ? v.result : null;
        var won = {};
        if (r) r.pots.forEach(function (pot) {
            pot.winners.forEach(function (pid) { won[pid] = (won[pid] || 0) + Math.floor(pot.amount / pot.winners.length); });
        });
        return '<div class="plist">' + v.players.map(function (p) {
            var t = '', out = h && !h.inHand[p.id], folded = h && h.folded[p.id];
            if (p.id === v.dealer) t += tag('D', 'office');
            if (h && v.phase === 'hand') {
                if (p.id === h.sb) t += tag('SB');
                if (p.id === h.bb) t += tag('BB');
                if (h.bet[p.id]) t += tag('bet ' + h.bet[p.id], 'vote');
                if (h.allIn[p.id]) t += tag('all in', 'cabal');
                else if (h.last[p.id]) t += tag(h.last[p.id]);
            }
            if (r && r.shown[p.id]) t += '<span class="hcards">' + r.shown[p.id].map(function (c) { return SDG.cardHtml(c, true); }).join('') + '</span>';
            if (won[p.id]) t += tag('won ' + won[p.id], 'loyal');
            if (!p.chips && (!h || !h.inHand[p.id] || v.phase !== 'hand')) t += tag('out', 'dead');
            var cls = 'prow' + (h && h.toAct === p.id ? ' sel' : '') + (out || folded ? ' dim' : '');
            return '<div class="' + cls + '"><span class="pname">' + esc(p.name) + (p.id === ctx.me ? ' <span class="muted">(you)</span>' : '') +
                ' <span class="muted small">' + p.chips + '</span>' +
                (r && r.desc[p.id] ? '<div class="small muted">' + esc(r.desc[p.id]) + '</div>' : '') +
                '</span><span class="ptags">' + t + '</span></div>';
        }).join('') + '</div>';
    }

    function render(v, ctx) {
        var h = v.hand, mine = me(v, ctx);
        var title = v.phase === 'over' ? 'Game over' : 'Hand ' + v.handNo + (v.phase === 'hand' ? ' · ' + h.street : '');
        var out = '<div class="phase"><h2>' + title + ' <span class="muted small">blinds ' + v.blinds.join('/') + '</span></h2></div>';

        if (v.phase === 'over') out += '<div class="card banner loyal"><b>' + esc(nm(v, v.winner)) + ' wins the table.</b></div>';

        if (h) {
            out += '<div class="hboard">' + [0, 1, 2, 3, 4].map(function (i) { return SDG.cardHtml(h.board[i] || ''); }).join('') + '</div>';
            out += '<div class="center small muted">pot ' + h.pot + '</div>';
        }

        if (v.phase !== 'hand' && v.result) {
            out += v.result.pots.map(function (pot, i) {
                var label = v.result.pots.length > 1 ? (i ? 'side pot ' + i : 'main pot') : 'pot';
                return '<div class="card banner loyal">' + pot.winners.map(function (pid) { return '<b>' + esc(nm(v, pid)) + '</b>'; }).join(' & ') +
                    ' win' + (pot.winners.length > 1 ? '' : 's') + ' the ' + label + ' (' + pot.amount + ')' + (pot.desc ? ' with ' + esc(pot.desc) : '') + '</div>';
            }).join('');
        }

        if (h && h.mine) {
            var my = h.mine.concat(h.board);
            out += '<div class="hmine">' + h.mine.map(function (c) { return SDG.cardHtml(c); }).join('') +
                (h.board.length ? '<div class="small muted">' + esc(describe(best(my))) + '</div>' : '') + '</div>';
        }

        if (v.phase === 'hand') {
            if (h.toAct === ctx.me) out += actionPanel(v, ctx);
            else if (h.inHand[ctx.me] && !h.folded[ctx.me]) out += '<p class="muted center">Waiting for ' + esc(nm(v, h.toAct)) + '…</p>';
            else out += '<p class="muted center">' + (h.inHand[ctx.me] ? 'You folded.' : 'You’re sitting this hand out.') + ' ' + esc(nm(v, h.toAct)) + ' to act.</p>';
        } else if (v.phase === 'between') {
            out += '<button class="btn primary wide" ' + act({ type: 'next' }) + '>deal next hand</button>';
            if (!mine.chips && v.opts.rebuy) out += '<button class="btn wide" ' + act({ type: 'rebuy' }) + '>rebuy for ' + v.opts.stack + '</button>';
        }

        out += seats(v, ctx);
        if (v.phase === 'hand' && ctx.isHost && h.toAct && h.toAct !== ctx.me) {
            out += '<button class="btn subtle" ' + act({ type: 'force' }) + ' data-confirm="Check or fold for ' + esc(nm(v, h.toAct)) + '?">act for ' + esc(nm(v, h.toAct)) + ' (away)</button>';
        }
        return out + SDG.logList(v.log);
    }

    SDG.register({
        id: 'holdem',
        name: 'Hold’em',
        tagline: 'No-limit Texas Hold’em. Your hole cards stay on your phone.',
        minPlayers: 2,
        maxPlayers: 10,
        seated: true,
        options: [
            { key: 'stack', label: 'Starting chips', type: 'select', def: '1000', choices: [['500', '500'], ['1000', '1000'], ['2000', '2000'], ['5000', '5000']] },
            { key: 'blinds', label: 'Blinds', type: 'select', def: '10/20', choices: [['5/10', '5/10'], ['10/20', '10/20'], ['25/50', '25/50'], ['50/100', '50/100']] },
            { key: 'rebuy', label: 'Allow rebuys', type: 'bool', def: true }
        ],
        rules: '<p>Standard no-limit <b>Texas Hold’em</b>. You get two private cards on your phone; five shared cards come out in stages: the flop (3), the turn (1) and the river (1).</p>' +
            '<p>Each round of betting you can <b>fold</b>, <b>check</b> or <b>call</b>, or <b>bet/raise</b>. Raises must be at least the size of the last bet or raise, unless you’re going all in.</p>' +
            '<p>The best five-card hand from your two cards and the board wins. Side pots are handled automatically.</p>' +
            '<p>The dealer button moves each hand. Anyone can deal the next hand. If someone wanders off, the host can check or fold for them.</p>',
        setup: setup,
        act: handle,
        view: view,
        render: render,
        _test: { score5: score5, best: best, compare: compare, describe: describe }
    });
})(typeof window !== 'undefined' ? window : globalThis);
