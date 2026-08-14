/**
 * api.js — Centralized API client for CORE smart-meter portal
 * 
 * All API calls go through this module. Only the service worker should
 * import/use these functions. The dashboard/popup NEVER call these directly.
 * 
 * API Base: https://core.polarisgrids.com/api
 * MDMS endpoints: /mdms/...
 */

const API_BASE = 'https://core.polarisgrids.com/api';

/**
 * Build the complete set of required headers for CORE API requests.
 * The portal requires 7 custom headers on every authenticated request.
 * 
 * @param {Object} context - Auth context from the content script
 * @returns {Object} Headers object
 */
function buildApiHeaders(context) {
  const headers = {
    'Content-Type': 'application/json'
  };

  const setIfPresent = (key, value) => {
    if (typeof value === 'string' && value.trim()) {
      headers[key] = value.trim();
    }
  };

  setIfPresent('authorization', context.token);
  setIfPresent('module', context.module);
  setIfPresent('vertical', context.vertical);
  setIfPresent('project', context.project);
  setIfPresent('username', context.username);
  setIfPresent('user-type', context.userType);
  setIfPresent('sc-no', context.scNo);

  return headers;
}

/**
 * Make an authenticated GET request to the CORE API.
 * 
 * @param {string} endpoint - API path (e.g., 'mdms/meter_detail')
 * @param {Object} context - Auth context
 * @param {Object} [params] - Query parameters
 * @returns {Promise<Object>} Parsed JSON response
 */
