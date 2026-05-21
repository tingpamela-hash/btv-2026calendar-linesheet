/**
 * BTV Supabase Sync — v4
 *
 * Flow:
 *   1. index.html logs the user in with signInWithPassword.
 *   2. index.html calls frame.contentWindow.btvSyncStart(session, parentSb).
 *   3. btvSyncStart: pulls latest state from cloud into localStorage,
 *      re-renders, then subscribes to Realtime + Presence.
 *   4. Write interceptor mirrors every localStorage.setItem to Supabase.
 *
 * Safety features (v4):
 *   • Offline detection — persistent banner when navigator is offline;
 *     auto force-sync on reconnect.
 *   • Write-failure alert — visible error bar with Retry button when a
 *     Supabase write fails (network error, auth expiry, etc.).
 *   • Version-conflict check — btvCheckVersionConflict(key) does a live
 *     Supabase query before the caller saves; if a teammate saved the same
 *     key after the user last pulled, returns true so the caller can prompt.
 *   • updated_at tracking — every Supabase read stores each key's
 *     updated_at so version comparisons are accurate.
 */
(function () {
  'use strict';

  if (!window.BTV_SUPABASE_CONFIG || !window.supabase) {
    console.warn('[BTV Sync] Config or SDK missing — sync disabled.');
    return;
  }

  const { url, anonKey } = window.BTV_SUPABASE_CONFIG;

  // Keys that are synced to Supabase
  const SYNCED_KEYS = [
    'calendar-2026-working-v5',
    'calendar-2026-working-v5-history',
    'calendar-2026-working-v5-versions',
    'calendar-2026-working-v5-changelog',
    'calendar-2026-marketing-workflow-v1',
    'calendar-2026-markdown-bars-v1',
    'linesheetCalendarData',
    'launchListMaster',
    'btvLinesheetChangeLog',
    'btv_product_data',
    'btv_linesheet_products',
    'btv-admin-config-v1',
  ];

  // Keys that trigger a UI re-render when changed remotely.
  const RENDER_KEYS = [
    'calendar-2026-working-v5',
    'calendar-2026-markdown-bars-v1',
    'calendar-2026-marketing-workflow-v1',
    'linesheetCalendarData',
    'launchListMaster',
    'btvLinesheetChangeLog',
    'btv_product_data',
    'btv_linesheet_products',
  ];

  // Capture the real setItem before we intercept it
  const _origSetItem = localStorage.setItem.bind(localStorage);

  let _sb                   = null;  // authenticated Supabase client
  let _userId               = null;
  let _userEmail            = null;
  let _started              = false;
  let _interceptorInstalled = false;
  let _realtimeChannel      = null;

  // Tracks the last-known updated_at from Supabase for each key.
  // Used for version-conflict detection.
  const _lastPullTimes = {};

  // ── Status bars ────────────────────────────────────────────────────────────
  // Persistent banners at the top of the iframe for sync health states.

  const BAR_CSS = [
    'position:fixed;top:0;left:0;right:0;z-index:10000;',
    'display:flex;align-items:center;justify-content:center;gap:12px;',
    'padding:7px 16px;font-size:12px;font-weight:600;line-height:1.4;',
    "font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;",
    'box-shadow:0 2px 8px rgba(0,0,0,.18);',
  ].join('');

  function _showBar(id, html, bg, color) {
    if (!document.body) return;
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      document.body.insertBefore(el, document.body.firstChild);
    }
    el.style.cssText = BAR_CSS + 'background:' + bg + ';color:' + color + ';';
    el.innerHTML = html;
    el.style.display = 'flex';
  }

  function _hideBar(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  // ── Offline / online detection ─────────────────────────────────────────────

  function _onOffline() {
    _showBar(
      'btv-offline-bar',
      '📡 <span>You are <strong>offline</strong> — changes are being saved locally but will not sync to teammates until you reconnect.</span>',
      '#fef3c7', '#78350f'
    );
  }

  function _onOnline() {
    _hideBar('btv-offline-bar');
    // Push any local changes that may have been made while offline
    if (!_sb || !_userId) return;
    setTimeout(async function () {
      const rows = SYNCED_KEYS
        .filter(function (k) { return localStorage.getItem(k) !== null; })
        .map(function (key) {
          const raw = localStorage.getItem(key);
          let parsed; try { parsed = JSON.parse(raw); } catch (e) { parsed = raw; }
          return { key, value: parsed, updated_at: new Date().toISOString(), updated_by: _userId };
        });
      if (!rows.length) return;
      const { error } = await _sb.from('app_state').upsert(rows, { onConflict: 'key' });
      if (!error) {
        rows.forEach(function (r) { _lastPullTimes[r.key] = r.updated_at; });
        _showBar('btv-online-bar', '✓ Back online — all changes have been synced.', '#dcfce7', '#166534');
        setTimeout(function () { _hideBar('btv-online-bar'); }, 5000);
      }
    }, 800);
  }

  window.addEventListener('offline', _onOffline);
  window.addEventListener('online',  _onOnline);
  // Defer the initial offline check until body exists (script may be in <head>)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { if (!navigator.onLine) _onOffline(); });
  } else {
    if (!navigator.onLine) _onOffline();
  }

  // ── Write-failure alert ────────────────────────────────────────────────────

  function _showWriteFailure(key, errMsg) {
    _showBar(
      'btv-write-fail-bar',
      '⚠ <span><strong>Save failed</strong> for <em>' + key + '</em>: ' + errMsg +
      '. Your change may not have reached teammates.</span>' +
      '<button onclick="window.btvForceSync&&window.btvForceSync()" ' +
      'style="background:#ef4444;color:#fff;border:none;border-radius:5px;' +
      'padding:3px 10px;font-size:11px;cursor:pointer;font-weight:700">Retry Sync</button>' +
      '<button onclick="document.getElementById(\'btv-write-fail-bar\').style.display=\'none\'" ' +
      'style="background:none;border:1px solid #b91c1c;border-radius:5px;' +
      'padding:3px 8px;font-size:11px;cursor:pointer;color:#7f1d1d">Dismiss</button>',
      '#fee2e2', '#7f1d1d'
    );
  }

  // ── Toast ──────────────────────────────────────────────────────────────────

  function showToast(msg) {
    if (!document.body) return;
    let el = document.getElementById('btv-sync-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'btv-sync-toast';
      el.style.cssText = [
        'position:fixed;bottom:20px;right:20px;z-index:9998;',
        'background:#111;color:#fff;border-radius:10px;',
        'padding:10px 16px;font-size:12px;font-weight:500;letter-spacing:.02em;',
        "font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;",
        'box-shadow:0 4px 20px rgba(0,0,0,.25);opacity:0;',
        'transition:opacity .3s ease;pointer-events:none;',
      ].join('');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.style.opacity = '0'; }, 3500);
  }

  function showError(msg) {
    if (!document.body) return;
    const el = document.createElement('div');
    el.style.cssText = [
      'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);',
      'z-index:9999;background:#fff3cd;border:1.5px solid #e6a817;',
      'border-radius:10px;padding:12px 18px;max-width:480px;width:90%;',
      "font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;",
      'font-size:12px;color:#7a5a00;line-height:1.5;',
      'box-shadow:0 4px 24px rgba(0,0,0,.12)',
    ].join('');
    el.innerHTML = '<strong style="display:block;margin-bottom:4px">⚠ Sync Warning</strong>' + msg +
      '<br><button onclick="this.parentElement.remove()" style="margin-top:8px;background:none;border:none;' +
      'color:#7a5a00;cursor:pointer;text-decoration:underline;font-size:12px">Dismiss</button>';
    document.body.appendChild(el);
  }

  // ── Version-conflict check ─────────────────────────────────────────────────
  //
  // Call this before saving. Returns true if a teammate saved the same key
  // after the user last pulled — meaning the user's form is based on stale data.

  window.btvCheckVersionConflict = async function (key) {
    if (!_sb || !_lastPullTimes[key]) return false;
    try {
      const { data } = await _sb
        .from('app_state')
        .select('updated_at, updated_by')
        .eq('key', key)
        .single();
      if (!data || !data.updated_at) return false;
      const dbTime   = new Date(data.updated_at);
      const pullTime = new Date(_lastPullTimes[key]);
      // Conflict if DB is newer AND it was written by someone else
      return dbTime > pullTime && data.updated_by !== _userId;
    } catch (e) {
      return false; // network error during check — allow save to proceed
    }
  };

  // ── Apply a row received from Supabase into localStorage + re-render ───────

  function applyRow(key, val, fromUserId, updatedAt) {
    if (updatedAt) _lastPullTimes[key] = updatedAt;
    if (localStorage.getItem(key) === val) return; // nothing changed
    _origSetItem(key, val);
    if (!RENDER_KEYS.includes(key)) return;
    // Only re-render and toast for changes from someone else.
    const isOtherUser = fromUserId && fromUserId !== _userId;
    if (!isOtherUser) return;
    try {
      if (typeof window.btvReloadAndRender === 'function') window.btvReloadAndRender();
      else if (typeof window._btvCalRender === 'function') window._btvCalRender();
    } catch (e) {}
    showToast('Calendar updated by another team member');
  }

  // ── Write interceptor — mirrors localStorage writes to Supabase ────────────

  function setupWriteInterceptor() {
    if (_interceptorInstalled) return;
    _interceptorInstalled = true;
    localStorage.setItem = function (key, value) {
      _origSetItem(key, value);
      if (!SYNCED_KEYS.includes(key) || !_sb) return;
      if (!navigator.onLine) return; // queued for reconnect sync
      let parsed;
      try { parsed = JSON.parse(value); } catch (e) { parsed = value; }
      const now = new Date().toISOString();
      _sb.from('app_state')
        .upsert(
          { key, value: parsed, updated_at: now, updated_by: _userId },
          { onConflict: 'key' }
        )
        .then(function (res) {
          if (res.error) {
            console.error('[BTV Sync] Write failed:', key, res.error.message);
            _showWriteFailure(key, res.error.message);
          } else {
            _lastPullTimes[key] = now; // our own save — update baseline
            _hideBar('btv-write-fail-bar'); // clear any previous failure
          }
        })
        .catch(function (err) {
          console.error('[BTV Sync] Network error on write:', key, err);
          _showWriteFailure(key, err.message || 'Network error');
        });
    };
  }

  // ── Realtime subscription ─────────────────────────────────────────────────
  // Each iframe uses its own Realtime client. The authenticated query client is
  // shared by the parent, but sharing a Realtime channel across iframes means
  // only one iframe receives immediate callbacks; the other can lag until polling.

  async function setupRealtime() {
    if (_realtimeChannel) return;
    var rtSb = window.supabase.createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    if (_session) {
      try {
        await rtSb.auth.setSession({
          access_token: _session.access_token,
          refresh_token: _session.refresh_token,
        });
      } catch (e) {
        console.warn('[BTV Sync] Realtime setSession failed:', e);
      }
    }
    _realtimeChannel = rtSb.channel('btv_app_state_v3')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_state' },
        function (payload) {
          if (!payload.new) return;
          const key = payload.new.key;
          if (!SYNCED_KEYS.includes(key)) return;
          const val =
            typeof payload.new.value === 'string'
              ? payload.new.value
              : JSON.stringify(payload.new.value);
          applyRow(key, val, payload.new.updated_by, payload.new.updated_at);
        }
      )
      .subscribe(function (status, err) {
        console.log('[BTV Sync] Realtime:', status, err || '');
        if (status === 'SUBSCRIBED') {
          console.log('[BTV Sync] Realtime connected — live sync active.');
        }
      });
  }

  // ── Editing presence — who is online and who is editing which item ──────

  let _presenceChannel = null;
  let _session         = null; // stored so setupPresence can create its own client

  function _dispatchPresence() {
    window.dispatchEvent(new CustomEvent('btv-presence-changed'));
  }

  async function setupPresence() {
    var _isLinesheet = window.location.pathname.indexOf('linesheet') !== -1;
    // Linesheet has its own dedicated presence system (btvLsPresenceInit / btv-ls-presence-v2).
    // Running a second channel here for linesheet caused a race that cleared all field locks.
    if (_isLinesheet) return;

    // Create a dedicated local client so WebSocket + callbacks live entirely in THIS
    // iframe's JS context. Using parentSb caused cross-frame event-dispatch failures.
    var _presenceSb = window.supabase.createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    if (_session) {
      try {
        await _presenceSb.auth.setSession({
          access_token: _session.access_token,
          refresh_token: _session.refresh_token,
        });
      } catch (e) {
        console.warn('[BTV Sync] setSession failed — presence client continuing unauthenticated:', e);
      }
    }

    console.log('[BTV Sync] Setting up presence channel: btv-cal-presence-v1');
    _presenceChannel = _presenceSb.channel('btv-cal-presence-v1', {
      config: { presence: { key: _userId } },
    });
    _presenceChannel
      .on('presence', { event: 'sync' },  _dispatchPresence)
      .on('presence', { event: 'join' },  _dispatchPresence)
      .on('presence', { event: 'leave' }, _dispatchPresence)
      .subscribe(function (status) {
        if (status === 'SUBSCRIBED') {
          console.log('[BTV Sync] Presence connected on btv-cal-presence-v1');
          _presenceChannel.track({ email: _userEmail, item: null, field: null, ts: Date.now() });
          setInterval(_dispatchPresence, 3000);
        } else {
          console.log('[BTV Sync] Presence status:', status, 'on btv-cal-presence-v1');
        }
      });
  }

  window.btvSetEditing = async function (itemId) {
    if (!_presenceChannel) return;
    await _presenceChannel.track({ email: _userEmail, item: itemId, field: null, ts: Date.now() });
  };

  window.btvClearEditing = async function () {
    if (!_presenceChannel) return;
    await _presenceChannel.track({ email: _userEmail, item: null, field: null, ts: Date.now() });
  };

  // Track which specific field the user is currently focused on within a product form.
  // groupId is the product's groupId; fieldKey is a stable identifier for the input
  // (e.g. "f_name", "meas-r0-S-val"). Pass fieldKey=null to clear field focus.
  window.btvTrackField = async function (groupId, fieldKey) {
    if (!_presenceChannel) return;
    var itemId = groupId ? 'ls::group::' + groupId : null;
    await _presenceChannel.track({ email: _userEmail, item: itemId, field: fieldKey || null, ts: Date.now() });
  };

  // Returns the email of the teammate currently focused on fieldKey within groupId, or null.
  window.btvGetFieldHolder = function (groupId, fieldKey) {
    var itemId = 'ls::group::' + groupId;
    var users = window.btvGetOnlineUsers();
    for (var i = 0; i < users.length; i++) {
      if (users[i].item === itemId && users[i].field === fieldKey) return users[i].email;
    }
    return null;
  };

  window.btvGetOnlineUsers = function () {
    if (!_presenceChannel) return [];
    const state = _presenceChannel.presenceState();
    const users = [];
    Object.keys(state).forEach(function (key) {
      if (key === _userId) return;
      const presences = state[key] || [];
      if (presences.length) {
        const p = presences[presences.length - 1];
        if (p.email) users.push({ email: p.email, item: p.item || null, field: p.field || null });
      }
    });
    return users;
  };

  window.btvGetEditingUsers = function (itemId) {
    return window.btvGetOnlineUsers()
      .filter(function (u) { return u.item === itemId; })
      .map(function (u) { return u.email; });
  };

  // ── Polling fallback every 15 s ───────────────────────────────────────────

  function setupPolling() {
    setInterval(async function () {
      if (!_sb) return;
      try {
        const { data } = await _sb
          .from('app_state')
          .select('key, value, updated_by, updated_at')
          .in('key', RENDER_KEYS);
        if (!data) return;
        data.forEach(function (row) {
          const val =
            typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
          applyRow(row.key, val, row.updated_by, row.updated_at);
        });
      } catch (e) {}
    }, 30000);
  }

  // ── btvSyncStart ──────────────────────────────────────────────────────────

  window.btvSyncStart = async function (session, parentSb) {
    if (_started) {
      console.log('[BTV Sync] Already started, skipping.');
      return;
    }
    _started   = true;
    _userId    = session.user.id;
    _userEmail = session.user.email || null;
    _session   = session;

    console.log('[BTV Sync] Starting for', _userEmail);

    if (parentSb) {
      _sb = parentSb;
      console.log('[BTV Sync] Using parent Supabase client.');
    } else {
      _sb = window.supabase.createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
      const { data: { session: activeSession } } = await _sb.auth.getSession();
      if (!activeSession) {
        console.error('[BTV Sync] No active session found.');
        showError('Live sync could not authenticate. Sign out and sign back in.');
        setupWriteInterceptor();
        return;
      }
    }

    // Pull latest state — include updated_at for version tracking
    console.log('[BTV Sync] Pulling latest state from cloud…');
    const { data, error } = await _sb
      .from('app_state')
      .select('key, value, updated_at')
      .in('key', SYNCED_KEYS);

    if (error) {
      console.error('[BTV Sync] Initial pull error:', error.message);
      if (error.message.includes('does not exist') || error.code === '42P01') {
        showError(
          'Supabase <strong>app_state</strong> table not found. ' +
          'Run <strong>supabase-setup.sql</strong> in your Supabase SQL Editor.'
        );
      }
      setupWriteInterceptor();
      return;
    }

    if (data && data.length > 0) {
      let changed = false;
      data.forEach(function (row) {
        if (row.updated_at) _lastPullTimes[row.key] = row.updated_at;
        const val =
          typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
        if (localStorage.getItem(row.key) !== val) {
          _origSetItem(row.key, val);
          changed = true;
        }
      });
      if (changed) {
        console.log('[BTV Sync] Applied remote state — re-rendering.');
        try {
          if (typeof window.btvReloadAndRender === 'function') window.btvReloadAndRender();
          else if (typeof window._btvCalRender === 'function') window._btvCalRender();
        } catch (e) {}
      } else {
        console.log('[BTV Sync] Local state already up to date.');
      }
    } else {
      // Supabase is empty — push local data up as first migration
      console.log('[BTV Sync] Supabase empty — pushing local data up…');
      const rows = SYNCED_KEYS
        .filter(function (k) { return localStorage.getItem(k) !== null; })
        .map(function (key) {
          const raw = localStorage.getItem(key);
          let parsed; try { parsed = JSON.parse(raw); } catch (e) { parsed = raw; }
          const now = new Date().toISOString();
          _lastPullTimes[key] = now;
          return { key, value: parsed, updated_at: now, updated_by: _userId };
        });
      if (rows.length) {
        const { error: pushErr } = await _sb
          .from('app_state')
          .upsert(rows, { onConflict: 'key' });
        if (pushErr) {
          console.error('[BTV Sync] Initial push error:', pushErr.message);
        } else {
          console.log('[BTV Sync] Pushed', rows.length, 'keys to Supabase.');
        }
      }
    }

    // Wire up live sync and safety features
    setupWriteInterceptor();
    await setupRealtime();
    setupPolling();
    await setupPresence();

    // Let the linesheet initialize its own presence system if defined
    if (typeof window.btvLsPresenceInit === 'function') {
      await window.btvLsPresenceInit(_session);
    }

    console.log('[BTV Sync] Live sync ready.');
  };

  // ── Helpers exposed to parent frame / console ──────────────────────────────

  window.btvGetCurrentEmail  = function () { return _userEmail; };
  window.btvSyncIsActive     = function () { return _started; };

  // Call from DevTools console to diagnose presence state:  window.btvDiagnosePresence to see raw data.
  window.btvDiagnosePresence = function () {
    console.log('=== BTV Presence Diagnosis ===');
    console.log('Sync started:', _started);
    console.log('User ID:', _userId);
    console.log('User email:', _userEmail);
    console.log('Presence channel:', _presenceChannel ? 'EXISTS' : 'NULL');
    console.log('Shared channel on _sb:', _sb && _sb.__btvPresenceChannel ? 'EXISTS' : 'NULL');
    if (_presenceChannel) {
      var state = _presenceChannel.presenceState();
      console.log('Presence state (raw):', JSON.stringify(state));
      console.log('Online users (filtered):', JSON.stringify(window.btvGetOnlineUsers()));
    }
    console.log('==============================');
  };

  window.btvForceSync = async function () {
    if (!_sb) { console.warn('[BTV Sync] Not started.'); return; }
    const rows = SYNCED_KEYS
      .filter(function (k) { return localStorage.getItem(k) !== null; })
      .map(function (key) {
        const raw = localStorage.getItem(key);
        let parsed; try { parsed = JSON.parse(raw); } catch (e) { parsed = raw; }
        const now = new Date().toISOString();
        return { key, value: parsed, updated_at: now, updated_by: _userId };
      });
    const { error } = await _sb.from('app_state').upsert(rows, { onConflict: 'key' });
    if (error) { console.error('[BTV Sync] Force-push error:', error.message); return; }
    rows.forEach(function (r) { _lastPullTimes[r.key] = r.updated_at; });
    _hideBar('btv-write-fail-bar');
    console.log('[BTV Sync] Force-pushed', rows.length, 'keys.');
    showToast('Sync complete — ' + rows.length + ' keys pushed to Supabase.');
  };

  window.btvFetchChangeLog = async function (limit) {
    if (!_sb) return [];
    const { data, error } = await _sb
      .from('change_log')
      .select('label, email, changed_at')
      .order('changed_at', { ascending: false })
      .limit(limit || 100);
    if (error) { console.warn('[BTV Sync] change_log error:', error.message); return []; }
    return data || [];
  };

})();
