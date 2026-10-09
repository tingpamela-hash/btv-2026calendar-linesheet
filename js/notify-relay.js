(function (root) {
  function endpoint() {
    var cfg = root.BTV_SUPABASE_CONFIG;
    if (!cfg || !cfg.url) return '';
    return String(cfg.url).replace(/\/+$/, '') + '/functions/v1/notify-teams';
  }

  function token() {
    try {
      if (typeof root.btvAccessToken === 'function') return String(root.btvAccessToken() || '');
    } catch (err) {}
    return '';
  }

  function btvPostNotification(channel, message) {
    var text = String(message || '').replace(/^\s+|\s+$/g, '');
    var url = endpoint();
    var bearer = token();
    if ((channel !== 'linesheet' && channel !== 'calendar') || !text || !url || !bearer) {
      return Promise.resolve(false);
    }
    var cfg = root.BTV_SUPABASE_CONFIG || {};
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + bearer,
        apikey: cfg.anonKey || ''
      },
      body: JSON.stringify({ channel: channel, summary: text })
    }).then(function (res) {
      if (!res || res.ok !== true) return false;
      if (typeof res.json !== 'function') return true;
      return res.json().then(function (body) {
        if (!body || body.ok !== true || body.disabled === true) return false;
        return true;
      }, function () { return true; });
    }, function () { return false; });
  }

  function btvClearStoredWebhooks() {
    ['btvLsWebhook', 'btvMgmtWebhook', 'ccWebhookPublished', 'ccWebhookDraft'].forEach(function (key) {
      try { root.localStorage.removeItem(key); } catch (err) {}
    });
  }

  root.btvPostNotification = btvPostNotification;
  root.btvClearStoredWebhooks = btvClearStoredWebhooks;
  btvClearStoredWebhooks();
})(typeof globalThis !== 'undefined' ? globalThis : this);
