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
    //   selected pid, tags(pid) -> html, dim(pid) -> bool
    SDG.playerList = function (opts) {
        var esc = SDG.esc;
        return '<div class="plist">' + opts.players.map(function (p) {
            var can = opts.selectable ? opts.selectable(p.id) : false;
            var cls = 'prow' + (can ? ' pick' : '') + (opts.selected === p.id ? ' sel' : '') +
                (opts.dim && opts.dim(p.id) ? ' dim' : '');
            var tags = opts.tags ? opts.tags(p.id) : '';
            var attr = can ? ' ' + SDG.act(opts.action(p.id)) : ' disabled';
            return '<button class="' + cls + '"' + attr + '><span class="pname">' + esc(p.name) +
                '</span><span class="ptags">' + tags + '</span></button>';
        }).join('') + '</div>';
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
