/**
 * BTV Supabase Sync Layer
 *
 * Strategy:
 *  - On first page load in a session:
 *      a) Pull all keys from Supabase.
 *      b) If Supabase has data  → write to localStorage, reload so the app
 *         initialises with correct data.
 *      c) If Supabase is empty but localStorage has data → push localStorage
 *         up to Supabase first (one-time migration), then reload.
 *      d) If both empty → just mark synced and continue.
 *  - On subsequent loads (flag already set): wire up the write interceptor
 *    and Realtime subscription only.
 *  - All writes to watched keys are mirrored to Supabase in real-time.
 *  - Realtime subscription keeps localStorage fresh when another user saves.
 */
(function () {
  if (!window.BTV_SUPABASE_CONFIG || !window.supabase) {
    console.warn('[BTV Sync] Missing Supabase config or SDK — sync disabled.');
    return;
  }

  const { url, anonKey } = window.BTV_SUPABASE_CONFIG;
  const sb = window.supabase.createClient(url, anonKey);

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

  // Per-page flag so calendar and linesheet each sync independently.
  const SYNC_FLAG = 'btv-synced-v2-' + window.location.pathname;

  let _userId = null;
  let _userEmail = null;
  const _origSetItem = localStorage.setItem.bind(localStorage);

  // Human-readable labels for loggable keys (null = skip logging)
  const KEY_LABELS = {
    'calendar-2026-working-v5':           'Calendar',
    'calendar-2026-working-v5-history':   null,
    'calendar-2026-working-v5-versions':  null,
    'calendar-2026-working-v5-changelog': null,
    'calendar-2026-marketing-workflow-v1':'Marketing Workflow',
    'calendar-2026-markdown-bars-v1':     'Markdown',
    'linesheetCalendarData':              'Linesheet Data',
    'launchListMaster':                   'Launch List',
    'btvLinesheetChangeLog':              null,
    'btv_product_data':                   'Product Data',
    'btv-admin-config-v1':               'Admin Settings',
  };

  // Debounce per key: don't log the same key more than once per 3 s
  const _logDebounce = {};

  function logChange(key) {
    const label = KEY_LABELS[key];
    if (!label) return;
    const now = Date.now();
    if (_logDebounce[key] && now - _logDebounce[key] < 3000) return;
    _logDebounce[key] = now;
    sb.from('change_log')
      .insert({ key, label, changed_by: _userId, email: _userEmail, changed_at: new Date().toISOString() })
      .then(function (res) {
        if (res.error) console.warn('[BTV Sync] Change log error:', res.error);
      });
  }

  // ── Loading overlay ────────────────────────────────────────────────────────

  function showOverlay(msg) {
    let el = document.getElementById('btv-sync-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'btv-sync-overlay';
      el.style.cssText = [
        'position:fixed;inset:0;z-index:9999;',
        'background:#f7f6f3;display:flex;align-items:center;',
        'justify-content:center;flex-direction:column;gap:14px;',
        "font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;",
      ].join('');
      const attach = function () { document.body.appendChild(el); };
      if (document.body) attach();
      else document.addEventListener('DOMContentLoaded', attach);
    }
    el.innerHTML =
      '<div style="font-size:10px;font-weight:800;letter-spacing:.24em;text-transform:uppercase;color:#333">BTV Planner</div>' +
      '<div style="width:28px;height:28px;border:2.5px solid #e0ddd8;border-top-color:#333;border-radius:50%;animation:btvSpin .7s linear infinite"></div>' +
      '<div id="btv-sync-msg" style="font-size:12px;color:#888;letter-spacing:.04em">' + (msg || 'Syncing data…') + '</div>' +
      '<style>@keyframes btvSpin{to{transform:rotate(360deg)}}</style>';
  }

  function updateOverlayMsg(msg) {
    const el = document.getElementById('btv-sync-msg');
    if (el) el.textContent = msg;
  }

  function hideOverlay() {
    const el = document.getElementById('btv-sync-overlay');
    if (el) el.remove();
  }

  function showError(msg) {
    hideOverlay();
    const el = document.createElement('div');
    el.id = 'btv-sync-error';
    el.style.cssText = [
      'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);',
      'z-index:9999;background:#fff3cd;border:1.5px solid #e6a817;',
      'border-radius:10px;padding:12px 18px;max-width:480px;width:90%;',
      "font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;",
      'font-size:12px;color:#7a5a00;line-height:1.5;',
      'box-shadow:0 4px 24px rgba(0,0,0,.12)',
    ].join('');
    el.innerHTML = '<strong style="display:block;margin-bottom:4px">⚠️ Sync Warning</strong>' + msg +
      '<br><button onclick="this.parentElement.remove()" style="margin-top:8px;background:none;border:none;color:#7a5a00;cursor:pointer;text-decoration:underline;font-size:12px">Dismiss</button>';
    const attach = function () { document.body.appendChild(el); };
    if (document.body) attach();
    else document.addEventListener('DOMContentLoaded', attach);
  }

  // ── Write interceptor ──────────────────────────────────────────────────────

  function setupWriteInterceptor() {
    localStorage.setItem = function (key, value) {
      _origSetItem(key, value);
      if (!SYNCED_KEYS.includes(key)) return;
      let parsed;
      try { parsed = JSON.parse(value); } catch { parsed = value; }
      sb.from('app_state')
        .upsert(
          { key, value: parsed, updated_at: new Date().toISOString(), updated_by: _userId },
          { onConflict: 'key' }
        )
        .then(function (res) {
          if (res.error) {
            console.error('[BTV Sync] Save error for key:', key, res.error);
          }
        });
      logChange(key);
    };
  }

  // ── Realtime: receive changes from other users ─────────────────────────────

  function setupRealtime() {
    sb.channel('btv_app_state')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_state' },
        function (payload) {
          if (!payload.new || !SYNCED_KEYS.includes(payload.new.key)) return;
          const key = payload.new.key;
          const val =
            typeof payload.new.value === 'string'
              ? payload.new.value
              : JSON.stringify(payload.new.value);
          _origSetItem(key, val);
          try {
            window.dispatchEvent(new StorageEvent('storage', { key, newValue: val }));
          } catch (e) {}
        }
      )
      .subscribe();
  }

  // ── Push all local data up to Supabase (one-time migration) ───────────────

  async function pushLocalToSupabase() {
    const keysWithData = SYNCED_KEYS.filter(function (k) {
      return localStorage.getItem(k) !== null;
    });
    if (!keysWithData.length) return 0;

    const rows = keysWithData.map(function (key) {
      const raw = localStorage.getItem(key);
      let parsed;
      try { parsed = JSON.parse(raw); } catch { parsed = raw; }
      return { key, value: parsed, updated_at: new Date().toISOString(), updated_by: _userId };
    });

    const { error } = await sb
      .from('app_state')
      .upsert(rows, { onConflict: 'key' });

    if (error) {
      console.error('[BTV Sync] Migration push error:', error);
      return -1;
    }
    return keysWithData.length;
  }

  // ── Main init ──────────────────────────────────────────────────────────────

  async function init() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      // Not authenticated yet — wire up interceptor and wait for login.
      // When the parent frame signs in (SIGNED_IN event propagates via shared
      // localStorage), reload this iframe so the full sync runs with a session.
      setupWriteInterceptor();
      sb.auth.onAuthStateChange(function (event, newSession) {
        if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && newSession) {
          if (!sessionStorage.getItem(SYNC_FLAG)) {
            window.location.reload();
          }
        }
      });
      return;
    }
    _userId = session.user.id;
    _userEmail = session.user.email || null;

    sb.auth.onAuthStateChange(function (_, s) {
      _userId = s ? s.user.id : null;
      _userEmail = s ? (s.user.email || null) : null;
    });

    if (sessionStorage.getItem(SYNC_FLAG)) {
      // Already synced this session — just set up live sync.
      setupWriteInterceptor();
      setupRealtime();
      return;
    }

    // ── First load this session: reconcile Supabase ↔ localStorage ────────
    showOverlay('Checking for updates…');

    const { data, error } = await sb
      .from('app_state')
      .select('key, value')
      .in('key', SYNCED_KEYS);

    if (error) {
      // Table likely doesn't exist yet — show instructions.
      const isTableMissing = error.message && (
        error.message.includes('does not exist') ||
        error.code === '42P01' ||
        error.code === 'PGRST116'
      );
      console.error('[BTV Sync] Init pull error:', error);
      hideOverlay();
      setupWriteInterceptor();
      if (isTableMissing) {
        showError(
          'The Supabase <code>app_state</code> table has not been created yet. ' +
          'Please run <strong>supabase-setup.sql</strong> in your Supabase SQL Editor ' +
          'so data can be shared between team members.'
        );
      }
      return;
    }

    const remoteRows = data || [];

    let _anyChanged = false;

    if (remoteRows.length > 0) {
      // ── Case A: Supabase has data → load it into localStorage ─────────
      updateOverlayMsg('Loading shared data…');
      remoteRows.forEach(function (row) {
        const val =
          typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
        // Only write — and flag reload needed — if something actually changed
        if (localStorage.getItem(row.key) !== val) {
          _origSetItem(row.key, val);
          _anyChanged = true;
        }
      });
    } else {
      // ── Case B: Supabase is empty → push any local data up (migration) ─
      const localKeyCount = SYNCED_KEYS.filter(function (k) {
        return localStorage.getItem(k) !== null;
      }).length;

      if (localKeyCount > 0) {
        updateOverlayMsg('Uploading your data to the shared store…');
        const pushed = await pushLocalToSupabase();
        if (pushed > 0) {
          console.log('[BTV Sync] Migrated', pushed, 'keys from localStorage to Supabase.');
        }
      }
      // If both empty, nothing to do — fall through.
    }

    sessionStorage.setItem(SYNC_FLAG, '1');

    if (_anyChanged) {
      // Data changed — reload so the app re-initialises with fresh state
      window.location.reload();
    } else {
      // Nothing changed — skip reload, go straight to live-sync mode
      hideOverlay();
      setupWriteInterceptor();
      setupRealtime();
      setupPolling();
    }
  }

  // Expose force-push utility for emergency use from browser console.
  window.btvForceSync = async function () {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { console.warn('[BTV Sync] Not logged in.'); return; }
    _userId = session.user.id;
    const n = await pushLocalToSupabase();
    console.log('[BTV Sync] Force-pushed', n, 'keys to Supabase.');
    alert('Sync complete — pushed ' + n + ' data keys to Supabase. Reloading…');
    sessionStorage.removeItem(SYNC_FLAG);
    window.location.reload();
  };

  // Expose fetch helper so the admin panel can query change_log
  window.btvFetchChangeLog = async function (limit) {
    const { data, error } = await sb
      .from('change_log')
      .select('label, email, changed_at')
      .order('changed_at', { ascending: false })
      .limit(limit || 100);
    if (error) { console.warn('[BTV Sync] Fetch change_log error:', error); return []; }
    return data || [];
  };

  init();
})();
