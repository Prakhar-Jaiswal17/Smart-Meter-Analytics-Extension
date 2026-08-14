/**
 * dashboard.js — Logic and Chart.js integration for the full dashboard.
 * 
 * Fetches data from the service worker via messaging. Never touches tokens.
 */

// UI Elements
const els = {
  header: document.getElementById('header'),
  meterBadge: document.getElementById('meter-badge'),
  meterName: document.getElementById('meter-name'),
  monthPicker: document.getElementById('month-picker'),
  refreshBtn: document.getElementById('refresh-btn'),
  
  loadingState: document.getElementById('loading-state'),
  errorState: document.getElementById('error-state'),
  errorMessage: document.getElementById('error-message'),
  errorRetryBtn: document.getElementById('error-retry-btn'),
  authState: document.getElementById('auth-state'),
  mainContent: document.getElementById('main-content'),

  // Cards
  todayKwh: document.getElementById('today-kwh'),
  todayCost: document.getElementById('today-cost'),
  walletBalance: document.getElementById('wallet-balance'),
  walletEstimate: document.getElementById('wallet-estimate'),
  avgDailyKwh: document.getElementById('avg-daily-kwh'),
  avgDailyCost: document.getElementById('avg-daily-cost'),
  latestPower: document.getElementById('latest-power'),
  latestPowerTime: document.getElementById('latest-power-time'),
  peakPower: document.getElementById('peak-power'),
  peakPowerTime: document.getElementById('peak-power-time'),
  tariffValue: document.getElementById('tariff-value'),

  // Insights
  insightsSection: document.getElementById('insights-section'),
  insightsList: document.getElementById('insights-list'),

  // Period Stats
  periodTabs: document.querySelectorAll('.tab-btn'),
  statTotalKwh: document.getElementById('stat-total-kwh'),
  statTotalCost: document.getElementById('stat-total-cost'),
  statAvgKwh: document.getElementById('stat-avg-kwh'),
  statAvgCost: document.getElementById('stat-avg-cost'),
  statPeakDay: document.getElementById('stat-peak-day'),
  statLowDay: document.getElementById('stat-low-day'),

  // Table & Info
  dailyTableBody: document.getElementById('daily-table-body'),
  meterInfoGrid: document.getElementById('meter-info-grid')
};

// Chart instances
let charts = {
  dailyKwh: null,
  dailyCost: null,
  power: null
};

// Current data state
let currentData = null;
let currentPeriod = 'week'; // 'week' or 'month'

// ============================================================
// Initialization & Data Loading
// ============================================================

async function init() {
  setupEventListeners();
  
  // Set default month picker value to current month
  const now = new Date();
  els.monthPicker.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  await loadData();
}

function setupEventListeners() {
  els.refreshBtn.addEventListener('click', () => loadData(true));
  els.errorRetryBtn.addEventListener('click', () => loadData());
  
  els.monthPicker.addEventListener('change', () => {
    loadData(false); // don't force refresh, try cache first for other months
  });

  els.periodTabs.forEach(btn => {
    btn.addEventListener('click', (e) => {
      els.periodTabs.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentPeriod = e.target.dataset.period;
      updatePeriodStats();
    });
  });
}

async function loadData(forceRefresh = false) {
  showState('loading');
  
  const [year, month] = els.monthPicker.value.split('-').map(Number);
  
  if (forceRefresh) {
    els.refreshBtn.classList.add('loading');
  }

  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: forceRefresh ? 'REFRESH_DATA' : 'GET_DASHBOARD_DATA',
        payload: { year, month, forceRefresh }
      }, resolve);
    });

    if (!response) {
      throw new Error('No response from background script');
    }

    if (response.status === 'no_auth' || !response.success && response.error?.includes('authenticate')) {
      showState('auth');
      return;
    }

    if (!response.success) {
      throw new Error(response.error || 'Failed to load data');
    }

    currentData = response.data;
    renderDashboard();
    showState('content');

  } catch (error) {
    console.error('Data load error:', error);
    els.errorMessage.textContent = error.message || 'An unexpected error occurred.';
    showState('error');
  } finally {
    els.refreshBtn.classList.remove('loading');
  }
}

function showState(state) {
  els.loadingState.classList.add('hidden');
  els.errorState.classList.add('hidden');
  els.authState.classList.add('hidden');
  els.mainContent.classList.add('hidden');

  switch (state) {
    case 'loading': els.loadingState.classList.remove('hidden'); break;
    case 'error': els.errorState.classList.remove('hidden'); break;
    case 'auth': els.authState.classList.remove('hidden'); break;
    case 'content': els.mainContent.classList.remove('hidden'); break;
  }
}

// ============================================================
// Rendering
// ============================================================

