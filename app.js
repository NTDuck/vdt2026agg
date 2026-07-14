/**
 * Console Aesthetic - VDT 2026 MiniProject Evaluations Aggregator
 * Client-side script handling data loading, parsing, adjustments, charts, and table rendering.
 * Conforms mathematically to nocturnal16/vsd (PERCENTILE.INC, PERCENTRANK.INC, and Dense Ranking).
 * Implements 10-record pagination, "participant" vocabulary, and smooth layout animations.
 */

// Configuration
const DEFAULT_SPREADSHEET_ID = '16rUgoJlObiB6ymHkzyDrn5wTW5XtmpPumYUr5FvHd4g';
const DEFAULT_SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/16rUgoJlObiB6ymHkzyDrn5wTW5XtmpPumYUr5FvHd4g/edit?gid=2076177057#gid=2076177057';

// Application State
const state = {
  spreadsheetId: DEFAULT_SPREADSHEET_ID,
  spreadsheetUrl: DEFAULT_SPREADSHEET_URL,
  allParticipants: [], // Raw participant list parsed from Excel
  activeTrack: 'SwE',  // active track filter: 'SwE' (All), 'System', 'Web', 'HPC'
  activeBoard: 'all',  // board (sheet name) filter: 'all' or specific sheet
  searchQuery: '',     // search query string
  interpolateScore: false,
  includeResigned: false,
  currentPage: 1,      // Pagination state: page index starting at 1
  prevPage: 1,         // Previous page to calculate scroll transition direction
  theme: 'dark',       // Default theme, will be adjusted dynamically
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

// ==========================================================================
// MATHEMATICAL ENGINES (Conforming to Excel / vsd)
// ==========================================================================

/**
 * Returns true if the value represents a valid numeric score (ignores empty strings and whitespace)
 */
function isNumeric(val) {
  if (val === null || val === undefined) return false;
  const str = String(val).trim();
  if (str === '') return false;
  const num = Number(str);
  return !isNaN(num) && isFinite(num);
}

/**
 * Emulates Excel/Google Sheets PERCENTILE.INC
 * Returns the p-th percentile of a sorted ascending array of numbers.
 */
function percentileInc(arr, p) {
  if (!arr || arr.length === 0) return 0;
  if (arr.length === 1) return arr[0];
  if (p <= 0) return arr[0];
  if (p >= 1) return arr[arr.length - 1];

  const idx = p * (arr.length - 1);
  const floor = Math.floor(idx);
  const ceil = Math.ceil(idx);

  if (floor === ceil) {
    return arr[floor];
  }
  return arr[floor] + (idx - floor) * (arr[ceil] - arr[floor]);
}

/**
 * Emulates Excel/Google Sheets PERCENTRANK.INC
 * Returns the percentile rank of value x in a sorted ascending array of numbers.
 * Appropriately averages duplicated values and interpolates intermediate values.
 */
function percentRankInc(arr, x) {
  const N = arr.length;
  if (N === 0) return 0;
  if (N === 1) return 1.0;

  if (x <= arr[0]) return 0.0;
  if (x >= arr[N - 1]) return 1.0;

  // Check for exact matching values
  const firstIdx = arr.indexOf(x);
  if (firstIdx !== -1) {
    const lastIdx = arr.lastIndexOf(x);
    // If duplicates exist, average their index positions
    return (firstIdx + lastIdx) / (2 * (N - 1));
  }

  // Interpolate if value lies between elements
  for (let i = 0; i < N - 1; i++) {
    if (x > arr[i] && x < arr[i + 1]) {
      const r_i = percentRankInc(arr, arr[i]);
      const r_i1 = percentRankInc(arr, arr[i + 1]);
      return r_i + ((x - arr[i]) / (arr[i + 1] - arr[i])) * (r_i1 - r_i);
    }
  }
  return 0.0;
}

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

  // Load initial dataset (prefer cache, then pre-compiled static JSON, then fetch live)
  await loadInitialData();
}

/**
 * Setup Event Listeners for interactive controls.
 */
