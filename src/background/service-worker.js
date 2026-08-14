/**
 * service-worker.js — Extension service worker (background script)
 * 
 * This is the ONLY component that holds the JWT and makes API calls.
 * The dashboard and popup request data via chrome.runtime.sendMessage()
 * and receive normalized data back — they never see the token.
 * 
 * Architecture:
 *   Content Script → AUTH_CONTEXT → Service Worker (stores token in session)
 *   Dashboard/Popup → REQUEST_DATA → Service Worker → CORE API → normalized response
 */

// Import modules (service worker has access to these via importScripts equivalent)
// In MV3 with type:module, we use self/globalThis
importScripts(
  '../api/api.js',
  '../data/normalizers.js',
  '../utils/calculations.js',
  '../utils/storage.js'
);

// ============================================================
// Event Listeners (all registered synchronously at top level)
// ============================================================

// Handle messages from content script, popup, and dashboard
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => {
    sendResponse({ error: err.message || 'Unknown error' });
  });
  return true; // Keep channel open for async response
});

// Enforce retention policy on install/update
chrome.runtime.onInstalled.addListener(async () => {
  await Storage.enforceRetention();
});

// Also enforce on startup
chrome.runtime.onStartup?.addListener?.(async () => {
  await Storage.enforceRetention();
});

// ============================================================
// Message Handler
// ============================================================

async function handleMessage(message, sender) {
  const { type } = message;

  switch (type) {
    case 'AUTH_CONTEXT':
      return handleAuthContext(message.payload);

    case 'AUTH_MISSING':
      await Storage.clearAuthContext();
      return { success: true, status: 'no_auth' };

    case 'AUTH_ERROR':
      return { success: false, error: 'Failed to extract authentication from portal' };

    case 'PORTAL_DETECTED':
      return { success: true, status: 'portal_detected' };

    case 'GET_DASHBOARD_DATA':
      return handleGetDashboardData(message.payload);

    case 'GET_DAILY_CONSUMPTION':
      return handleGetDailyConsumption(message.payload);

    case 'GET_ENERGY_GRAPH':
      return handleGetEnergyGraph(message.payload);

    case 'GET_METER_INFO':
      return handleGetMeterInfo();

    case 'GET_CONSUMER_INFO':
      return handleGetConsumerInfo(message.payload);

    case 'GET_RECHARGE_HISTORY':
      return handleGetRechargeHistory();

    case 'GET_POPUP_DATA':
      return handleGetPopupData();

    case 'REFRESH_DATA':
      return handleRefreshData();

    case 'CHECK_AUTH':
      return handleCheckAuth();

    default:
      return { error: `Unknown message type: ${type}` };
  }
}

// ============================================================
// Auth Handler
// ============================================================

async function handleAuthContext(payload) {
  if (!payload || !payload.token) {
    return { success: false, error: 'No token provided' };
  }

  await Storage.setAuthContext(payload);
  return { success: true, status: 'authenticated' };
}

async function handleCheckAuth() {
  const ctx = await Storage.getAuthContext();
  if (ctx && ctx.token) {
    return { authenticated: true, scNo: ctx.scNo || '' };
  }
  return { authenticated: false };
}

// ============================================================
// Data Handlers — ALL API calls happen here
// ============================================================

/**
 * Get comprehensive dashboard data.
 * This is the main data endpoint for the dashboard.
 */