function renderDashboard() {
  if (!currentData) return;

  updateHeader();
  updateSummaryCards();
  updateInsights();
  updatePeriodStats();
  updateCharts();
  updateTable();
  updateMeterInfo();
}

function updateHeader() {
  if (currentData.meterInfo?.projectName) {
    els.meterName.textContent = currentData.meterInfo.projectName;
    els.meterBadge.classList.remove('hidden');
  } else if (currentData.meterDetail?.title) {
    els.meterName.textContent = currentData.meterDetail.title;
    els.meterBadge.classList.remove('hidden');
  } else {
    els.meterBadge.classList.add('hidden');
  }
}

function updateSummaryCards() {
  const { today, weekStats, walletEstimate, powerMetrics, tariff } = currentData;

  // Today's Consumption
  if (today) {
    els.todayKwh.textContent = today.kwh.toFixed(2) + ' kWh';
    els.todayCost.textContent = '₹' + today.cost.toFixed(2);
  } else {
    els.todayKwh.textContent = '—';
    els.todayCost.textContent = 'No data for today';
  }

  // Wallet Balance
  if (currentData.meterInfo?.walletBalance != null) {
    els.walletBalance.textContent = '₹' + currentData.meterInfo.walletBalance.toFixed(2);
    
    if (walletEstimate?.estimatedDays) {
      els.walletEstimate.innerHTML = `~${walletEstimate.estimatedDays} days left <span class="estimate-tag">EST</span>`;
    } else {
      els.walletEstimate.textContent = '—';
    }
  } else {
    els.walletBalance.textContent = '—';
    els.walletEstimate.textContent = '';
  }

  // Avg Daily
  if (weekStats) {
    els.avgDailyKwh.textContent = weekStats.avgDailyKwh.toFixed(2) + ' kWh';
    els.avgDailyCost.textContent = '₹' + weekStats.avgDailyCost.toFixed(2) + ' / day';
  }

  // Latest Power
  if (powerMetrics?.latestPower != null) {
    els.latestPower.textContent = powerMetrics.latestPower + ' W';
    els.latestPowerTime.textContent = 'at ' + powerMetrics.latestTime;
  } else {
    els.latestPower.textContent = '—';
    els.latestPowerTime.textContent = 'No watt data today';
  }

  // Peak Power
  if (powerMetrics?.peakPower != null) {
    els.peakPower.textContent = powerMetrics.peakPower + ' W';
    els.peakPowerTime.textContent = 'at ' + powerMetrics.peakTime;
  } else {
    els.peakPower.textContent = '—';
    els.peakPowerTime.textContent = '';
  }

  // Tariff
  if (tariff) {
    els.tariffValue.textContent = '₹' + tariff.toFixed(2);
  } else {
    els.tariffValue.textContent = '—';
  }
}

function updateInsights() {
  const { insights } = currentData;
  
  if (!insights || insights.length === 0) {
    els.insightsSection.classList.add('hidden');
    return;
  }

  els.insightsSection.classList.remove('hidden');
  els.insightsList.innerHTML = insights.map(text => `
    <div class="insight-item">
      <span class="insight-icon" aria-hidden="true"></span>
      <span>${text}</span>
    </div>
  `).join('');
}

function updatePeriodStats() {
  const stats = currentPeriod === 'week' ? currentData.weekStats : currentData.monthStats;
  
  if (!stats) {
    els.statTotalKwh.textContent = '—';
    els.statTotalCost.textContent = '—';
    els.statAvgKwh.textContent = '—';
    els.statAvgCost.textContent = '—';
    els.statPeakDay.textContent = '—';
    els.statLowDay.textContent = '—';
    return;
  }

  els.statTotalKwh.textContent = stats.totalKwh.toFixed(2) + ' kWh';
  els.statTotalCost.textContent = '₹' + stats.totalCost.toFixed(2);
  els.statAvgKwh.textContent = stats.avgDailyKwh.toFixed(2) + ' kWh';
  els.statAvgCost.textContent = '₹' + stats.avgDailyCost.toFixed(2);
  
  if (stats.peakDay) {
    els.statPeakDay.innerHTML = `${formatDateShort(stats.peakDay.date)}<br><small class="muted">${stats.peakDay.kwh.toFixed(2)} kWh</small>`;
  } else {
    els.statPeakDay.textContent = '—';
  }
  
  if (stats.lowestDay) {
    els.statLowDay.innerHTML = `${formatDateShort(stats.lowestDay.date)}<br><small class="muted">${stats.lowestDay.kwh.toFixed(2)} kWh</small>`;
  } else {
    els.statLowDay.textContent = '—';
  }
}

