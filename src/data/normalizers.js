/**
 * normalizers.js — Normalize CORE API responses into consistent internal formats
 * 
 * The portal's APIs return data in different shapes. This layer transforms
 * all responses into a common format so the rest of the extension doesn't
 * need to know about API-specific field names.
 */

/**
 * Normalized daily consumption record.
 * @typedef {Object} NormalizedDailyRecord
 * @property {string} date - 'YYYY-MM-DD'
 * @property {number} kwh - Active units consumed
 * @property {number|null} kvah - Apparent energy consumed (if available)
 * @property {number} cost - Energy amount consumed in ₹ (from API)
 * @property {number|null} balance - Wallet balance after this day
 * @property {number|null} openingReading - Active unit opening
 * @property {number|null} closingReading - Active unit closing
 * @property {number|null} ebKwh - EB consumption (if dual-source)
 * @property {number|null} dgKwh - DG consumption (if dual-source)
 */

/**
 * Normalize a daily consumption record from getDailyConsumptionHistory.
 * 
 * Input fields:
 *   consumption_date, active_unit_opening, active_unit_closing,
 *   active_unit_consumed, energy_amount_consumed, balance_amount
 * 
 * @param {Object} raw - Raw API record
 * @returns {NormalizedDailyRecord}
 */
function normalizeDailyConsumptionRecord(raw) {
  const parseCurrency = (val) => {
    if (val == null) return null;
    const num = parseFloat(String(val).replace(/[^0-9.-]+/g, ""));
    return isNaN(num) ? null : num;
  };

  // Try multiple possible field names for cost
  const costValue = parseCurrency(
    raw.energy_amount_consumed ?? raw.eb_amount_consumed ??
    raw.total_amount ?? raw.amount ?? raw.cost
  );

  // Try multiple possible field names for balance
  const balanceValue = parseCurrency(
    raw.balance_amount ?? raw.wallet_balance ?? raw.balance
  );

  // Try multiple possible field names for opening/closing
  const openingVal = raw.active_unit_opening ?? raw.opening_kwh ?? raw.opening_reading;
  const closingVal = raw.active_unit_closing ?? raw.closing_kwh ?? raw.closing_reading;

  return {
    date: raw.consumption_date || raw.date || '',
    kwh: parseFloat(raw.active_unit_consumed ?? raw.consumed_units ?? raw.kwh) || 0,
    kvah: null,
    cost: costValue || 0,
    balance: balanceValue,
    openingReading: openingVal != null ? parseFloat(openingVal) : null,
    closingReading: closingVal != null ? parseFloat(closingVal) : null,
    ebKwh: raw.eb_unit_consumed != null ? parseFloat(raw.eb_unit_consumed) : null,
    dgKwh: raw.dg_unit_consumed != null ? parseFloat(raw.dg_unit_consumed) : null
  };
}

/**
 * Normalize a daily energy record from consumer_energy_graph_data → final_data.
 * 
 * Input fields:
 *   consumed_kwh_energy_of_day, consumed_kvah_energy_of_day,
 *   month (actually a date like '2026-08-01'), eb_unit_consumed, dg_unit_consumed
 * 
 * @param {Object} raw - Raw API record
 * @returns {NormalizedDailyRecord}
 */
function normalizeEnergyGraphRecord(raw) {
  const kwh = parseFloat(raw.consumed_kwh_energy_of_day) || 0;
  return {
    date: raw.month || '', // The API uses 'month' but it's actually a daily date
    kwh,
    kvah: raw.consumed_kvah_energy_of_day != null ? parseFloat(raw.consumed_kvah_energy_of_day) : null,
    cost: 0, // Energy graph doesn't include cost — will be filled from tariff
    balance: null,
    openingReading: null,
    closingReading: null,
    ebKwh: raw.eb_unit_consumed != null ? parseFloat(raw.eb_unit_consumed) : null,
    dgKwh: raw.dg_unit_consumed != null ? parseFloat(raw.dg_unit_consumed) : null
  };
}

/**
 * Normalized meter info.
 * @typedef {Object} NormalizedMeterInfo
 * @property {string} scNo - Consumer/meter number
 * @property {string} projectName - Project name
 * @property {string} verticalName - Vertical name
 * @property {number} walletBalance - Current wallet balance
 * @property {number} tariff - eb_price (₹/kWh)
 * @property {string} ldp - Last data point timestamp
 * @property {number} liveStatus - Live status code
 * @property {boolean} isDualSource - Has EB + DG
 * @property {string} meterAddress - Meter IP/address
 */

/**
 * Normalize consumer_level_detail response.
 * @param {Object} raw - Raw API record (from data[0])
 * @returns {NormalizedMeterInfo}
 */
