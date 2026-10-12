(function (root) {
  function endpoint() {
    var cfg = root.BTV_SUPABASE_CONFIG;
    if (!cfg || !cfg.url) return '';
    return String(cfg.url).replace(/\/+$/, '') + '/functions/v1/notify-teams';
  }

  function sessionToken() {
    var sb = root._btvSb;
    if (!sb || !sb.auth || typeof sb.auth.getSession !== 'function') return Promise.resolve('');
    return Promise.resolve().then(function () {
      return sb.auth.getSession();
    }).then(function (result) {
      var session = result && result.data && result.data.session;
      var access = session && session.access_token;
      return access ? String(access) : '';
    }, function () { return ''; });
  }

  function showNeedsSignIn() {
    var message = 'Teams notification was not sent. Sign in and try again.';
    if (typeof root.alert === 'function') root.alert(message);
  }

  function btvPostNotification(channel, message) {
    var text = String(message || '').replace(/^\s+|\s+$/g, '');
    var url = endpoint();
    var allowed = channel === 'linesheet' || channel === 'calendar';
    if (!allowed || !text || !url) return Promise.resolve(false);
    return sessionToken().then(function (bearer) {
      if (!bearer) {
        showNeedsSignIn();
        return false;
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
    });
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