function updateTable() {
  const { dailyRecords } = currentData;
  
  if (!dailyRecords || dailyRecords.length === 0) {
    els.dailyTableBody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No data available for this month.</td></tr>';
    return;
  }

  // Only show records for the selected month in the table
  const [year, month] = els.monthPicker.value.split('-');
  const monthPrefix = `${year}-${month.padStart(2, '0')}`;
  
  const filteredRecords = dailyRecords.filter(r => r.date.startsWith(monthPrefix));

  els.dailyTableBody.innerHTML = filteredRecords.map(r => `
    <tr>
      <td>${formatDateShort(r.date)}</td>
      <td>${r.openingReading != null ? r.openingReading.toFixed(2) : '—'}</td>
      <td>${r.closingReading != null ? r.closingReading.toFixed(2) : '—'}</td>
      <td>${r.kwh.toFixed(2)}</td>
      <td>₹${r.cost.toFixed(2)}</td>
      <td>${r.balance != null ? '₹' + r.balance.toFixed(2) : '—'}</td>
    </tr>
  `).join('');
}

function updateMeterInfo() {
  const { meterInfo, meterDetail } = currentData;
  let html = '';
  
  const addInfo = (label, value) => {
    if (value) {
      html += `
        <div class="meter-info-item">
          <div class="meter-info-label">${label}</div>
          <div class="meter-info-value">${value}</div>
        </div>
      `;
    }
  };

  if (meterInfo) {
    addInfo('Consumer / SC No', meterInfo.scNo);
    addInfo('Project Name', meterInfo.projectName);
    addInfo('Vertical', meterInfo.verticalName);
    addInfo('Tariff (₹/kWh)', meterInfo.tariff);
    addInfo('Dual Source', meterInfo.isDualSource ? 'Yes (EB + DG)' : 'No');
  }

  if (meterDetail) {
    addInfo('Meter Serial', meterDetail.meterSerial);
    addInfo('Meter Address/IP', meterDetail.meterAddress);
    addInfo('Supply Type', meterDetail.supplyType);
    addInfo('Meter Title', meterDetail.title);
  }

  els.meterInfoGrid.innerHTML = html || '<div class="muted">No meter details available.</div>';
}

// ============================================================
// Charts (Chart.js)
// ============================================================

