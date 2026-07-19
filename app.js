// Ambitious Journaling App Logic

// state management
let state = {
    password: '',
    pat: '',
    repo: '',
    entries: {}, // cache of decrypted entries: { "file_id": { title, body, mood, timestamp, sha } }
    activeTab: 'write',
    activeMood: '',
    selectedHistoryDate: null,
    editingFileId: null,
    currentAttachments: []
};

// Helper function to get all entries for a specific date (YYYY-MM-DD)
function getEntriesForDate(dateStr) {
    return Object.keys(state.entries)
        .filter(key => key === dateStr || key.startsWith(dateStr + '_'))
        .map(key => ({ id: key, ...state.entries[key] }));
}

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

const inputPhoto = document.getElementById('input-photo');
const btnAddPhoto = document.getElementById('btn-add-photo');
const btnRecordAudio = document.getElementById('btn-record-audio');
const btnStopRecord = document.getElementById('btn-stop-record');
const btnCancelRecord = document.getElementById('btn-cancel-record');
const recordingPanel = document.getElementById('recording-panel');
const recordingTimer = document.getElementById('recording-timer');
const editorAttachmentsList = document.getElementById('editor-attachments');
const viewerAttachments = document.getElementById('viewer-attachments');
const btnDownloadPdf = document.getElementById('btn-download-pdf');
const btnExportPdfBook = document.getElementById('btn-export-pdf-book');

const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxCaption = document.getElementById('lightbox-caption');
const lightboxClose = document.querySelector('.lightbox-close');

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
                                attachments: parsed.attachments || [],
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
    const parent = syncStatus.parentElement;
    if (parent) {
        parent.className = `status-indicator sync-${type}`;
    }
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
    const cacheCopy = {};
    Object.keys(state.entries).forEach(key => {
        const entry = state.entries[key];
        cacheCopy[key] = {
            title: entry.title,
            body: entry.body,
            mood: entry.mood,
            timestamp: entry.timestamp,
            sha: entry.sha,
            attachments: entry.attachments ? entry.attachments.map(att => ({
                type: att.type,
                name: att.name,
                path: att.path
            })) : []
        };
    });
    localStorage.setItem('journal_entries_cache', JSON.stringify(cacheCopy));
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
    if (state.editingFileId) {
        const entry = state.entries[state.editingFileId];
        entryTitle.value = entry.title;
        entryBody.value = entry.body;
        selectMood(entry.mood);
        state.currentAttachments = entry.attachments ? [...entry.attachments] : [];
        btnSave.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Update Reflection';
    } else {
        entryTitle.value = '';
        entryBody.value = '';
        selectMood('');
        state.currentAttachments = [];
        btnSave.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Save & Encrypt Reflection';
    }
    renderEditorAttachments();
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

