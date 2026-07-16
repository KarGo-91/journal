// Quietude Journaling App Logic

// state management
let state = {
    password: '',
    pat: '',
    repo: '',
    entries: {}, // cache of decrypted entries: { "YYYY-MM-DD": { title, body, mood, lastModified } }
    activeTab: 'write',
    activeMood: '',
    selectedHistoryDate: null
};

// DOM Elements
const authScreen = document.getElementById('auth-screen');
const appScreen = document.getElementById('app-screen');
const authForm = document.getElementById('auth-form');
const masterPasswordInput = document.getElementById('master-password');
const githubPatInput = document.getElementById('github-pat');
const githubRepoInput = document.getElementById('github-repo');
const setupFields = document.getElementById('setup-fields');
const toggleSetupBtn = document.getElementById('toggle-setup-mode');
const authError = document.getElementById('auth-error');
const btnLogin = document.getElementById('btn-login');

const navItems = document.querySelectorAll('.nav-item');
const tabContents = document.querySelectorAll('.tab-content');
const headerDate = document.getElementById('header-date');
const headerGreeting = document.getElementById('header-greeting');
const syncStatus = document.getElementById('sync-status');
const btnLock = document.getElementById('btn-lock');

const moodButtons = document.querySelectorAll('.mood-btn');
const entryTitle = document.getElementById('entry-title');
const entryBody = document.getElementById('entry-body');
const wordCountText = document.getElementById('word-count');
const autosaveStatus = document.getElementById('autosave-status');
const btnSave = document.getElementById('btn-save');

const searchEntries = document.getElementById('search-entries');
const historyEntriesList = document.getElementById('history-entries-list');
const viewerPlaceholder = document.getElementById('viewer-placeholder');
const viewerContent = document.getElementById('viewer-content');
const viewerTitle = document.getElementById('viewer-title');
const viewerDate = document.getElementById('viewer-date');
const viewerMood = document.getElementById('viewer-mood');
const viewerBody = document.getElementById('viewer-body');
const btnEditEntry = document.getElementById('btn-edit-entry');
const btnDeleteEntry = document.getElementById('btn-delete-entry');

const statStreak = document.getElementById('stat-streak');
const statTotalEntries = document.getElementById('stat-total-entries');
const statTotalWords = document.getElementById('stat-total-words');
const heatmapGrid = document.getElementById('heatmap-grid');
const moodStatsList = document.getElementById('mood-stats-list');

const settingsForm = document.getElementById('settings-form');
const settingsPat = document.getElementById('settings-github-pat');
const settingsRepo = document.getElementById('settings-github-repo');
const btnExportDecrypted = document.getElementById('btn-export-decrypted');
const btnClearCache = document.getElementById('btn-clear-cache');

// 1. CRYPTO UTILITIES (AES-GCM Web Crypto API)
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function deriveKey(password, salt) {
    const encoder = new TextEncoder();
    const passwordKey = await crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: 100000,
            hash: "SHA-256"
        },
        passwordKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

async function encryptData(plainText, password) {
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    
    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        key,
        encoder.encode(plainText)
    );
    
    const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(encrypted), salt.length + iv.length);
    
    return btoa(String.fromCharCode.apply(null, combined));
}

async function decryptData(cipherBase64, password) {
    const decoder = new TextDecoder();
    const binaryString = atob(cipherBase64);
    const combined = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        combined[i] = binaryString.charCodeAt(i);
    }
    
    const salt = combined.slice(0, 16);
    const iv = combined.slice(16, 28);
    const ciphertext = combined.slice(28);
    
    const key = await deriveKey(password, salt);
    const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        key,
        ciphertext
    );
    return decoder.decode(decrypted);
}