function setupEventListeners() {
  // Theme Toggle Button
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  themeToggleBtn.addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme(state.theme);
    saveSettings();
    renderAll(); // Re-render to update ChartJS colors and tooltips!
  });

  // Track tabs selector
  const trackTabs = document.querySelectorAll('.track-tab');
  trackTabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      trackTabs.forEach(el => el.classList.remove('active'));
      const btn = e.currentTarget;
      btn.classList.add('active');

      const track = btn.getAttribute('data-track');
      changeTrack(track);
    });
  });

  // Toggle Settings panel button
  const toggleSettingsBtn = document.getElementById('toggleSettingsBtn');
  const settingsPanel = document.getElementById('settingsPanel');
  toggleSettingsBtn.addEventListener('click', () => {
    const isCollapsed = settingsPanel.classList.toggle('collapsed');
    toggleSettingsBtn.classList.toggle('active', !isCollapsed);
  });

  // Checkboxes inside settings panel
  const interpolateCheckbox = document.getElementById('interpolateScoreCheckbox');
  interpolateCheckbox.addEventListener('change', (e) => {
    state.interpolateScore = e.target.checked;
    saveSettings();
    state.currentPage = 1;
    renderAll();
  });

  const includeResignedCheckbox = document.getElementById('includeResignedCheckbox');
  includeResignedCheckbox.addEventListener('change', (e) => {
    state.includeResigned = e.target.checked;
    saveSettings();
    state.currentPage = 1;
    renderAll();
  });

  // Search input in toolbar
  const tableSearch = document.getElementById('tableSearch');
  tableSearch.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    state.currentPage = 1;
    renderTableOnly();
  });

  // Keyboard shortcut for search ("/" key)
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== tableSearch) {
      e.preventDefault();
      tableSearch.focus();
      tableSearch.select();
    }
  });

  // Board (sheet) filter dropdown
  const boardFilterSelect = document.getElementById('boardFilterSelect');
  boardFilterSelect.addEventListener('change', (e) => {
    state.activeBoard = e.target.value;
    state.currentPage = 1;
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

  // Bin size select for histogram
  const binSizeSelect = document.getElementById('binSizeSelect');
  if (binSizeSelect) {
    binSizeSelect.addEventListener('change', () => {
      renderDistributionChart();
    });
  }

  // Pagination buttons
  const prevPageBtn = document.getElementById('prevPageBtn');
  prevPageBtn.addEventListener('click', () => {
    if (state.currentPage > 1) {
      state.currentPage--;
      renderTableOnly();
    }
  });

  const nextPageBtn = document.getElementById('nextPageBtn');
  nextPageBtn.addEventListener('click', () => {
    const totalRecords = getFilteredListCount();
    const totalPages = Math.ceil(totalRecords / 10) || 1;
    if (state.currentPage < totalPages) {
      state.currentPage++;
      renderTableOnly();
    }
  });

  // Table wrapper scroll pagination
  const tableWrapper = document.querySelector('.table-wrapper');
  if (tableWrapper) {
    let lastScrollTop = tableWrapper.scrollTop;
    let scrollCooldown = false;

    tableWrapper.addEventListener('scroll', () => {
      if (scrollCooldown) return;

      const { scrollTop, scrollHeight, clientHeight } = tableWrapper;

      if (scrollTop + clientHeight >= scrollHeight - 3) {
        const totalRecords = getFilteredListCount();
        const totalPages = Math.ceil(totalRecords / 10) || 1;
        if (state.currentPage < totalPages) {
          scrollCooldown = true;
          state.currentPage++;
          renderTableOnly();
          tableWrapper.scrollTop = 4;
          setTimeout(() => { scrollCooldown = false; }, 400);
        }
      }
      else if (scrollTop <= 1 && lastScrollTop > scrollTop) {
        if (state.currentPage > 1) {
          scrollCooldown = true;
          state.currentPage--;
          renderTableOnly();
          tableWrapper.scrollTop = tableWrapper.scrollHeight - tableWrapper.clientHeight - 4;
          setTimeout(() => { scrollCooldown = false; }, 400);
        }
      }

      lastScrollTop = tableWrapper.scrollTop;
    });
  }

  // Close toast alert
  const alertCloseBtn = document.getElementById('alertCloseBtn');
  alertCloseBtn.addEventListener('click', () => {
    document.getElementById('toastAlert').classList.add('hidden');
  });

  // Track tab highlights window resize syncing
  window.addEventListener('resize', updateTabHighlight);
}

/**
 * Apply the selected theme to the body and update UI icons.
 */
function applyTheme(theme) {
  document.body.className = theme === 'dark' ? 'aws-dark-theme' : 'aws-light-theme';
  const themeIcon = document.getElementById('themeIcon');
  if (theme === 'dark') {
    themeIcon.className = 'fa-solid fa-sun';
  } else {
    themeIcon.className = 'fa-solid fa-moon';
  }
}

/**
 * Returns grid and text colors, and custom tooltip colors for ChartJS depending on theme.
 */
function getChartThemeColors() {
  const isDark = state.theme === 'dark';
  return {
    grid: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)',
    text: isDark ? '#94a3b8' : '#545b64',
    tooltipBg: isDark ? '#1b2430' : '#ffffff',
    tooltipTitle: isDark ? '#ffffff' : '#16191f',
    tooltipBody: isDark ? '#e2e8f0' : '#545b64',
    tooltipBorder: isDark ? 'rgba(255, 255, 255, 0.1)' : '#eaeded'
  };
}

/**
 * Load initial data.
 */
async function loadInitialData() {
  showLoadingState();

  const cachedData = localStorage.getItem('vdt2026_custom_data');
  if (cachedData) {
    try {
      const data = JSON.parse(cachedData);
      state.allParticipants = data.all_participants;
      normalizeParticipants(state.allParticipants);
      state.lastUpdated = data.lastUpdated || 'Loaded from local cache';

      updateLastUpdatedDisplay(state.lastUpdated);
      renderAll();
      showToast('Success', 'Successfully loaded data from local cache.', 'success');
      return;
    } catch (e) {
      console.warn('Failed to parse cached data from localStorage, falling back to static JSON.', e);
    }
  }

  try {
    const response = await fetch('data.json');
    if (response.ok) {
      const data = await response.json();
      state.allParticipants = data.all_participants;
      normalizeParticipants(state.allParticipants);
      state.lastUpdated = 'Preloaded static dataset (2026-07-13)';

      updateLastUpdatedDisplay(state.lastUpdated);
      renderAll();
      return;
    }
  } catch (e) {
    console.error('Failed to fetch data.json, attempting live spreadsheet load...', e);
  }

  fetchSpreadsheetLive();
}

