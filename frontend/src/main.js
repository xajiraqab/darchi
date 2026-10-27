import './style.css';

import {ArchiveDesktop, ListArchives, GetSettings, ChooseArchiveDir, RenameArchive, OpenFileLocation, OpenFolderLocation, MoveToDesktop, RestoreDesktopFromArchive} from '../wailsjs/go/main/App';
import {EventsOn} from '../wailsjs/runtime/runtime';

document.querySelector('#app').innerHTML = `
    <div class="top-bar">
        <button class="archive-btn" id="archiveBtn">Archive Desktop</button>
        <button class="settings-btn icon-only" id="settingsBtn" title="Settings">⚙️</button>
    </div>
    <div class="main-content" id="mainContent"></div>
    
    <div id="contextMenu" class="context-menu">
        <div class="context-menu-item" id="ctxOpenLocation">Open location</div>
        <div class="context-menu-item" id="ctxMoveToDesktop">Move to desktop</div>
    </div>
    
    <div id="archiveMoreMenu" class="context-menu">
        <div class="context-menu-item" id="moreOpenLocation">Open location</div>
        <div class="context-menu-item" id="moreRestoreAll">Restore all</div>
        <div class="context-menu-item" id="moreRename">Rename</div>
    </div>
    
    <div id="folderContextMenu" class="context-menu">
        <div class="context-menu-item" id="ctxRestoreDesktop">Restore desktop from this archive</div>
        <div class="context-menu-item" id="ctxOpenFolderLocation">Open location</div>
        <div class="context-menu-item" id="ctxRenameFolder">Rename</div>
    </div>
    
    <div id="settingsModal" class="modal" style="display:none;">
        <div class="modal-content settings-content">
            <div class="modal-header">Settings</div>
            <div class="modal-body">
                <div class="settings-section">
                    <div class="settings-label">Archive root location</div>
                    <div class="settings-row">
                        <input type="text" id="archiveRootInput" class="modal-input" readonly />
                        <button class="modal-btn secondary" id="chooseDirBtn">Choose...</button>
                    </div>
                </div>
                <div class="settings-section">
                    <div class="settings-label">Theme</div>
                    <select id="themeSelect" class="modal-select">
                        <option value="dark">Dark</option>
                        <option value="light">Light</option>
                        <option value="system">System</option>
                    </select>
                </div>
                <div class="settings-section">
                    <button class="modal-btn secondary settings-refresh" id="refreshBtn">Refresh Archives</button>
                </div>
            </div>
            <div class="modal-footer">
                <button class="modal-btn primary" id="closeSettingsBtn">Close</button>
            </div>
        </div>
    </div>
    
    <div id="confirmModal" class="modal confirm-modal" style="display:none;">
        <div class="modal-content">
            <div class="modal-header">Confirm</div>
            <div class="modal-body">
                <div class="confirm-text">Are you sure to archive desktop?</div>
            </div>
            <div class="modal-footer">
                <button class="modal-btn secondary" id="confirmCancelBtn">Cancel</button>
                <button class="modal-btn primary" id="confirmOkBtn">Archive</button>
            </div>
        </div>
    </div>
    
    <div id="renameModal" class="modal" style="display:none;">
        <div class="modal-content">
            <div class="modal-header">Rename archive</div>
            <div class="modal-body">
                <input type="text" id="renameInput" class="modal-input" />
            </div>
            <div class="modal-footer">
                <button class="modal-btn secondary" id="renameCancelBtn">Cancel</button>
                <button class="modal-btn primary" id="renameOkBtn">Rename</button>
            </div>
        </div>
    </div>
    
    <div id="loadingModal" class="modal" style="display:none;">
        <div class="modal-content">
            <div class="modal-header">Please wait</div>
            <div class="modal-body" style="display:flex;flex-direction:column;align-items:center;gap:12px;">
                <div id="loadingSpinner" class="spinner"></div>
                <div id="loadingText" style="font-size:13px;">Processing...</div>
            </div>
        </div>
    </div>
`;

