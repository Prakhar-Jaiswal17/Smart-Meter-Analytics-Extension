/**
 * calculations.js — Pure calculation functions for consumption analytics
 * 
 * All functions are pure (no side effects, no API calls, no DOM access).
 * They operate on normalized data structures from normalizers.js.
 */

/**
 * Calculate cost from consumption and tariff.
 * Used only as a FALLBACK when the API doesn't provide energy_amount_consumed.
 * 
 * @param {number} kwh - Energy consumed in kWh
 * @param {number} tariff - Price per kWh in ₹
 * @returns {number} Estimated cost in ₹
 */
function calculateCost(kwh, tariff) {
  if (!kwh || !tariff || kwh < 0 || tariff < 0) return 0;
  return Math.round(kwh * tariff * 100) / 100;
}

/**
 * Calculate statistics for a period (works for weekly, monthly, or any range).
 * 
 * @param {NormalizedDailyRecord[]} records - Daily records for the period
 * @returns {Object} Period statistics
 */
function calculatePeriodStats(records) {
  if (!records || records.length === 0) {
    return {
      totalKwh: 0,
      totalCost: 0,
      avgDailyKwh: 0,
      avgDailyCost: 0,
      peakDay: null,
      lowestDay: null,
      days: 0,
      totalKvah: null,
      totalEbKwh: null,
      totalDgKwh: null
    };
  }

  // Filter out invalid records
  const valid = records.filter(r => r.kwh >= 0);
  if (valid.length === 0) return calculatePeriodStats([]);

  const totalKwh = roundTo(valid.reduce((sum, r) => sum + r.kwh, 0), 2);
  const totalCost = roundTo(valid.reduce((sum, r) => sum + r.cost, 0), 2);

  // kVAh total (only if any records have it)
  const kvahRecords = valid.filter(r => r.kvah != null);
  const totalKvah = kvahRecords.length > 0
    ? roundTo(kvahRecords.reduce((sum, r) => sum + r.kvah, 0), 2)
    : null;

  // EB/DG totals
  const ebRecords = valid.filter(r => r.ebKwh != null);
  const totalEbKwh = ebRecords.length > 0
    ? roundTo(ebRecords.reduce((sum, r) => sum + r.ebKwh, 0), 2)
    : null;

  const dgRecords = valid.filter(r => r.dgKwh != null);
  const totalDgKwh = dgRecords.length > 0
    ? roundTo(dgRecords.reduce((sum, r) => sum + r.dgKwh, 0), 2)
    : null;

  // Peak and lowest days
  let peakDay = valid[0];
  let lowestDay = valid[0];
  valid.forEach(r => {
    if (r.kwh > peakDay.kwh) peakDay = r;
    if (r.kwh < lowestDay.kwh) lowestDay = r;
  });

  return {
    totalKwh,
    totalCost,
    avgDailyKwh: roundTo(totalKwh / valid.length, 2),
    avgDailyCost: roundTo(totalCost / valid.length, 2),
    peakDay: { date: peakDay.date, kwh: peakDay.kwh, cost: peakDay.cost },
    lowestDay: { date: lowestDay.date, kwh: lowestDay.kwh, cost: lowestDay.cost },
    days: valid.length,
    totalKvah,
    totalEbKwh,
    totalDgKwh
  };
}

/**
 * Estimate remaining wallet days.
 * 
 * @param {number} balance - Current wallet balance in ₹
 * @param {number} avgDailyCost - Average daily expenditure in ₹
 * @returns {Object} Wallet estimate
 */
function calculateWalletEstimate(balance, avgDailyCost) {
  if (!balance || balance <= 0) {
    return { estimatedDays: 0, avgDailyExpenditure: avgDailyCost || 0, isEstimate: true };
  }
  if (!avgDailyCost || avgDailyCost <= 0) {
    return { estimatedDays: null, avgDailyExpenditure: 0, isEstimate: true };
  }

  return {
    estimatedDays: roundTo(balance / avgDailyCost, 1),
    avgDailyExpenditure: roundTo(avgDailyCost, 2),
    isEstimate: true
  };
}

/**
 * Process watt (power) samples to extract key metrics.
 * 
 * @param {NormalizedWattSample[]} samples - Sorted watt samples
 * @returns {Object} Power metrics
 */
function processWattData(samples) {
  if (!samples || samples.length === 0) {
    return {
      latestPower: null,
      latestTime: null,
      peakPower: null,
      peakTime: null,
      samples: []
    };
  }

  const latest = samples[samples.length - 1];
  let peak = samples[0];
  samples.forEach(s => {
    if (s.watts > peak.watts) peak = s;
  });

  return {
    latestPower: roundTo(latest.watts, 2),
    latestTime: latest.timeStr,
    peakPower: roundTo(peak.watts, 2),
    peakTime: peak.timeStr,
    samples
  };
}