/**
 * Live fetches Excel file from Google Sheet, parses sheets, and updates UI.
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

    parseWorkbookData(workbook);

    state.lastUpdated = `Synced live at ${new Date().toLocaleTimeString()} on ${new Date().toLocaleDateString()}`;
    const cacheObject = {
      all_participants: state.allParticipants,
      lastUpdated: state.lastUpdated
    };
    localStorage.setItem('vdt2026_custom_data', JSON.stringify(cacheObject));

    updateLastUpdatedDisplay(state.lastUpdated);
    state.currentPage = 1;
    renderAll();
    showToast('Sync Complete', 'Successfully fetched and parsed the latest evaluations from Google Sheets!', 'success');
  } catch (error) {
    console.error('Error fetching live spreadsheet:', error);
    showToast('Sync Failed', `Could not connect to Google Sheets. Please check your URL. Error: ${error.message}`, 'danger');

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
 * Parses raw XLSX workbook sheets dynamically using SheetJS.
 */
function parseWorkbookData(wb) {
  const parsedParticipants = [];
  const activeSheets = wb.SheetNames.filter(name =>
    name.startsWith('System') || name.startsWith('Web') || name.startsWith('HPC')
  );

  activeSheets.forEach(sheetName => {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    if (rows.length < 2) return;

    // Find the header row dynamically by searching for the "Họ tên SV" column
    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      const r = rows[i];
      if (r && r.some(cell => cell && String(cell).trim() === 'Họ tên SV')) {
        headerRowIdx = i;
        break;
      }
    }

    if (headerRowIdx === -1) {
      console.warn(`Could not find header row in sheet ${sheetName}`);
      return;
    }

    const headers = rows[headerRowIdx];
    const row0 = headerRowIdx > 0 ? rows[headerRowIdx - 1] : [];

    const finalIdx = headers.findIndex(h => h && String(h).trim().toLowerCase() === 'final score');
    const hasGrading = finalIdx !== -1;

    let grader1Name = "Grader 1";
    let grader2Name = "Grader 2";
    let grader3Name = "Grader 3";

    // Find grader total columns ('Tổng kết') dynamically
    const totalIndices = [];
    headers.forEach((h, idx) => {
      if (h && String(h).trim() === 'Tổng kết') {
        totalIndices.push(idx);
      }
    });

    if (hasGrading && totalIndices.length >= 3) {
      if (row0.length > totalIndices[0] - 6 && row0[totalIndices[0] - 6]) grader1Name = String(row0[totalIndices[0] - 6]).trim();
      if (row0.length > totalIndices[1] - 6 && row0[totalIndices[1] - 6]) grader2Name = String(row0[totalIndices[1] - 6]).trim();
      if (row0.length > totalIndices[2] - 6 && row0[totalIndices[2] - 6]) grader3Name = String(row0[totalIndices[2] - 6]).trim();
    }

    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length < 5 || !row[4] || String(row[4]).trim() === '') continue;

      const board = row[0] ? String(row[0]).trim() : sheetName;
      let session = row[1] ? String(row[1]).trim() : '';

      // Normalize and translate session name to English
      if (session === 'Chiểu') session = 'Chiều';
      if (session === 'Sáng') session = 'Morning';
      if (session === 'Chiều') session = 'Afternoon';

      let dateStr = '';
      const dateVal = row[2];
      if (dateVal instanceof Date) {
        let day = String(dateVal.getDate()).padStart(2, '0');
        let month = String(dateVal.getMonth() + 1).padStart(2, '0');
        dateStr = `${day}/${month}`;
      } else if (dateVal) {
        dateStr = String(dateVal).trim().split(' ')[0];
        let parts = dateStr.split('-');
        if (parts.length === 3) {
          dateStr = `${parts[2]}/${parts[1]}`;
        }
      }

      const timeSlot = row[3] ? String(row[3]).trim() : '';
      const studentName = String(row[4]).trim();

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

      if (hasGrading && totalIndices.length >= 3) {
        const idx1 = totalIndices[0];
        const g1_criteria = row.slice(idx1 - 6, idx1);
        const g1_graded = g1_criteria.every(isNumeric);
        let g1_total = null;
        if (g1_graded) {
          g1_total = isNumeric(row[idx1]) ? parseFloat(row[idx1]) : g1_criteria.reduce((s, c) => s + parseFloat(c), 0);
        }

        const idx2 = totalIndices[1];
        const g2_criteria = row.slice(idx2 - 6, idx2);
        const g2_graded = g2_criteria.every(isNumeric);
        let g2_total = null;
        if (g2_graded) {
          g2_total = isNumeric(row[idx2]) ? parseFloat(row[idx2]) : g2_criteria.reduce((s, c) => s + parseFloat(c), 0);
        }

        const idx3 = totalIndices[2];
        const g3_criteria = row.slice(idx3 - 6, idx3);
        const g3_graded = g3_criteria.every(isNumeric);
        let g3_total = null;
        if (g3_graded) {
          g3_total = isNumeric(row[idx3]) ? parseFloat(row[idx3]) : g3_criteria.reduce((s, c) => s + parseFloat(c), 0);
        }

        const graderCount = [g1_graded, g2_graded, g3_graded].filter(Boolean).length;

        let finalScore = parseFloat(row[finalIdx]);
        if (isNaN(finalScore)) finalScore = 0.0;

        participant.graderCount = graderCount;
        participant.finalScore = finalScore;
        if (finalScore === 0.0) {
          participant.isResigned = true;
        }
        participant.graders = [
          { name: grader1Name, total: g1_total || 0.0, graded: g1_graded, criteria: g1_criteria },
          { name: grader2Name, total: g2_total || 0.0, graded: g2_graded, criteria: g2_criteria },
          { name: grader3Name, total: g3_total || 0.0, graded: g3_graded, criteria: g3_criteria }
        ];
      } else {
        participant.graderCount = 0;
        participant.finalScore = null;
        participant.graders = [];
      }

      parsedParticipants.push(participant);
    }
  });

  normalizeParticipants(parsedParticipants);
  state.allParticipants = parsedParticipants;
}