let currentContextFile = null;
let currentContextFolder = null;
function positionContextMenu(menu, x, y) {
    menu.classList.add('show');
    // force layout
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + mw > vw - 4) {
        left = Math.max(4, x - mw);
    }
    if (top + mh > vh - 4) {
        top = Math.max(4, y - mh);
    }
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
}
let renameClickTimer = null;
let currentRenameItem = null;
let currentRenameOldName = null;
let currentMoreArchive = null;
const expandedArchives = new Set();

function toggleArchive(header) {
    const filesDiv = header.nextElementSibling;
    const arrow = header.querySelector('.collapse-arrow');
    const archiveItem = header.parentElement;
    const name = archiveItem ? archiveItem.dataset.name : null;
    if (!filesDiv) return;
    if (filesDiv.classList.contains('collapsed')) {
        filesDiv.classList.remove('collapsed');
        if (arrow) arrow.textContent = '▼';
        if (name) expandedArchives.add(name);
    } else {
        filesDiv.classList.add('collapsed');
        if (arrow) arrow.textContent = '▶';
        if (name) expandedArchives.delete(name);
    }
}

function startRenameArchive(archiveItem) {
    const header = archiveItem.querySelector('.archive-header');
    const nameSpan = header.querySelector('.archive-name');
    const nameInput = header.querySelector('.archive-name-input');
    const oldName = archiveItem.dataset.name;
    nameSpan.style.display = 'none';
    nameInput.style.display = 'block';
    nameInput.focus();
    nameInput.select();
    const editing = {archiveItem, oldName, nameSpan, nameInput};
    const onBlur = async () => {
        nameInput.removeEventListener('blur', onBlur);
        if (currentEditingFolder !== editing) return;
        currentEditingFolder = null;
        const newName = nameInput.value.trim();
        if (newName && newName !== oldName) {
            try {
                await RenameArchive(oldName, newName);
                archiveItem.dataset.name = newName;
                nameSpan.textContent = newName;
                await loadArchives();
            } catch (err) {
                alert('Error: ' + err);
            }
        }
        nameSpan.style.display = 'block';
        nameInput.style.display = 'none';
    };
    editing.blurHandler = onBlur;
    currentEditingFolder = editing;
    nameInput.addEventListener('blur', onBlur);
}

async function loadSettings() {
    try {
        const settings = await GetSettings();
        const input = document.getElementById('archiveRootInput');
        if (input) {
            input.value = settings.archiveRoot;
        }
    } catch(e) {
        console.error(e);
    }
}

function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        root.classList.toggle('light', !prefersDark);
    } else {
        root.classList.toggle('light', theme === 'light');
    }
}

function loadTheme() {
    const theme = localStorage.getItem('theme') || 'dark';
    const select = document.getElementById('themeSelect');
    if (select) select.value = theme;
    applyTheme(theme);
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((localStorage.getItem('theme') || 'dark') === 'system') {
        applyTheme('system');
    }
});

