/**
 * BTV Supabase Sync — v3
 *
 * Architecture change from v2:
 *   The parent frame (index.html) calls window.btvSyncStart(session) directly
 *   after login instead of relying on cross-frame SIGNED_IN event propagation.
 *   This eliminates all iframe-reload chains and timing race conditions.
 *
 * Flow:
 *   1. index.html logs the user in with signInWithPassword.
 *   2. index.html calls frame.contentWindow.btvSyncStart(session) on the iframe.
 *   3. btvSyncStart: sets up the authenticated Supabase client, pulls latest
 *      state from cloud into localStorage, re-renders, then subscribes to
 *      Realtime so future changes from other users appear automatically.
 *   4. Write interceptor mirrors every localStorage.setItem (for watched keys)
 *      to Supabase in real time.
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
    'btv-admin-config-v1',
  ];

  // Keys that trigger a UI re-render when changed remotely
  const RENDER_KEYS = [
    'calendar-2026-working-v5',
    'calendar-2026-markdown-bars-v1',
    'calendar-2026-marketing-workflow-v1',
  ];

  // Capture the real setItem before we intercept it
  const _origSetItem = localStorage.setItem.bind(localStorage);

  let _sb                  = null;  // authenticated Supabase client
  let _userId              = null;
  let _userEmail           = null;
  let _started             = false;
  let _interceptorInstalled = false;

  // ── Toast ──────────────────────────────────────────────────────────────────

  function showToast(msg) {
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

  // ── Apply a row received from Supabase into localStorage + re-render ───────

  function applyRow(key, val, fromUserId) {
    if (localStorage.getItem(key) === val) return; // nothing changed
    _origSetItem(key, val);
    if (!RENDER_KEYS.includes(key)) return;
    try {
      if (typeof window.render === 'function') window.render();
    } catch (e) {}
    if (fromUserId && fromUserId !== _userId) {
      showToast('Calendar updated by another team member');
    }
  }

  // ── Write interceptor — mirrors localStorage writes to Supabase ────────────

  function setupWriteInterceptor() {
    if (_interceptorInstalled) return;
    _interceptorInstalled = true;
    localStorage.setItem = function (key, value) {
      _origSetItem(key, value);
      if (!SYNCED_KEYS.includes(key) || !_sb) return;
      let parsed;
      try { parsed = JSON.parse(value); } catch (e) { parsed = value; }
      _sb.from('app_state')
        .upsert(
          { key, value: parsed, updated_at: new Date().toISOString(), updated_by: _userId },
          { onConflict: 'key' }
        )
        .then(function (res) {
          if (res.error) console.error('[BTV Sync] Write failed:', key, res.error.message);
        });
    };
  }

  // ── Realtime subscription ─────────────────────────────────────────────────

  function setupRealtime() {
    _sb.channel('btv_app_state_v3')
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
          applyRow(key, val, payload.new.updated_by);
        }
      )
      .subscribe(function (status, err) {
        console.log('[BTV Sync] Realtime:', status, err || '');
        if (status === 'SUBSCRIBED') {
          console.log('[BTV Sync] Realtime connected — live sync active.');
        }
      });
  }

  // ── Polling fallback every 15 s (catches missed Realtime events) ───────────

  function setupPolling() {
    setInterval(async function () {
      if (!_sb) return;
      try {
        const { data } = await _sb
          .from('app_state')
          .select('key, value, updated_by')
          .in('key', RENDER_KEYS);
        if (!data) return;
        data.forEach(function (row) {
          const val =
            typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
          applyRow(row.key, val, row.updated_by);
        });
      } catch (e) {}
    }, 15000); // every 15 s
  }

  // ── btvSyncStart — called by index.html right after login ──────────────────
  //
  //   session = the Supabase session object from signInWithPassword
  //
  window.btvSyncStart = async function (session) {
    if (_started) {
      console.log('[BTV Sync] Already started, skipping.');
      return;
    }
    _started  = true;
    _userId   = session.user.id;
    _userEmail = session.user.email || null;

    console.log('[BTV Sync] Starting for', _userEmail);

    // Create a fresh authenticated Supabase client
    _sb = window.supabase.createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });

    // Restore the session so this client uses the logged-in user's JWT
    const { error: sessionErr } = await _sb.auth.setSession({
      access_token:  session.access_token,
      refresh_token: session.refresh_token,
    });
    if (sessionErr) {
      console.error('[BTV Sync] setSession failed:', sessionErr.message);
      showError('Sync session error: ' + sessionErr.message + '. Live sync may not work.');
      // Still set up interceptor so local saves at least work
      setupWriteInterceptor();
      return;
    }

    // Pull latest state from Supabase → write to localStorage → re-render
    console.log('[BTV Sync] Pulling latest state from cloud…');
    const { data, error } = await _sb
      .from('app_state')
      .select('key, value')
      .in('key', SYNCED_KEYS);

    if (error) {
      console.error('[BTV Sync] Initial pull error:', error.message);
      const missing = error.message.includes('does not exist') || error.code === '42P01';
      if (missing) {
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
        const val =
          typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
        if (localStorage.getItem(row.key) !== val) {
          _origSetItem(row.key, val);
          changed = true;
        }
      });
      if (changed) {
        console.log('[BTV Sync] Applied remote state — re-rendering.');
        try { if (typeof window.render === 'function') window.render(); } catch (e) {}
      } else {
        console.log('[BTV Sync] Local state already up to date.');
      }
    } else {
      // Supabase is empty — push local data up as the first migration
      console.log('[BTV Sync] Supabase empty — pushing local data up…');
      const rows = SYNCED_KEYS
        .filter(function (k) { return localStorage.getItem(k) !== null; })
        .map(function (key) {
          const raw = localStorage.getItem(key);
          let parsed;
          try { parsed = JSON.parse(raw); } catch (e) { parsed = raw; }
          return { key, value: parsed, updated_at: new Date().toISOString(), updated_by: _userId };
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

    // Wire up live sync
    setupWriteInterceptor();
    setupRealtime();
    setupPolling();

    console.log('[BTV Sync] Live sync ready.');
  };

  // ── Helpers exposed to parent frame / console ──────────────────────────────

  window.btvGetCurrentEmail  = function () { return _userEmail; };
  window.btvSyncIsActive     = function () { return _started; };

  window.btvForceSync = async function () {
    if (!_sb) { console.warn('[BTV Sync] Not started.'); return; }
    const rows = SYNCED_KEYS
      .filter(function (k) { return localStorage.getItem(k) !== null; })
      .map(function (key) {
        const raw = localStorage.getItem(key);
        let parsed;
        try { parsed = JSON.parse(raw); } catch (e) { parsed = raw; }
        return { key, value: parsed, updated_at: new Date().toISOString(), updated_by: _userId };
      });
    const { error } = await _sb.from('app_state').upsert(rows, { onConflict: 'key' });
    if (error) { console.error('[BTV Sync] Force-push error:', error.message); return; }
    console.log('[BTV Sync] Force-pushed', rows.length, 'keys.');
    alert('Force sync complete — pushed ' + rows.length + ' keys to Supabase.');
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