async function handleGetDashboardData(payload = {}) {
  const ctx = await requireAuth();
  const now = new Date();
  const year = payload?.year || now.getFullYear();
  const month = payload?.month || String(now.getMonth() + 1).padStart(2, '0');

  const cacheKey = `dashboard_${ctx.scNo}_${year}_${month}`;
  const cached = await Storage.getCachedData(cacheKey);
  if (cached && !payload?.forceRefresh) {
    return { success: true, data: cached, fromCache: true };
  }

  // 1. Fetch assigned_info first to extract site_id (required for consumer_level_detail)
  let assignedData = null;
  try {
    const assignedRes = await CoreAPI.fetchAssignedInfo(ctx);
    assignedData = Array.isArray(assignedRes?.data) ? assignedRes.data[0] : assignedRes?.data;
    if (assignedData && assignedData.site_id) {
      ctx.siteId = assignedData.site_id;
      console.log('[SmartMeter DEBUG] Successfully extracted site_id from assigned_info:', ctx.siteId);
    }
  } catch (err) {
    console.error('[SmartMeter DEBUG] Failed to fetch assigned_info for site_id:', err.message);
  }

  // 2. Setup dates for daily consumption (fetch last 45 days to cover month & week stats)
  const endDateObj = new Date(now);
  const startDateObj = new Date(now);
  startDateObj.setDate(startDateObj.getDate() - 45);
  const startDate = startDateObj.toISOString().split('T')[0];
  const endDate = endDateObj.toISOString().split('T')[0];

  // 3. Fetch rest of data in parallel
  const [consumerInfoRes, dailyRes, energyGraphRes, meterDetailRes] = await Promise.allSettled([
    ctx.siteId ? CoreAPI.fetchConsumerInfo(ctx, year, month) : Promise.reject(new Error('Missing site_id')),
    CoreAPI.fetchAllDailyConsumption(ctx, startDate, endDate),
    CoreAPI.fetchEnergyGraphData(ctx, year, month),
    CoreAPI.fetchMeterDetail(ctx)
  ]);

  // DEBUG: Log raw API responses to diagnose money/tariff issues
  if (consumerInfoRes.status === 'fulfilled') {
    console.log('[SmartMeter DEBUG] Raw consumer_level_detail response:', JSON.stringify(consumerInfoRes.value).substring(0, 3000));
  } else {
    console.error('[SmartMeter DEBUG] consumer_level_detail FAILED:', consumerInfoRes.reason?.message);
  }
  if (dailyRes.status === 'fulfilled') {
    const sample = Array.isArray(dailyRes.value) ? dailyRes.value[0] : dailyRes.value;
    console.log('[SmartMeter DEBUG] Raw daily consumption sample:', JSON.stringify(sample).substring(0, 1500));
    if (Array.isArray(dailyRes.value) && dailyRes.value.length > 0) {
      console.log('[SmartMeter DEBUG] Daily consumption field names:', Object.keys(dailyRes.value[0]));
    }
  } else {
    console.error('[SmartMeter DEBUG] daily consumption FAILED:', dailyRes.reason?.message);
  }
  if (energyGraphRes.status === 'fulfilled') {
    console.log('[SmartMeter DEBUG] Raw energy_graph response keys:', JSON.stringify(Object.keys(energyGraphRes.value || {})));
    const egData = energyGraphRes.value?.data?.[0];
    if (egData) {
      console.log('[SmartMeter DEBUG] energy_graph data[0] keys:', Object.keys(egData));
      // Log all scalar fields that might contain tariff/wallet
      const scalars = {};
      for (const [k, v] of Object.entries(egData)) {
        if (typeof v !== 'object' || v === null) scalars[k] = v;
      }
      console.log('[SmartMeter DEBUG] energy_graph scalar fields:', JSON.stringify(scalars));
    }
  }
  if (meterDetailRes.status === 'fulfilled') {
    console.log('[SmartMeter DEBUG] meter_detail response:', JSON.stringify(meterDetailRes.value).substring(0, 2000));
  }

  // Helper for parsing currency strings
  const parseCurrencyNum = (val) => {
    if (val == null) return 0;
    return parseFloat(String(val).replace(/[^0-9.-]+/g, "")) || 0;
  };

  // Normalize consumer info
  let meterInfo = null;
  if (consumerInfoRes.status === 'fulfilled' && consumerInfoRes.value?.data) {
    const rawData = consumerInfoRes.value.data;
    const data = Array.isArray(rawData) ? rawData[0] : rawData;
    if (data) {
      meterInfo = Normalizers.normalizeConsumerInfo(data);
      console.log('[SmartMeter DEBUG] Normalized meterInfo — wallet:', meterInfo.walletBalance, '| tariff:', meterInfo.tariff);
    }
  }

  // ============================================================
  // FALLBACK TARIFF/WALLET EXTRACTION
  // If consumer_level_detail failed or yielded 0, try alternatives
  // ============================================================

  // Ensure meterInfo exists even if consumer_level_detail failed entirely
  if (!meterInfo) {
    meterInfo = { scNo: ctx.scNo, tariff: 0, walletBalance: 0, projectName: '', verticalName: '', ldp: '', liveStatus: 0, isDualSource: false, meterAddress: '' };
  }

  // Fallback 1: Extract tariff/wallet from energy graph response
  if (!meterInfo.tariff && (energyGraphRes.status === 'fulfilled')) {
    const egResp = energyGraphRes.value;
    // Check response root level
    let ft = parseCurrencyNum(egResp?.eb_price ?? egResp?.tariff ?? egResp?.price_per_unit);
    // Check inside data[0]
    if (!ft && egResp?.data?.[0]) {
      const gd = egResp.data[0];
      ft = parseCurrencyNum(gd.eb_price ?? gd.tariff ?? gd.price_per_unit ?? gd.rate);
      if (!ft && gd.tariff_info) {
        ft = parseCurrencyNum(gd.tariff_info.eb_price ?? gd.tariff_info.price ?? gd.tariff_info.rate);
      }
    }
    if (ft > 0) {
      meterInfo.tariff = ft;
      console.log('[SmartMeter DEBUG] Tariff found in energy_graph response:', ft);
    }
    // Also check wallet
    const fw = parseCurrencyNum(egResp?.wallet_balance ?? egResp?.balance ?? egResp?.data?.[0]?.wallet_balance);
    if (fw > 0 && !meterInfo.walletBalance) {
      meterInfo.walletBalance = fw;
      console.log('[SmartMeter DEBUG] Wallet found in energy_graph response:', fw);
    }
  }

  // Fallback 2: Extract tariff from meter_detail response
  if (!meterInfo.tariff && (meterDetailRes.status === 'fulfilled')) {
    const mdResp = meterDetailRes.value;
    const mdData = Array.isArray(mdResp?.data) ? mdResp.data[0] : mdResp?.data;
    if (mdData) {
      const ft = parseCurrencyNum(mdData.eb_price ?? mdData.tariff ?? mdData.price_per_unit ?? mdData.rate);
      if (ft > 0) {
        meterInfo.tariff = ft;
        console.log('[SmartMeter DEBUG] Tariff found in meter_detail:', ft);
      }
    }
    // Also check response root
    const rootTariff = parseCurrencyNum(mdResp?.eb_price ?? mdResp?.tariff);
    if (rootTariff > 0 && !meterInfo.tariff) {
      meterInfo.tariff = rootTariff;
      console.log('[SmartMeter DEBUG] Tariff found at meter_detail root:', rootTariff);
    }
  }

  // Fallback 3: Try assigned_info endpoint (we already fetched it earlier!)
  if (!meterInfo.tariff || !meterInfo.walletBalance) {
    if (assignedData) {
      if (!meterInfo.tariff) {
        const ft = parseCurrencyNum(assignedData.eb_price ?? assignedData.tariff ?? assignedData.price_per_unit ?? assignedData.unit_price ?? assignedData.rate);
        if (ft > 0) {
          meterInfo.tariff = ft;
          console.log('[SmartMeter DEBUG] Tariff found via assigned_info:', ft);
        }
      }
      if (!meterInfo.walletBalance) {
        const fw = parseCurrencyNum(assignedData.wallet_balance ?? assignedData.balance ?? assignedData.remaining_balance ?? assignedData.balance_amount);
        if (fw > 0) {
          meterInfo.walletBalance = fw;
          console.log('[SmartMeter DEBUG] Wallet found via assigned_info:', fw);
        }
      }
    } else {
      console.log('[SmartMeter DEBUG] assigned_info data not available for fallback.');
    }
  }

  // Fallback 4: Try recharge history for wallet balance
  if (!meterInfo.walletBalance) {
    try {
      const rwYear = now.getFullYear();
      const rwMonth = String(now.getMonth() + 1).padStart(2, '0');
      const rechargeRes = await CoreAPI.fetchRechargeHistory(ctx, rwYear, rwMonth);
      console.log('[SmartMeter DEBUG] recharge response (for wallet):', JSON.stringify(rechargeRes).substring(0, 500));
      const rw = parseCurrencyNum(rechargeRes?.wallet_balance ?? rechargeRes?.balance ?? rechargeRes?.remaining_balance);
      if (rw > 0) {
        meterInfo.walletBalance = rw;
        console.log('[SmartMeter DEBUG] Wallet found via recharge_history:', rw);
      }
    } catch (e) {
      console.log('[SmartMeter DEBUG] recharge fallback for wallet failed:', e.message);
    }
  }

  const tariff = meterInfo.tariff || 0;
  console.log('[SmartMeter DEBUG] Final tariff:', tariff, '| wallet:', meterInfo.walletBalance);
  if (tariff === 0) {
    console.warn('[SmartMeter] WARNING: Tariff is still 0. All cost calculations will show ₹0.00. Check the API debug logs above for available tariff sources.');
  }

  // Normalize daily consumption records
  let dailyRecords = [];
  if (dailyRes.status === 'fulfilled' && Array.isArray(dailyRes.value)) {
    dailyRecords = dailyRes.value.map(r => Normalizers.normalizeDailyConsumptionRecord(r));
    if (dailyRecords.length > 0) {
      console.log('[SmartMeter DEBUG] First normalized daily record — kwh:', dailyRecords[0].kwh, '| cost:', dailyRecords[0].cost, '| balance:', dailyRecords[0].balance);
      
      // Dynamic fallback for tariff & wallet from daily records!
      if (!meterInfo.tariff) {
        // Find a record with > 0 kwh and > 0 cost to calculate tariff
        const validRec = dailyRecords.find(r => r.kwh > 0 && r.cost > 0);
        if (validRec) {
          meterInfo.tariff = Number((validRec.cost / validRec.kwh).toFixed(2));
          console.log('[SmartMeter DEBUG] Tariff dynamically calculated from daily records:', meterInfo.tariff);
        }
      }
      if (!meterInfo.walletBalance) {
        // Get the most recent balance from dailyRecords
        const validRec = dailyRecords.find(r => r.balance > 0);
        if (validRec) {
          meterInfo.walletBalance = validRec.balance;
          console.log('[SmartMeter DEBUG] Wallet balance dynamically extracted from daily records:', meterInfo.walletBalance);
        }
      }
    }
  }

  // Normalize energy graph records
  let energyRecords = [];
  let wattSamples = [];
  if (energyGraphRes.status === 'fulfilled' && energyGraphRes.value?.data?.[0]) {
    const graphData = energyGraphRes.value.data[0];
    if (Array.isArray(graphData.final_data)) {
      energyRecords = graphData.final_data.map(r => Normalizers.normalizeEnergyGraphRecord(r));
    }
    if (Array.isArray(graphData.current_day_watt_data)) {
      wattSamples = Normalizers.normalizeWattSamples(graphData.current_day_watt_data);
    }
  }

  // Normalize meter detail
  let meterDetail = null;
  if (meterDetailRes.status === 'fulfilled' && meterDetailRes.value?.data) {
    const data = Array.isArray(meterDetailRes.value.data) ? meterDetailRes.value.data[0] : meterDetailRes.value.data;
    if (data) meterDetail = Normalizers.normalizeMeterDetail(data);
  }

  // Get actual final tariff
  const finalTariff = meterInfo.tariff || 0;
  
  // Merge daily data from both sources
  const mergedDaily = Normalizers.mergeDailyData(dailyRecords, energyRecords, finalTariff);
  console.log('[SmartMeter DEBUG] After merge — first record cost:', mergedDaily[0]?.cost, '| tariff used:', finalTariff);

  // Get today and yesterday
  const todayStr = now.toISOString().split('T')[0];
  const yesterdayStr = new Date(now.getTime() - 86400000).toISOString().split('T')[0];
  const today = mergedDaily.find(r => r.date === todayStr) || null;
  const yesterday = mergedDaily.find(r => r.date === yesterdayStr) || null;

  // Calculate period stats
  const last7 = mergedDaily.filter(r => {
    const d = new Date(r.date + 'T00:00:00');
    const daysAgo = (now - d) / 86400000;
    return daysAgo >= 0 && daysAgo < 7;
  });
  const last30 = mergedDaily.filter(r => {
    const d = new Date(r.date + 'T00:00:00');
    const daysAgo = (now - d) / 86400000;
    return daysAgo >= 0 && daysAgo < 30;
  });

  // Current month records
  const monthRecords = mergedDaily.filter(r => {
    return r.date.startsWith(`${year}-${String(month).padStart(2, '0')}`);
  });

  const weekStats = Calculations.calculatePeriodStats(last7);
  const monthStats = Calculations.calculatePeriodStats(monthRecords);

  // Wallet estimate
  const walletEstimate = Calculations.calculateWalletEstimate(
    meterInfo?.walletBalance || 0,
    weekStats.avgDailyCost
  );

  // Power metrics
  const powerMetrics = Calculations.processWattData(wattSamples);

  // Insights
  const insights = Calculations.generateInsights(today, yesterday, weekStats, monthStats);

  const dashboardData = {
    meterInfo,
    meterDetail,
    today,
    yesterday,
    dailyRecords: mergedDaily,
    weekStats,
    monthStats,
    walletEstimate,
    powerMetrics,
    insights,
    tariff: finalTariff,
    lastUpdated: now.toISOString()
  };

  // Cache with appropriate TTL
  await Storage.setCachedData(cacheKey, dashboardData, Storage.TTL_TODAY);

  return { success: true, data: dashboardData, fromCache: false };
}