// 2. GITHUB API LOGIC
async function fetchGithubFile(path) {
    const response = await fetch(`https://api.github.com/repos/${state.repo}/contents/${path}`, {
        headers: {
            'Authorization': `Bearer ${state.pat}`,
            'Accept': 'application/vnd.github.v3+json'
        }
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub API returned error status: ${response.status}`);
    return await response.json();
}

async function writeGithubFile(path, contentBase64, sha = null) {
    const body = {
        message: `Sync entry ${path}`,
        content: contentBase64
    };
    if (sha) body.sha = sha;

    const response = await fetch(`https://api.github.com/repos/${state.repo}/contents/${path}`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${state.pat}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Error syncing file to GitHub');
    }
    return await response.json();
}

async function deleteGithubFile(path, sha) {
    const response = await fetch(`https://api.github.com/repos/${state.repo}/contents/${path}`, {
        method: 'DELETE',
        headers: {
            'Authorization': `Bearer ${state.pat}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            message: `Delete entry ${path}`,
            sha: sha
        })
    });
    if (!response.ok) {
        throw new Error('Error deleting file from GitHub');
    }
    return true;
}

// Sync all entries from GitHub repository
async function syncFromGithub() {
    setSyncStatus('syncing', 'Syncing from GitHub...');
    try {
        const files = await fetchGithubFile('entries');
        if (!files) {
            // entries folder doesn't exist yet, which is fine for first time
            setSyncStatus('success', 'Connected. Ready to write!');
            return;
        }

        let fetchedNew = false;
        for (const file of files) {
            if (file.name.endsWith('.enc')) {
                const date = file.name.replace('.enc', '');
                
                // If not cached or remote modification date changed, fetch it
                if (!state.entries[date] || state.entries[date].sha !== file.sha) {
                    const rawFile = await fetchGithubFile(`entries/${file.name}`);
                    if (rawFile && rawFile.content) {
                        try {
                            const decryptedStr = await decryptData(rawFile.content.replace(/\s/g, ''), state.password);
                            const parsed = JSON.parse(decryptedStr);
                            
                            state.entries[date] = {
                                title: parsed.title,
                                body: parsed.body,
                                mood: parsed.mood,
                                timestamp: parsed.timestamp || Date.now(),
                                sha: file.sha
                            };
                            fetchedNew = true;
                        } catch (err) {
                            console.error(`Failed to decrypt entry for ${date}:`, err);
                        }
                    }
                }
            }
        }
        
        if (fetchedNew) {
            saveLocalCache();
        }
        setSyncStatus('success', 'Journal fully synced & up to date.');
        renderHistory();
        renderStats();
    } catch (err) {
        console.error(err);
        setSyncStatus('error', 'Sync failed. Check settings/PAT.');
    }
}

// 3. UI STATE & INTERACTION UTILITIES
function setSyncStatus(type, message) {
    syncStatus.className = `status-indicator sync-${type}`;
    let icon = '<i class="fa-solid fa-cloud-check"></i>';
    if (type === 'syncing') icon = '<i class="fa-solid fa-arrows-rotate fa-spin"></i>';
    if (type === 'error') icon = '<i class="fa-solid fa-triangle-exclamation"></i>';
    syncStatus.innerHTML = `${icon} ${message}`;
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function getTodayString() {
    const tzoffset = (new Date()).getTimezoneOffset() * 60000; // offset in milliseconds
    const localISOTime = (new Date(Date.now() - tzoffset)).toISOString().slice(0, 10);
    return localISOTime;
}

// Local Storage Cache Management
function saveLocalCache() {
    localStorage.setItem('journal_entries_cache', JSON.stringify(state.entries));
}

function loadLocalCache() {
    const cache = localStorage.getItem('journal_entries_cache');
    if (cache) {
        try {
            state.entries = JSON.parse(cache);
        } catch (e) {
            state.entries = {};
        }
    }
}

// 4. EDITOR LOGIC
function setupEditor() {
    const today = getTodayString();
    
    // Check if we already have an entry for today loaded
    if (state.entries[today]) {
        const entry = state.entries[today];
        entryTitle.value = entry.title;
        entryBody.value = entry.body;
        selectMood(entry.mood);
        btnSave.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Update Today\'s Entry';
    } else {
        // Reset Editor for a new entry
        entryTitle.value = '';
        entryBody.value = '';
        selectMood('');
        btnSave.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Save & Encrypt Entry';
    }
    updateWordCount();
}

function selectMood(mood) {
    state.activeMood = mood;
    moodButtons.forEach(btn => {
        if (btn.dataset.mood === mood) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

function updateWordCount() {
    const text = entryBody.value.trim();
    const count = text === '' ? 0 : text.split(/\s+/).length;
    wordCountText.textContent = count;
}

// Save Entry Function
async function saveCurrentEntry() {
    const title = entryTitle.value.trim();
    const body = entryBody.value.trim();
    const mood = state.activeMood;
    
    if (!body) {
        alert('Please write something in your reflection before saving.');
        return;
    }
    
    setSyncStatus('syncing', 'Encrypting & syncing to GitHub...');
    btnSave.disabled = true;
    
    const today = getTodayString();
    const entryData = {
        title: title || 'Untitled Reflection',
        body: body,
        mood: mood,
        timestamp: Date.now()
    };
    
    try {
        const jsonStr = JSON.stringify(entryData);
        const encryptedBase64 = await encryptData(jsonStr, state.password);
        
        // Check if file exists to get SHA for updates
        const path = `entries/${today}.enc`;
        let sha = null;
        try {
            const existingFile = await fetchGithubFile(path);
            if (existingFile) sha = existingFile.sha;
        } catch (e) {}
        
        const result = await writeGithubFile(path, encryptedBase64, sha);
        
        // Update local state cache
        state.entries[today] = {
            title: entryData.title,
            body: entryData.body,
            mood: entryData.mood,
            timestamp: entryData.timestamp,
            sha: result.content.sha
        };
        
        saveLocalCache();
        btnSave.disabled = false;
        setSyncStatus('success', 'Entry successfully encrypted & synced.');
        setupEditor();
        renderHistory();
        renderStats();
        
        alert('Your reflection has been safely encrypted and saved to your GitHub repo!');
    } catch (err) {
        console.error(err);
        btnSave.disabled = false;
        setSyncStatus('error', 'Save failed. Check PAT permission or repo name.');
        alert(`Error saving entry: ${err.message}`);
    }
}

// 5. HISTORY VIEWER LOGIC
function renderHistory() {
    const searchQuery = searchEntries.value.toLowerCase().trim();
    historyEntriesList.innerHTML = '';
    
    const sortedDates = Object.keys(state.entries).sort((a, b) => b.localeCompare(a));
    let count = 0;
    
    sortedDates.forEach(date => {
        const entry = state.entries[date];
        
        // Filter by search query
        if (searchQuery) {
            const matchTitle = entry.title.toLowerCase().includes(searchQuery);
            const matchBody = entry.body.toLowerCase().includes(searchQuery);
            if (!matchTitle && !matchBody) return;
        }
        
        count++;
        const item = document.createElement('div');
        item.className = `history-item ${state.selectedHistoryDate === date ? 'active' : ''}`;
        item.dataset.date = date;
        
        const moodEmoji = getMoodEmoji(entry.mood);
        
        item.innerHTML = `
            <div class="history-item-header">
                <span class="history-item-date">${date}</span>
                <span class="history-item-mood">${moodEmoji}</span>
            </div>
            <div class="history-item-title">${entry.title}</div>
        `;
        
        item.addEventListener('click', () => {
            selectHistoryEntry(date);
        });
        
        historyEntriesList.appendChild(item);
    });
    
    if (count === 0) {
        historyEntriesList.innerHTML = `<div class="no-entries">${searchQuery ? 'No matching reflections found.' : 'No entries found yet.'}</div>`;
    }
}

function getMoodEmoji(mood) {
    const moods = {
        inspired: '🌟',
        peaceful: '😌',
        focused: '🧠',
        tired: '🥱',
        low: '😔'
    };
    return moods[mood] || '✍️';
}

function selectHistoryEntry(date) {
    state.selectedHistoryDate = date;
    
    // Highlight list item
    document.querySelectorAll('.history-item').forEach(item => {
        if (item.dataset.date === date) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
    
    const entry = state.entries[date];
    viewerPlaceholder.classList.add('hidden');
    viewerContent.classList.remove('hidden');
    
    viewerTitle.textContent = entry.title;
    viewerDate.textContent = formatDate(date);
    viewerMood.textContent = `${getMoodEmoji(entry.mood)} ${entry.mood ? entry.mood.charAt(0).toUpperCase() + entry.mood.slice(1) : 'Standard'}`;
    viewerBody.textContent = entry.body;
}

// Edit or delete entries
function editSelectedEntry() {
    if (!state.selectedHistoryDate) return;
    
    const date = state.selectedHistoryDate;
    const entry = state.entries[date];
    
    // Switch to Write tab
    switchTab('write');
    
    // Load into editor
    entryTitle.value = entry.title;
    entryBody.value = entry.body;
    selectMood(entry.mood);
    updateWordCount();
    
    // Check if the entry is from today
    const today = getTodayString();
    if (date === today) {
        btnSave.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Update Today\'s Entry';
    } else {
        btnSave.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Update Entry (${date})`;
        // Temporarily adjust today behavior if editing an older file
        btnSave.onclick = async () => {
            await updateOlderEntry(date);
        };
    }
}

async function updateOlderEntry(targetDate) {
    const title = entryTitle.value.trim();
    const body = entryBody.value.trim();
    const mood = state.activeMood;
    
    if (!body) return;
    
    setSyncStatus('syncing', 'Updating encrypted entry...');
    btnSave.disabled = true;
    
    const entryData = {
        title: title || 'Untitled Reflection',
        body: body,
        mood: mood,
        timestamp: Date.now()
    };
    
    try {
        const jsonStr = JSON.stringify(entryData);
        const encryptedBase64 = await encryptData(jsonStr, state.password);
        
        const path = `entries/${targetDate}.enc`;
        const existing = await fetchGithubFile(path);
        const sha = existing ? existing.sha : null;
        
        const result = await writeGithubFile(path, encryptedBase64, sha);
        
        state.entries[targetDate] = {
            title: entryData.title,
            body: entryData.body,
            mood: entryData.mood,
            timestamp: entryData.timestamp,
            sha: result.content.sha
        };
        
        saveLocalCache();
        btnSave.disabled = false;
        setSyncStatus('success', 'Entry updated successfully.');
        
        // Restore default save button action
        btnSave.onclick = saveCurrentEntry;
        setupEditor();
        renderHistory();
        renderStats();
        alert('The entry has been successfully updated on your GitHub repository!');
    } catch (err) {
        console.error(err);
        btnSave.disabled = false;
        setSyncStatus('error', 'Update failed.');
        alert(`Error updating entry: ${err.message}`);
    }
}

async function deleteSelectedEntry() {
    if (!state.selectedHistoryDate) return;
    const date = state.selectedHistoryDate;
    
    if (!confirm(`Are you absolutely sure you want to delete the reflection for ${date}? This action is permanent.`)) {
        return;
    }
    
    setSyncStatus('syncing', 'Deleting entry...');
    try {
        const path = `entries/${date}.enc`;
        const fileData = await fetchGithubFile(path);
        if (fileData) {
            await deleteGithubFile(path, fileData.sha);
        }
        
        delete state.entries[date];
        saveLocalCache();
        
        // reset UI
        state.selectedHistoryDate = null;
        viewerPlaceholder.classList.remove('hidden');
        viewerContent.classList.add('hidden');
        
        setSyncStatus('success', 'Entry deleted successfully.');
        renderHistory();
        renderStats();
        setupEditor();
    } catch (err) {
        console.error(err);
        setSyncStatus('error', 'Deletion failed.');
        alert(`Error deleting entry: ${err.message}`);
    }
}

// 6. INSIGHTS & STATS LOGIC
function renderStats() {
    const dates = Object.keys(state.entries).sort();
    const totalEntries = dates.length;
    statTotalEntries.textContent = totalEntries;
    
    // Total words calculation
    let totalWords = 0;
    dates.forEach(d => {
        const text = state.entries[d].body.trim();
        if (text) {
            totalWords += text.split(/\s+/).length;
        }
    });
    statTotalWords.textContent = totalWords.toLocaleString();
    
    // Current streak calculation
    let streak = 0;
    let checkDate = new Date();
    // If we wrote today, start checks from today, else start checks from yesterday
    const todayStr = getTodayString();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    
    let baseDateStr = todayStr;
    if (!state.entries[todayStr] && state.entries[yesterdayStr]) {
        baseDateStr = yesterdayStr;
    }
    
    if (state.entries[baseDateStr]) {
        let current = new Date(baseDateStr);
        while (true) {
            const currentStr = current.toISOString().slice(0, 10);
            if (state.entries[currentStr]) {
                streak++;
                current.setDate(current.getDate() - 1);
            } else {
                break;
            }
        }
    }
    statStreak.textContent = `${streak} Day${streak === 1 ? '' : 's'}`;
    
    // Render heatmap grid
    renderHeatmapGrid();
    
    // Render mood statistics chart
    renderMoodStats(totalEntries);
}

function renderHeatmapGrid() {
    heatmapGrid.innerHTML = '';
    
    // Setup date boundary: 371 squares (53 weeks x 7 days)
    // Start grid from exactly 1 year ago (same weekday as today)
    const today = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setDate(today.getDate() - 364); // 52 weeks ago
    
    // Align starting day to Sunday or Monday
    // Let's align to oneYearAgo's day of week
    let current = new Date(oneYearAgo);
    
    for (let i = 0; i < 371; i++) {
        const cell = document.createElement('div');
        cell.className = 'grid-day';
        const dateStr = current.toISOString().slice(0, 10);
        
        cell.title = `${dateStr}: No entry`;
        
        if (state.entries[dateStr]) {
            const entry = state.entries[dateStr];
            const wordCount = entry.body.trim().split(/\s+/).length;
            
            cell.title = `${dateStr}: ${entry.title} (${wordCount} words)`;
            
            // set fill intensity
            if (wordCount < 100) {
                cell.style.backgroundColor = 'rgba(16, 185, 129, 0.3)';
            } else if (wordCount < 300) {
                cell.style.backgroundColor = 'rgba(16, 185, 129, 0.6)';
            } else {
                cell.style.backgroundColor = 'rgba(16, 185, 129, 0.9)';
            }
        }
        
        cell.addEventListener('click', () => {
            if (state.entries[dateStr]) {
                switchTab('history');
                selectHistoryEntry(dateStr);
            } else {
                switchTab('write');
                // set editor date if we wanted to backdate, but for now just clear
                setupEditor();
            }
        });
        
        heatmapGrid.appendChild(cell);
        
        // Increment date by 1 day
        current.setDate(current.getDate() + 1);
    }
}

function renderMoodStats(totalEntries) {
    moodStatsList.innerHTML = '';
    if (totalEntries === 0) {
        moodStatsList.innerHTML = '<div class="no-stats">Write entries and select moods to see insights!</div>';
        return;
    }
    
    const moodCounts = { inspired: 0, peaceful: 0, focused: 0, tired: 0, low: 0 };
    Object.keys(state.entries).forEach(d => {
        const mood = state.entries[d].mood;
        if (mood && moodCounts[mood] !== undefined) {
            moodCounts[mood]++;
        }
    });
    
    Object.keys(moodCounts).forEach(mood => {
        const count = moodCounts[mood];
        const percentage = totalEntries === 0 ? 0 : Math.round((count / totalEntries) * 100);
        
        const row = document.createElement('div');
        row.className = 'mood-stat-row';
        row.innerHTML = `
            <div class="mood-stat-label">${getMoodEmoji(mood)} ${mood.charAt(0).toUpperCase() + mood.slice(1)}</div>
            <div class="mood-bar-container">
                <div class="mood-bar-fill" style="width: ${percentage}%"></div>
            </div>
            <div class="mood-stat-count">${count}</div>
        `;
        moodStatsList.appendChild(row);
    });
}

// 7. SETTINGS & EXPORT LOGIC
function handleSettingsSubmit(e) {
    e.preventDefault();
    const newPat = settingsPat.value.trim();
    const newRepo = settingsRepo.value.trim();
    
    if (newPat) {
        state.pat = newPat;
        localStorage.setItem('journal_github_pat', newPat);
        settingsPat.value = '';
    }
    if (newRepo) {
        state.repo = newRepo;
        localStorage.setItem('journal_github_repo', newRepo);
    }
    
    alert('Configuration parameters successfully updated!');
    syncFromGithub();
}

function exportDecryptedDatabase() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state.entries, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", `quietude_backup_${new Date().toISOString().slice(0, 10)}.json`);
    dlAnchorElem.click();
}

function clearCacheAndLogout() {
    if (confirm('Are you sure you want to clear your local configuration cache and logout? Your encrypted database on GitHub will not be affected.')) {
        localStorage.clear();
        location.reload();
    }
}

// 8. ROUTING & TAB NAVIGATION
function switchTab(tabId) {
    state.activeTab = tabId;
    
    navItems.forEach(item => {
        if (item.dataset.tab === tabId) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
    
    tabContents.forEach(content => {
        if (content.id === `tab-${tabId}`) {
            content.classList.add('active');
        } else {
            content.classList.remove('active');
        }
    });

    if (tabId === 'write') {
        setupEditor();
    }
}

// 9. APP INITIALIZATION & BOOTSTRAP
async function handleLogin(e) {
    e.preventDefault();
    const password = masterPasswordInput.value;
    if (!password) return;

    btnLogin.disabled = true;
    btnLogin.innerHTML = 'Unlocking... <i class="fa-solid fa-arrows-rotate fa-spin"></i>';
    
    try {
        const passwordHash = await hashPassword(password);
        const cachedHash = localStorage.getItem('journal_password_hash');
        
        // If config fields are active, it's either setup mode or first login
        const isSetupMode = !setupFields.classList.contains('hidden');
        
        if (isSetupMode) {
            const pat = githubPatInput.value.trim();
            const repo = githubRepoInput.value.trim();
            
            if (!pat || !repo) {
                throw new Error('Please fill in both the Personal Access Token and Repository fields for first-time configuration.');
            }
            
            state.pat = pat;
            state.repo = repo;
            
            localStorage.setItem('journal_github_pat', pat);
            localStorage.setItem('journal_github_repo', repo);
            localStorage.setItem('journal_password_hash', passwordHash);
        } else {
            // Verify password matches cached hash
            if (cachedHash && passwordHash !== cachedHash) {
                throw new Error('Incorrect Master Password. Please try again.');
            }
            
            // Load saved config
            state.pat = localStorage.getItem('journal_github_pat');
            state.repo = localStorage.getItem('journal_github_repo');
            
            if (!state.pat || !state.repo) {
                // If config was deleted, force setup mode
                setupFields.classList.remove('hidden');
                toggleSetupBtn.classList.add('hidden');
                throw new Error('Saved configuration not found. Please fill in the PAT and Repository fields below.');
            }
        }
        
        state.password = password;
        
        // Load local cache to display immediately, then sync
        loadLocalCache();
        renderHistory();
        renderStats();
        
        // Switch to App Screen
        authScreen.classList.remove('active');
        appScreen.classList.add('active');
        
        // Set greetings
        headerGreeting.textContent = `Welcome back`;
        headerDate.textContent = formatDate(getTodayString());
        
        // Fill settings fields
        settingsRepo.placeholder = state.repo;
        
        // setup write page
        setupEditor();
        
        // Sync
        syncFromGithub();
    } catch (err) {
        console.error(err);
        authError.textContent = err.message || 'Authentication failed.';
        authError.classList.remove('hidden');
        btnLogin.disabled = false;
        btnLogin.innerHTML = '<span>Unlock Journal</span> <i class="fa-solid fa-key"></i>';
    }
}

// DOM Event Listeners
authForm.addEventListener('submit', handleLogin);
toggleSetupBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (setupFields.classList.contains('hidden')) {
        setupFields.classList.remove('hidden');
        toggleSetupBtn.textContent = 'Use existing local configuration';
        btnLogin.innerHTML = '<span>Save Config & Unlock</span> <i class="fa-solid fa-key"></i>';
    } else {
        setupFields.classList.add('hidden');
        toggleSetupBtn.textContent = 'First-time configuration / Setup PAT';
        btnLogin.innerHTML = '<span>Unlock Journal</span> <i class="fa-solid fa-key"></i>';
    }
});

navItems.forEach(item => {
    item.addEventListener('click', () => {
        switchTab(item.dataset.tab);
    });
});

moodButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        selectMood(btn.dataset.mood);
    });
});

entryBody.addEventListener('input', updateWordCount);

btnSave.addEventListener('click', saveCurrentEntry);

searchEntries.addEventListener('input', renderHistory);

btnEditEntry.addEventListener('click', editSelectedEntry);
btnDeleteEntry.addEventListener('click', deleteSelectedEntry);

settingsForm.addEventListener('submit', handleSettingsSubmit);
btnExportDecrypted.addEventListener('click', exportDecryptedDatabase);
btnClearCache.addEventListener('click', clearCacheAndLogout);

btnLock.addEventListener('click', () => {
    // Reset state & reload
    location.reload();
});

// Run check on startup to show setup if first time
window.addEventListener('DOMContentLoaded', () => {
    const cachedHash = localStorage.getItem('journal_password_hash');
    if (!cachedHash) {
        // Force setup view
        setupFields.classList.remove('hidden');
        toggleSetupBtn.classList.add('hidden');
        btnLogin.innerHTML = '<span>Setup & Unlock</span> <i class="fa-solid fa-key"></i>';
    }
});