async function loadArchives() {
    try {
        const archives = await ListArchives();
        const mainContent = document.getElementById('mainContent');
        const topBar = document.querySelector('.top-bar');
        
        // Remove empty state if exists
        const existingEmpty = mainContent.querySelector('.empty-state');
        if (existingEmpty) {
            existingEmpty.remove();
        }
        
        if (archives.length === 0) {
            if (topBar) {
                topBar.classList.remove('has-archives');
                topBar.classList.remove('no-archives');
                topBar.style.display = 'flex';
            }
            const topArchiveBtn = document.getElementById('archiveBtn');
            if (topArchiveBtn) {
                topArchiveBtn.style.display = 'none';
            }
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.style.display = 'flex';
            empty.style.flexDirection = 'column';
            empty.style.alignItems = 'center';
            empty.style.justifyContent = 'center';
            empty.style.gap = '10px';
            empty.style.position = 'absolute';
            empty.style.top = '0';
            empty.style.left = '0';
            empty.style.right = '0';
            empty.style.bottom = '0';
            empty.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;"><button class="archive-btn big-archive-btn" id="bigArchiveBtn">Archive Desktop</button></div>`;
            mainContent.innerHTML = '';
            mainContent.appendChild(empty);
            document.getElementById('bigArchiveBtn').addEventListener('click', () => {
                showConfirm(async () => {
                    showLoading('Archiving desktop...');
                    try {
                        const newName = await ArchiveDesktop();
                        expandedArchives.clear();
                        if (newName) expandedArchives.add(newName);
                        await loadArchives();
                        hideLoading();
                    } catch(e) {
                        hideLoading();
                        alert('Error: ' + e);
                    }
                });
            });
            return;
        }
        
        mainContent.innerHTML = '';
        if (topBar) {
            topBar.classList.remove('no-archives');
            topBar.classList.add('has-archives');
        }
        const topArchiveBtn = document.getElementById('archiveBtn');
        if (topArchiveBtn) {
            topArchiveBtn.style.display = '';
        }
        
        archives.forEach((archive, idx) => {
            const archiveDiv = document.createElement('div');
            archiveDiv.className = 'archive-item';
            archiveDiv.dataset.name = archive.name;
            archiveDiv.dataset.path = archive.path;
            
            const expanded = expandedArchives.has(archive.name);
            
            archiveDiv.innerHTML = `
                <div class="archive-header" data-action="toggle">
                    <span class="collapse-arrow">${expanded ? '▼' : '▶'}</span>
                    <span class="archive-name" data-action="rename">${escapeHtml(archive.name)}</span>
                    <input class="archive-name-input" style="display:none;" value="${escapeHtml(archive.name)}" />
                    <span class="archive-date">${archive.created}</span>
                    <span class="archive-more" title="More" data-action="more">⋮</span>
                </div>
                <div class="archive-files ${expanded ? '' : 'collapsed'}">
                    ${[...(archive.files || [])].sort((a,b) => {
                        const ca = fileCategory(a).order;
                        const cb = fileCategory(b).order;
                        if (ca !== cb) return ca - cb;
                        if (a.isDir && !b.isDir) return -1;
                        if (!a.isDir && b.isDir) return 1;
                        return a.name.localeCompare(b.name);
                    }).map(file => `
                        <div class="file-item" data-path="${(file.path || '').replace(/\\/g,'\\\\')}" data-isdir="${file.isDir}" title="${escapeHtml(file.name)}">
                            ${file.isDir ? `<span class="file-icon">${folderIconSvg()}</span>` : (file.icon ? `<span class="file-icon"><img src="${file.icon}" width="32" height="32" style="border-radius:4px;" /></span>` : `<span class="file-icon">${getFileIconSvg(file.name)}</span>`)}
                            ${file.duplicate ? '<span class="dup-badge" title="Duplicate name across archives">⚠</span>' : ''}
                            ${file.onDesktop ? '<span class="desk-badge" title="Already on desktop"><svg width="14" height="14" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="2" width="14" height="9" rx="1" fill="#42A5F5"/><rect x="1" y="2" width="14" height="3" rx="1" fill="#1E88E5"/><rect x="6" y="11" width="4" height="2" fill="#42A5F5"/><rect x="4" y="13" width="8" height="1.5" rx="0.5" fill="#1E88E5"/></svg></span>' : ''}
                            <span class="file-name">${escapeHtml(file.name)}</span>
                        </div>
                    `).join('')}
                </div>
            `;
            
            mainContent.appendChild(archiveDiv);
        });
    } catch(e) {
        console.error(e);
    }
}

function fileCategory(file) {
    if (file.isDir) return { order: 0, label: 'Folders' };
    const ext = (file.name || '').split('.').pop().toLowerCase();
    if (['exe','msi','bat','cmd'].includes(ext)) return { order: 1, label: 'Applications' };
    if (['jpg','jpeg','png','gif','bmp','ico','webp','svg'].includes(ext)) return { order: 2, label: 'Images' };
    if (['mp3','wav','flac','aac','ogg'].includes(ext)) return { order: 3, label: 'Audio' };
    if (['mp4','avi','mkv','mov','webm'].includes(ext)) return { order: 4, label: 'Video' };
    if (['pdf','doc','docx','txt','md','log','rtf','odt'].includes(ext)) return { order: 5, label: 'Documents' };
    if (['xls','xlsx','csv'].includes(ext)) return { order: 6, label: 'Spreadsheets' };
    if (['ppt','pptx'].includes(ext)) return { order: 7, label: 'Presentations' };
    if (['zip','rar','7z','tar','gz'].includes(ext)) return { order: 8, label: 'Archives' };
    return { order: 9, label: 'Other' };
}
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

