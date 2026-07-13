/**
 * AWS Console Aesthetic - VDT 2026 MiniProject Aggregator
 * Client-side script handling data loading, parsing, adjustments, charts, and table rendering.
 */

// Configuration
const DEFAULT_SPREADSHEET_ID = '16rUgoJlObiB6ymHkzyDrn5wTW5XtmpPumYUr5FvHd4g';
const DEFAULT_SPREADSHEET_URL = `https://docs.google.com/spreadsheets/d/${DEFAULT_SPREADSHEET_ID}/edit?usp=sharing`;

// Application State
const state = {
  spreadsheetId: DEFAULT_SPREADSHEET_ID,
  spreadsheetUrl: DEFAULT_SPREADSHEET_URL,
  allParticipants: [], // Raw list parsed from Excel
  activeTrack: 'SwE',  // active track filter: 'SwE' (All), 'System', 'Web', 'HPC'
  activeBoard: 'all',  // board (sheet name) filter: 'all' or e.g. 'System 1'
  searchQuery: '',     // search query string
  interpolateScore: false,
  includeResigned: false,
  charts: {},          // ChartJS instances
  lastUpdated: ''
};

// Map of Mentor Unit to CSS Badge class names
const UNIT_BADGE_CLASSES = {
  'VCS': 'badge-vcs',
  'VTNET': 'badge-vtnet',
  'VTX': 'badge-vtx',
  'VHT': 'badge-vht',
  'VAC': 'badge-vac',
  'VTIT': 'badge-vtit',
  'VTT': 'badge-vtt',
  'VAI': 'badge-vai'
};

// Entry point
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

/**
 * Initializes the application: loads config, registers event listeners, and loads initial data.
 */
async function initApp() {
  setupEventListeners();
  loadSavedSettings();
  
  // Pre-fill Spreadsheet URL input field
  document.getElementById('sheetUrlInput').value = state.spreadsheetUrl;
  
  // Load initial dataset (prefer custom cached data, then pre-compiled static JSON, then fetch live)
  await loadInitialData();
}

/**
 * Setup Event Listeners for interactive controls.
 */
function setupEventListeners() {
  // Track sidebar menu items
  const menuItems = document.querySelectorAll('.sidebar-menu-item');
  menuItems.forEach(item => {
    item.addEventListener('click', (e) => {
      // Toggle active classes
      menuItems.forEach(el => el.classList.remove('active'));
      const li = e.currentTarget;
      li.classList.add('active');
      
      const track = li.getAttribute('data-track');
      changeTrack(track);
    });
  });

  // Checkboxes
  const interpolateCheckbox = document.getElementById('interpolateScoreCheckbox');
  interpolateCheckbox.addEventListener('change', (e) => {
    state.interpolateScore = e.target.checked;
    saveSettings();
    renderAll();
  });

  const includeResignedCheckbox = document.getElementById('includeResignedCheckbox');
  includeResignedCheckbox.addEventListener('change', (e) => {
    state.includeResigned = e.target.checked;
    saveSettings();
    renderAll();
  });

  // Search input in table header
  const tableSearch = document.getElementById('tableSearch');
  tableSearch.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    // Sync with global header search bar
    document.getElementById('globalSearch').value = state.searchQuery;
    renderTableOnly();
  });

  // Global search input in header
  const globalSearch = document.getElementById('globalSearch');
  globalSearch.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    // Sync with table search bar
    document.getElementById('tableSearch').value = state.searchQuery;
    renderTableOnly();
  });

  // Keyboard shortcut for search (focusing search when "/" is pressed)
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== globalSearch && document.activeElement !== tableSearch) {
      e.preventDefault();
      globalSearch.focus();
      globalSearch.select();
    }
  });

  // Board (sheet) filter dropdown
  const boardFilterSelect = document.getElementById('boardFilterSelect');
  boardFilterSelect.addEventListener('change', (e) => {
    state.activeBoard = e.target.value;
    renderTableOnly();
  });

  // Configuration Apply button
  const saveUrlBtn = document.getElementById('saveSheetUrlBtn');
  saveUrlBtn.addEventListener('click', () => {
    const inputVal = document.getElementById('sheetUrlInput').value;
    const extractedId = getSpreadsheetId(inputVal);
    if (!extractedId) {
      showToast('Error', 'Invalid Google Sheets URL. Could not parse Spreadsheet ID.', 'danger');
      return;
    }
    
    state.spreadsheetId = extractedId;
    state.spreadsheetUrl = inputVal.includes('docs.google.com') ? inputVal : `https://docs.google.com/spreadsheets/d/${extractedId}/edit`;
    saveSettings();
    
    // Fetch and parse live spreadsheet data
    fetchSpreadsheetLive();
  });

  // Configuration Reset button
  const resetUrlBtn = document.getElementById('resetSheetUrlBtn');
  resetUrlBtn.addEventListener('click', () => {
    state.spreadsheetId = DEFAULT_SPREADSHEET_ID;
    state.spreadsheetUrl = DEFAULT_SPREADSHEET_URL;
    document.getElementById('sheetUrlInput').value = DEFAULT_SPREADSHEET_URL;
    
    localStorage.removeItem('vdt2026_custom_data');
    localStorage.removeItem('vdt2026_sheet_id');
    localStorage.removeItem('vdt2026_sheet_url');
    
    showToast('Info', 'Reset to default spreadsheet. Reloading data...', 'info');
    loadInitialData();
  });

  // Refresh / Sync button
  const refreshBtn = document.getElementById('refreshDataBtn');
  refreshBtn.addEventListener('click', () => {
    fetchSpreadsheetLive();
  });

  // Time Comparison chart select dropdown
  const timeCompareSelect = document.getElementById('timeCompareSelect');
  timeCompareSelect.addEventListener('change', () => {
    renderTimeChart();
  });

  // Close toast alert
  const alertCloseBtn = document.getElementById('alertCloseBtn');
  alertCloseBtn.addEventListener('click', () => {
    document.getElementById('toastAlert').classList.add('hidden');
  });
}

