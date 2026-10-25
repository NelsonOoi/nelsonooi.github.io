// Blackjack — everyone plays their own hands against the dealer at the same time.
(function (root) {
    var SDG = root.SDG || require('./core.js');
    var esc = SDG.esc, act = SDG.act, tag = SDG.tag;

    function cardValue(c) { return c[0] === 'A' ? 11 : 'TJQK'.indexOf(c[0]) >= 0 ? 10 : +c[0]; }

    // Best total, counting aces as 1 where needed; soft means an ace is still counted as 11.
    function value(cards) {
        var total = 0, aces = 0;
        cards.forEach(function (c) { if (!c) return; total += cardValue(c); if (c[0] === 'A') aces++; });
        while (total > 21 && aces) { total -= 10; aces--; }
        return { total: total, soft: aces > 0 };
    }

    function natural(hand) { return !hand.split && hand.cards.length === 2 && value(hand.cards).total === 21; }

    function name(s, pid) {
        for (var i = 0; i < s.players.length; i++) if (s.players[i].id === pid) return s.players[i].name;
        return '?';
    }

    function setup(players, opts) {
        var s = {
            opts: opts, phase: 'bet', round: 1,
            players: players.map(function (p) { return { id: p.id, name: p.name }; }),
            chips: {}, rebuys: {}, bets: {}, lastBet: {},
            shoe: SDG.newDeck(parseInt(opts.decks, 10)), dealer: [], hands: {}, log: []
        };
        players.forEach(function (p) { s.chips[p.id] = parseInt(opts.stack, 10); s.rebuys[p.id] = 0; });
        return s;
    }

    // An empty shoe mid-round is refilled with every card not already on the table.
    function draw(s) {
        if (!s.shoe.length) {
            var out = s.dealer.slice();
            allHands(s).forEach(function (h) { out = out.concat(h.cards); });
            s.shoe = SDG.newDeck(parseInt(s.opts.decks, 10)).filter(function (c) {
                var i = out.indexOf(c);
                if (i < 0) return true;
                out.splice(i, 1);
                return false;
            });
            s.log.push('The shoe ran out and was reshuffled.');
        }
        return s.shoe.pop();
    }

    function allBetsIn(s) {
        return s.players.every(function (p) { return !s.chips[p.id] || s.bets[p.id] != null; });
    }

    function deal(s) {
        var decks = parseInt(s.opts.decks, 10);
        if (s.shoe.length < Math.max(decks * 13, 30)) {
            s.shoe = SDG.newDeck(decks);
            s.log.push('The shoe was reshuffled.');
        }
        s.hands = {};
        s.players.forEach(function (p) {
            var b = s.bets[p.id];
            if (!b) return;
            s.chips[p.id] -= b;
            s.lastBet[p.id] = b;
            s.hands[p.id] = [{ cards: [draw(s), draw(s)], bet: b, done: false }];
            if (natural(s.hands[p.id][0])) s.hands[p.id][0].done = true;
        });
        s.dealer = [draw(s), draw(s)];
        s.phase = 'play';
        // The dealer peeks under an ace or ten; a dealer blackjack ends the round at once.
        if (cardValue(s.dealer[0]) >= 10 && value(s.dealer).total === 21) {
            s.log.push('The dealer has blackjack.');
            return settle(s);
        }
        checkDone(s);
    }

    function allHands(s) {
        var out = [];
        Object.keys(s.hands).forEach(function (pid) { s.hands[pid].forEach(function (h) { out.push(h); }); });
        return out;
    }

    function checkDone(s) {
        if (allHands(s).every(function (h) { return h.done; })) settle(s);
    }

    function settle(s) {
        var dv, rule = s.opts.h17;
        // The dealer only draws if someone is still in with a non-blackjack hand.
        if (allHands(s).some(function (h) { return value(h.cards).total <= 21 && !natural(h); })) {
            while (true) {
                dv = value(s.dealer);
                if (dv.total < 17 || (rule && dv.total === 17 && dv.soft)) s.dealer.push(draw(s));
                else break;
            }
        }
        dv = value(s.dealer);
        var dealerBJ = s.dealer.length === 2 && dv.total === 21;
        Object.keys(s.hands).forEach(function (pid) {
            var net = 0;
            s.hands[pid].forEach(function (h) {
                var t = value(h.cards).total, pay = 0;
                if (t > 21) h.result = 'bust';
                else if (natural(h)) { h.result = dealerBJ ? 'push' : 'blackjack'; pay = dealerBJ ? h.bet : h.bet + Math.floor(h.bet * 3 / 2); }
                else if (dealerBJ) h.result = 'lose';
                else if (dv.total > 21 || t > dv.total) { h.result = 'win'; pay = h.bet * 2; }
                else if (t === dv.total) { h.result = 'push'; pay = h.bet; }
                else h.result = 'lose';
                h.done = true;
                h.net = pay - h.bet;
                net += h.net;
                s.chips[pid] += pay;
            });
            s.log.push(name(s, pid) + (net > 0 ? ' won ' + net : net < 0 ? ' lost ' + -net : ' broke even') + '.');
        });
        s.phase = 'result';
    }

    function handle(s, pid, a, ctx) {
        switch (a.type) {
            case 'bet': {
                if (s.phase !== 'bet') return;
                var amt = Math.floor(Number(a.amount)) || 0;
                if (amt < 0 || amt > s.chips[pid]) SDG.fail('You only have ' + s.chips[pid] + ' chips.');
                s.bets[pid] = amt;
                if (allBetsIn(s) && s.players.some(function (p) { return s.bets[p.id] > 0; })) deal(s);
                return;
            }
            case 'rebuy':
                if (s.phase !== 'bet' || !s.opts.rebuy || s.chips[pid] > 0) return;
                s.chips[pid] = parseInt(s.opts.stack, 10);
                s.rebuys[pid]++;
                s.log.push(name(s, pid) + ' rebought.');
                return;
            case 'next':
                if (s.phase !== 'result') return;
                s.phase = 'bet';
                s.round++;
                s.bets = {};
                s.hands = {};
                s.dealer = [];
                return;
            case 'force':
                if (!ctx.isHost) SDG.fail('Only the host can do that.');
                if (s.phase === 'bet') {
                    if (!s.players.some(function (p) { return s.bets[p.id] > 0; })) SDG.fail('Nobody has bet yet.');
                    s.players.forEach(function (p) { if (s.bets[p.id] == null) s.bets[p.id] = 0; });
                    deal(s);
                } else if (s.phase === 'play') {
                    allHands(s).forEach(function (h) { h.done = true; });
                    s.log.push('The host stood everyone’s remaining hands.');
                    settle(s);
                }
                return;
        }
        if (s.phase !== 'play') return;
        var hands = s.hands[pid] || [], h = hands[a.h];
        if (!h || h.done) return;
        switch (a.type) {
            case 'hit':
                h.cards.push(draw(s));
                if (value(h.cards).total >= 21) h.done = true;
                break;
            case 'stand':
                h.done = true;
                break;
            case 'double':
                if (h.cards.length !== 2) SDG.fail('You can only double on your first two cards.');
                if (s.chips[pid] < h.bet) SDG.fail('Not enough chips to double.');
                s.chips[pid] -= h.bet;
                h.bet *= 2;
                h.doubled = true;
                h.cards.push(draw(s));
                h.done = true;
                break;
            case 'split': {
                if (hands.length > 1 || h.cards.length !== 2 || cardValue(h.cards[0]) !== cardValue(h.cards[1])) SDG.fail('You can only split a pair, once.');
                if (s.chips[pid] < h.bet) SDG.fail('Not enough chips to split.');
                s.chips[pid] -= h.bet;
                var aces = h.cards[0][0] === 'A';
                s.hands[pid] = h.cards.map(function (c) {
                    var nh = { cards: [c, draw(s)], bet: h.bet, done: false, split: true };
                    // Split aces get one card each.
                    if (aces || value(nh.cards).total === 21) nh.done = true;
                    return nh;
                });
                break;
            }
            default:
                return;
        }
        checkDone(s);
    }

    function view(s, pid) {
        var hidden = s.phase === 'play';
        return {
            phase: s.phase, round: s.round, opts: s.opts,
            players: s.players.map(function (p) { return { id: p.id, name: p.name, chips: s.chips[p.id], rebuys: s.rebuys[p.id] }; }),
            bets: s.bets, lastBet: s.lastBet[pid] || 0, hands: s.hands,
            dealer: hidden ? [s.dealer[0], null] : s.dealer,
            shoe: s.shoe.length, log: s.log
        };
    }

    // ---------- rendering ----------

    function nm(v, pid) {
        for (var i = 0; i < v.players.length; i++) if (v.players[i].id === pid) return v.players[i].name;
        return '?';
    }

    function totalLabel(cards, split) {
        var val = value(cards);
        if (!split && cards.length === 2 && val.total === 21) return 'blackjack';
        return (val.soft && val.total < 21 ? 'soft ' : '') + val.total;
    }

    var RESULT = { win: ['win', 'loyal'], blackjack: ['blackjack!', 'loyal'], push: ['push', ''], lose: ['lose', 'cabal'], bust: ['bust', 'cabal'] };

    function handHtml(v, pid, h, i, mine, ctx) {
        var t = value(h.cards).total, out = '<div class="bjhand' + (mine ? ' mine' : '') + '">';
        out += '<div class="bjcards">' + h.cards.map(function (c) { return SDG.cardHtml(c, !mine); }).join('') + '</div>';
        out += '<div class="small">' + totalLabel(h.cards, h.split) + ' <span class="muted">· bet ' + h.bet + (h.doubled ? ' (doubled)' : '') + '</span> ';
        if (h.result) out += tag(RESULT[h.result][0] + (h.net > 0 ? ' +' + h.net : ''), RESULT[h.result][1]);
        else if (t > 21) out += tag('bust', 'cabal');
        else if (h.done) out += tag('stand');
        out += '</div>';
        if (mine && v.phase === 'play' && !h.done) {
            var me = v.players.filter(function (p) { return p.id === ctx.me; })[0];
            var canDouble = h.cards.length === 2 && me.chips >= h.bet;
            var canSplit = v.hands[pid].length === 1 && h.cards.length === 2 && cardValue(h.cards[0]) === cardValue(h.cards[1]) && me.chips >= h.bet;
            out += '<div class="bjacts"><button class="btn primary" ' + act({ type: 'hit', h: i }) + '>hit</button>' +
                '<button class="btn" ' + act({ type: 'stand', h: i }) + '>stand</button>' +
                (canDouble ? '<button class="btn" ' + act({ type: 'double', h: i }) + '>double</button>' : '') +
                (canSplit ? '<button class="btn" ' + act({ type: 'split', h: i }) + '>split</button>' : '') + '</div>';
        }
        return out + '</div>';
    }

    function betPanel(v, ctx, me) {
        if (!me.chips) {
            return v.opts.rebuy ? '<button class="btn primary wide" ' + act({ type: 'rebuy' }) + '>rebuy for ' + v.opts.stack + '</button>'
                : '<p class="muted center">You’re out of chips.</p>';
        }
        var placed = v.bets[ctx.me];
        var amt = ctx.ui.bjBet != null ? ctx.ui.bjBet : placed || v.lastBet || 10;
        amt = Math.max(0, Math.min(me.chips, amt));
        var add = function (n) { return SDG.uiset({ bjBet: Math.min(me.chips, amt + n) }); };
        var h = '<div class="card"><div class="lbl">your bet</div><div class="hraise"><button class="btn" ' + SDG.uiset({ bjBet: 0 }) + '>clear</button>' +
            '<span class="hamt">' + amt + '</span><button class="btn" ' + SDG.uiset({ bjBet: me.chips }) + '>max</button></div>' +
            '<div class="seg">' + [5, 25, 100, 500].map(function (n) { return '<button ' + add(n) + '>+' + n + '</button>'; }).join('') + '</div>' +
            '<button class="btn primary wide" ' + act({ type: 'bet', amount: amt }) + (amt > 0 ? '' : ' disabled') + '>' + (placed ? 'change bet to ' : 'bet ') + amt + '</button>' +
            '<button class="btn subtle" ' + act({ type: 'bet', amount: 0 }) + '>sit this round out</button></div>';
        if (placed != null) h += '<p class="muted small center">' + (placed ? 'You’re in for ' + placed + '.' : 'You’re sitting out.') + ' Dealing once everyone has bet.</p>';
        return h;
    }

    function render(v, ctx) {
        var me = v.players.filter(function (p) { return p.id === ctx.me; })[0];
        var h = '<div class="phase"><h2>Round ' + v.round + ' <span class="muted small">you have ' + me.chips + '</span></h2></div>';

        if (v.dealer.length) {
            var up = v.dealer[0], hidden = v.dealer[1] === null;
            h += '<div class="card bjdealer"><div class="small muted">dealer · ' + (hidden ? 'showing ' + (up[0] === 'A' ? 'an ace' : cardValue(up)) : totalLabel(v.dealer)) + '</div>' +
                '<div class="bjcards">' + v.dealer.map(function (c) { return SDG.cardHtml(c); }).join('') + '</div></div>';
        }

        if (v.phase === 'bet') {
            h += betPanel(v, ctx, me);
            if (ctx.isHost) h += '<button class="btn subtle" ' + act({ type: 'force' }) + ' data-confirm="Deal now? Anyone who hasn’t bet sits this round out.">deal now</button>';
        } else if (v.hands[ctx.me]) {
            h += v.hands[ctx.me].map(function (hand, i) { return handHtml(v, ctx.me, hand, i, true, ctx); }).join('');
        } else {
            h += '<p class="muted center">You’re sitting this round out.</p>';
        }
        if (v.phase === 'result') h += '<button class="btn primary wide" ' + act({ type: 'next' }) + '>next round</button>';
        if (v.phase === 'play' && ctx.isHost) h += '<button class="btn subtle" ' + act({ type: 'force' }) + ' data-confirm="Stand on every unfinished hand and finish the round?">finish the round</button>';

        h += '<div class="plist">' + v.players.filter(function (p) { return p.id !== ctx.me; }).map(function (p) {
            var hands = v.hands[p.id], status = '';
            if (v.phase === 'bet') status = !p.chips ? tag('out', 'dead') : v.bets[p.id] == null ? tag('choosing…') : v.bets[p.id] ? tag('bet ' + v.bets[p.id], 'vote') : tag('sitting out');
            return '<div class="prow bjrow"><span class="pname">' + esc(p.name) + ' <span class="muted small">' + p.chips + '</span></span>' +
                (hands ? '<span class="bjothers">' + hands.map(function (hand, i) { return handHtml(v, p.id, hand, i, false, ctx); }).join('') + '</span>' : '<span class="ptags">' + status + '</span>') + '</div>';
        }).join('') + '</div>';

        return h + '<p class="muted small">' + v.shoe + ' cards left in the ' + v.opts.decks + '-deck shoe. Dealer ' + (v.opts.h17 ? 'hits' : 'stands on') + ' soft 17; blackjack pays 3:2.</p>' + SDG.logList(v.log);
    }

    SDG.register({
        id: 'blackjack',
        name: 'Blackjack',
        tagline: 'Beat the dealer to 21. Everyone plays at once on their own phone.',
        minPlayers: 1,
        maxPlayers: 7,
        options: [
            { key: 'stack', label: 'Starting chips', type: 'select', def: '1000', choices: [['500', '500'], ['1000', '1000'], ['5000', '5000']] },
            { key: 'decks', label: 'Decks in the shoe', type: 'select', def: '6', choices: [['1', '1'], ['2', '2'], ['6', '6'], ['8', '8']] },
            { key: 'h17', label: 'Dealer hits soft 17', type: 'bool', def: false },
            { key: 'rebuy', label: 'Allow rebuys', type: 'bool', def: true }
        ],
        rules: '<p>Everyone bets, then gets two cards against the dealer. Get closer to 21 than the dealer without going over. Face cards are 10; aces are 1 or 11.</p>' +
            '<p><b>Hit</b> to take a card, <b>stand</b> to stop. <b>Double</b> your bet on your first two cards to take exactly one more card. <b>Split</b> a pair into two hands (once; split aces get one card each).</p>' +
            '<p>Once everyone is done, the dealer draws to 17. A win pays 1:1; a blackjack (21 on your first two cards) pays 3:2. Everyone plays at the same time, so there’s no waiting for turns.</p>',
        setup: setup,
        act: handle,
        view: view,
        render: render,
        _test: { value: value }
    });
})(typeof window !== 'undefined' ? window : globalThis);