/**
 * Changes active track.
 */
function changeTrack(track) {
  state.activeTrack = track;
  state.activeBoard = 'all';

  // Sync the track tabs active state
  const trackTabs = document.querySelectorAll('.track-tab');
  trackTabs.forEach(tab => {
    if (tab.getAttribute('data-track') === track) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  document.getElementById('dashboardTitle').innerText =
    track === 'SwE' ? 'MiniProject Evaluations' : `${track} Evaluations`;

  state.currentPage = 1;
  renderAll();
}

/**
 * Rebuilds the board selection dropdown menu based on the selected track, preserving the currently selected board if valid.
 */
function rebuildBoardFilterDropdown() {
  const boardFilterSelect = document.getElementById('boardFilterSelect');
  if (!boardFilterSelect) return;

  const currentValue = state.activeBoard;
  boardFilterSelect.innerHTML = '<option value="all">All Boards</option>';

  const activeBoards = new Set();
  state.allParticipants.forEach(p => {
    if (isInActiveTrack(p)) {
      activeBoards.add(p.board);
    }
  });

  const sortedBoards = Array.from(activeBoards).sort((a, b) => {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  });

  sortedBoards.forEach(board => {
    const opt = document.createElement('option');
    opt.value = board;
    opt.innerText = board;
    boardFilterSelect.appendChild(opt);
  });

  if (activeBoards.has(currentValue)) {
    boardFilterSelect.value = currentValue;
  } else {
    boardFilterSelect.value = 'all';
    state.activeBoard = 'all';
  }
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
    return p.finalScore;
  }

  // Interpolated: Average of only valid evaluations (matches vsd score formula)
  const gradedScores = p.graders.filter(g => g.graded).map(g => g.total);
  if (gradedScores.length === 0) return 0.0;

  const sum = gradedScores.reduce((acc, curr) => acc + curr, 0);
  return sum / gradedScores.length;
}

/**
 * Filter and sort participants in active track for evaluation
 */
function getActiveTrackParticipants() {
  let list = state.allParticipants.filter(p => isInActiveTrack(p));

  if (!state.includeResigned) {
    list = list.filter(p => !p.isResigned);
  }

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

  rebuildBoardFilterDropdown();
  renderQuickStats();
  renderMetricsTable();
  renderTableOnly();
  renderDistributionChart();
  renderGraderBreakdownChart();
  renderGraderComparisonChart();
  renderTimeChart();
  renderVarianceCorrelationChart();

  // Update sliding tab position
  updateTabHighlight();
}

/**
 * Computes and renders Quick Stats cards at the top
 */
function renderQuickStats() {
  const participants = getActiveTrackParticipants();
  const total = participants.length;
  const resigned = participants.filter(p => p.isResigned).length;

  const graded = participants.filter(p => p.hasGrading ? p.graderCount > 0 : !p.isResigned).length;

  const gradedPart = participants.filter(p => p.tempScore !== null);

  let avg = 0;
  if (gradedPart.length > 0) {
    const sum = gradedPart.reduce((acc, p) => acc + p.tempScore, 0);
    avg = sum / gradedPart.length;
  }

  animateUpdateText(document.getElementById('statTotalStudents'), total);
  animateUpdateText(document.getElementById('statGradedStudents'), graded);
  animateUpdateText(document.getElementById('statResignedStudents'), resigned);

  const avgEl = document.getElementById('statAverageScore');
  if (avgEl) {
    animateUpdateText(avgEl, avg.toFixed(2));
  }
}

/**
 * Computes statistics and renders metrics summary table
 */
function renderMetricsTable() {
  const participants = getActiveTrackParticipants();

  const scores = participants
    .filter(p => p.tempScore !== null)
    .map(p => p.tempScore);

  const stats = calculateStats(scores);

  animateUpdateText(document.getElementById('metricMean'), stats.mean.toFixed(2));
  animateUpdateText(document.getElementById('metricMax'), stats.max.toFixed(2));
  animateUpdateText(document.getElementById('metricMedian'), stats.median.toFixed(2));
  animateUpdateText(document.getElementById('metricMin'), stats.min.toFixed(2));
  animateUpdateText(document.getElementById('metricStd'), stats.std.toFixed(2));
  animateUpdateText(document.getElementById('metricP25'), stats.p25.toFixed(2));
  animateUpdateText(document.getElementById('metricP75'), stats.p75.toFixed(2));
  animateUpdateText(document.getElementById('metricP90'), stats.p90.toFixed(2));
  animateUpdateText(document.getElementById('metricP95'), stats.p95.toFixed(2));
  animateUpdateText(document.getElementById('metricGradedCount'), scores.length);
}

/**
 * Performs statistical computations on a list of numeric scores conforming to vsd percentileInc
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

  const median = percentileInc(sorted, 0.5);

  const variance = sorted.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
  const std = Math.sqrt(variance);

  const p25 = percentileInc(sorted, 0.25);
  const p75 = percentileInc(sorted, 0.75);
  const p90 = percentileInc(sorted, 0.90);
  const p95 = percentileInc(sorted, 0.95);

  return { mean, max, median, min, std, p25, p75, p90, p95 };
}

/**
 * Chart 1: Final Score Distribution Histogram (bins of size 1, 0 to 100)
 */
function renderDistributionChart() {
  const participants = getActiveTrackParticipants();
  const colors = getChartThemeColors();

  const scores = participants
    .filter(p => p.tempScore !== null)
    .map(p => p.tempScore);

  const canvasId = 'scoreHistogramChart';
  const noDataEl = document.getElementById('noDataHistogram');

  if (scores.length === 0) {
    document.getElementById(canvasId).style.visibility = 'hidden';
    noDataEl.classList.remove('hidden');
    // Destroy previous instance to avoid visual glitches and hover callbacks on empty grids
    if (state.charts[canvasId]) {
      state.charts[canvasId].destroy();
      state.charts[canvasId] = null;
    }
    return;
  } else {
    document.getElementById(canvasId).style.visibility = 'visible';
    noDataEl.classList.add('hidden');
  }

  const binSizeSelect = document.getElementById('binSizeSelect');
  const B = binSizeSelect ? parseInt(binSizeSelect.value) : 1;

  const labels = [];
  const bins = [];

  for (let i = 0; i <= 100; i += B) {
    if (i === 100 && B > 1) break;
    const start = i;
    const end = Math.min(100, i + B - 1);
    const label = start === end ? `${start}` : `${start}-${end}`;
    labels.push(label);

    const count = scores.filter(s => {
      const val = Math.floor(s);
      if (end < 100) {
        return val >= start && val <= end;
      } else {
        return val >= start && val <= 100;
      }
    }).length;
    bins.push(count);
  }

  createOrUpdateChart(canvasId, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Participant Count',
        data: bins,
        backgroundColor: 'rgba(0, 115, 187, 0.75)',
        borderColor: '#0073bb',
        borderWidth: 0,
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
          backgroundColor: colors.tooltipBg,
          titleColor: colors.tooltipTitle,
          bodyColor: colors.tooltipBody,
          borderColor: colors.tooltipBorder,
          borderWidth: 1,
          cornerRadius: 6,
          titleFont: { family: 'Amazon Ember', size: 11, weight: 'bold' },
          bodyFont: { family: 'Amazon Ember', size: 11 },
          displayColors: false,
          callbacks: {
            title: (items) => `Score Range: ${items[0].label}`,
            label: (item) => `${item.raw} participant(s)`
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: `Score Interval (Bin size = ${B})`, color: colors.text, font: { family: 'Amazon Ember', size: 9, weight: 600 } },
          grid: { display: false },
          ticks: {
            callback: function(val, idx) {
              if (B === 1) {
                return idx % 10 === 0 ? idx : '';
              }
              return labels[idx];
            },
            color: colors.text,
            font: { family: 'Amazon Ember', size: 9 }
          }
        },
        y: {
          title: { display: true, text: 'Number of Participants', color: colors.text, font: { family: 'Amazon Ember', size: 9, weight: 600 } },
          grid: { color: colors.grid },
          ticks: { precision: 0, color: colors.text, font: { family: 'Amazon Ember', size: 9 } }
        }
      }
    }
  });
}