/**
 * Generate textual insights from consumption data.
 * Only generates insights from confirmed data. Never makes claims
 * about individual appliances or estimates hourly patterns.
 * 
 * @param {NormalizedDailyRecord|null} today
 * @param {NormalizedDailyRecord|null} yesterday
 * @param {Object|null} weekStats - From calculatePeriodStats (last 7 days)
 * @param {Object|null} monthStats - From calculatePeriodStats (this month)
 * @returns {string[]} Array of insight messages
 */
function generateInsights(today, yesterday, weekStats, monthStats) {
  const insights = [];

  // Today vs yesterday comparison
  if (today && yesterday && today.kwh > 0 && yesterday.kwh > 0) {
    const diff = today.kwh - yesterday.kwh;
    const pctChange = roundTo((diff / yesterday.kwh) * 100, 1);

    if (pctChange > 5) {
      insights.push(`Your consumption today (${today.kwh} kWh) is ${pctChange}% higher than yesterday (${yesterday.kwh} kWh).`);
    } else if (pctChange < -5) {
      insights.push(`Your consumption today (${today.kwh} kWh) is ${Math.abs(pctChange)}% lower than yesterday (${yesterday.kwh} kWh).`);
    } else {
      insights.push(`Your consumption today (${today.kwh} kWh) is about the same as yesterday (${yesterday.kwh} kWh).`);
    }
  }

  // Weekly average
  if (weekStats && weekStats.days >= 3) {
    insights.push(`Your average daily consumption over the last ${weekStats.days} days is ${weekStats.avgDailyKwh} kWh (₹${weekStats.avgDailyCost}/day).`);
  }

  // Peak day in current data
  if (weekStats && weekStats.peakDay) {
    const peakDate = formatDateShort(weekStats.peakDay.date);
    insights.push(`Your highest consumption day was ${peakDate} at ${weekStats.peakDay.kwh} kWh.`);
  }

  // Lowest day
  if (weekStats && weekStats.lowestDay && weekStats.days > 1) {
    const lowDate = formatDateShort(weekStats.lowestDay.date);
    insights.push(`Your lowest consumption day was ${lowDate} at ${weekStats.lowestDay.kwh} kWh.`);
  }

  // Monthly projection
  if (monthStats && monthStats.days >= 5) {
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const projectedKwh = roundTo(monthStats.avgDailyKwh * daysInMonth, 1);
    const projectedCost = roundTo(monthStats.avgDailyCost * daysInMonth, 0);
    insights.push(`At current rates, your projected monthly consumption is ~${projectedKwh} kWh (~₹${projectedCost}).`);
  }

  // DG usage insight
  if (weekStats && weekStats.totalDgKwh != null && weekStats.totalDgKwh > 0) {
    const dgPct = roundTo((weekStats.totalDgKwh / weekStats.totalKwh) * 100, 1);
    insights.push(`${dgPct}% of your recent consumption came from DG (generator) power.`);
  }

  return insights;
}

/**
 * Validate a meter reading against the previous reading.
 * Handles resets and negative differences.
 * 
 * @param {number} current - Current reading
 * @param {number} previous - Previous reading
 * @returns {Object} Validation result
 */
function validateReading(current, previous) {
  if (current == null || previous == null) {
    return { valid: false, consumption: 0, reason: 'Missing reading' };
  }

  const diff = current - previous;

  if (diff < 0) {
    return { valid: false, consumption: 0, reason: 'Meter reset detected (reading decreased)' };
  }

  if (diff > 100) {
    return { valid: false, consumption: diff, reason: 'Unusually high consumption — possible meter issue' };
  }

  return { valid: true, consumption: roundTo(diff, 2), reason: null };
}

// ============================================================
// Utility helpers
// ============================================================

function roundTo(num, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

/**
 * Format a number as Indian Rupees.
 * @param {number} amount
 * @returns {string}
 */
function formatCurrency(amount) {
  if (amount == null || isNaN(amount)) return '₹0.00';
  return '₹' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Format kWh with appropriate precision.
 * @param {number} kwh
 * @returns {string}
 */
function formatKwh(kwh) {
  if (kwh == null || isNaN(kwh)) return '0.00 kWh';
  return kwh.toFixed(2) + ' kWh';
}

// Export
if (typeof globalThis !== 'undefined') {
  globalThis.Calculations = {
    calculateCost,
    calculatePeriodStats,
    calculateWalletEstimate,
    processWattData,
    generateInsights,
    validateReading,
    roundTo,
    formatDateShort,
    formatCurrency,
    formatKwh
  };
}