/**
 * Load settings from localStorage
 */
function loadSavedSettings() {
  const savedId = localStorage.getItem('vdt2026_sheet_id');
  const savedUrl = localStorage.getItem('vdt2026_sheet_url');
  const savedInterpolate = localStorage.getItem('vdt2026_interpolate');
  const savedIncludeResigned = localStorage.getItem('vdt2026_include_resigned');
  
  if (savedId) state.spreadsheetId = savedId;
  if (savedUrl) state.spreadsheetUrl = savedUrl;
  
  if (savedInterpolate !== null) {
    state.interpolateScore = savedInterpolate === 'true';
    document.getElementById('interpolateScoreCheckbox').checked = state.interpolateScore;
  }
  if (savedIncludeResigned !== null) {
    state.includeResigned = savedIncludeResigned === 'true';
    document.getElementById('includeResignedCheckbox').checked = state.includeResigned;
  }
}

/**
 * Save settings to localStorage
 */
function saveSettings() {
  localStorage.setItem('vdt2026_sheet_id', state.spreadsheetId);
  localStorage.setItem('vdt2026_sheet_url', state.spreadsheetUrl);
  localStorage.setItem('vdt2026_interpolate', state.interpolateScore);
  localStorage.setItem('vdt2026_include_resigned', state.includeResigned);
}

/**
 * Extracts Google Spreadsheet ID from a URL or returns it directly if it's already an ID.
 */
function getSpreadsheetId(urlOrId) {
  if (!urlOrId) return null;
  let str = urlOrId.trim();
  if (str.length === 44) return str;
  let match = str.match(/\/d\/([a-zA-Z0-9-_]{44})/);
  if (match) return match[1];
  match = str.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  return null;
}

/**
 * Load initial data.
 * Checks localStorage cache first, falls back to pre-compiled static JSON, and then attempts live fetch if both fail.
 */
async function loadInitialData() {
  showLoadingState();
  
  // 1. Try local storage cache
  const cachedData = localStorage.getItem('vdt2026_custom_data');
  if (cachedData) {
    try {
      const data = JSON.parse(cachedData);
      state.allParticipants = data.all_participants;
      state.lastUpdated = data.lastUpdated || 'Loaded from local cache';
      
      updateLastUpdatedDisplay(state.lastUpdated);
      renderAll();
      showToast('Success', 'Successfully loaded data from local cache.', 'success');
      return;
    } catch (e) {
      console.warn('Failed to parse cached data from localStorage, falling back to static JSON.', e);
    }
  }

  // 2. Try loading preloaded data.json
  try {
    const response = await fetch('data.json');
    if (response.ok) {
      const data = await response.json();
      state.allParticipants = data.all_participants;
      state.lastUpdated = 'Preloaded static dataset (2026-07-13)';
      
      updateLastUpdatedDisplay(state.lastUpdated);
      renderAll();
      return;
    }
  } catch (e) {
    console.error('Failed to fetch data.json, attempting live spreadsheet load...', e);
  }

  // 3. Force live fetch from Google Sheet
  fetchSpreadsheetLive();
}

/**
 * Live fetches Excel file from Google Sheet, parses sheets using SheetJS, caches results, and updates UI.
 */