function folderIconSvg() {
    return `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 8a2 2 0 0 1 2-2h8l2 2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" fill="#F5C518"/>
        <path d="M3 12h26v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V12z" fill="#E6B800"/>
    </svg>`;
}

function getFileIconSvg(name) {
    const ext = (name || '').split('.').pop().toLowerCase();
    const color = (c) => c;
    // Excel
    if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
        return `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <rect x="4" y="3" width="20" height="26" rx="2" fill="#217346"/>
            <rect x="8" y="8" width="12" height="2" fill="#fff" opacity="0.9"/>
            <rect x="8" y="12" width="12" height="2" fill="#fff" opacity="0.9"/>
            <rect x="8" y="16" width="8" height="2" fill="#fff" opacity="0.9"/>
            <text x="24" y="30" font-size="8" font-weight="bold" fill="#217346" text-anchor="end">X</text>
        </svg>`;
    }
    // Word
    if (ext === 'doc' || ext === 'docx') {
        return `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <rect x="4" y="3" width="20" height="26" rx="2" fill="#2B579A"/>
            <rect x="8" y="9" width="12" height="2" fill="#fff" opacity="0.9"/>
            <rect x="8" y="13" width="12" height="2" fill="#fff" opacity="0.9"/>
            <rect x="8" y="17" width="10" height="2" fill="#fff" opacity="0.9"/>
            <rect x="8" y="21" width="12" height="2" fill="#fff" opacity="0.9"/>
        </svg>`;
    }
    // PowerPoint
    if (ext === 'ppt' || ext === 'pptx') {
        return `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <rect x="4" y="3" width="20" height="26" rx="2" fill="#D24726"/>
            <rect x="8" y="9" width="12" height="9" rx="1" fill="#fff" opacity="0.9"/>
            <circle cx="14" cy="13" r="2" fill="#D24726"/>
        </svg>`;
    }
    // PDF
    if (ext === 'pdf') {
        return `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <rect x="4" y="3" width="20" height="26" rx="2" fill="#E53935"/>
            <text x="14" y="20" font-size="7" font-weight="bold" fill="#fff" text-anchor="middle">PDF</text>
        </svg>`;
    }
    // Images
    if (ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'gif' || ext === 'bmp' || ext === 'ico' || ext === 'webp' || ext === 'svg') {
        return `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <rect x="4" y="5" width="24" height="22" rx="2" fill="#7E57C2"/>
            <circle cx="11" cy="12" r="2.5" fill="#FFD54F"/>
            <path d="M4 22l7-7 5 5 6-6 8 8v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2z" fill="#4DB6AC"/>
        </svg>`;
    }
    // Audio
    if (ext === 'mp3' || ext === 'wav' || ext === 'flac' || ext === 'aac' || ext === 'ogg') {
        return `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <circle cx="16" cy="16" r="12" fill="#EC407A"/>
            <circle cx="16" cy="16" r="4" fill="#fff"/>
            <circle cx="16" cy="16" r="1.5" fill="#EC407A"/>
        </svg>`;
    }
    // Video
    if (ext === 'mp4' || ext === 'avi' || ext === 'mkv' || ext === 'mov' || ext === 'webm') {
        return `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <rect x="3" y="7" width="26" height="18" rx="2" fill="#5C6BC0"/>
            <path d="M13 12l8 5-8 5V12z" fill="#fff"/>
        </svg>`;
    }
    // Archives
    if (ext === 'zip' || ext === 'rar' || ext === '7z' || ext === 'tar' || ext === 'gz') {
        return `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <rect x="5" y="4" width="22" height="24" rx="2" fill="#8D6E63"/>
            <rect x="14" y="4" width="4" height="24" fill="#6D4C41"/>
            <rect x="13" y="8" width="6" height="2" fill="#FFD54F"/>
            <rect x="13" y="13" width="6" height="2" fill="#FFD54F"/>
        </svg>`;
    }
    // Executable
    if (ext === 'exe' || ext === 'msi' || ext === 'bat' || ext === 'cmd') {
        return `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <rect x="4" y="5" width="24" height="18" rx="2" fill="#546E7A"/>
            <rect x="4" y="5" width="24" height="4" rx="2" fill="#37474F"/>
            <circle cx="7" cy="7" r="0.8" fill="#EF5350"/>
            <circle cx="9.5" cy="7" r="0.8" fill="#FFCA28"/>
            <circle cx="12" cy="7" r="0.8" fill="#66BB6A"/>
            <rect x="7" y="11" width="18" height="2" rx="1" fill="#fff" opacity="0.8"/>
            <rect x="7" y="15" width="12" height="2" rx="1" fill="#fff" opacity="0.8"/>
            <rect x="7" y="19" width="15" height="2" rx="1" fill="#fff" opacity="0.8"/>
            <rect x="12" y="23" width="8" height="2" rx="1" fill="#546E7A"/>
            <rect x="10" y="25" width="12" height="2" rx="1" fill="#37474F"/>
        </svg>`;
    }
    // RDP / Remote Desktop
    if (ext === 'rdp') {
        return `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <rect x="3" y="5" width="26" height="17" rx="2" fill="#1976D2"/>
            <rect x="3" y="5" width="26" height="4" rx="2" fill="#1565C0"/>
            <circle cx="6" cy="7" r="0.8" fill="#fff"/>
            <circle cx="8.5" cy="7" r="0.8" fill="#fff"/>
            <circle cx="11" cy="7" r="0.8" fill="#fff"/>
            <path d="M10 14l4 3-4 3" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
            <rect x="16" y="16" width="8" height="2" rx="1" fill="#fff" opacity="0.9"/>
            <rect x="12" y="22" width="8" height="2" rx="1" fill="#1976D2"/>
            <rect x="10" y="24" width="12" height="2" rx="1" fill="#1565C0"/>
        </svg>`;
    }
    // Text
    if (ext === 'txt' || ext === 'md' || ext === 'log' || ext === 'json' || ext === 'xml' || ext === 'html' || ext === 'css' || ext === 'js' || ext === 'ts') {
        return `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <rect x="6" y="3" width="20" height="26" rx="2" fill="#90A4AE"/>
            <rect x="10" y="9" width="12" height="2" fill="#fff" opacity="0.9"/>
            <rect x="10" y="13" width="12" height="2" fill="#fff" opacity="0.9"/>
            <rect x="10" y="17" width="9" height="2" fill="#fff" opacity="0.9"/>
            <rect x="10" y="21" width="12" height="2" fill="#fff" opacity="0.9"/>
        </svg>`;
    }
    // Default file
    return `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <path d="M7 3h12l6 6v20a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="#B0BEC5"/>
        <path d="M19 3v6h6" fill="#90A4AE"/>
    </svg>`;
}