function normalizeConsumerInfo(raw) {
  const parseCurrency = (val) => {
    if (val == null) return 0;
    const num = parseFloat(String(val).replace(/[^0-9.-]+/g, ""));
    return isNaN(num) ? 0 : num;
  };

  // Try multiple possible field names for wallet balance
  const walletBalance = parseCurrency(
    raw.wallet_balance ?? raw.walletBalance ?? raw.balance_amount ??
    raw.balance ?? raw.remaining_balance
  );

  // Try multiple possible field names for tariff/price
  // Also check nested tariff_info object and eb_details
  let tariff = parseCurrency(
    raw.eb_price ?? raw.ebPrice ?? raw.tariff ?? raw.price_per_unit ??
    raw.unit_price ?? raw.rate
  );
  
  // Check nested objects for tariff if not found at top level
  if (!tariff && raw.tariff_info) {
    tariff = parseCurrency(
      raw.tariff_info.eb_price ?? raw.tariff_info.price ?? raw.tariff_info.rate
    );
  }
  if (!tariff && raw.eb_details) {
    tariff = parseCurrency(
      raw.eb_details.price ?? raw.eb_details.rate ?? raw.eb_details.eb_price
    );
  }

  // Log the raw data for debugging (remove once money issue is resolved)
  console.log('[SmartMeter] Raw consumer info keys:', Object.keys(raw));
  console.log('[SmartMeter] Raw consumer info data:', JSON.stringify(raw).substring(0, 2000));
  console.log('[SmartMeter] Parsed wallet:', walletBalance, '| tariff:', tariff);

  return {
    scNo: raw.sc_no || '',
    projectId: raw.project_id || '',
    siteId: raw.site_id || '',
    projectName: raw.project_name || '',
    verticalName: raw.vertical_name || '',
    walletBalance,
    tariff,
    ldp: raw.ldp || '',
    liveStatus: raw.live_status || 0,
    isDualSource: raw.is_dual_source === true,
    meterAddress: raw.meter_address || '',
    isOnlinePaymentAllowed: raw.is_online_payment_allowed === true
  };
}

/**
 * Normalized watt (power) sample.
 * @typedef {Object} NormalizedWattSample
 * @property {number} timestamp - Unix timestamp (seconds)
 * @property {number} watts - Instantaneous power in watts
 * @property {string} timeStr - Human-readable time string
 */

/**
 * Normalize current_day_watt_data samples.
 * @param {Array} rawSamples - Array of {time, watt} from API
 * @returns {NormalizedWattSample[]}
 */
function normalizeWattSamples(rawSamples) {
  if (!Array.isArray(rawSamples)) return [];

  return rawSamples
    .map(sample => {
      const timestamp = parseFloat(sample.time);
      const watts = parseFloat(sample.watt);

      if (isNaN(timestamp) || isNaN(watts)) return null;

      const date = new Date(timestamp * 1000);
      const timeStr = date.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });

      return { timestamp, watts, timeStr };
    })
    .filter(Boolean)
    .sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Normalized meter detail.
 */
function normalizeMeterDetail(raw) {
  return {
    scNo: raw.sc_no || '',
    meterSerial: raw.meter_serial || '',
    meterAddress: raw.meter_address || '',
    supplyType: raw.supply_type || '',
    timestamp: raw.timestamp || '',
    title: raw.title || ''
  };
}

/**
 * Normalize recharge history record.
 */
function normalizeRechargeRecord(raw) {
  return {
    amount: parseFloat(raw.recharge_amount || raw.amount) || 0,
    date: raw.recharge_date || raw.date || raw.timestamp || '',
    mode: raw.payment_mode || raw.mode || '',
    transactionId: raw.transaction_id || raw.txn_id || '',
    status: raw.status || ''
  };
}

/**
 * Merge data from getDailyConsumptionHistory and consumer_energy_graph_data.
 * The consumption history has cost/balance/readings, the energy graph has kVAh/EB/DG.
 * 
 * @param {NormalizedDailyRecord[]} consumptionRecords - From getDailyConsumptionHistory
 * @param {NormalizedDailyRecord[]} energyRecords - From consumer_energy_graph_data
 * @param {number} tariff - ₹/kWh for fallback cost calculation
 * @returns {NormalizedDailyRecord[]}
 */
function mergeDailyData(consumptionRecords, energyRecords, tariff) {
  const energyMap = new Map();
  energyRecords.forEach(r => {
    // The energy graph 'month' field is 'YYYY-MM-DD'
    const dateKey = r.date.split('T')[0];
    energyMap.set(dateKey, r);
  });

  const merged = consumptionRecords.map(record => {
    const dateKey = record.date.split('T')[0];
    const energyData = energyMap.get(dateKey);

    return {
      ...record,
      kvah: energyData?.kvah ?? record.kvah,
      ebKwh: energyData?.ebKwh ?? record.ebKwh,
      dgKwh: energyData?.dgKwh ?? record.dgKwh,
      // Use API cost as authoritative; fallback to kWh × tariff
      cost: record.cost > 0 ? record.cost : (record.kwh * tariff)
    };
  });

  // Add any energy graph records that aren't in consumption history
  energyRecords.forEach(energyRecord => {
    const dateKey = energyRecord.date.split('T')[0];
    const exists = merged.some(r => r.date.split('T')[0] === dateKey);
    if (!exists && energyRecord.kwh > 0) {
      merged.push({
        ...energyRecord,
        cost: energyRecord.kwh * tariff // Fallback since no API cost available
      });
    }
  });

  // Sort by date descending (most recent first)
  merged.sort((a, b) => b.date.localeCompare(a.date));

  return merged;
}

// Export
if (typeof globalThis !== 'undefined') {
  globalThis.Normalizers = {
    normalizeDailyConsumptionRecord,
    normalizeEnergyGraphRecord,
    normalizeConsumerInfo,
    normalizeWattSamples,
    normalizeMeterDetail,
    normalizeRechargeRecord,
    mergeDailyData
  };
}