async function fetchSpreadsheetLive() {
  showLoadingState();
  const refreshBtn = document.getElementById('refreshDataBtn');
  refreshBtn.disabled = true;
  refreshBtn.querySelector('i').classList.add('fa-spin');
  refreshBtn.querySelector('span').innerText = 'Syncing...';
  
  const exportUrl = `https://docs.google.com/spreadsheets/d/${state.spreadsheetId}/export?format=xlsx`;
  
  try {
    const response = await fetch(exportUrl);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    
    const arrayBuffer = await response.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
    
    // Parse the parsed workbook sheets into state.allParticipants
    parseWorkbookData(workbook);
    
    // Cache successfully parsed data to localStorage
    state.lastUpdated = `Synced live at ${new Date().toLocaleTimeString()} on ${new Date().toLocaleDateString()}`;
    const cacheObject = {
      all_participants: state.allParticipants,
      lastUpdated: state.lastUpdated
    };
    localStorage.setItem('vdt2026_custom_data', JSON.stringify(cacheObject));
    
    updateLastUpdatedDisplay(state.lastUpdated);
    renderAll();
    showToast('Sync Complete', 'Successfully fetched and parsed the latest evaluations from Google Sheets!', 'success');
  } catch (error) {
    console.error('Error fetching live spreadsheet:', error);
    showToast('Sync Failed', `Could not connect to Google Sheets. Please check your URL/permissions. Error: ${error.message}`, 'danger');
    
    // Revert loading UI if we have data to display
    if (state.allParticipants.length > 0) {
      renderAll();
    } else {
      document.getElementById('tableBody').innerHTML = `
        <tr>
          <td colspan="12" class="table-empty-state" style="color: var(--color-danger)">
            <i class="fa-solid fa-triangle-exclamation"></i> Sync Failed: Could not load data.
          </td>
        </tr>
      `;
    }
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.querySelector('i').classList.remove('fa-spin');
    refreshBtn.querySelector('span').innerText = 'Refresh Data';
  }
}

/**
 * Parses raw XLSX workbook sheets using SheetJS.
 * Replicates the parsing logic from parse_data.py on client side.
 */
function parseWorkbookData(wb) {
  const parsedParticipants = [];
  
  // Filter active sheets starting with System, Web, or HPC
  const activeSheets = wb.SheetNames.filter(name => 
    name.startsWith('System') || name.startsWith('Web') || name.startsWith('HPC')
  );
  
  activeSheets.forEach(sheetName => {
    const sheet = wb.Sheets[sheetName];
    // Convert sheet to 2D array of rows
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    if (rows.length < 2) return;
    
    const row0 = rows[0];
    const headers = rows[1];
    
    // Determine whether this sheet contains grading columns
    const finalIdx = headers.indexOf('Final Score');
    const hasGrading = headers.length >= 31 && finalIdx !== -1;
    
    // Grader Names are in row 0 at index 9, 16, 23
    let grader1Name = "Grader 1";
    let grader2Name = "Grader 2";
    let grader3Name = "Grader 3";
    
    if (hasGrading) {
      if (row0.length > 9 && row0[9]) grader1Name = String(row0[9]).trim();
      if (row0.length > 16 && row0[16]) grader2Name = String(row0[16]).trim();
      if (row0.length > 23 && row0[23]) grader3Name = String(row0[23]).trim();
    }
    
    // Process participant rows
    for (let r = 2; r < rows.length; r++) {
      const row = rows[r];
      // Skip empty rows or rows without student names (index 4)
      if (!row || row.length < 5 || !row[4] || String(row[4]).trim() === '') continue;
      
      const board = row[0] ? String(row[0]).trim() : sheetName;
      let session = row[1] ? String(row[1]).trim() : '';
      if (session === 'Chiểu') session = 'Chiều'; // Fix accents typo
      
      // Date formatting
      let dateStr = '';
      const dateVal = row[2];
      if (dateVal instanceof Date) {
        let day = String(dateVal.getDate()).padStart(2, '0');
        let month = String(dateVal.getMonth() + 1).padStart(2, '0');
        dateStr = `${day}/${month}`;
      } else if (dateVal) {
        dateStr = String(dateVal).trim().split(' ')[0]; // clean time stamp
        let parts = dateStr.split('-');
        if (parts.length === 3) {
          dateStr = `${parts[2]}/${parts[1]}`;
        }
      }
      
      const timeSlot = row[3] ? String(row[3]).trim() : '';
      const studentName = String(row[4]).trim();
      
      // Phone number formatting
      let phoneStr = '';
      const phoneVal = row[5];
      if (phoneVal) {
        phoneStr = String(phoneVal).trim();
        if (phoneStr.includes('.')) {
          phoneStr = String(Math.floor(parseFloat(phoneStr)));
        }
        if (!phoneStr.startsWith('0') && /^\d+$/.test(phoneStr)) {
          phoneStr = '0' + phoneStr;
        }
      }
      
      // Project Code
      let projectCode = '';
      if (row.length > 6 && row[6] !== null) {
        projectCode = String(row[6]).trim();
        if (projectCode.includes('.')) {
          projectCode = String(Math.floor(parseFloat(projectCode)));
        }
      }
      
      const mentorUnit = row.length > 7 && row[7] ? String(row[7]).trim() : '';
      const note = row.length > 8 && row[8] ? String(row[8]).trim() : '';
      const isResigned = (note === '');
      
      const participant = {
        board: board,
        session: session,
        date: dateStr,
        timeSlot: timeSlot,
        studentName: studentName,
        phone: phoneStr,
        projectCode: projectCode,
        mentorUnit: mentorUnit,
        note: note,
        isResigned: isResigned,
        hasGrading: hasGrading
      };
      
      if (hasGrading) {
        // Helper to check if a cell is filled
        const isFilled = c => c !== null && c !== undefined && String(c).trim() !== '';

        // Grader 1
        const g1_criteria = [row[9], row[10], row[11], row[12], row[13], row[14]];
        const g1_total = row[15];
        const g1_graded = g1_criteria.some(isFilled);
        
        // Grader 2
        const g2_criteria = [row[16], row[17], row[18], row[19], row[20], row[21]];
        const g2_total = row[22];
        const g2_graded = g2_criteria.some(isFilled);
        
        // Grader 3
        const g3_criteria = [row[23], row[24], row[25], row[26], row[27], row[28]];
        const g3_total = row[29];
        const g3_graded = g3_criteria.some(isFilled);
        
        const graderCount = [g1_graded, g2_graded, g3_graded].filter(Boolean).length;
        
        let finalScore = parseFloat(row[30]);
        if (isNaN(finalScore)) finalScore = 0.0;
        
        participant.graderCount = graderCount;
        participant.finalScore = finalScore;
        participant.graders = [
          { name: grader1Name, total: parseFloat(g1_total) || 0.0, graded: g1_graded, criteria: g1_criteria },
          { name: grader2Name, total: parseFloat(g2_total) || 0.0, graded: g2_graded, criteria: g2_criteria },
          { name: grader3Name, total: parseFloat(g3_total) || 0.0, graded: g3_graded, criteria: g3_criteria }
        ];
      } else {
        participant.graderCount = 0;
        participant.finalScore = null;
        participant.graders = [];
      }
      
      parsedParticipants.push(participant);
    }
  });
  
  state.allParticipants = parsedParticipants;
}