function updateCharts() {
  const { dailyRecords, powerMetrics } = currentData;
  
  // Theme colors
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const textColor = isDark ? '#9aa5b4' : '#5a6171';
  const gridColor = isDark ? '#2d3548' : '#e2e5ec';
  const barColor = isDark ? '#3cceb1' : '#3cceb1';
  const lineColor = isDark ? '#5b8af5' : '#0b3690';
  const powerColor = isDark ? '#fbbf24' : '#f59e0b';

  Chart.defaults.color = textColor;
  Chart.defaults.font.family = "'Montserrat', sans-serif";

  // Extract last 30 days of data and reverse for chronological order
  const chartData = [...(dailyRecords || [])].slice(0, 30).reverse();
  const labels = chartData.map(r => {
    const d = new Date(r.date + 'T00:00:00');
    return d.getDate(); // Just show day number on X axis
  });

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        enabled: true,
        mode: 'index',
        intersect: false,
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        titleColor: '#e2e8f0',
        bodyColor: '#cbd5e1',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
        cornerRadius: 8,
        padding: 12,
        bodySpacing: 6,
        titleFont: { size: 13, weight: 'bold' },
        bodyFont: { size: 12 },
        displayColors: false,
        callbacks: {
          title: function(tooltipItems) {
            const idx = tooltipItems[0].dataIndex;
            if (chartData[idx]) {
              const d = new Date(chartData[idx].date + 'T00:00:00');
              const day = d.getDate();
              const suffix = ["th", "st", "nd", "rd"][((day % 100) - 20) % 10] || ["th", "st", "nd", "rd"][day] || "th";
              const month = d.toLocaleString('en-IN', { month: 'long' });
              return `${day}${suffix} ${month}`;
            }
            return tooltipItems[0].label;
          },
          label: function(context) {
            let label = context.dataset.label || '';
            if (label) {
              label += ': ';
            }
            if (context.parsed.y !== null) {
              if (label.includes('Cost')) {
                label += '₹' + context.parsed.y.toFixed(2);
              } else if (label.includes('Consumption')) {
                label += context.parsed.y.toFixed(2) + ' kWh';
              } else {
                label += context.parsed.y;
              }
            }
            return label;
          }
        }
      }
    },
    scales: {
      x: {
        grid: { display: false, drawBorder: false }
      },
      y: {
        grid: { color: gridColor, drawBorder: false },
        beginAtZero: true
      }
    }
  };

  // 1. Daily kWh Chart
  const kwhCtx = document.getElementById('chart-daily-kwh');
  if (charts.dailyKwh) charts.dailyKwh.destroy();
  
  charts.dailyKwh = new Chart(kwhCtx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Consumption (kWh)',
        data: chartData.map(r => r.kwh),
        backgroundColor: barColor,
        borderRadius: 4
      }]
    },
    options: chartOptions
  });

  // 2. Daily Cost Chart
  const costCtx = document.getElementById('chart-daily-cost');
  if (charts.dailyCost) charts.dailyCost.destroy();
  
  charts.dailyCost = new Chart(costCtx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Cost (₹)',
        data: chartData.map(r => r.cost),
        borderColor: lineColor,
        backgroundColor: lineColor + '33', // 20% opacity
        borderWidth: 2,
        pointRadius: 2,
        fill: true,
        tension: 0.3
      }]
    },
    options: chartOptions
  });

  // 3. Power Chart
  const powerCtx = document.getElementById('chart-power');
  if (charts.power) charts.power.destroy();
  
  const powerSamples = powerMetrics?.samples || [];
  const tariffRate = currentData.tariff || 0;
  
  if (powerSamples.length === 0) {
    document.getElementById('power-section').classList.add('hidden');
  } else {
    document.getElementById('power-section').classList.remove('hidden');

    // Pre-calculate cumulative energy (kWh) and cost (₹) for each sample
    // Using trapezoidal integration between successive watt samples
    const cumulativeKwh = [];
    const cumulativeCost = [];
    let totalKwh = 0;

    for (let i = 0; i < powerSamples.length; i++) {
      if (i === 0) {
        cumulativeKwh.push(0);
        cumulativeCost.push(0);
        continue;
      }
      
      const dt = powerSamples[i].timestamp - powerSamples[i - 1].timestamp; // seconds
      const avgWatts = (powerSamples[i].watts + powerSamples[i - 1].watts) / 2;
      const kwhInterval = (avgWatts * dt) / (1000 * 3600); // W·s → kWh
      totalKwh += kwhInterval;
      
      cumulativeKwh.push(Math.round(totalKwh * 10000) / 10000);
      cumulativeCost.push(Math.round(totalKwh * tariffRate * 100) / 100);
    }
    
    charts.power = new Chart(powerCtx, {
      type: 'line',
      data: {
        labels: powerSamples.map(s => {
          const d = new Date(s.timestamp * 1000);
          return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }),
        datasets: [{
          label: 'Power (W)',
          data: powerSamples.map(s => s.watts),
          borderColor: powerColor,
          backgroundColor: powerColor + '22',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: true,
          stepped: true // Power is usually discrete readings
        }]
      },
      options: {
        ...chartOptions,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            titleColor: '#e2e8f0',
            bodyColor: '#cbd5e1',
            borderColor: 'rgba(255, 255, 255, 0.1)',
            borderWidth: 1,
            cornerRadius: 8,
            padding: 12,
            bodySpacing: 6,
            titleFont: { size: 13, weight: 'bold' },
            bodyFont: { size: 12 },
            displayColors: false,
            callbacks: {
              title: function(tooltipItems) {
                return tooltipItems[0].label;
              },
              label: function(context) {
                const idx = context.dataIndex;
                const watts = context.parsed.y;
                const lines = [];
                
                // Line 1: Power
                lines.push(`Power: ${watts.toFixed(2)} W`);
                
                // Line 2: Instantaneous energy rate (kW)
                lines.push(`Rate: ${(watts / 1000).toFixed(4)} kW`);
                
                // Line 3: Cumulative energy up to this point
                if (cumulativeKwh[idx] !== undefined) {
                  lines.push(`Energy (till now): ${cumulativeKwh[idx].toFixed(4)} kWh`);
                }
                
                // Line 4: Cumulative cost up to this point
                if (tariffRate > 0 && cumulativeCost[idx] !== undefined) {
                  lines.push(`Cost (till now): ₹${cumulativeCost[idx].toFixed(2)}`);
                }

                // Line 5: Interval energy (between previous and this sample)
                if (idx > 0) {
                  const intervalKwh = cumulativeKwh[idx] - cumulativeKwh[idx - 1];
                  const intervalCost = tariffRate > 0 ? (intervalKwh * tariffRate) : 0;
                  lines.push(`This interval: ${(intervalKwh * 1000).toFixed(2)} Wh (₹${intervalCost.toFixed(4)})`);
                }
                
                return lines;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false, drawBorder: false },
            ticks: {
              maxTicksLimit: 12
            }
          },
          y: {
            grid: { color: gridColor, drawBorder: false },
            beginAtZero: true
          }
        }
      }
    });
  }
}

// ============================================================
// Helpers
// ============================================================

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

// Start
document.addEventListener('DOMContentLoaded', init);