let confirmCallback = null;

function showConfirm(callback) {
    confirmCallback = callback;
    const modal = document.getElementById('confirmModal');
    modal.style.display = 'flex';
    void modal.offsetWidth;
    modal.classList.add('show');
}

function hideConfirm() {
    const modal = document.getElementById('confirmModal');
    modal.classList.remove('show');
    setTimeout(() => {
        if (!modal.classList.contains('show')) {
            modal.style.display = 'none';
        }
    }, 250);
}

document.getElementById('confirmCancelBtn').addEventListener('click', () => {
    hideConfirm();
    confirmCallback = null;
});

document.getElementById('confirmOkBtn').addEventListener('click', async () => {
    hideConfirm();
    if (typeof confirmCallback === 'function') {
        await confirmCallback();
    }
    confirmCallback = null;
});

document.getElementById('confirmModal').addEventListener('click', (e) => {
    if (e.target.id === 'confirmModal') {
        hideConfirm();
        confirmCallback = null;
    }
});

function showLoading(text) {
    const modal = document.getElementById('loadingModal');
    const loadingText = document.getElementById('loadingText');
    if (loadingText) loadingText.textContent = text || 'Processing...';
    modal.style.display = 'flex';
    void modal.offsetWidth;
    modal.classList.add('show');
}