/**
 * Chart 2: Grader Count Breakdown (Resigned, Graded by 0, 1, 2, 3)
 */
function renderGraderBreakdownChart() {
  const participants = getActiveTrackParticipants();
  const colors = getChartThemeColors();

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
        'Resigned',
        'Ungraded (0)',
        '1 Grader',
        '2 Graders',
        '3 Graders'
      ],
      datasets: [{
        data: [counts.resigned, counts.g0, counts.g1, counts.g2, counts.g3],
        backgroundColor: [
          'rgba(223, 62, 62, 0.75)',   // Red
          'rgba(100, 116, 139, 0.72)', // Gray
          'rgba(248, 148, 6, 0.75)',   // Amber
          'rgba(0, 115, 187, 0.75)',   // Blue
          'rgba(46, 168, 90, 0.75)'    // Green
        ],
        borderColor: [
          '#df3e3e', '#64748b', '#f89406', '#0073bb', '#2ea85a'
        ],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: colors.tooltipBg,
          titleColor: colors.tooltipTitle,
          bodyColor: colors.tooltipBody,
          borderColor: colors.tooltipBorder,
          borderWidth: 1,
          cornerRadius: 6,
          titleFont: { family: 'Amazon Ember', size: 11, weight: 'bold' },
          bodyFont: { family: 'Amazon Ember', size: 11 },
          displayColors: false,
          callbacks: {
            footer: () => `Total Cohort: ${totalSum}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: colors.text, font: { family: 'Amazon Ember', size: 9 } }
        },
        y: {
          grid: { color: colors.grid },
          ticks: { precision: 0, color: colors.text, font: { family: 'Amazon Ember', size: 9 } }
        }
      }
    }
  });
}

/**
 * Chart 3: Grader Comparison Chart
 */
function renderGraderComparisonChart() {
  const participants = getActiveTrackParticipants();
  const colors = getChartThemeColors();

  const graderScores = {};

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
    document.getElementById(canvasId).style.visibility = 'hidden';
    noDataEl.classList.remove('hidden');
    // Destroy previous instance to avoid visual glitches
    if (state.charts[canvasId]) {
      state.charts[canvasId].destroy();
      state.charts[canvasId] = null;
    }
    return;
  } else {
    document.getElementById(canvasId).style.visibility = 'visible';
    noDataEl.classList.add('hidden');
  }

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
        backgroundColor: 'rgba(0, 115, 187, 0.75)',
        borderColor: '#0073bb',
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: colors.tooltipBg,
          titleColor: colors.tooltipTitle,
          bodyColor: colors.tooltipBody,
          borderColor: colors.tooltipBorder,
          borderWidth: 1,
          cornerRadius: 6,
          titleFont: { family: 'Amazon Ember', size: 11, weight: 'bold' },
          bodyFont: { family: 'Amazon Ember', size: 11 },
          displayColors: false,
          callbacks: {
            label: (item) => {
              const info = gradersList[item.dataIndex];
              return `Avg: ${item.raw} (graded ${info.count} participants)`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: colors.text, font: { family: 'Amazon Ember', size: 9 } }
        },
        y: {
          min: 0,
          max: 100,
          grid: { color: colors.grid },
          ticks: { color: colors.text, font: { family: 'Amazon Ember', size: 9 } }
        }
      }
    }
  });
}

/**
 * Chart 4: Temporal Score Comparison
 */
function renderTimeChart() {
  const participants = getActiveTrackParticipants();
  const colors = getChartThemeColors();

  const gradedPart = participants.filter(p =>
    p.tempScore !== null && !p.isResigned
  );

  const canvasId = 'timeComparisonChart';
  const noDataEl = document.getElementById('noDataTime');

  if (gradedPart.length === 0) {
    document.getElementById(canvasId).style.visibility = 'hidden';
    noDataEl.classList.remove('hidden');
    // Destroy previous instance to avoid visual glitches
    if (state.charts[canvasId]) {
      state.charts[canvasId].destroy();
      state.charts[canvasId] = null;
    }
    return;
  } else {
    document.getElementById(canvasId).style.visibility = 'visible';
    noDataEl.classList.add('hidden');
  }

  const compareBy = document.getElementById('timeCompareSelect').value;
  const groups = {};

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

  keys.sort((a, b) => {
    if (compareBy === 'session') {
      if (a === 'Morning') return -1;
      if (b === 'Morning') return 1;
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
        backgroundColor: 'rgba(46, 168, 90, 0.75)',
        borderColor: '#2ea85a',
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: colors.tooltipBg,
          titleColor: colors.tooltipTitle,
          bodyColor: colors.tooltipBody,
          borderColor: colors.tooltipBorder,
          borderWidth: 1,
          cornerRadius: 6,
          titleFont: { family: 'Amazon Ember', size: 11, weight: 'bold' },
          bodyFont: { family: 'Amazon Ember', size: 11 },
          displayColors: false,
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
          ticks: { color: colors.text, font: { family: 'Amazon Ember', size: 9 } }
        },
        y: {
          min: 0,
          max: 100,
          grid: { color: colors.grid },
          ticks: { color: colors.text, font: { family: 'Amazon Ember', size: 9 } }
        }
      }
    }
  });
}

/**
 * Chart 5: Standard Deviation of 3 Grades vs Standing Rank (Scatter plot)
 */
function renderVarianceCorrelationChart() {
  const participants = getActiveTrackParticipants();
  const colors = getChartThemeColors();

  const scatterData = [];
  participants.forEach(p => {
    if (p.isResigned || !p.hasGrading || !p.rank) return;

    // Fully graded check: must have exactly 3 graders, all graded
    if (!p.graders || p.graders.length !== 3) return;
    if (!p.graders[0].graded || !p.graders[1].graded || !p.graders[2].graded) return;

    const s1 = Number(p.graders[0].total) || 0;
    const s2 = Number(p.graders[1].total) || 0;
    const s3 = Number(p.graders[2].total) || 0;

    const mean = (s1 + s2 + s3) / 3;
    const std = Math.sqrt(((s1 - mean)**2 + (s2 - mean)**2 + (s3 - mean)**2) / 3);

    scatterData.push({
      x: p.rank,
      y: std,
      studentName: p.studentName,
      meanScore: mean
    });
  });

  const canvasId = 'graderVarianceCorrelationChart';
  const noDataEl = document.getElementById('noDataCorrelation');

  if (scatterData.length === 0) {
    document.getElementById(canvasId).style.visibility = 'hidden';
    noDataEl.classList.remove('hidden');
    if (state.charts[canvasId]) {
      state.charts[canvasId].destroy();
      state.charts[canvasId] = null;
    }
    return;
  } else {
    document.getElementById(canvasId).style.visibility = 'visible';
    noDataEl.classList.add('hidden');
  }

  createOrUpdateChart(canvasId, {
    type: 'scatter',
    data: {
      datasets: [{
        data: scatterData.map(d => ({ x: d.x, y: d.y })),
        backgroundColor: 'rgba(0, 115, 187, 0.75)',
        borderColor: 'rgba(0, 115, 187, 0.9)',
        borderWidth: 0,
        pointRadius: 6,
        pointHoverRadius: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: colors.tooltipBg,
          titleColor: colors.tooltipTitle,
          bodyColor: colors.tooltipBody,
          borderColor: colors.tooltipBorder,
          borderWidth: 1,
          cornerRadius: 6,
          titleFont: { family: 'Amazon Ember', size: 11, weight: 'bold' },
          bodyFont: { family: 'Amazon Ember', size: 11 },
          displayColors: false,
          callbacks: {
            title: (items) => {
              const idx = items[0].dataIndex;
              return scatterData[idx].studentName;
            },
            label: (item) => {
              const idx = item.dataIndex;
              const pt = scatterData[idx];
              return [
                `Rank: ${pt.x}`,
                `Grader Std Dev: ${pt.y.toFixed(2)}`,
                `Final Score (Mean): ${pt.meanScore.toFixed(2)}`
              ];
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'Standing Rank (Lower is better)', color: colors.text, font: { family: 'Amazon Ember', size: 9, weight: 600 } },
          grid: { color: colors.grid },
          ticks: { color: colors.text, font: { family: 'Amazon Ember', size: 9 } }
        },
        y: {
          title: { display: true, text: 'Standard Deviation of Grades', color: colors.text, font: { family: 'Amazon Ember', size: 9, weight: 600 } },
          grid: { color: colors.grid },
          ticks: { color: colors.text, font: { family: 'Amazon Ember', size: 9 } }
        }
      }
    }
  });
}

/**
 * Creates a new chart or destroys the previous instance if it already exists.
 */
function createOrUpdateChart(id, config) {
  if (state.charts[id]) {
    state.charts[id].destroy();
  }
  const ctx = document.getElementById(id).getContext('2d');
  state.charts[id] = new Chart(ctx, config);
}

/**
 * Computes filtered participants list count (used in pagination bounding)
 */
function getFilteredListCount() {
  const trackPart = getActiveTrackParticipants();
  const searchNorm = removeDiacritics(state.searchQuery.toLowerCase());

  const filteredList = trackPart.filter(p => {
    if (state.activeBoard !== 'all' && p.board !== state.activeBoard) {
      return false;
    }

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

  return filteredList.length;
}

/**
 * Renders ONLY the directory table.
 * Implements Dense Ranking, PERCENTRANK.INC, and 10-record Pagination.
 */
function renderTableOnly() {
  const tableBody = document.getElementById('tableBody');
  const tableEmptyState = document.getElementById('tableEmptyState');

  const trackPart = getActiveTrackParticipants();

  // Filter cohort for ranking
  const gradedPart = trackPart.filter(p =>
    p.tempScore !== null && (state.includeResigned || !p.isResigned)
  );

  // Sort descending
  gradedPart.sort((a, b) => b.tempScore - a.tempScore);

  // Assign Dense Ranks
  let rankTracker = 1;
  gradedPart.forEach((p, idx) => {
    if (idx > 0 && p.tempScore < gradedPart[idx - 1].tempScore) {
      rankTracker++;
    }
    p.rank = rankTracker;
  });

  // Assign Percentile Rank (1 - percentRankInc) * 100
  const sortedScoresAsc = gradedPart.map(p => p.tempScore).sort((a, b) => a - b);
  gradedPart.forEach(p => {
    const rankPercent = percentRankInc(sortedScoresAsc, p.tempScore);
    p.percentile = ((1 - rankPercent) * 100).toFixed(1);
  });

  trackPart.forEach(p => {
    const isEvaluated = gradedPart.includes(p);
    if (!isEvaluated) {
      p.rank = null;
      p.percentile = null;
    }
  });

  const sortedTrackPart = [...trackPart].sort((a, b) => {
    if (a.tempScore === null && b.tempScore === null) return 0;
    if (a.tempScore === null) return 1;
    if (b.tempScore === null) return -1;
    return b.tempScore - a.tempScore;
  });

  const searchNorm = removeDiacritics(state.searchQuery.toLowerCase());

  const filteredList = sortedTrackPart.filter(p => {
    if (state.activeBoard !== 'all' && p.board !== state.activeBoard) {
      return false;
    }

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

  document.getElementById('tableRecordCount').innerText = `${filteredList.length} records`;

  if (filteredList.length === 0) {
    tableBody.innerHTML = '';
    tableEmptyState.classList.remove('hidden');
    document.getElementById('tablePaginationFooter').style.display = 'none';
    return;
  }

  tableEmptyState.classList.add('hidden');
  document.getElementById('tablePaginationFooter').style.display = 'flex';

  // Calculate total pages for 10 records pagination
  const ITEMS_PER_PAGE = 10;
  const totalPages = Math.ceil(filteredList.length / ITEMS_PER_PAGE) || 1;

  // Bounding currentPage state
  if (state.currentPage > totalPages) {
    state.currentPage = totalPages;
  }
  if (state.currentPage < 1) {
    state.currentPage = 1;
  }

  const start = (state.currentPage - 1) * ITEMS_PER_PAGE;
  const end = start + ITEMS_PER_PAGE;
  const pageList = filteredList.slice(start, end);

  let animClass = 'fade-in-row';
  if (state.currentPage > state.prevPage) {
    animClass = 'slide-up-row';
  } else if (state.currentPage < state.prevPage) {
    animClass = 'slide-down-row';
  }

  let html = '';
  pageList.forEach(p => {
    const badgeClass = UNIT_BADGE_CLASSES[p.mentorUnit.toUpperCase()] || 'badge-default';
    const scoreText = p.tempScore !== null ? p.tempScore.toFixed(2) : '<span class="resigned-text">N/A (Ungraded)</span>';
    const rankText = p.rank !== null ? p.rank : '<span class="resigned-text">-</span>';
    const pctText = p.percentile !== null ? `${p.percentile}%` : '<span class="resigned-text">-</span>';

    let noteHtml = '';
    if (p.note) {
      const cleanNote = String(p.note).trim();
      if (cleanNote.startsWith('http') || cleanNote.includes('drive.google.com') || cleanNote.includes('github.com')) {
        noteHtml = `<a href="${cleanNote}" target="_blank" class="note-link tooltip-trigger" data-tooltip="Open participant folder"><i class="fa-regular fa-folder-open"></i></a>`;
      } else {
        noteHtml = `<span class="note-comment-icon tooltip-trigger" data-tooltip="${cleanNote}"><i class="fa-regular fa-comment-dots"></i></span>`;
      }
    } else {
      noteHtml = `<span class="resigned-text">Resigned</span>`;
    }

    const boardBadge = `<span class="unit-badge badge-board">${p.board}</span>`;
    const sessionClass = p.session === 'Morning' ? 'badge-session-morning' : 'badge-session-afternoon';
    const sessionBadge = `<span class="unit-badge ${sessionClass}">${p.session}</span>`;
    const dateBadge = `<span class="unit-badge badge-date">${p.date}</span>`;
    const slotBadge = `<span class="unit-badge badge-slot">${p.timeSlot}</span>`;

    const rowClass = (p.isResigned ? 'resigned-row ' : '') + animClass;

    html += `
      <tr class="${rowClass}">
        <td class="rank-col">${rankText}</td>
        <td class="percentile-col">${pctText}</td>
        <td>${boardBadge}</td>
        <td>${sessionBadge}</td>
        <td>${dateBadge}</td>
        <td>${slotBadge}</td>
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

  // Render pagination indicator and buttons states
  const xStr = String(state.currentPage).padStart(3, '0');
  const yStr = String(totalPages).padStart(3, '0');
  document.getElementById('paginationInfo').innerText = `${xStr}/${yStr}`;
  document.getElementById('prevPageBtn').disabled = state.currentPage === 1;
  document.getElementById('nextPageBtn').disabled = state.currentPage === totalPages;

  state.prevPage = state.currentPage;
}

/**
 * Normalizes Vietnamese text by stripping accents and diacritics.
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
        <i class="fa-solid fa-spinner fa-spin"></i> Loading participant directory...
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
 * Toast/Alert system.
 */
function showToast(title, desc, type = 'info') {
  const toast = document.getElementById('toastAlert');
  const tTitle = document.getElementById('alertTitle');
  const tDesc = document.getElementById('alertDesc');
  const tIcon = document.getElementById('alertIcon');

  toast.className = 'aws-alert';

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

  toast.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  if (type !== 'danger') {
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 6000);
  }
}

/**
 * Saves current config/settings to localStorage.
 */
function saveSettings() {
  localStorage.setItem('vdt2026_sheet_id', state.spreadsheetId);
  localStorage.setItem('vdt2026_sheet_url', state.spreadsheetUrl);
  localStorage.setItem('vdt2026_theme', state.theme);
  localStorage.setItem('vdt2026_interpolate', state.interpolateScore ? 'true' : 'false');
  localStorage.setItem('vdt2026_include_resigned', state.includeResigned ? 'true' : 'false');
}

/**
 * Loads configuration settings from localStorage.
 */
function loadSavedSettings() {
  const savedId = localStorage.getItem('vdt2026_sheet_id');
  const savedUrl = localStorage.getItem('vdt2026_sheet_url');
  const savedTheme = localStorage.getItem('vdt2026_theme');
  const savedInterpolate = localStorage.getItem('vdt2026_interpolate');
  const savedIncludeResigned = localStorage.getItem('vdt2026_include_resigned');

  if (savedId) state.spreadsheetId = savedId;
  if (savedUrl) state.spreadsheetUrl = savedUrl;
  if (savedTheme) {
    state.theme = savedTheme;
    applyTheme(savedTheme);
  }
  if (savedInterpolate) state.interpolateScore = savedInterpolate === 'true';
  if (savedIncludeResigned) state.includeResigned = savedIncludeResigned === 'true';

  // Sync checkboxes in settings UI drawer
  const interpolateCheckbox = document.getElementById('interpolateScoreCheckbox');
  if (interpolateCheckbox) interpolateCheckbox.checked = state.interpolateScore;

  const includeResignedCheckbox = document.getElementById('includeResignedCheckbox');
  if (includeResignedCheckbox) includeResignedCheckbox.checked = state.includeResigned;
}

/**
 * Parses and returns the 44-character spreadsheet ID from a Google Sheets URL.
 */
function getSpreadsheetId(url) {
  if (!url) return null;
  const cleaned = url.trim();
  if (cleaned.length === 44 && !cleaned.includes('/')) return cleaned;
  const match = cleaned.match(/\/d\/([a-zA-Z0-9-_]{44})/);
  return match ? match[1] : null;
}

/**
 * Normalizes participant attributes across various load sources (caches, file preloads).
 */
function normalizeParticipants(list) {
  if (!list) return;
  list.forEach(p => {
    if (p.finalScore === 0.0 || p.finalScore === 0) {
      p.isResigned = true;
    }
    if (!p.note || String(p.note).trim() === '') {
      p.isResigned = true;
    }

    // Normalize session translations
    if (p.session === 'Chiểu') p.session = 'Chiều';
    if (p.session === 'Sáng') p.session = 'Morning';
    if (p.session === 'Chiều') p.session = 'Afternoon';
  });
}

/**
 * Helper to update element inner text with a scale/fade change animation.
 */
function animateUpdateText(el, text) {
  if (!el) return;
  el.classList.remove('animate-value-change');
  void el.offsetWidth; // Trigger reflow to restart CSS animation
  el.innerText = text;
  el.classList.add('animate-value-change');
}

/**
 * Aligns the sliding track tab highlight position behind the active tab.
 */
function updateTabHighlight() {
  const activeTab = document.querySelector('.track-tab.active');
  const highlight = document.getElementById('tabHighlight');
  if (activeTab && highlight) {
    const left = activeTab.offsetLeft;
    const width = activeTab.offsetWidth;
    const height = activeTab.offsetHeight;
    const top = activeTab.offsetTop;

    highlight.style.width = `${width}px`;
    highlight.style.height = `${height}px`;
    highlight.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  }
}