/**
 * Changes active track. Triggered when clicking track sidebar items.
 */
function changeTrack(track) {
  state.activeTrack = track;
  state.activeBoard = 'all'; // reset board filter on track change
  
  // Update breadcrumb and page headers
  document.getElementById('breadcrumbActiveTrack').innerText = 
    track === 'SwE' ? 'SwE (All Tracks)' : track === 'Web' ? 'Web Development' : track;
  document.getElementById('dashboardTitle').innerText = 
    track === 'SwE' ? 'MiniProject Evaluations Dashboard' : `${track} Evaluation Dashboard`;
  
  // Rebuild the Board Filter dropdown dynamically based on the boards in the selected track
  rebuildBoardFilterDropdown();
  
  // Re-render dashboard widgets, charts, and table
  renderAll();
}

/**
 * Rebuilds the board selection dropdown menu based on the selected track.
 */
function rebuildBoardFilterDropdown() {
  const boardFilterSelect = document.getElementById('boardFilterSelect');
  boardFilterSelect.innerHTML = '<option value="all">All Boards</option>';
  
  // Gather unique board names for current track
  const activeBoards = new Set();
  state.allParticipants.forEach(p => {
    if (isInActiveTrack(p)) {
      activeBoards.add(p.board);
    }
  });
  
  // Sort alphabetically
  const sortedBoards = Array.from(activeBoards).sort((a, b) => {
    // Treat numeric endings correctly (e.g. System 2 before System 10)
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  });
  
  sortedBoards.forEach(board => {
    const opt = document.createElement('option');
    opt.value = board;
    opt.innerText = board;
    boardFilterSelect.appendChild(opt);
  });
}

/**
 * Helper to check if a participant belongs to the active track
 */
function isInActiveTrack(p) {
  if (state.activeTrack === 'SwE') return true;
  if (state.activeTrack === 'System') return p.board.startsWith('System');
  if (state.activeTrack === 'Web') return p.board.startsWith('Web');
  if (state.activeTrack === 'HPC') return p.board.startsWith('HPC');
  return false;
}

/**
 * Helper to calculate final score for a participant based on current state (interpolated vs raw)
 */
function getParticipantScore(p, interpolate) {
  if (!p.hasGrading) return null;
  if (p.isResigned) return 0.0;
  
  if (!interpolate) {
    return p.finalScore; // Raw final score from sheet
  }
  
  // Interpolated: Average of actual grader totals who graded the participant
  const gradedScores = p.graders.filter(g => g.graded).map(g => g.total);
  if (gradedScores.length === 0) return 0.0;
  
  const sum = gradedScores.reduce((acc, curr) => acc + curr, 0);
  return sum / gradedScores.length;
}

/**
 * Filter and sort participants in active track for evaluation (used in stats and table ranking)
 */
function getActiveTrackParticipants() {
  // Get all participants in active track
  let list = state.allParticipants.filter(p => isInActiveTrack(p));
  
  // Calculate temporary scores based on current interpolate setting
  list.forEach(p => {
    p.tempScore = getParticipantScore(p, state.interpolateScore);
  });
  
  return list;
}

/**
 * Renders all dashboard elements (Metrics, Charts, Table).
 */
function renderAll() {
  if (state.allParticipants.length === 0) {
    showLoadingState();
    return;
  }

  // 1. Calculate stats and render quick stats card banners
  renderQuickStats();

  // 2. Render Score Metrics summary card
  renderMetricsTable();

  // 3. Render charts
  renderDistributionChart();
  renderGraderBreakdownChart();
  renderGraderComparisonChart();
  renderTimeChart();

  // 4. Render participants directory table
  renderTableOnly();
}

