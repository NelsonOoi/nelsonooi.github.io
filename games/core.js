// Shared helpers + game registry. Loaded in the browser and in node (for tests).
(function (root) {
    var SDG = root.SDG || {};
    SDG.games = SDG.games || {};
    SDG.order = SDG.order || [];

    SDG.register = function (game) {
        if (!SDG.games[game.id]) SDG.order.push(game.id);
        SDG.games[game.id] = game;
    };

    SDG.esc = function (s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };

    // Server time, so countdowns agree across phones. The client sets clockOffset from each response.
    SDG.clockOffset = 0;
    SDG.now = function () { return Date.now() + SDG.clockOffset; };

    SDG.randInt = function (n) {
        var buf = new Uint32Array(1);
        root.crypto.getRandomValues(buf);
        return buf[0] % n;
    };

    SDG.shuffle = function (arr) {
        var a = arr.slice();
        for (var i = a.length - 1; i > 0; i--) {
            var j = SDG.randInt(i + 1);
            var t = a[i]; a[i] = a[j]; a[j] = t;
        }
        return a;
    };

    SDG.fail = function (msg) {
        var e = new Error(msg);
        e.userFacing = true;
        throw e;
    };

    // data-act attribute: clicking the element sends this action to the host.
    SDG.act = function (action) {
        return 'data-act="' + SDG.esc(JSON.stringify(action)) + '"';
    };

    // Renders a column of player buttons. opts:
    //   players [{id,name}], selectable(pid) -> bool, action(pid) -> action,
    //   selected pid, tags(pid) -> html, dim(pid) -> bool, confirm(pid) -> question to ask first
    SDG.playerList = function (opts) {
        var esc = SDG.esc;
        return '<div class="plist">' + opts.players.map(function (p) {
            var can = opts.selectable ? opts.selectable(p.id) : false;
            var cls = 'prow' + (can ? ' pick' : '') + (opts.selected === p.id ? ' sel' : '') +
                (opts.dim && opts.dim(p.id) ? ' dim' : '');
            var tags = opts.tags ? opts.tags(p.id) : '';
            var attr = can ? ' ' + SDG.act(opts.action(p.id)) : ' disabled';
            if (can && opts.confirm) attr += ' data-confirm="' + SDG.esc(opts.confirm(p.id)) + '"';
            return '<button class="' + cls + '"' + attr + '><span class="pname">' + esc(p.name) +
                '</span><span class="ptags">' + tags + '</span></button>';
        }).join('') + '</div>';
    };

    // data-uiset attribute: clicking merges this object into the device's local UI state.
    SDG.uiset = function (obj) {
        return 'data-uiset="' + SDG.esc(JSON.stringify(obj)) + '"';
    };

    // A live m:ss countdown to a server timestamp; app.js ticks it and re-renders when it hits zero.
    SDG.timer = function (deadline) {
        var left = Math.max(0, Math.ceil((deadline - SDG.now()) / 1000));
        return '<span class="timer" data-deadline="' + deadline + '">' +
            Math.floor(left / 60) + ':' + ('0' + left % 60).slice(-2) + '</span>';
    };

    // Playing cards are two-character strings: rank (23456789TJQKA) + suit (shdc).
    SDG.newDeck = function (decks) {
        var cards = [];
        for (var d = 0; d < (decks || 1); d++)
            '23456789TJQKA'.split('').forEach(function (r) { 'shdc'.split('').forEach(function (s) { cards.push(r + s); }); });
        return SDG.shuffle(cards);
    };

    // A face-up card, a face-down card (null), or an empty slot ('').
    SDG.cardHtml = function (c, small) {
        var cls = 'pcard' + (small ? ' sm' : '');
        if (c === '') return '<span class="' + cls + ' empty"></span>';
        if (!c) return '<span class="' + cls + ' back"></span>';
        var suit = { s: '♠', h: '♥', d: '♦', c: '♣' }[c[1]];
        return '<span class="' + cls + (c[1] === 'h' || c[1] === 'd' ? ' red' : '') + '">' +
            (c[0] === 'T' ? '10' : c[0]) + '<i>' + suit + '</i></span>';
    };

    SDG.tag = function (text, kind) {
        return '<span class="tag' + (kind ? ' ' + kind : '') + '">' + SDG.esc(text) + '</span>';
    };

    SDG.logList = function (log, n) {
        var items = log.slice(-(n || 8)).reverse();
        if (!items.length) return '';
        return '<details class="card log" data-key="log"><summary>event log</summary><ol>' +
            items.map(function (l) { return '<li>' + SDG.esc(l) + '</li>'; }).join('') +
            '</ol></details>';
    };

    root.SDG = SDG;
    if (typeof module !== 'undefined' && module.exports) module.exports = SDG;
})(typeof window !== 'undefined' ? window : globalThis);