EventsOn('archive:progress', (data) => {
    const loadingText = document.getElementById('loadingText');
    if (loadingText) {
        loadingText.textContent = data.message || `Processing ${data.current}/${data.total}...`;
    }
});

function hideLoading() {
    const modal = document.getElementById('loadingModal');
    modal.classList.remove('show');
    setTimeout(() => {
        if (!modal.classList.contains('show')) {
            modal.style.display = 'none';
        }
    }, 250);
}

document.getElementById('archiveBtn').addEventListener('click', () => {
    showConfirm(async () => {
        showLoading('Archiving desktop...');
        try {
            const newName = await ArchiveDesktop();
            expandedArchives.clear();
            if (newName) expandedArchives.add(newName);
            await loadArchives();
            hideLoading();
        } catch(e) {
            hideLoading();
            alert('Error: ' + e);
        }
    });
});

document.getElementById('settingsBtn').addEventListener('click', () => {
    const modal = document.getElementById('settingsModal');
    modal.style.display = 'flex';
    // trigger reflow
    void modal.offsetWidth;
    modal.classList.add('show');
});

document.getElementById('closeSettingsBtn').addEventListener('click', () => {
    const modal = document.getElementById('settingsModal');
    modal.classList.remove('show');
    setTimeout(() => {
        if (!modal.classList.contains('show')) {
            modal.style.display = 'none';
        }
    }, 250);
});

document.getElementById('settingsModal').addEventListener('click', (e) => {
    if (e.target.id === 'settingsModal') {
        const modal = document.getElementById('settingsModal');
        modal.classList.remove('show');
        setTimeout(() => {
            if (!modal.classList.contains('show')) {
                modal.style.display = 'none';
            }
        }, 250);
    }
});

document.getElementById('renameCancelBtn').addEventListener('click', () => {
    const modal = document.getElementById('renameModal');
    modal.classList.remove('show');
    setTimeout(() => {
        if (!modal.classList.contains('show')) {
            modal.style.display = 'none';
        }
    }, 250);
    currentRenameItem = null;
    currentRenameOldName = null;
});

document.getElementById('renameModal').addEventListener('click', (e) => {
    if (e.target.id === 'renameModal') {
        const modal = document.getElementById('renameModal');
        modal.classList.remove('show');
        setTimeout(() => {
            if (!modal.classList.contains('show')) {
                modal.style.display = 'none';
            }
        }, 250);
        currentRenameItem = null;
        currentRenameOldName = null;
    }
});

document.getElementById('renameOkBtn').addEventListener('click', async () => {
    const input = document.getElementById('renameInput');
    const newName = (input.value || '').trim();
    const modal = document.getElementById('renameModal');
    if (newName && currentRenameOldName && newName !== currentRenameOldName) {
        try {
            const wasExpanded = expandedArchives.has(currentRenameOldName);
            await RenameArchive(currentRenameOldName, newName);
            if (wasExpanded) {
                expandedArchives.delete(currentRenameOldName);
                expandedArchives.add(newName);
            }
            if (currentRenameItem) currentRenameItem.dataset.name = newName;
            await loadArchives();
        } catch (err) {
            alert('Error: ' + err);
            return;
        }
    }
    modal.classList.remove('show');
    setTimeout(() => {
        if (!modal.classList.contains('show')) {
            modal.style.display = 'none';
        }
    }, 250);
    currentRenameItem = null;
    currentRenameOldName = null;
});

