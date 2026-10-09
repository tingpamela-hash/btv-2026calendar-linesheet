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

  // A stalled settings request must not prevent independent calendar tables loading.
  window.btvReadWithTimeout = async function(query,label){
    var timer,controller=new AbortController();
    if(query && typeof query.abortSignal==='function')query=query.abortSignal(controller.signal);
    try {
      return await Promise.race([query,new Promise(function(resolve){timer=setTimeout(function(){resolve({data:null,error:{message:label+' request timed out. Check your connection and retry.'}});controller.abort();},10000);})]);
    } catch(error){return {data:null,error:{message:label+': '+(error.message||'Request failed')}};}
    finally{clearTimeout(timer);}
  };

  if (!window.BTV_SUPABASE_CONFIG || !window.supabase) {
    console.warn('[BTV Sync] Config or SDK missing — sync disabled.');
    return;
  }

  const { url, anonKey } = window.BTV_SUPABASE_CONFIG;

  // Keys that are synced to Supabase
  const SYNCED_KEYS = [
    // 'calendar-2026-working-v5' (the live entries themselves) removed — they used
    // to be pushed as one whole-blob value on every save, so two people editing
    // different launches at the same moment could silently overwrite each other's
    // work. Now synced as individual rows in the calendar_entries table (one row
    // per entry) by the btvCalEntriesInit / btvCalEntriesTeardown module in
    // "input calendar-2026.html" — same fix already applied to linesheet_products
    // and global_cal_entries for the same reason. Its -history/-versions/-changelog
    // siblings below are unaffected (append-only logs, not live editable state).
    'calendar-2026-working-v5-history',
    'calendar-2026-working-v5-versions',
    'calendar-2026-working-v5-changelog',
    'calendar-2026-marketing-workflow-v1', // blob fallback kept for non-CC pages; CC page uses per-entry tables
    'calendar-2026-markdown-bars-v1',
    // 'calendar-2027-working-v5' (the live entries themselves) removed for the
    // same reason 'calendar-2026-working-v5' was above — input calendar-2027.html
    // was retired in favor of input calendar-2026.html's year-switcher, so 2027's
    // entries now sync per-row through calendar_entries (year=2027) too. Its
    // -history/-versions/-changelog siblings below are unaffected.
    'calendar-2027-working-v5-history',
    'calendar-2027-working-v5-versions',
    'calendar-2027-working-v5-changelog',
    'calendar-2027-marketing-workflow-v1',
    'calendar-2027-markdown-bars-v1',
    // creative-cal-2026-v1 removed — Global Calendar entries now live in the
    // global_cal_entries table (one row per entry) and are synced by the
    // btvCcEntriesInit / btvCcEntriesTeardown module in creative-calendar.html.
    // Keeping it here would cause the blob-level write interceptor to race
    // against the per-entry writes.
    'linesheetCalendarData',
    'launchListMaster',
    'btvLinesheetChangeLog',
    // btv_product_data removed — it is only READ in linesheet.html and never written,
    // so syncing it would push empty/undefined data on every reconnect. If this key
    // is written by a future module, add it back then.
    // btv_linesheet_products is deliberately NOT here — it's synced as individual
    // rows in its own linesheet_products table (see the per-row sync module in
    // linesheet.html), not as a whole-blob app_state key. Re-adding it here would
    // reintroduce the whole-list-overwrite race condition that module exists to fix.
    'btv-admin-config-v1',
  ];

  // Keys that trigger a UI re-render when changed remotely.
  const RENDER_KEYS = [
    // 'calendar-2026-working-v5' excluded — per-entry table now, see SYNCED_KEYS
    // comment. Its own Realtime subscription (calendar_entries) re-renders directly.
    'calendar-2026-markdown-bars-v1',
    'calendar-2026-marketing-workflow-v1',
    // 'calendar-2027-working-v5' excluded — per-entry table now, see SYNCED_KEYS comment.
    'calendar-2027-markdown-bars-v1',
    'calendar-2027-marketing-workflow-v1',
    'creative-cal-2026-v1',
    'linesheetCalendarData',
    'launchListMaster',
    'btvLinesheetChangeLog',
    // btv_product_data excluded — never written, see SYNCED_KEYS comment.
    // btv_linesheet_products excluded — per-row table, see SYNCED_KEYS comment.
    // creative-cal-2026-v1 excluded — per-entry tables, see SYNCED_KEYS comment.
    // btv-edit-locks-v1 removed entirely — it used calendar.html's own entry-id key
    // format from inside linesheet.html, so every field edit there forced a full
    // re-render + input lockout in every open Product Calendar Input tab. Linesheet's
    // real per-product lock is presence-based and scoped to its own product records.
  ];

  // Per-page blob-sync exclusions ─────────────────────────────────────────────
  // A page can declare window.BTV_SYNC_EXCLUDE (array of key strings) in an
  // inline <script> BEFORE this file loads to remove specific keys from the
  // generic app_state blob-sync path. Each iframe has its own window, so this
  // only affects the page that declares it.
  //
  // creative-calendar.html sets:
  //   window.BTV_SYNC_EXCLUDE = ['calendar-2026-marketing-workflow-v1']
  // because that page syncs marketing entries via the per-entry marketing_entries
  // table (btvMktUpsertEntries / btvMktDeleteEntries). Running the blob write
  // interceptor in parallel on that page caused two races:
  //   a) double-write: per-entry + blob upsert for the same save
  //   b) blob Realtime from another page overwrites marketingState in memory,
  //      causing the next diff to false-detect deletions of per-entry items.
  const _pageExcludes = new Set(
    Array.isArray(window.BTV_SYNC_EXCLUDE) ? window.BTV_SYNC_EXCLUDE : []
  );
  const _SYNCED_KEYS = SYNCED_KEYS.filter(function (k) { return !_pageExcludes.has(k); });
  const _RENDER_KEYS = RENDER_KEYS.filter(function (k) { return !_pageExcludes.has(k); });
  const isLegacyMarkdownKey = key => /^calendar-\d{4}-markdown-bars-v1$/.test(key);

  // Capture the real setItem before we intercept it
  const _origSetItem = localStorage.setItem.bind(localStorage);

  let _sb                   = null;  // authenticated Supabase client
  let _userId               = null;
  let _userEmail            = null;
  let _started              = false;
  let _interceptorInstalled = false;
  let _hasEverPulled        = false; // true after the first _pullLatest completes in this iframe
  let _realtimeChannel      = null;
  let _realtimeConnected    = false; // true only while the postgres_changes channel is SUBSCRIBED; gates the polling fallback below
  let _presenceIntervalId   = null;  // tracks the 3-second dispatch interval so it can be cleared on reconnect
  let _reconnectTimer       = null;  // debounces realtime reconnect attempts
  let _presenceReconnTimer  = null;  // debounces presence reconnect attempts
  let _rtSb                 = null;  // realtime Supabase client — stored so it can be cleaned up on reconnect
  let _presenceSb           = null;  // presence Supabase client — stored so it can be cleaned up on reconnect
  let _pollingIntervalId    = null;  // the 15s fallback-poll timer, so it can be stopped while paused
  let _liveActive           = false; // true while Realtime/Presence/polling are actually running

  // Tracks the last-known updated_at from Supabase for each key.
  // Used for version-conflict detection.
  const _lastPullTimes = {};

  // Tracks keys with locally-written changes that haven't yet been confirmed saved
  // to Supabase. While a key is in this set, applyRow and _pullLatest won't overwrite
  // local storage with remote data — our in-flight write is the authoritative version.
  // Cleared on successful upsert; stays set on write-failure so the user's data is
  // preserved locally until they retry.
  const _dirtyKeys = new Set();

  // ── Status bars ────────────────────────────────────────────────────────────
  // Persistent banners at the top of the iframe for sync health states.

  // pointer-events:none so this overlay never blocks clicks on whatever's underneath
  // it (every page's sticky top nav sits at the same top:0 as this bar) — any button
  // placed inside the bar's HTML (e.g. Retry Sync below) opts back in with its own
  // inline pointer-events:auto.
  const BAR_CSS = [
    'position:fixed;top:0;left:0;right:0;z-index:10000;pointer-events:none;',
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
      // Only push keys we KNOW have locally-unsaved changes (_dirtyKeys).
      // Pushing every synced key unconditionally risks overwriting a teammate's
      // newer save with our stale local copy of a key we didn't actually change.
      const rows = [..._dirtyKeys]
        .filter(function (k) { return _SYNCED_KEYS.includes(k) && !isLegacyMarkdownKey(k) && localStorage.getItem(k) !== null; })
        .map(function (key) {
          const raw = localStorage.getItem(key);
          let parsed; try { parsed = JSON.parse(raw); } catch (e) { parsed = raw; }
          return { key, value: parsed, updated_at: new Date().toISOString(), updated_by: _userId };
        });
      if (!rows.length) {
        _showBar('btv-online-bar', '✓ Back online.', '#dcfce7', '#166534');
        setTimeout(function () { _hideBar('btv-online-bar'); }, 4000);
        return;
      }
      const { error } = await _sb.from('app_state').upsert(rows, { onConflict: 'key' });
      if (!error) {
        rows.forEach(function (r) {
          _lastPullTimes[r.key] = r.updated_at;
          _dirtyKeys.delete(r.key); // confirmed saved
        });
        // Now pull to pick up any changes teammates made while we were offline.
        // (Realtime is not available offline, so we may have missed live updates.)
        await _pullLatest();
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
      'style="pointer-events:auto;background:#ef4444;color:#fff;border:none;border-radius:5px;' +
      'padding:3px 10px;font-size:11px;cursor:pointer;font-weight:700">Retry Sync</button>' +
      '<button onclick="document.getElementById(\'btv-write-fail-bar\').style.display=\'none\'" ' +
      'style="pointer-events:auto;background:none;border:1px solid #b91c1c;border-radius:5px;' +
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
      // Race against a timeout — a stalled request (dead connection, no error,
      // just never resolves) used to leave the caller's await stuck forever,
      // which for a Save button meant "Saving…" never cleared and the form
      // could never be submitted again. Treat a stall the same as a network
      // error: no conflict, let the save proceed.
      const { data } = await Promise.race([
        _sb.from('app_state').select('updated_at, updated_by').eq('key', key).single(),
        new Promise(resolve => setTimeout(() => resolve({ data: null }), 6000))
      ]);
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

    // Guard: if we have a locally-pending write for this key, our version is newer.
    // Don't let the incoming remote value (which may not yet include our change)
    // overwrite local storage — our in-flight or pending-retry write will win.
    if (_dirtyKeys.has(key)) {
      console.warn('[BTV Sync] applyRow: skipping remote overwrite of dirty key:', key,
        '— local has unsaved changes; in-flight write takes precedence.');
      return;
    }

    _origSetItem(key, val);
    if (!_RENDER_KEYS.includes(key)) return;
    // Only re-render and toast for changes from someone else.
    const isOtherUser = fromUserId && fromUserId !== _userId;
    if (!isOtherUser) return;
    try {
      if (typeof window.btvReloadAndRender === 'function') window.btvReloadAndRender();
      else if (typeof window._btvCalRender === 'function') window._btvCalRender();
    } catch (e) {
      console.error('[BTV Sync] applyRow: btvReloadAndRender threw on remote update for key:', key, e);
    }
    showToast('Calendar updated by another team member');
  }

  // ── Write interceptor — mirrors localStorage writes to Supabase ────────────
  // Errors like "Timed out acquiring connection from connection pool" are usually
  // momentary (the pool frees up within a second or two under concurrent load from
  // multiple team members' open tabs) — retry a couple of times with backoff before
  // surfacing the write-fail bar, instead of failing on the very first hiccup.
  const _WRITE_RETRY_DELAYS_MS = [1000, 3000];

  function _upsertAppState(key, parsed, now, attempt) {
    return _sb.from('app_state')
      .upsert(
        { key, value: parsed, updated_at: now, updated_by: _userId },
        { onConflict: 'key' }
      )
      .then(function (res) {
        if (res.error) throw res.error;
        _lastPullTimes[key] = now; // our own save — update baseline
        _dirtyKeys.delete(key);   // confirmed saved — remote may now overwrite safely
        _hideBar('btv-write-fail-bar'); // clear any previous failure
      })
      .catch(function (err) {
        if (attempt < _WRITE_RETRY_DELAYS_MS.length) {
          console.warn('[BTV Sync] Write failed (attempt ' + (attempt + 1) + '), retrying:', key, err.message || err);
          return new Promise(function (resolve) {
            setTimeout(resolve, _WRITE_RETRY_DELAYS_MS[attempt]);
          }).then(function () { return _upsertAppState(key, parsed, now, attempt + 1); });
        }
        console.error('[BTV Sync] Write failed after retries:', key, err.message || err);
        _showWriteFailure(key, err.message || 'Network error');
      });
  }

  // A single save action (e.g. saving a product with many variants) can call
  // localStorage.setItem for the SAME key (like btvLinesheetChangeLog) dozens of
  // times in one synchronous pass. Firing an immediate Supabase upsert for every
  // one of those was enough on its own to blow past the browser's per-origin
  // connection limit (net::ERR_INSUFFICIENT_RESOURCES / "Failed to fetch" spam).
  // Debounce per key so a burst of writes collapses into a single upsert
  // carrying the latest value, and chain onto any still-in-flight upsert for
  // that key so writes can't complete out of order.
  const WRITE_DEBOUNCE_MS = 400;
  const _pendingWrites = {}; // key -> { parsed, timer }
  const _inFlight       = {}; // key -> Promise

  function _flushWrite(key) {
    const pending = _pendingWrites[key];
    if (!pending) return;
    delete _pendingWrites[key];
    const prior = _inFlight[key] || Promise.resolve();
    const run = prior.then(function () {
      const now = new Date().toISOString();
      return _upsertAppState(key, pending.parsed, now, 0);
    });
    _inFlight[key] = run.then(function () {
      if (_inFlight[key] === run) delete _inFlight[key];
    });
  }

  function _scheduleWrite(key, parsed) {
    const existing = _pendingWrites[key];
    if (existing) clearTimeout(existing.timer);
    _pendingWrites[key] = {
      parsed: parsed,
      timer: setTimeout(function () { _flushWrite(key); }, WRITE_DEBOUNCE_MS),
    };
  }

  // Best-effort: push any still-pending debounced writes immediately when the
  // tab is hidden/closed, so a save made right before a tab switch isn't lost.
  window.addEventListener('pagehide', function () {
    Object.keys(_pendingWrites).forEach(function (key) {
      clearTimeout(_pendingWrites[key].timer);
      _flushWrite(key);
    });
  });

  function setupWriteInterceptor() {
    if (_interceptorInstalled) return;
    _interceptorInstalled = true;
    localStorage.setItem = function (key, value) {
      _origSetItem(key, value);
      if (!_SYNCED_KEYS.includes(key) || isLegacyMarkdownKey(key) || !_sb) return;
      // Mark dirty immediately — even if offline — so that applyRow / _pullLatest
      // won't overwrite local storage with a stale remote value while our write is pending.
      _dirtyKeys.add(key);
      if (!navigator.onLine) return; // will be pushed to Supabase when _onOnline fires
      let parsed;
      try { parsed = JSON.parse(value); } catch (e) { parsed = value; }
      _scheduleWrite(key, parsed);
    };
  }

  // ── Realtime subscription ─────────────────────────────────────────────────
  // Each iframe uses its own Realtime client. The authenticated query client is
  // shared by the parent, but sharing a Realtime channel across iframes means
  // only one iframe receives immediate callbacks; the other can lag until polling.

  async function setupRealtime() {
    if (_realtimeChannel) return;
    // Clean up the previous (dead) client before creating a new one to avoid
    // accumulating orphaned WebSocket connections on repeated reconnects.
    if (_rtSb) { try { _rtSb.removeAllChannels(); } catch(e) {} _rtSb = null; }
    // autoRefreshToken: true so the access token is refreshed automatically before
    // expiry (~1 hour). Without this the channel silently disconnects after an hour
    // and remote updates stop arriving.
    _rtSb = window.supabase.createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: true },
    });
    var rtSb = _rtSb;
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
          if (!_SYNCED_KEYS.includes(key)) return;
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
          _realtimeConnected = true;
          if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          // Channel dropped — schedule a reconnect. Clear the reference first so
          // setupRealtime() is willing to run again.
          console.warn('[BTV Sync] Realtime channel lost (' + status + ') — will reconnect in 8 s');
          _realtimeConnected = false;
          _realtimeChannel = null;
          if (!_reconnectTimer) {
            _reconnectTimer = setTimeout(function () {
              _reconnectTimer = null;
              setupRealtime();
            }, 8000);
          }
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
    // autoRefreshToken: true prevents the channel from silently dying after ~1 hour.
    // Clean up any previous (dead) client first.
    if (_presenceSb) { try { _presenceSb.removeAllChannels(); } catch(e) {} _presenceSb = null; }
    _presenceSb = window.supabase.createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: true },
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
          // Clear any previous interval before starting a new one (guards against
          // duplicate intervals if the channel is reconnected).
          if (_presenceIntervalId) clearInterval(_presenceIntervalId);
          var _heartbeatTick = 0;
          _presenceIntervalId = setInterval(function () {
            _dispatchPresence();
            _heartbeatTick++;
            // Re-track only every 10 ticks (30 s) to refresh the ts timestamp without
            // flooding Supabase with presence messages. The ts is what the stale-lock
            // checker in calendar.html reads to know whether a lock is still live.
            if (_heartbeatTick % 10 === 0 && _presenceChannel && _userEmail) {
              try {
                var _curState = _presenceChannel.presenceState();
                var _myPresence = (_curState[_userId] || [])[0] || {};
                _presenceChannel.track({
                  email: _userEmail,
                  item:  _myPresence.item  || null,
                  field: _myPresence.field || null,
                  ts:    Date.now(),
                });
              } catch (e) {}
            }
          }, 3000);
          if (_presenceReconnTimer) { clearTimeout(_presenceReconnTimer); _presenceReconnTimer = null; }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.warn('[BTV Sync] Presence channel lost (' + status + ') — will reconnect in 8 s');
          // Stop the stale dispatch interval while the channel is dead.
          if (_presenceIntervalId) { clearInterval(_presenceIntervalId); _presenceIntervalId = null; }
          _presenceChannel = null;
          if (!_presenceReconnTimer) {
            _presenceReconnTimer = setTimeout(function () {
              _presenceReconnTimer = null;
              setupPresence();
            }, 8000);
          }
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
        // ts must be included so that _btvCalGetLockHolder can detect stale locks.
        const merged = { email: null, item: null, field: null, launchItem: null, ts: null };
        presences.forEach(function (p) {
          if (p.email) merged.email = p.email;
          if (p.item) merged.item = p.item;
          if (p.field) merged.field = p.field;
          if (p.launchItem) merged.launchItem = p.launchItem;
          // Keep the most-recent ts across multiple presence records for this user.
          if (p.ts && (!merged.ts || Number(p.ts) > Number(merged.ts))) merged.ts = p.ts;
        });
        if (merged.email) users.push(merged);
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
  // Realtime (setupRealtime, above) is the source of live updates. This poll
  // used to run unconditionally in parallel — a duplicate read of the same
  // rows Realtime already pushes — which was a major contributor to Supabase
  // Disk IO usage. It now only queries when Realtime is actually disconnected,
  // acting purely as a safety net until the reconnect logic above restores it.

  function setupPolling() {
    if (_pollingIntervalId) return;
    _pollingIntervalId = setInterval(async function () {
      if (!_sb || _realtimeConnected) return;
      try {
        const { data } = await _sb
          .from('app_state')
          .select('key, value, updated_by, updated_at')
          .in('key', _RENDER_KEYS);
        if (!data) return;
        data.forEach(function (row) {
          const val =
            typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
          applyRow(row.key, val, row.updated_by, row.updated_at);
        });
      } catch (e) {
        console.warn('[BTV Sync] Polling fallback error:', e.message || e);
      }
    }, 15000);
  }

  // ── btvSyncStart ──────────────────────────────────────────────────────────

  // One-time (or catch-up-on-resume) fetch of every synced key from Supabase into
  // localStorage. Returns false on a hard error (caller should bail out).
  async function _pullLatest() {
    console.log('[BTV Sync] Pulling latest state from cloud…');
    const { data, error } = await window.btvReadWithTimeout(_sb
      .from('app_state')
      .select('key, value, updated_at')
      .in('key', _SYNCED_KEYS),'Shared settings');

    if (error) {
      console.error('[BTV Sync] Pull error:', error.message);
      if (error.message.includes('does not exist') || error.code === '42P01') {
        showError(
          'Supabase <strong>app_state</strong> table not found. ' +
          'Run <strong>supabase-setup.sql</strong> in your Supabase SQL Editor.'
        );
      } else {
        // Show a visible warning so users know they may be looking at stale data.
        // Include a Refresh button so they can retry without hunting for the browser refresh.
        _showBar(
          'btv-pull-fail-bar',
          '⚠ <span><strong>Could not load latest data</strong> — you may be seeing a stale version. ' +
          error.message + '</span>' +
          '<button onclick="location.reload()" ' +
          'style="pointer-events:auto;background:#1e3a5f;color:#fff;border:none;border-radius:5px;' +
          'padding:3px 10px;font-size:11px;cursor:pointer;font-weight:700">Refresh</button>' +
          '<button onclick="document.getElementById(\'btv-pull-fail-bar\').style.display=\'none\'" ' +
          'style="pointer-events:auto;background:none;border:1px solid #1e3a5f;border-radius:5px;' +
          'padding:3px 8px;font-size:11px;cursor:pointer;color:#1e3a5f">Dismiss</button>',
          '#e0edff', '#1e3a5f'
        );
      }
      return false;
    }

    if (data && data.length > 0) {
      let changed = false;
      data.forEach(function (row) {
        if (row.updated_at) _lastPullTimes[row.key] = row.updated_at;

        // Guard: if local has an unsaved pending write for this key, our version is
        // newer than what Supabase is returning (or Supabase may not have it yet).
        // Skip the overwrite — our in-flight / retry write will push local → remote.
        if (_dirtyKeys.has(row.key)) {
          console.log('[BTV Sync] _pullLatest: skipping dirty key:', row.key);
          return;
        }

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
        } catch (e) {
          console.error('[BTV Sync] btvReloadAndRender error after pull:', e);
        }
      } else {
        console.log('[BTV Sync] Local state already up to date.');
      }
    } else {
      // Supabase is empty — push local data up as first migration
      console.log('[BTV Sync] Supabase empty — pushing local data up…');
      const rows = _SYNCED_KEYS
        .filter(function (k) { return !isLegacyMarkdownKey(k) && localStorage.getItem(k) !== null; })
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
    return true;
  }

  // Only one of the app's four pages (Calendar 2026/2027, Global Calendar, Linesheet) is
  // ever visible at a time — the other three sit hidden (display:none) in their iframes for
  // the whole session. Previously all four kept a live Realtime channel, a Presence channel
  // and a 15s poll running regardless, which was a major contributor to Supabase Disk IO
  // usage. _goLive/_goPaused let the parent frame (index.html) start live sync ONLY for the
  // currently-visible page and pause it for the other three, resuming on tab switch.
  async function _goLive() {
    if (_liveActive || !_sb) return;
    _liveActive = true;
    // Every page renders once from whatever is already in localStorage before
    // btvSyncStart is called — on a new device or after another user has made
    // changes this "first render" is stale/empty. _pullLatest below fetches the
    // authoritative data from Supabase and re-renders, but without a visual guard
    // the stale content is briefly visible.
    //
    // On the FIRST _goLive call in this iframe (initial load or first tab switch),
    // cover the page with a full-screen overlay so users never see the stale render.
    // On subsequent calls (later tab switches) the data is likely only seconds old,
    // so we use the lighter loading-bar instead.
    var _isFirstPull = !_hasEverPulled;
    if (_isFirstPull && document.body) {
      var _ov = document.createElement('div');
      _ov.id = 'btv-pull-overlay';
      _ov.style.cssText = [
        'position:fixed;inset:0;z-index:9998;background:#f7f6f3;',
        'display:flex;align-items:center;justify-content:center;',
        'flex-direction:column;gap:14px;',
        // pointer-events intentionally left at default (auto) so the overlay
        // blocks all clicks while the pull is in flight — prevents users from
        // interacting with stale content during the 8-second safety window.
      ].join('');
      _ov.innerHTML = [
        '<div style="font-size:10px;font-weight:800;letter-spacing:.24em;',
          'text-transform:uppercase;color:#333;',
          "font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;\">BTV PLANNER</div>",
        '<div style="width:28px;height:28px;border:2.5px solid #e0ddd8;',
          'border-top-color:#333;border-radius:50%;',
          'animation:_btvOvSpin .7s linear infinite;"></div>',
        '<style>@keyframes _btvOvSpin{to{transform:rotate(360deg)}}</style>',
      ].join('');
      document.body.appendChild(_ov);
      // Safety net — remove overlay after 8 s even if _pullLatest never resolves
      setTimeout(function () {
        var el = document.getElementById('btv-pull-overlay');
        if (el) el.remove();
      }, 8000);
    } else {
      _showBar('btv-loading-bar', '⏳ <span>Loading latest data…</span>', '#e0edff', '#1e3a5f');
    }

    let pulled;
    try {
      pulled = await _pullLatest(); // catch up on anything missed while paused
    } catch (error) {
      pulled = false;
      console.warn('[BTV Sync] Shared settings unavailable:', error);
      showError('Could not load shared settings. Calendar and product sync will still be attempted. Check your connection and reload.');
    } finally {
      _hasEverPulled = true;
      _hideBar('btv-loading-bar');
      var _ovEl = document.getElementById('btv-pull-overlay');
      if (_ovEl) _ovEl.remove();
    }
    // If _goPaused was called while _pullLatest was in flight (e.g. user switched tabs
    // during the initial load), abort — don't set up Realtime/Presence/Polling on a
    // hidden tab. The connections will be started when the user switches back.
    if (!_liveActive) return;
    // Per-row tables are independent of app_state and presence availability.
    // Let creative-calendar.html initialize its per-entry sync (global_cal_entries +
    // marketing_entries tables). Only runs on that page — other pages don't define it.
    if (typeof window.btvCcEntriesInit === 'function') {
      await window.btvCcEntriesInit(_session);
    }
    // Same for the Product Calendar Input's own entries (calendar_entries table) —
    // only defined on that page. See the per-entry sync module in
    // "input calendar-2026.html". The 'calendar-2026-working-v5' blob key has been
    // removed from SYNCED_KEYS above (see comment there) now that the live entries
    // sync per-row instead; only its -history/-versions/-changelog siblings still
    // go through the generic whole-blob path.
    if (typeof window.btvCalEntriesInit === 'function') {
      await window.btvCalEntriesInit(_session);
    }
    if (typeof window.btvMarkdownInit === 'function') {
      try { await window.btvMarkdownInit(); } catch(error) { console.warn('[BTV Markdown] Startup failed:',error.message); }
    }
    // Linesheet products are synced as individual rows (not through the generic
    // whole-blob app_state path above) — see the per-row sync module in linesheet.html.
    if (typeof window.btvLsProductsInit === 'function') {
      await window.btvLsProductsInit(_session);
    }
    if (typeof window.btvLsPresenceInit === 'function') {
      try { await window.btvLsPresenceInit(_session); }
      catch (error) { console.warn('[BTV Sync] Product presence unavailable:', error); }
    }
    if (!_liveActive) return;
    if (pulled) {
      try { await setupRealtime(); }
      catch(error) { console.warn('[BTV Sync] Realtime unavailable; using polling:',error); }
      setupPolling();
    }
    try { await setupPresence(); } catch (error) { console.warn('[BTV Sync] Presence unavailable:', error); }
    console.log('[BTV Sync] Live sync active.');

    // Tell index.html this frame's initial data load is actually done — it keeps
    // its boot/loading overlay up until the frame the user is about to see
    // reports in here, instead of removing it the instant sync merely *started*
    // (which used to let people land on a page still catching up with Supabase).
    try {
      var _frameId = window.frameElement && window.frameElement.id;
      if (_frameId && window.parent && window.parent !== window &&
          typeof window.parent.btvFrameDataReady === 'function') {
        window.parent.btvFrameDataReady(_frameId);
      }
    } catch (e) {}
  }

  function _goPaused() {
    if (!_liveActive) return;
    _liveActive = false;
    if (_realtimeChannel) { try { _realtimeChannel.unsubscribe(); } catch (e) {} _realtimeChannel = null; }
    if (_rtSb) { try { _rtSb.removeAllChannels(); } catch (e) {} _rtSb = null; }
    _realtimeConnected = false;
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
    if (_presenceChannel) { try { _presenceChannel.untrack(); _presenceChannel.unsubscribe(); } catch (e) {} _presenceChannel = null; }
    if (_presenceSb) { try { _presenceSb.removeAllChannels(); } catch (e) {} _presenceSb = null; }
    if (_presenceIntervalId) { clearInterval(_presenceIntervalId); _presenceIntervalId = null; }
    if (_presenceReconnTimer) { clearTimeout(_presenceReconnTimer); _presenceReconnTimer = null; }
    if (_pollingIntervalId) { clearInterval(_pollingIntervalId); _pollingIntervalId = null; }
    // Tear down the Global Calendar's per-entry Realtime channels when hidden.
    if (typeof window.btvCcEntriesTeardown === 'function') window.btvCcEntriesTeardown();
    // Same for the Product Calendar Input's own per-entry channel.
    if (typeof window.btvCalEntriesTeardown === 'function') window.btvCalEntriesTeardown();
    if (typeof window.btvMarkdownTeardown === 'function') window.btvMarkdownTeardown();
    // Linesheet runs its own separate presence channel (see comment in setupPresence) —
    // tear it down too, otherwise a backgrounded Linesheet tab would keep it alive.
    if (typeof window.btvLsPresenceTeardown === 'function') window.btvLsPresenceTeardown();
    if (typeof window.btvLsProductsTeardown === 'function') window.btvLsProductsTeardown();
    console.log('[BTV Sync] Live sync paused (background tab).');
  }

  // Called by index.html when this page's iframe is hidden/shown.
  window.btvSyncPause  = function () { _goPaused(); };
  window.btvSyncResume = async function () { if (_started) await _goLive(); };

  window.btvSyncStart = async function (session, parentSb, canEdit, startLive) {
    // Store edit permission before anything else; default true for back-compat
    window._btvCanEdit = (canEdit !== false);
    if (_started) {
      // A different user in the same tab must never inherit this one's
      // _userId/_session/_dirtyKeys (wrong updated_by, conflict check disabled,
      // stale blobs pushed). index.html reloads on sign-out and on a second
      // sign-in; this is the backstop if anything else ever gets here.
      if (session && session.user && session.user.id !== _userId) {
        console.warn('[BTV Sync] Different user in the same tab — reloading.');
        try { window.top.location.reload(); } catch (e) { location.reload(); }
        return;
      }
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
    // Expose Supabase client and user email for other modules (e.g. public calendar)
    window._btvSb = _sb;
    window._btvSyncEmail = _userEmail;

    setupWriteInterceptor();

    // startLive defaults to true for back-compat with any caller that doesn't pass it.
    // index.html passes false for the three pages that aren't the initially-shown one.
    if (startLive === false) {
      console.log('[BTV Sync] Started in background (paused) — will go live when this tab is shown.');
      return;
    }
    await _goLive();
    console.log('[BTV Sync] Live sync ready.');
  };

  // ── Helpers exposed to parent frame / console ──────────────────────────────

  window.btvGetCurrentEmail  = function () { return _userEmail; };
  window.btvGetCurrentActor = function () {
    var user=_session && _session.user, metadata=user && user.user_metadata || {};
    var email=user && user.email || _userEmail || '';
    return {id:user && user.id || _userId || '',email:email,name:metadata.full_name || metadata.name || email.split('@')[0] || 'Unknown user'};
  };
  window.btvSyncIsActive     = function () { return _started; };
  window.btvSyncDirtyCount   = function () { return _dirtyKeys.size; };

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
    // Only push keys that have locally-unsaved changes (_dirtyKeys).
    // Pushing every synced key risks overwriting a teammate's newer save with a stale
    // local copy of a key this user didn't actually change (e.g., clicking "Retry Sync"
    // after a linesheet write failure would otherwise also push a stale calendar blob).
    const dirtyToSync = [..._dirtyKeys].filter(function (k) {
      return _SYNCED_KEYS.includes(k) && !isLegacyMarkdownKey(k) && localStorage.getItem(k) !== null;
    });
    if (!dirtyToSync.length) {
      showToast('Nothing to sync — all local changes are already saved.');
      _hideBar('btv-write-fail-bar');
      return;
    }
    const rows = dirtyToSync.map(function (key) {
      const raw = localStorage.getItem(key);
      let parsed; try { parsed = JSON.parse(raw); } catch (e) { parsed = raw; }
      const now = new Date().toISOString();
      return { key, value: parsed, updated_at: now, updated_by: _userId };
    });
    const { error } = await _sb.from('app_state').upsert(rows, { onConflict: 'key' });
    if (error) {
      console.error('[BTV Sync] Force-push error:', error.message);
      _showWriteFailure('force-sync', error.message);
      return;
    }
    rows.forEach(function (r) {
      _lastPullTimes[r.key] = r.updated_at;
      _dirtyKeys.delete(r.key); // confirmed saved
    });
    _hideBar('btv-write-fail-bar');
    console.log('[BTV Sync] Force-pushed', rows.length, 'key(s):', dirtyToSync.join(', '));
    showToast('Sync complete — ' + rows.length + ' change(s) pushed to Supabase.');
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
  window.btvWriteChangeLog = async function(entries){
    if(!_sb || !_userId || !entries || !entries.length)return false;
    try {
      var result=await _sb.from('change_log').insert(entries.map(function(entry){return {key:(entry.action==='markdown'?'markdown:':'linesheet:')+entry.productName,label:JSON.stringify(entry),changed_by:_userId,email:_userEmail,changed_at:new Date(entry.ts).toISOString()};}));
      if(result.error)throw result.error;
      return true;
    } catch(error){console.warn('[BTV Sync] Detailed audit log was not written:',error.message);return false;}
  };

})();