/**
 * Computes and renders Quick Stats cards at the top
 */
function renderQuickStats() {
  const participants = state.allParticipants.filter(p => isInActiveTrack(p));
  const total = participants.length;
  
  const resigned = participants.filter(p => p.isResigned).length;
  
  // Active means graded by at least 1 member (or is HPC track student - count as active/graded? In VDT, HPC students don't have grades yet but are active)
  const graded = participants.filter(p => p.hasGrading ? p.graderCount > 0 : !p.isResigned).length;
  
  // Average Score of active track
  const gradedPart = participants.filter(p => {
    let s = getParticipantScore(p, state.interpolateScore);
    return s !== null && (state.includeResigned || !p.isResigned);
  });
  
  let avg = 0;
  if (gradedPart.length > 0) {
    const sum = gradedPart.reduce((acc, p) => acc + getParticipantScore(p, state.interpolateScore), 0);
    avg = sum / gradedPart.length;
  }

  document.getElementById('statTotalStudents').innerText = total;
  document.getElementById('statGradedStudents').innerText = graded;
  document.getElementById('statResignedStudents').innerText = resigned;
  document.getElementById('statAverageScore').innerText = avg.toFixed(2);
}

/**
 * Computes statistics and renders metrics summary table
 */
function renderMetricsTable() {
  const participants = getActiveTrackParticipants();
  
  // Filter scores considering 'includeResigned' setting
  const scores = participants
    .filter(p => {
      if (p.tempScore === null) return false; // Exclude ungraded (like HPC)
      if (!state.includeResigned && p.isResigned) return false; // Exclude resigned if toggle off
      return true;
    })
    .map(p => p.tempScore);
    
  const stats = calculateStats(scores);
  
  // Render
  document.getElementById('metricMean').innerText = stats.mean.toFixed(2);
  document.getElementById('metricMax').innerText = stats.max.toFixed(2);
  document.getElementById('metricMedian').innerText = stats.median.toFixed(2);
  document.getElementById('metricMin').innerText = stats.min.toFixed(2);
  document.getElementById('metricStd').innerText = stats.std.toFixed(2);
  document.getElementById('metricP25').innerText = stats.p25.toFixed(2);
  document.getElementById('metricP75').innerText = stats.p75.toFixed(2);
  document.getElementById('metricP90').innerText = stats.p90.toFixed(2);
  document.getElementById('metricP95').innerText = stats.p95.toFixed(2);
  document.getElementById('metricGradedCount').innerText = scores.length;
  
  document.getElementById('metricsFilterLabel').innerText = 
    state.includeResigned ? 'All SVs (incl. Resigned)' : 'Active SVs Only';
}

/**
 * Performs statistical computations on a list of numeric scores
 */
function calculateStats(scores) {
  if (scores.length === 0) {
    return { mean: 0, max: 0, median: 0, min: 0, std: 0, p25: 0, p75: 0, p90: 0, p95: 0 };
  }
  
  const sorted = [...scores].sort((a, b) => a - b);
  const n = sorted.length;
  
  const min = sorted[0];
  const max = sorted[n - 1];
  
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  
  // Median
  let median = 0;
  if (n % 2 === 1) {
    median = sorted[Math.floor(n / 2)];
  } else {
    median = (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  }
  
  // Variance & StdDev
  const variance = sorted.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
  const std = Math.sqrt(variance);
  
  // Percentile helper
  function getPercentile(arr, p) {
    const idx = (arr.length - 1) * p;
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    const weight = idx - lower;
    return arr[lower] * (1 - weight) + arr[upper] * weight;
  }
  
  const p25 = getPercentile(sorted, 0.25);
  const p75 = getPercentile(sorted, 0.75);
  const p90 = getPercentile(sorted, 0.90);
  const p95 = getPercentile(sorted, 0.95);
  
  return { mean, max, median, min, std, p25, p75, p90, p95 };
}

/**
 * Chart 1: Final Score Distribution Histogram (bins of size 1, 0 to 100)
 */
function renderDistributionChart() {
  const participants = getActiveTrackParticipants();
  
  // Filter active scores (exclude HPC/resigned if applicable)
  const scores = participants
    .filter(p => {
      if (p.tempScore === null) return false;
      if (!state.includeResigned && p.isResigned) return false;
      return true;
    })
    .map(p => p.tempScore);

  const canvasId = 'scoreHistogramChart';
  const noDataEl = document.getElementById('noDataHistogram');
  
  if (scores.length === 0) {
    document.getElementById(canvasId).style.display = 'none';
    noDataEl.classList.remove('hidden');
    return;
  } else {
    document.getElementById(canvasId).style.display = 'block';
    noDataEl.classList.add('hidden');
  }

  // Count frequencies in bins of size 1 (0 to 100)
  const bins = Array(101).fill(0);
  scores.forEach(s => {
    const rounded = Math.min(100, Math.max(0, Math.floor(s)));
    bins[rounded]++;
  });

  const labels = Array.from({ length: 101 }, (_, i) => i);

  createOrUpdateChart(canvasId, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Student Count',
        data: bins,
        backgroundColor: 'rgba(236, 114, 17, 0.75)',
        borderColor: '#ec7211',
        borderWidth: 1,
        barPercentage: 1.0,
        categoryPercentage: 1.0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => `Score: ${items[0].label}`,
            label: (item) => `${item.raw} student(s)`
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'Score Interval (Bin size = 1)', color: '#94a3b8', font: { size: 10 } },
          grid: { display: false },
          ticks: {
            callback: function(val, idx) {
              return idx % 10 === 0 ? idx : '';
            },
            color: '#94a3b8',
            font: { size: 10 }
          }
        },
        y: {
          title: { display: true, text: 'Number of Students', color: '#94a3b8', font: { size: 10 } },
          grid: { color: 'rgba(255,255,255,0.06)' },
          ticks: { precision: 0, color: '#94a3b8', font: { size: 10 } }
        }
      }
    }
  });
}

