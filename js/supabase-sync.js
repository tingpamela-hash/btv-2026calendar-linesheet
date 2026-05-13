/**
 * BTV Supabase Sync Layer
 * Intercepts localStorage reads/writes for BTV data keys and keeps them
 * in sync with Supabase. Injected into calendar.html and linesheet.html.
 *
 * Strategy:
 *  - On first page load in a session: pull all keys from Supabase → populate
 *    localStorage → reload the page so the app initialises with correct data.
 *  - On subsequent loads (flag already set): just wire up the write interceptor.
 *  - All writes to watched keys are mirrored to Supabase in real-time.
 *  - Supabase Realtime subscription keeps localStorage fresh when another user
 *    saves, and fires a native `storage` event so the app can react.
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
  ];

  // Use page path so calendar and linesheet each get their own flag.
  const SYNC_FLAG = 'btv-synced-v1-' + window.location.pathname;

  let _userId = null;
  const _origSetItem = localStorage.setItem.bind(localStorage);

  // ---- Loading overlay (shown during first-load data pull) ----
  function showOverlay() {
    const el = document.createElement('div');
    el.id = 'btv-sync-overlay';
    el.style.cssText = [
      'position:fixed;inset:0;z-index:9999;',
      'background:#f7f6f3;display:flex;align-items:center;',
      'justify-content:center;flex-direction:column;gap:14px;',
      "font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;",
    ].join('');
    el.innerHTML =
      '<div style="font-size:10px;font-weight:800;letter-spacing:.24em;text-transform:uppercase;color:#333">BTV Planner</div>' +
      '<div style="width:28px;height:28px;border:2.5px solid #e0ddd8;border-top-color:#333;border-radius:50%;animation:btvSpin .7s linear infinite"></div>' +
      '<style>@keyframes btvSpin{to{transform:rotate(360deg)}}</style>';
    if (document.body) {
      document.body.appendChild(el);
    } else {
      document.addEventListener('DOMContentLoaded', function () {
        document.body.appendChild(el);
      });
    }
  }

  function hideOverlay() {
    const el = document.getElementById('btv-sync-overlay');
    if (el) el.remove();
  }

  // ---- Write interceptor: mirror saves to Supabase ----
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
          if (res.error) console.error('[BTV Sync] Save error for key:', key, res.error);
        });
    };
  }

  // ---- Realtime: receive changes from other users ----
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
          // Fire a storage event so apps that listen (linesheet does) can react.
          try {
            window.dispatchEvent(new StorageEvent('storage', { key, newValue: val }));
          } catch (e) {}
        }
      )
      .subscribe();
  }

  // ---- Main init ----
  async function init() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      // Not authenticated — just wire up the interceptor (writes will fail
      // with an RLS error until the user logs in, which is fine).
      setupWriteInterceptor();
      return;
    }
    _userId = session.user.id;

    sb.auth.onAuthStateChange(function (_, s) {
      _userId = s ? s.user.id : null;
    });

    if (sessionStorage.getItem(SYNC_FLAG)) {
      // Already pulled data this session — just set up the interceptor.
      setupWriteInterceptor();
      setupRealtime();
      return;
    }

    // First load this session: pull all data from Supabase.
    showOverlay();
    const { data, error } = await sb
      .from('app_state')
      .select('key, value')
      .in('key', SYNCED_KEYS);

    if (error) {
      console.error('[BTV Sync] Init pull error:', error);
      hideOverlay();
      setupWriteInterceptor();
      return;
    }

    (data || []).forEach(function (row) {
      const val =
        typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
      _origSetItem(row.key, val);
    });

    sessionStorage.setItem(SYNC_FLAG, '1');

    // Reload so the app initialises with the correct localStorage data.
    window.location.reload();
  }

  init();
})();