// Save Entry Function (handles both new entries and updates)
async function saveCurrentEntry() {
    const title = entryTitle.value.trim();
    const body = entryBody.value.trim();
    const mood = state.activeMood;
    
    if (!body) {
        alert('Please write something in your reflection before saving.');
        return;
    }
    
    setSyncStatus('syncing', 'Preparing media files...');
    btnSave.disabled = true;
    
    const today = getTodayString();
    
    // Determine file_id and path
    let fileId = state.editingFileId;
    let isNew = false;
    if (!fileId) {
        fileId = `${today}_${Date.now()}`;
        isNew = true;
    }
    
    try {
        const updatedAttachments = [];
        for (let i = 0; i < state.currentAttachments.length; i++) {
            const att = state.currentAttachments[i];
            if (att.data) {
                setSyncStatus('syncing', `Encrypting media file ${i+1}/${state.currentAttachments.length}...`);
                const mediaPath = `media/${fileId}_${i}.enc`;
                const encryptedMedia = await encryptData(att.data, state.password);
                
                let mediaSha = null;
                try {
                    const existingMedia = await fetchGithubFile(mediaPath);
                    if (existingMedia) mediaSha = existingMedia.sha;
                } catch (e) {}
                
                await writeGithubFile(mediaPath, encryptedMedia, mediaSha);
                
                updatedAttachments.push({
                    type: att.type,
                    name: att.name,
                    path: mediaPath
                });
            } else {
                updatedAttachments.push(att);
            }
        }
        
        setSyncStatus('syncing', 'Encrypting text & syncing to GitHub...');
        const path = `entries/${fileId}.enc`;
        const entryData = {
            title: title || 'Untitled Reflection',
            body: body,
            mood: mood,
            timestamp: isNew ? Date.now() : (state.entries[fileId]?.timestamp || Date.now()),
            attachments: updatedAttachments
        };
        
        const jsonStr = JSON.stringify(entryData);
        const encryptedBase64 = await encryptData(jsonStr, state.password);
        
        let sha = null;
        if (!isNew) {
            try {
                const existingFile = await fetchGithubFile(path);
                if (existingFile) sha = existingFile.sha;
            } catch (e) {}
        }
        
        const result = await writeGithubFile(path, encryptedBase64, sha);
        
        // Update local state cache
        state.entries[fileId] = {
            title: entryData.title,
            body: entryData.body,
            mood: entryData.mood,
            timestamp: entryData.timestamp,
            attachments: entryData.attachments,
            sha: result.content.sha
        };
        
        saveLocalCache();
        btnSave.disabled = false;
        setSyncStatus('success', 'Reflection safely saved.');
        
        // Reset editor state
        state.editingFileId = null;
        setupEditor();
        renderHistory();
        renderStats();
        
        alert('Your reflection has been safely encrypted and saved to your GitHub repo!');
    } catch (err) {
        console.error(err);
        btnSave.disabled = false;
        setSyncStatus('error', 'Save failed.');
        alert(`Error saving entry: ${err.message}`);
    }
}