document.getElementById('renameInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        document.getElementById('renameOkBtn').click();
    } else if (e.key === 'Escape') {
        document.getElementById('renameCancelBtn').click();
    }
});

function showRenameDialog(archiveItem) {
    currentRenameItem = archiveItem;
    currentRenameOldName = archiveItem.dataset.name;
    const input = document.getElementById('renameInput');
    input.value = currentRenameOldName;
    const modal = document.getElementById('renameModal');
    modal.style.display = 'flex';
    void modal.offsetWidth;
    modal.classList.add('show');
    setTimeout(() => input.focus(), 0);
    input.select();
}

document.getElementById('themeSelect').addEventListener('change', (e) => {
    const theme = e.target.value;
    localStorage.setItem('theme', theme);
    applyTheme(theme);
});

document.getElementById('refreshBtn').addEventListener('click', async () => {
    const modal = document.getElementById('settingsModal');
    modal.classList.remove('show');
    setTimeout(() => {
        if (!modal.classList.contains('show')) {
            modal.style.display = 'none';
        }
    }, 250);
    expandedArchives.clear();
    await loadArchives();
});

document.getElementById('chooseDirBtn').addEventListener('click', async () => {
    showLoading('Moving archives...');
    try {
        await ChooseArchiveDir();
        await loadSettings();
        await loadArchives();
        hideLoading();
    } catch(e) {
        hideLoading();
        alert('Error: ' + e);
        console.error(e);
    }
});

document.getElementById('mainContent').addEventListener('click', (e) => {
    const header = e.target.closest('.archive-header');
    if (header) {
        const moreIcon = e.target.closest('.archive-more');
        if (moreIcon) {
            const archiveItem = header.parentElement;
            currentMoreArchive = archiveItem;
            const menu = document.getElementById('archiveMoreMenu');
            document.getElementById('contextMenu').classList.remove('show');
            document.getElementById('folderContextMenu').classList.remove('show');
            positionContextMenu(menu, e.pageX, e.pageY);
            e.stopPropagation();
            return;
        }
        const nameSpan = e.target.closest('.archive-name');
        const nameInput = e.target.closest('.archive-name-input');
        if (nameInput) {
            return;
        }
        if (nameSpan) {
            toggleArchive(header);
            return;
        }
        // clicking anywhere else in header toggles immediately
        toggleArchive(header);
        return;
    }
    
    const fileItem = e.target.closest('.file-item');
    if (fileItem) {
        // Could add click behavior if needed
    }
});

document.getElementById('mainContent').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const header = e.target.closest('.archive-header');
    if (header && !e.target.dataset.action) {
        currentContextFolder = header.parentElement;
        const menu = document.getElementById('folderContextMenu');
        document.getElementById('contextMenu').classList.remove('show');
        positionContextMenu(menu, e.pageX, e.pageY);
        return;
    }
    const fileItem = e.target.closest('.file-item');
    if (fileItem) {
        currentContextFile = (fileItem.dataset.path || '').replace(/\\\\/g, '\\');
        const menu = document.getElementById('contextMenu');
        document.getElementById('folderContextMenu').classList.remove('show');
        positionContextMenu(menu, e.pageX, e.pageY);
        return;
    }
});

document.getElementById('mainContent').addEventListener('click', (e) => {
    const fileItem = e.target.closest('.file-item');
    if (fileItem) {
        currentContextFile = (fileItem.dataset.path || '').replace(/\\\\/g, '\\');
        const menu = document.getElementById('contextMenu');
        document.getElementById('folderContextMenu').classList.remove('show');
        positionContextMenu(menu, e.pageX, e.pageY);
        e.stopPropagation();
        return;
    }
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('.context-menu')) {
        document.getElementById('contextMenu').classList.remove('show');
        document.getElementById('folderContextMenu').classList.remove('show');
        document.getElementById('archiveMoreMenu').classList.remove('show');
    }
});

document.getElementById('ctxOpenLocation').addEventListener('click', async () => {
    if (currentContextFile) {
        try {
            await OpenFileLocation(currentContextFile);
        } catch(e) {
            console.error(e);
        }
    }
    document.getElementById('contextMenu').classList.remove('show');
});