async function apiGet(endpoint, context, params = {}) {
  const url = new URL(`${API_BASE}/${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: buildApiHeaders(context)
  });

  if (!response.ok) {
    const status = response.status;
    // Log the response body for 4xx errors to aid debugging
    let errorBody = '';
    try { errorBody = await response.text(); } catch {}
    if (status === 422 || status === 400) {
      console.error(`[SmartMeter API] ${endpoint} returned ${status}:`, errorBody);
    }
    if (status === 401 || status === 403) {
      throw new ApiError('Authentication expired. Please re-open the CORE portal and log in.', status);
    }
    throw new ApiError(`API request failed (${status})`, status);
  }

  return response.json();
}

/**
 * Make an authenticated POST request to the CORE API.
 * 
 * @param {string} endpoint - API path
 * @param {Object} context - Auth context
 * @param {Object} body - Request body
 * @returns {Promise<Object>} Parsed JSON response
 */
async function apiPost(endpoint, context, body = {}) {
  const response = await fetch(`${API_BASE}/${endpoint}`, {
    method: 'POST',
    headers: buildApiHeaders(context),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const status = response.status;
    // Log the response body for 4xx errors to aid debugging
    let errorBody = '';
    try { errorBody = await response.text(); } catch {}
    if (status === 422 || status === 400) {
      console.error(`[SmartMeter API] ${endpoint} returned ${status}:`, errorBody);
    }
    if (status === 401 || status === 403) {
      throw new ApiError('Authentication expired. Please re-open the CORE portal and log in.', status);
    }
    throw new ApiError(`API request failed (${status})`, status);
  }

  return response.json();
}

/**
 * Custom error class for API failures.
 */
class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// ============================================================
// CONFIRMED ENDPOINTS
// ============================================================

/**
 * Fetch consumer-level detail (wallet, tariff, live status).
 * Endpoint: GET mdms/consumer_level_detail
 * Required query params: site_id, year, month
 * 
 * @param {Object} context - Auth context (must include siteId)
 * @param {number} year - e.g. 2026
 * @param {string} month - e.g. '08'
 */
async function fetchConsumerInfo(context, year, month) {
  if (!context.siteId) {
    throw new ApiError('site_id not available — cannot call consumer_level_detail', 0);
  }
  return apiGet('mdms/consumer_level_detail', context, {
    site_id: context.siteId,
    year,
    month
  });
}

/**
 * Fetch daily consumption history (paginated).
 * Endpoint: POST mdms/get-daily-consumption-consumer
 * Required body: sc_no, start_date, end_date, page, rows
 * 
 * @param {Object} context - Auth context
 * @param {string} startDate - 'YYYY-MM-DD'
 * @param {string} endDate - 'YYYY-MM-DD'
 * @param {number} page - Page number (1-based)
 * @param {number} rows - Rows per page
 */
async function fetchDailyConsumption(context, startDate, endDate, page = 1, rows = 50) {
  return apiPost('mdms/get-daily-consumption-consumer', context, {
    sc_no: context.scNo,
    start_date: startDate,
    end_date: endDate,
    page,
    rows
  });
}

/**
 * Fetch ALL pages of daily consumption for a date range.
 * Handles pagination automatically.
 * 
 * @param {Object} context - Auth context
 * @param {string} startDate - 'YYYY-MM-DD'
 * @param {string} endDate - 'YYYY-MM-DD'
 */
async function fetchAllDailyConsumption(context, startDate, endDate) {
  const allData = [];
  let page = 1;
  const rows = 50;
  let totalRows = Infinity;

  while ((page - 1) * rows < totalRows) {
    const response = await fetchDailyConsumption(context, startDate, endDate, page, rows);
    if (!response?.data) break;

    allData.push(...response.data);

    if (response.pagination) {
      totalRows = response.pagination.total_rows || 0;
    } else {
      break;
    }

    page++;

    // Safety: max 20 pages (1000 records)
    if (page > 20) break;
  }

  return allData;
}

/**
 * Fetch energy graph data (daily kWh/kVAh + current-day watt samples).
 * Endpoint: GET mdms/consumer_energy_graph_data
 */
async function fetchEnergyGraphData(context, year, month) {
  return apiGet('mdms/consumer_energy_graph_data', context, {
    sc_no: context.scNo,
    year,
    month
  });
}

/**
 * Fetch consumer recharge history.
 * Endpoint: GET mdms/consumer_recharge
 * Required query params: sc_no, year, month
 */
async function fetchRechargeHistory(context, year, month) {
  return apiGet('mdms/consumer_recharge', context, {
    sc_no: context.scNo,
    year,
    month
  });
}

/**
 * Fetch meter detail (serial, mapping, address).
 * Endpoint: GET mdms/meter_detail
 */
async function fetchMeterDetail(context) {
  return apiGet('mdms/meter_detail', context, {
    sc_no: context.scNo
  });
}

/**
 * Fetch meter history.
 * Endpoint: GET mdms/meter_history
 */
async function fetchMeterHistory(context, year, month) {
  return apiGet('mdms/meter_history', context, {
    sc_no: context.scNo,
    year,
    month
  });
}

/**
 * Fetch assigned info.
 * Endpoint: GET mdms/assigned_info
 */
async function fetchAssignedInfo(context) {
  return apiGet('mdms/assigned_info', context, {
    sc_no: context.scNo
  });
}

// ============================================================
// DISCOVERED BUT UNVERIFIED ENDPOINTS
// These are called opportunistically. If they fail or return
// unexpected data, the extension degrades gracefully.
// ============================================================

/**
 * Fetch time-range energy data (potential hourly source — UNVERIFIED).
 * Endpoint: GET mdms/time_energy
 */
async function fetchTimeEnergy(context, params = {}) {
  try {
    return await apiGet('mdms/time_energy', context, {
      sc_no: context.scNo,
      ...params
    });
  } catch {
    return null; // Graceful degradation
  }
}

/**
 * Fetch realtime voltage/current/power factor data (UNVERIFIED).
 * Endpoint: GET mdms/realtime_voltage_current_pf_data
 */
async function fetchRealtimeData(context) {
  try {
    return await apiGet('mdms/realtime_voltage_current_pf_data', context, {
      sc_no: context.scNo
    });
  } catch {
    return null;
  }
}

// Export for use in service worker
if (typeof globalThis !== 'undefined') {
  globalThis.CoreAPI = {
    fetchConsumerInfo,
    fetchDailyConsumption,
    fetchAllDailyConsumption,
    fetchEnergyGraphData,
    fetchRechargeHistory,
    fetchMeterDetail,
    fetchMeterHistory,
    fetchAssignedInfo,
    fetchTimeEnergy,
    fetchRealtimeData,
    ApiError
  };
}