/**
 * Get daily consumption data only.
 */
async function handleGetDailyConsumption(payload = {}) {
  const ctx = await requireAuth();

  const cacheKey = `daily_${ctx.scNo}`;
  const cached = await Storage.getCachedData(cacheKey);
  if (cached && !payload?.forceRefresh) {
    return { success: true, data: cached, fromCache: true };
  }

  const now = new Date();
  const endDate = now.toISOString().split('T')[0];
  const startDateObj = new Date(now);
  startDateObj.setDate(startDateObj.getDate() - 45);
  const startDate = startDateObj.toISOString().split('T')[0];

  const rawData = await CoreAPI.fetchAllDailyConsumption(ctx, startDate, endDate);
  const normalized = rawData.map(r => Normalizers.normalizeDailyConsumptionRecord(r));

  await Storage.setCachedData(cacheKey, normalized, Storage.TTL_TODAY);

  return { success: true, data: normalized, fromCache: false };
}

/**
 * Get energy graph data.
 */
async function handleGetEnergyGraph(payload = {}) {
  const ctx = await requireAuth();
  const now = new Date();
  const year = payload?.year || now.getFullYear();
  const month = payload?.month || String(now.getMonth() + 1).padStart(2, '0');

  const cacheKey = `energy_${ctx.scNo}_${year}_${month}`;
  const cached = await Storage.getCachedData(cacheKey);
  if (cached && !payload?.forceRefresh) {
    return { success: true, data: cached, fromCache: true };
  }

  const response = await CoreAPI.fetchEnergyGraphData(ctx, year, month);
  const graphData = response?.data?.[0] || {};

  const energyRecords = Array.isArray(graphData.final_data)
    ? graphData.final_data.map(r => Normalizers.normalizeEnergyGraphRecord(r))
    : [];
  const wattSamples = Array.isArray(graphData.current_day_watt_data)
    ? Normalizers.normalizeWattSamples(graphData.current_day_watt_data)
    : [];

  const result = { energyRecords, wattSamples };
  await Storage.setCachedData(cacheKey, result, Storage.TTL_TODAY);

  return { success: true, data: result, fromCache: false };
}