document.getElementById('ctxMoveToDesktop').addEventListener('click', async () => {
    if (currentContextFile) {
        document.getElementById('contextMenu').classList.remove('show');
        showLoading('Moving to desktop...');
        try {
            await MoveToDesktop(currentContextFile);
            await loadArchives();
        } catch(e) {
            alert('Error: ' + e);
        }
        hideLoading();
    } else {
        document.getElementById('contextMenu').classList.remove('show');
    }
});

document.getElementById('ctxOpenFolderLocation').addEventListener('click', async () => {
    if (currentContextFolder) {
        try {
            await OpenFolderLocation(currentContextFolder.dataset.path);
        } catch(e) {
            console.error(e);
        }
    }
    document.getElementById('folderContextMenu').classList.remove('show');
});

document.getElementById('ctxRestoreDesktop').addEventListener('click', () => {
    if (currentContextFolder) {
        const archiveName = currentContextFolder.dataset.name;
        document.getElementById('folderContextMenu').classList.remove('show');
        showConfirm(async () => {
            showLoading('Archiving current desktop and restoring...');
            try {
                await RestoreDesktopFromArchive(archiveName);
                await loadArchives();
                hideLoading();
                alert('Restored');
            } catch(e) {
                hideLoading();
                alert('Error: ' + e);
            }
        });
    }
});

document.getElementById('moreOpenLocation').addEventListener('click', async () => {
    if (currentMoreArchive) {
        try {
            await OpenFolderLocation(currentMoreArchive.dataset.path);
        } catch(e) {
            console.error(e);
        }
    }
    document.getElementById('archiveMoreMenu').classList.remove('show');
});

document.getElementById('moreRename').addEventListener('click', () => {
    if (currentMoreArchive) {
        showRenameDialog(currentMoreArchive);
    }
    document.getElementById('archiveMoreMenu').classList.remove('show');
});

document.getElementById('moreRestoreAll').addEventListener('click', () => {
    if (currentMoreArchive) {
        const archiveItem = currentMoreArchive;
        const archiveName = archiveItem.dataset.name;
        document.getElementById('archiveMoreMenu').classList.remove('show');
        showConfirm(async () => {
            showLoading('Archiving current desktop and restoring...');
            try {
                const newName = await RestoreDesktopFromArchive(archiveName);
                expandedArchives.clear();
                if (newName) expandedArchives.add(newName);
                await loadArchives();
                hideLoading();
            } catch(e) {
                hideLoading();
                alert('Error: ' + e);
            }
        });
    } else {
        document.getElementById('archiveMoreMenu').classList.remove('show');
    }
});

document.getElementById('ctxRenameFolder').addEventListener('click', () => {
    if (currentContextFolder) {
        showRenameDialog(currentContextFolder);
    }
    document.getElementById('folderContextMenu').classList.remove('show');
});

document.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && currentEditingFolder) {
        const editing = currentEditingFolder;
        if (editing.blurHandler) {
            editing.nameInput.removeEventListener('blur', editing.blurHandler);
        }
        currentEditingFolder = null;
        const newName = editing.nameInput.value.trim();
        if (newName && newName !== editing.oldName) {
            try {
                await RenameArchive(editing.oldName, newName);
                editing.archiveItem.dataset.name = newName;
                editing.nameSpan.textContent = newName;
                await loadArchives();
            } catch(err) {
                alert('Error: ' + err);
            }
        }
        editing.nameSpan.style.display = 'block';
        editing.nameInput.style.display = 'none';
    } else if (e.key === 'Escape' && currentEditingFolder) {
        const editing = currentEditingFolder;
        if (editing.blurHandler) {
            editing.nameInput.removeEventListener('blur', editing.blurHandler);
        }
        currentEditingFolder = null;
        editing.nameInput.value = editing.oldName;
        editing.nameSpan.style.display = 'block';
        editing.nameInput.style.display = 'none';
    }
});

loadTheme();
loadSettings();
loadArchives();