// 5. HISTORY VIEWER LOGIC
function renderHistory() {
    const searchQuery = searchEntries.value.toLowerCase().trim();
    historyEntriesList.innerHTML = '';
    
    const sortedFileIds = Object.keys(state.entries).sort((a, b) => b.localeCompare(a));
    let count = 0;
    
    sortedFileIds.forEach(id => {
        const entry = state.entries[id];
        
        // Filter by search query
        if (searchQuery) {
            const matchTitle = entry.title.toLowerCase().includes(searchQuery);
            const matchBody = entry.body.toLowerCase().includes(searchQuery);
            if (!matchTitle && !matchBody) return;
        }
        
        count++;
        const item = document.createElement('div');
        item.className = `history-item ${state.selectedHistoryDate === id ? 'active' : ''}`;
        item.dataset.date = id;
        
        const moodEmoji = getMoodEmoji(entry.mood);
        const datePart = id.split('_')[0];
        let timeStr = '';
        if (entry.timestamp) {
            const timeObj = new Date(entry.timestamp);
            timeStr = timeObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        
        item.innerHTML = `
            <div class="history-item-header">
                <span class="history-item-date">${datePart} ${timeStr ? '<span style="font-size: 11px; color: var(--text-muted); margin-left: 6px;">' + timeStr + '</span>' : ''}</span>
                <span class="history-item-mood">${moodEmoji}</span>
            </div>
            <div class="history-item-title">${entry.title}</div>
        `;
        
        item.addEventListener('click', () => {
            selectHistoryEntry(id);
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

function selectHistoryEntry(id) {
    state.selectedHistoryDate = id;
    
    // Highlight list item
    document.querySelectorAll('.history-item').forEach(item => {
        if (item.dataset.date === id) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
    
    const entry = state.entries[id];
    viewerPlaceholder.classList.add('hidden');
    viewerContent.classList.remove('hidden');
    
    const datePart = id.split('_')[0];
    const timeStr = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    
    viewerTitle.textContent = entry.title;
    viewerDate.textContent = `${formatDate(datePart)} ${timeStr ? 'at ' + timeStr : ''}`;
    viewerMood.textContent = `${getMoodEmoji(entry.mood)} ${entry.mood ? entry.mood.charAt(0).toUpperCase() + entry.mood.slice(1) : 'Standard'}`;
    viewerBody.textContent = entry.body;
    
    const attachments = entry.attachments || [];
    const needsLoading = attachments.some(att => att.path && !att.data);
    
    if (needsLoading) {
        loadEntryMedia(id);
    } else {
        renderViewerAttachments(attachments);
    }
}

async function loadEntryMedia(id) {
    const entry = state.entries[id];
    if (!entry || !entry.attachments) return;
    
    viewerAttachments.innerHTML = `
        <div style="text-align: center; padding: 20px; border-top: 1px solid var(--border-color); margin-top: 20px; color: var(--text-secondary);">
            <i class="fa-solid fa-spinner fa-spin"></i> Decrypting media files...
        </div>
    `;
    
    try {
        for (const att of entry.attachments) {
            if (att.path && !att.data) {
                const rawMedia = await fetchGithubFile(att.path);
                if (rawMedia && rawMedia.content) {
                    att.data = await decryptData(rawMedia.content.replace(/\s/g, ''), state.password);
                }
            }
        }
        if (state.selectedHistoryDate === id) {
            renderViewerAttachments(entry.attachments);
        }
    } catch (err) {
        console.error(err);
        if (state.selectedHistoryDate === id) {
            viewerAttachments.innerHTML = `
                <div style="text-align: center; padding: 20px; border-top: 1px solid var(--border-color); margin-top: 20px; color: var(--accent-rose);">
                    <i class="fa-solid fa-triangle-exclamation"></i> Failed to download or decrypt media.
                </div>
            `;
        }
    }
}

// Edit or delete entries
function editSelectedEntry() {
    if (!state.selectedHistoryDate) return;
    
    const id = state.selectedHistoryDate;
    const entry = state.entries[id];
    
    state.editingFileId = id;
    
    // Switch to Write tab
    switchTab('write');
    
    // Load into editor
    entryTitle.value = entry.title;
    entryBody.value = entry.body;
    selectMood(entry.mood);
    state.currentAttachments = entry.attachments ? [...entry.attachments] : [];
    renderEditorAttachments();
    updateWordCount();
    
    btnSave.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Update Reflection';
}

async function deleteSelectedEntry() {
    if (!state.selectedHistoryDate) return;
    const id = state.selectedHistoryDate;
    
    if (!confirm('Are you absolutely sure you want to delete this reflection? This action is permanent.')) {
        return;
    }
    
    setSyncStatus('syncing', 'Deleting entry...');
    try {
        const path = `entries/${id}.enc`;
        const fileData = await fetchGithubFile(path);
        if (fileData) {
            await deleteGithubFile(path, fileData.sha);
        }
        
        delete state.entries[id];
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
    const fileIds = Object.keys(state.entries);
    const totalEntries = fileIds.length;
    statTotalEntries.textContent = totalEntries;
    
    // Total words calculation
    let totalWords = 0;
    fileIds.forEach(id => {
        const text = state.entries[id].body.trim();
        if (text) {
            totalWords += text.split(/\s+/).length;
        }
    });
    statTotalWords.textContent = totalWords.toLocaleString();
    
    // Current streak calculation
    let streak = 0;
    const todayStr = getTodayString();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    
    let baseDateStr = todayStr;
    if (getEntriesForDate(todayStr).length === 0 && getEntriesForDate(yesterdayStr).length > 0) {
        baseDateStr = yesterdayStr;
    }
    
    if (getEntriesForDate(baseDateStr).length > 0) {
        let current = new Date(baseDateStr);
        while (true) {
            const currentStr = current.toISOString().slice(0, 10);
            if (getEntriesForDate(currentStr).length > 0) {
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
    
    const today = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setDate(today.getDate() - 364); // 52 weeks ago
    
    let current = new Date(oneYearAgo);
    
    for (let i = 0; i < 371; i++) {
        const cell = document.createElement('div');
        cell.className = 'grid-day';
        const dateStr = current.toISOString().slice(0, 10);
        
        cell.title = `${dateStr}: No entry`;
        
        const dayEntries = getEntriesForDate(dateStr);
        if (dayEntries.length > 0) {
            let wordCount = 0;
            dayEntries.forEach(entry => {
                wordCount += entry.body.trim().split(/\s+/).length;
            });
            
            cell.title = `${dateStr}: ${dayEntries.length} reflection(s) (${wordCount} words)`;
            
            // set fill intensity
            if (wordCount < 100) {
                cell.style.backgroundColor = 'rgba(0, 172, 193, 0.3)';
            } else if (wordCount < 300) {
                cell.style.backgroundColor = 'rgba(0, 172, 193, 0.6)';
            } else {
                cell.style.backgroundColor = 'rgba(0, 172, 193, 0.9)';
            }
        }
        
        cell.addEventListener('click', () => {
            const dayEntries = getEntriesForDate(dateStr);
            if (dayEntries.length > 0) {
                switchTab('history');
                selectHistoryEntry(dayEntries[0].id);
            } else {
                state.editingFileId = null;
                switchTab('write');
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
    dlAnchorElem.setAttribute("download", `ambitious_backup_${new Date().toISOString().slice(0, 10)}.json`);
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

// 7. RICH MEDIA & ATTACHMENT UTILITIES

function compressImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                const maxDim = 2048;
                
                if (width > maxDim || height > maxDim) {
                    if (width > height) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    } else {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }
                }
                
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                const compressedBase64 = canvas.toDataURL('image/jpeg', 0.85);
                resolve(compressedBase64);
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (err) => reject(err);
    });
}

let mediaRecorder = null;
let audioChunks = [];
let recordTimerInterval = null;
let recordSeconds = 0;

async function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Audio recording is not supported in this browser.');
        return;
    }
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioChunks = [];
        mediaRecorder = new MediaRecorder(stream);
        
        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                audioChunks.push(e.data);
            }
        };
        
        mediaRecorder.start();
        
        recordingPanel.classList.remove('hidden');
        btnRecordAudio.disabled = true;
        
        recordSeconds = 0;
        recordingTimer.textContent = '00:00';
        recordTimerInterval = setInterval(() => {
            recordSeconds++;
            const mins = String(Math.floor(recordSeconds / 60)).padStart(2, '0');
            const secs = String(recordSeconds % 60).padStart(2, '0');
            recordingTimer.textContent = `${mins}:${secs}`;
            
            if (recordSeconds >= 600) { // Limit to 10 mins
                stopRecording(true);
            }
        }, 1000);
        
    } catch (err) {
        console.error(err);
        alert('Could not access microphone: ' + err.message);
    }
}

function stopRecording(save) {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
    
    clearInterval(recordTimerInterval);
    recordingPanel.classList.add('hidden');
    btnRecordAudio.disabled = false;
    
    mediaRecorder.onstop = async () => {
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
        
        if (save && audioChunks.length > 0) {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            
            if (audioBlob.size > 15 * 1024 * 1024) {
                alert('Recording is too large (>15MB) and cannot be saved.');
                return;
            }
            
            const reader = new FileReader();
            reader.readAsDataURL(audioBlob);
            reader.onloadend = () => {
                state.currentAttachments.push({
                    type: 'audio',
                    name: `Voice_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.webm`,
                    data: reader.result
                });
                renderEditorAttachments();
            };
        }
    };
    
    mediaRecorder.stop();
}

function renderEditorAttachments() {
    editorAttachmentsList.innerHTML = '';
    
    state.currentAttachments.forEach((attachment, index) => {
        const item = document.createElement('div');
        item.className = 'editor-attachment-item';
        
        let icon = '<i class="fa-solid fa-file"></i>';
        if (attachment.type === 'image') icon = '<i class="fa-solid fa-image"></i>';
        if (attachment.type === 'audio') icon = '<i class="fa-solid fa-microphone"></i>';
        if (attachment.type === 'video') icon = '<i class="fa-solid fa-video"></i>';
        
        item.innerHTML = `
            ${icon}
            <span>${attachment.name}</span>
            <button type="button" class="btn-remove-attachment" onclick="removeAttachment(${index})">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        `;
        editorAttachmentsList.appendChild(item);
    });
}

// Exposed globally so inline HTML onclick works
window.removeAttachment = function(index) {
    state.currentAttachments.splice(index, 1);
    renderEditorAttachments();
};

function renderViewerAttachments(attachments) {
    viewerAttachments.innerHTML = '';
    if (!attachments || attachments.length === 0) return;
    
    const images = attachments.filter(a => a.type === 'image');
    const audios = attachments.filter(a => a.type === 'audio');
    const videos = attachments.filter(a => a.type === 'video');
    
    // Photos Section
    if (images.length > 0) {
        const sec = document.createElement('div');
        sec.className = 'viewer-media-section';
        sec.innerHTML = `<span class="viewer-media-section-title">Photos</span>`;
        const grid = document.createElement('div');
        grid.className = 'viewer-images-grid';
        
        images.forEach(img => {
            const wrapper = document.createElement('div');
            wrapper.className = 'viewer-image-wrapper';
            wrapper.innerHTML = `<img src="${img.data}" alt="${img.name}">`;
            wrapper.addEventListener('click', () => openLightbox(img.data, img.name));
            grid.appendChild(wrapper);
        });
        sec.appendChild(grid);
        viewerAttachments.appendChild(sec);
    }
    
    // Voice Section
    if (audios.length > 0) {
        const sec = document.createElement('div');
        sec.className = 'viewer-media-section';
        sec.innerHTML = `<span class="viewer-media-section-title">Voice Recordings</span>`;
        
        audios.forEach(aud => {
            const wrapper = document.createElement('div');
            wrapper.className = 'viewer-audio-wrapper';
            wrapper.innerHTML = `
                <span style="font-size: 13px; color: var(--text-secondary); margin-bottom: 4px;"><i class="fa-solid fa-microphone"></i> ${aud.name}</span>
                <audio controls src="${aud.data}"></audio>
            `;
            sec.appendChild(wrapper);
        });
        viewerAttachments.appendChild(sec);
    }
    
    // Video Section
    if (videos.length > 0) {
        const sec = document.createElement('div');
        sec.className = 'viewer-media-section';
        sec.innerHTML = `<span class="viewer-media-section-title">Videos</span>`;
        
        videos.forEach(vid => {
            const wrapper = document.createElement('div');
            wrapper.className = 'viewer-video-wrapper';
            wrapper.innerHTML = `
                <span style="font-size: 13px; color: var(--text-secondary); margin-bottom: 4px;"><i class="fa-solid fa-video"></i> ${vid.name}</span>
                <video controls src="${vid.data}"></video>
            `;
            sec.appendChild(wrapper);
        });
        viewerAttachments.appendChild(sec);
    }
}

function openLightbox(src, name) {
    lightbox.style.display = 'block';
    lightboxImg.src = src;
    lightboxCaption.textContent = name;
}

// 8. PDF EXPORT UTILITIES

function downloadCurrentEntryAsPdf() {
    if (!state.selectedHistoryDate) return;
    const id = state.selectedHistoryDate;
    const entry = state.entries[id];
    if (!entry) return;
    
    const images = entry.attachments ? entry.attachments.filter(a => a.type === 'image') : [];
    const unloaded = images.some(img => img.path && !img.data);
    if (unloaded) {
        alert('Please wait a moment for the photos to finish decrypting and try again.');
        return;
    }
    
    const datePart = id.split('_')[0];
    const timeStr = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    
    const element = document.createElement('div');
    element.className = 'pdf-export-layout';
    
    let imagesHtml = '';
    if (images.length > 0) {
        imagesHtml = `
            <div class="pdf-images-grid" style="margin-top: 30px;">
                ${images.map(img => `<div class="pdf-image-wrapper"><img src="${img.data}"></div>`).join('')}
            </div>
        `;
    }
    
    element.innerHTML = `
        <div class="pdf-header">
            <h2>${entry.title || 'Untitled Reflection'}</h2>
            <div class="pdf-meta">
                <span>Date: ${formatDate(datePart)} ${timeStr ? 'at ' + timeStr : ''}</span>
                <span>Mood: ${getMoodEmoji(entry.mood)} ${entry.mood || 'Standard'}</span>
            </div>
        </div>
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin-bottom: 20px;">
        <div class="pdf-body">${entry.body}</div>
        ${imagesHtml}
    `;
    
    const opt = {
        margin:       10,
        filename:     `reflection_${datePart}.pdf`,
        image:        { type: 'jpeg', quality: 0.95 },
        html2canvas:  { scale: 2, useCORS: true },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    
    html2pdf().from(element).set(opt).save();
}

async function exportFullJournalAsPdfBook() {
    const fileIds = Object.keys(state.entries).sort();
    if (fileIds.length === 0) {
        alert('You do not have any entries in your journal to export yet!');
        return;
    }
    
    btnExportPdfBook.disabled = true;
    btnExportPdfBook.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Downloading & Generating...';
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    try {
        const element = document.createElement('div');
        element.className = 'pdf-export-layout';
        
        let coverHtml = `
            <div class="pdf-book-cover">
                <h1>My Personal Journal</h1>
                <p>A Chronological Book of Daily Reflections</p>
                <p style="margin-top: 20px; font-size: 14px; color: #94a3b8;">Generated on ${formatDate(getTodayString())}</p>
            </div>
        `;
        
        let entriesHtml = '';
        for (let idx = 0; idx < fileIds.length; idx++) {
            const id = fileIds[idx];
            const entry = state.entries[id];
            const datePart = id.split('_')[0];
            const timeStr = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            
            btnExportPdfBook.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Decrypting entry ${idx+1}/${fileIds.length}...`;
            
            let imagesHtml = '';
            const images = entry.attachments ? entry.attachments.filter(a => a.type === 'image') : [];
            
            for (const img of images) {
                if (img.path && !img.data) {
                    try {
                        const rawMedia = await fetchGithubFile(img.path);
                        if (rawMedia && rawMedia.content) {
                            img.data = await decryptData(rawMedia.content.replace(/\s/g, ''), state.password);
                        }
                    } catch (e) {
                        console.error(`Failed to load image for entry ${id}:`, e);
                    }
                }
            }
            
            if (images.length > 0) {
                imagesHtml = `
                    <div class="pdf-images-grid" style="margin-top: 25px;">
                        ${images.filter(img => img.data).map(img => `<div class="pdf-image-wrapper"><img src="${img.data}"></div>`).join('')}
                    </div>
                `;
            }
            
            entriesHtml += `
                <div class="pdf-entry">
                    <h2>${entry.title || 'Untitled Reflection'}</h2>
                    <div class="pdf-meta">
                        <span>Date: ${formatDate(datePart)} ${timeStr ? 'at ' + timeStr : ''}</span>
                        <span>Mood: ${getMoodEmoji(entry.mood)} ${entry.mood || 'Standard'}</span>
                    </div>
                    <div class="pdf-body">${entry.body}</div>
                    ${imagesHtml}
                </div>
            `;
        }
        
        element.innerHTML = coverHtml + entriesHtml;
        
        btnExportPdfBook.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Rendering PDF pages...';
        
        const opt = {
            margin:       15,
            filename:     `ambitious_journal_book.pdf`,
            image:        { type: 'jpeg', quality: 0.95 },
            html2canvas:  { scale: 1.5, useCORS: true },
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };
        
        html2pdf().from(element).set(opt).save().then(() => {
            btnExportPdfBook.disabled = false;
            btnExportPdfBook.innerHTML = '<i class="fa-solid fa-file-pdf"></i> Export Journal as PDF Book';
        }).catch(err => {
            throw err;
        });
    } catch (err) {
        console.error(err);
        alert('Failed to generate PDF book: ' + err.message);
        btnExportPdfBook.disabled = false;
        btnExportPdfBook.innerHTML = '<i class="fa-solid fa-file-pdf"></i> Export Journal as PDF Book';
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

// Attachment Event Listeners
btnAddPhoto.addEventListener('click', () => inputPhoto.click());

inputPhoto.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
        const compressedBase64 = await compressImage(file);
        state.currentAttachments.push({
            type: 'image',
            name: file.name,
            data: compressedBase64
        });
        renderEditorAttachments();
    } catch (err) {
        console.error(err);
        alert('Failed to process image: ' + err.message);
    }
    inputPhoto.value = '';
});

btnRecordAudio.addEventListener('click', startRecording);
btnStopRecord.addEventListener('click', () => stopRecording(true));
btnCancelRecord.addEventListener('click', () => stopRecording(false));

btnDownloadPdf.addEventListener('click', downloadCurrentEntryAsPdf);
btnExportPdfBook.addEventListener('click', exportFullJournalAsPdfBook);

lightboxClose.addEventListener('click', () => {
    lightbox.style.display = 'none';
});
lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) {
        lightbox.style.display = 'none';
    }
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