/**
 * Get meter info.
 */
async function handleGetMeterInfo() {
  const ctx = await requireAuth();

  const cacheKey = `meter_${ctx.scNo}`;
  const cached = await Storage.getCachedData(cacheKey);
  if (cached) {
    return { success: true, data: cached, fromCache: true };
  }

  const response = await CoreAPI.fetchMeterDetail(ctx);
  const detail = response?.data?.[0]
    ? Normalizers.normalizeMeterDetail(response.data[0])
    : null;

  if (detail) {
    await Storage.setCachedData(cacheKey, detail, Storage.TTL_HISTORICAL);
  }

  return { success: true, data: detail, fromCache: false };
}

/**
 * Get consumer info (wallet, tariff, etc.).
 */
async function handleGetConsumerInfo(payload = {}) {
  const ctx = await requireAuth();
  const now = new Date();
  const year = payload?.year || now.getFullYear();
  const month = payload?.month || String(now.getMonth() + 1).padStart(2, '0');

  try {
    const assignedRes = await CoreAPI.fetchAssignedInfo(ctx);
    const ad = Array.isArray(assignedRes?.data) ? assignedRes.data[0] : assignedRes?.data;
    if (ad && ad.site_id) ctx.siteId = ad.site_id;
  } catch (err) {}

  if (!ctx.siteId) {
    return { success: false, error: 'Missing site_id' };
  }

  const response = await CoreAPI.fetchConsumerInfo(ctx, year, month);
  const info = response?.data?.[0]
    ? Normalizers.normalizeConsumerInfo(response.data[0])
    : null;

  return { success: true, data: info, fromCache: false };
}