/**
 * Chart 2: Grader Count Breakdown (Resigned, Graded by 0, 1, 2, 3)
 * Total sum is equal to the total number of track participants.
 */
function renderGraderBreakdownChart() {
  const participants = getActiveTrackParticipants();
  
  const counts = { resigned: 0, g0: 0, g1: 0, g2: 0, g3: 0 };
  participants.forEach(p => {
    if (p.isResigned) {
      counts.resigned++;
    } else if (p.graderCount === 0) {
      counts.g0++;
    } else if (p.graderCount === 1) {
      counts.g1++;
    } else if (p.graderCount === 2) {
      counts.g2++;
    } else if (p.graderCount === 3) {
      counts.g3++;
    }
  });

  const totalSum = counts.resigned + counts.g0 + counts.g1 + counts.g2 + counts.g3;

  createOrUpdateChart('graderCountDistributionChart', {
    type: 'bar',
    data: {
      labels: [
        'Resigned (Blank Note)',
        'Graded by 0 Members',
        'Graded by 1 Grader',
        'Graded by 2 Graders',
        'Graded by 3 Graders'
      ],
      datasets: [{
        data: [counts.resigned, counts.g0, counts.g1, counts.g2, counts.g3],
        backgroundColor: [
          'rgba(223, 62, 62, 0.75)',   // Red for resigned
          'rgba(100, 116, 139, 0.75)', // Gray for 0
          'rgba(248, 148, 6, 0.75)',   // Amber for 1
          'rgba(0, 115, 187, 0.75)',   // Blue for 2
          'rgba(46, 168, 90, 0.75)'    // Green for 3
        ],
        borderColor: [
          '#df3e3e', '#64748b', '#f89406', '#0073bb', '#2ea85a'
        ],
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            footer: () => `Total Participants: ${totalSum}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#94a3b8', font: { size: 10 } }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.06)' },
          ticks: { precision: 0, color: '#94a3b8', font: { size: 10 } }
        }
      }
    }
  });
}

/**
 * Chart 3: Grader Comparison Chart (Average score given by each unique grader unit)
 */
function renderGraderComparisonChart() {
  const participants = getActiveTrackParticipants();
  
  // Calculate average score given by each unique grader unit
  const graderScores = {}; // { graderName: { sum: 0, count: 0 } }
  
  participants.forEach(p => {
    if (!p.hasGrading || p.isResigned) return;
    p.graders.forEach(g => {
      if (g.graded && g.total > 0) {
        if (!graderScores[g.name]) {
          graderScores[g.name] = { sum: 0, count: 0 };
        }
        graderScores[g.name].sum += g.total;
        graderScores[g.name].count++;
      }
    });
  });

  const canvasId = 'graderComparisonChart';
  const noDataEl = document.getElementById('noDataGrader');

  const graderNames = Object.keys(graderScores);
  if (graderNames.length === 0) {
    document.getElementById(canvasId).style.display = 'none';
    noDataEl.classList.remove('hidden');
    return;
  } else {
    document.getElementById(canvasId).style.display = 'block';
    noDataEl.classList.add('hidden');
  }

  // Map to list, compute averages, and sort by average score descending
  const gradersList = graderNames.map(name => ({
    name: name,
    avg: graderScores[name].sum / graderScores[name].count,
    count: graderScores[name].count
  })).sort((a, b) => b.avg - a.avg);

  createOrUpdateChart(canvasId, {
    type: 'bar',
    data: {
      labels: gradersList.map(g => g.name),
      datasets: [{
        label: 'Average Score Given',
        data: gradersList.map(g => g.avg.toFixed(2)),
        backgroundColor: 'rgba(0, 115, 187, 0.75)', // AWS blue
        borderColor: '#0073bb',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => {
              const info = gradersList[item.dataIndex];
              return `Avg: ${item.raw} (graded ${info.count} students)`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#94a3b8', font: { size: 10 } }
        },
        y: {
          min: 0,
          max: 100,
          grid: { color: 'rgba(255,255,255,0.06)' },
          ticks: { color: '#94a3b8', font: { size: 10 } }
        }
      }
    }
  });
}

/**
 * Chart 4: Temporal Score Comparison (comparing average scores by Session, Date, or Time Slot)
 */
function renderTimeChart() {
  const participants = getActiveTrackParticipants();
  
  // Filter active graded participants (exclude resigned / ungraded)
  const gradedPart = participants.filter(p => 
    p.tempScore !== null && !p.isResigned
  );

  const canvasId = 'timeComparisonChart';
  const noDataEl = document.getElementById('noDataTime');

  if (gradedPart.length === 0) {
    document.getElementById(canvasId).style.display = 'none';
    noDataEl.classList.remove('hidden');
    return;
  } else {
    document.getElementById(canvasId).style.display = 'block';
    noDataEl.classList.add('hidden');
  }

  // Get selected grouping mode
  const compareBy = document.getElementById('timeCompareSelect').value;
  
  const groups = {}; // { groupName: { sum: 0, count: 0 } }
  
  gradedPart.forEach(p => {
    let key = '';
    if (compareBy === 'session') {
      key = p.session || 'N/A';
    } else if (compareBy === 'date') {
      key = p.date || 'N/A';
    } else {
      key = p.timeSlot || 'N/A';
    }
    
    if (!groups[key]) {
      groups[key] = { sum: 0, count: 0 };
    }
    groups[key].sum += p.tempScore;
    groups[key].count++;
  });

  const keys = Object.keys(groups);
  
  // Sort keys chronological/alphabetical
  keys.sort((a, b) => {
    if (compareBy === 'session') {
      // Sáng first, Chiều second
      if (a === 'Sáng') return -1;
      if (b === 'Sáng') return 1;
      return a.localeCompare(b);
    }
    return a.localeCompare(b, undefined, { numeric: true });
  });

  const chartData = keys.map(key => ({
    label: key,
    avg: groups[key].sum / groups[key].count,
    count: groups[key].count
  }));

  createOrUpdateChart(canvasId, {
    type: 'bar',
    data: {
      labels: chartData.map(d => d.label),
      datasets: [{
        data: chartData.map(d => d.avg.toFixed(2)),
        backgroundColor: 'rgba(46, 168, 90, 0.75)', // Green
        borderColor: '#2ea85a',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => {
              const info = chartData[item.dataIndex];
              return `Avg: ${item.raw} (${info.count} evaluations)`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#94a3b8', font: { size: 10 } }
        },
        y: {
          min: 0,
          max: 100,
          grid: { color: 'rgba(255,255,255,0.06)' },
          ticks: { color: '#94a3b8', font: { size: 10 } }
        }
      }
    }
  });
}

/**
 * Creates a new chart or destroys the previous instance if it already exists, avoiding canvas reuse bugs.
 */
function createOrUpdateChart(id, config) {
  if (state.charts[id]) {
    state.charts[id].destroy();
  }
  const ctx = document.getElementById(id).getContext('2d');
  state.charts[id] = new Chart(ctx, config);
}

/**
 * Renders ONLY the participants directory table.
 * Separated to handle fast table filtering/searching without rebuilding heavy charts.
 */
function renderTableOnly() {
  const tableBody = document.getElementById('tableBody');
  const tableEmptyState = document.getElementById('tableEmptyState');
  
  // 1. Get track participants
  const trackPart = getActiveTrackParticipants();
  
  // 2. Rank participants on the ENTIRE active track before applying search / board filters
  // This ensures ranks are absolute within their track, rather than local to search results
  
  // Filter for those who have evaluation scores
  const gradedPart = trackPart.filter(p => 
    p.tempScore !== null && (state.includeResigned || !p.isResigned)
  );
  
  // Sort graded descending
  gradedPart.sort((a, b) => b.tempScore - a.tempScore);
  
  // Assign ranks (handle ties)
  let currentRank = 0;
  let lastScore = -1;
  gradedPart.forEach((p, idx) => {
    if (p.tempScore !== lastScore) {
      currentRank = idx + 1;
      lastScore = p.tempScore;
    }
    p.rank = currentRank;
    p.percentile = ((currentRank / gradedPart.length) * 100).toFixed(1);
  });
  
  // Set rank as N/A for ungraded/resigned if they were excluded
  trackPart.forEach(p => {
    const isEvaluated = gradedPart.includes(p);
    if (!isEvaluated) {
      p.rank = null;
      p.percentile = null;
    }
  });
  
  // 3. Sort active track participants based on rank (highest score first)
  // Those with N/A score/rank go to the bottom
  const sortedTrackPart = [...trackPart].sort((a, b) => {
    if (a.tempScore === null && b.tempScore === null) return 0;
    if (a.tempScore === null) return 1;
    if (b.tempScore === null) return -1;
    
    // Sort by score descending
    return b.tempScore - a.tempScore;
  });

  // 4. Apply Board (sheet) filter and Search query
  const searchNorm = removeDiacritics(state.searchQuery.toLowerCase());
  
  const filteredList = sortedTrackPart.filter(p => {
    // Board filter
    if (state.activeBoard !== 'all' && p.board !== state.activeBoard) {
      return false;
    }
    
    // Search query (Student name, phone, project code, or mentor unit)
    if (searchNorm !== '') {
      const nameNorm = removeDiacritics(p.studentName.toLowerCase());
      const phone = p.phone.toLowerCase();
      const code = p.projectCode.toLowerCase();
      const unit = p.mentorUnit.toLowerCase();
      
      const match = nameNorm.includes(searchNorm) || 
                    phone.includes(searchNorm) || 
                    code.includes(searchNorm) || 
                    unit.includes(searchNorm);
      if (!match) return false;
    }
    
    return true;
  });

  // Render Table Records count
  document.getElementById('tableRecordCount').innerText = `${filteredList.length} records found`;

  // Render rows
  if (filteredList.length === 0) {
    tableBody.innerHTML = '';
    tableEmptyState.classList.remove('hidden');
    return;
  }
  
  tableEmptyState.classList.add('hidden');
  
  let html = '';
  filteredList.forEach(p => {
    const badgeClass = UNIT_BADGE_CLASSES[p.mentorUnit.toUpperCase()] || 'badge-default';
    const scoreText = p.tempScore !== null ? p.tempScore.toFixed(2) : '<span class="resigned-text">N/A (Ungraded)</span>';
    const rankText = p.rank !== null ? p.rank : '<span class="resigned-text">-</span>';
    const pctText = p.percentile !== null ? `Top ${p.percentile}%` : '<span class="resigned-text">-</span>';
    
    // Build Ghi chú / Note column
    let noteHtml = '';
    if (p.note) {
      if (p.note.startsWith('http')) {
        noteHtml = `<a href="${p.note}" target="_blank" class="note-link" title="Open attachment"><i class="fa-regular fa-folder-open"></i></a>`;
      } else {
        noteHtml = `<span class="note-text" title="${p.note}">${p.note}</span>`;
      }
    } else {
      noteHtml = `<span class="resigned-text">Resigned</span>`;
    }
    
    const rowClass = p.isResigned ? 'resigned-row' : '';

    html += `
      <tr class="${rowClass}">
        <td class="rank-col">${rankText}</td>
        <td class="percentile-col">${pctText}</td>
        <td>${p.board}</td>
        <td>${p.session}</td>
        <td>${p.date}</td>
        <td>${p.timeSlot}</td>
        <td class="student-name-col">${p.studentName}</td>
        <td>${p.phone}</td>
        <td style="text-align: center;">${p.projectCode}</td>
        <td><span class="unit-badge ${badgeClass}">${p.mentorUnit}</span></td>
        <td style="text-align: center;">${noteHtml}</td>
        <td class="score-col">${scoreText}</td>
      </tr>
    `;
  });
  
  tableBody.innerHTML = html;
}

/**
 * Normalizes Vietnamese text by stripping accents and diacritics.
 * Crucial for intuitive Vietnamese diacritics-insensitive search.
 */
function removeDiacritics(str) {
  if (!str) return '';
  return str.normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd')
            .replace(/Đ/g, 'D');
}

/**
 * Puts UI in a loading state.
 */
function showLoadingState() {
  document.getElementById('tableBody').innerHTML = `
    <tr>
      <td colspan="12" class="table-empty-state">
        <i class="fa-solid fa-spinner fa-spin"></i> Fetching evaluations and compiling results...
      </td>
    </tr>
  `;
  document.getElementById('tableRecordCount').innerText = 'Loading...';
}

/**
 * Updates UI date stamp
 */
function updateLastUpdatedDisplay(text) {
  document.getElementById('lastUpdatedDisplay').innerText = `Status: ${text}`;
}

/**
 * Toast/Alert system. Renders AWS Alert banners at the top of content.
 */
function showToast(title, desc, type = 'info') {
  const toast = document.getElementById('toastAlert');
  const tTitle = document.getElementById('alertTitle');
  const tDesc = document.getElementById('alertDesc');
  const tIcon = document.getElementById('alertIcon');
  
  toast.className = 'aws-alert'; // reset classes
  
  if (type === 'success') {
    toast.classList.add('alert-success');
    tIcon.className = 'fa-solid fa-circle-check';
  } else if (type === 'danger') {
    toast.classList.add('alert-danger');
    tIcon.className = 'fa-solid fa-circle-xmark';
  } else if (type === 'warning') {
    toast.classList.add('alert-warning');
    tIcon.className = 'fa-solid fa-triangle-exclamation';
  } else {
    tIcon.className = 'fa-solid fa-circle-info';
  }
  
  tTitle.innerText = title;
  tDesc.innerText = desc;
  
  // Scroll to alert
  toast.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  
  // Auto dismiss after 6 seconds for success/info, keep danger
  if (type !== 'danger') {
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 6000);
  }
}
