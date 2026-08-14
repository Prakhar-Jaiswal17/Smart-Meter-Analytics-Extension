/**
 * popup.js
 */

const els = {
  refreshBtn: document.getElementById('refresh-btn'),
  openDashboardBtn: document.getElementById('open-dashboard-btn'),
  
  loadingState: document.getElementById('loading-state'),
  errorState: document.getElementById('error-state'),
  errorMessage: document.getElementById('error-message'),
  authState: document.getElementById('auth-state'),
  mainContent: document.getElementById('main-content'),

  todayKwh: document.getElementById('today-kwh'),
  todayCost: document.getElementById('today-cost'),
  walletBalance: document.getElementById('wallet-balance'),
  walletEstimate: document.getElementById('wallet-estimate'),
  latestPower: document.getElementById('latest-power'),
  peakPower: document.getElementById('peak-power'),
  lastUpdated: document.getElementById('last-updated')
};

document.addEventListener('DOMContentLoaded', init);

function init() {
  els.refreshBtn.addEventListener('click', () => loadData(true));
  
  els.openDashboardBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/dashboard.html') });
  });

  loadData();
}

async function loadData(forceRefresh = false) {
  showState('loading');
  if (forceRefresh) els.refreshBtn.classList.add('loading');

  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: forceRefresh ? 'REFRESH_DATA' : 'GET_POPUP_DATA'
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

    // Determine correct response payload depending on message type
    const data = forceRefresh ? await getPopupDataViaMessage() : response.data;
    
    if (data) {
        renderData(data);
        showState('content');
    } else {
        throw new Error("Unable to parse data.");
    }

  } catch (error) {
    console.error('Popup load error:', error);
    els.errorMessage.textContent = error.message;
    showState('error');
  } finally {
    els.refreshBtn.classList.remove('loading');
  }
}

async function getPopupDataViaMessage() {
    const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'GET_POPUP_DATA'
        }, resolve);
      });
    return response.success ? response.data : null;
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

function renderData(data) {
  if (data.todayKwh != null) {
    els.todayKwh.textContent = data.todayKwh.toFixed(2) + ' kWh';
    els.todayCost.textContent = '₹' + data.todayCost.toFixed(2);
  } else {
    els.todayKwh.textContent = '—';
    els.todayCost.textContent = 'No data today';
  }

  if (data.walletBalance != null) {
    els.walletBalance.textContent = '₹' + data.walletBalance.toFixed(2);
    if (data.estimatedDays) {
      els.walletEstimate.textContent = `~${data.estimatedDays} days left`;
    } else {
      els.walletEstimate.textContent = '';
    }
  } else {
    els.walletBalance.textContent = '—';
    els.walletEstimate.textContent = '';
  }

  if (data.latestPower != null) {
    els.latestPower.textContent = `${data.latestPower} W (${data.latestPowerTime})`;
  } else {
    els.latestPower.textContent = '—';
  }

  if (data.peakPower != null) {
    els.peakPower.textContent = `${data.peakPower} W (${data.peakPowerTime})`;
  } else {
    els.peakPower.textContent = '—';
  }

  if (data.lastUpdated) {
    const d = new Date(data.lastUpdated);
    els.lastUpdated.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else {
    els.lastUpdated.textContent = '—';
  }
}