/**
 * Get recharge history.
 */
async function handleGetRechargeHistory() {
  const ctx = await requireAuth();

  const cacheKey = `recharge_${ctx.scNo}`;
  const cached = await Storage.getCachedData(cacheKey);
  if (cached) {
    return { success: true, data: cached, fromCache: true };
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');

  const response = await CoreAPI.fetchRechargeHistory(ctx, year, month);
  let records = [];
  if (response?.data && Array.isArray(response.data)) {
    records = response.data.map(r => Normalizers.normalizeRechargeRecord(r));
  }

  await Storage.setCachedData(cacheKey, records, Storage.TTL_TODAY);

  return { success: true, data: records, fromCache: false };
}

/**
 * Get compact popup data.
 */
async function handleGetPopupData() {
  try {
    const result = await handleGetDashboardData({});
    if (!result.success) return result;

    const d = result.data;
    return {
      success: true,
      data: {
        todayKwh: d.today?.kwh ?? null,
        todayCost: d.today?.cost ?? null,
        walletBalance: d.meterInfo?.walletBalance ?? null,
        estimatedDays: d.walletEstimate?.estimatedDays ?? null,
        latestPower: d.powerMetrics?.latestPower ?? null,
        latestPowerTime: d.powerMetrics?.latestTime ?? null,
        peakPower: d.powerMetrics?.peakPower ?? null,
        peakPowerTime: d.powerMetrics?.peakTime ?? null,
        tariff: d.tariff ?? null,
        scNo: d.meterInfo?.scNo ?? '',
        lastUpdated: d.lastUpdated
      },
      fromCache: result.fromCache
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Refresh all data (clear caches and re-fetch).
 */
async function handleRefreshData() {
  await Storage.clearAllCache();
  return handleGetDashboardData({ forceRefresh: true });
}

// ============================================================
// Helpers
// ============================================================

/**
 * Get auth context or throw.
 */
async function requireAuth() {
  const ctx = await Storage.getAuthContext();
  if (!ctx || !ctx.token) {
    throw new Error('Not authenticated. Please open the CORE portal and log in.');
  }
  return ctx;
}
