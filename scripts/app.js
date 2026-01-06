/**
 * 灵感笔记 - 云端数据库版（Supabase）
 * - 登录/注册（邮箱+密码）
 * - 私密/公开（公开只读，RLS 保证权限）
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const DEFAULT_COLOR = '#6C5CE7';
const IMAGE_MAX_DIMENSION = 1600;
const IMAGE_QUALITY = 0.85;

const MAX_TAGS = 8;
const MAX_TAG_LENGTH = 16;

function isSupabaseConfigured() {
    return (
        typeof SUPABASE_URL === 'string' &&
        SUPABASE_URL.startsWith('https://') &&
        !SUPABASE_URL.includes('YOUR_PROJECT') &&
        typeof SUPABASE_ANON_KEY === 'string' &&
        SUPABASE_ANON_KEY.length > 20 &&
        !SUPABASE_ANON_KEY.includes('YOUR_SUPABASE')
    );
}

function normalizeString(value) {
    return String(value ?? '').trim();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text ?? '');
    return div.innerHTML;
}

function uniqueStrings(items) {
    const seen = new Set();
    const result = [];
    for (const item of items) {
        const value = normalizeString(item);
        if (!value) continue;
        const key = value.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(value);
    }
    return result;
}

function parseTags(input) {
    const raw = normalizeString(input);
    if (!raw) return [];
    const parts = raw
        .split(/[,，]/g)
        .map((t) => normalizeString(t))
        .filter(Boolean)
        .map((t) => (t.length > MAX_TAG_LENGTH ? t.slice(0, MAX_TAG_LENGTH) : t));
    return uniqueStrings(parts).slice(0, MAX_TAGS);
}

function formatDateTime(value) {
    const ms = typeof value === 'number' ? value : Date.parse(String(value));
    const dt = new Date(ms);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toLocaleString('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
        reader.readAsText(file);
    });
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = src;
    });
}

async function compressImageFileToDataUrl(file) {
    const originalDataUrl = await readFileAsDataUrl(file);
    const img = await loadImage(originalDataUrl);

    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;

    if (!srcW || !srcH) return originalDataUrl;

    const scale = Math.min(1, IMAGE_MAX_DIMENSION / Math.max(srcW, srcH));
    const targetW = Math.max(1, Math.round(srcW * scale));
    const targetH = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;

    const ctx = canvas.getContext('2d');
    if (!ctx) return originalDataUrl;

    ctx.drawImage(img, 0, 0, targetW, targetH);

    return canvas.toDataURL('image/jpeg', IMAGE_QUALITY);
}

function safeJsonParse(raw) {
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function getDisplayNameFromUser(user) {
    const name = normalizeString(user?.user_metadata?.display_name);
    if (name) return name;
    const email = normalizeString(user?.email);
    if (email.includes('@')) return email.split('@')[0];
    return email || '用户';
}

class NotesApp {
    constructor(supabase) {
        this.supabase = supabase;

        this.session = null;
        this.user = null;

        this.viewMode = 'public';
        this.searchQuery = '';
        this.sortMode = 'updated_desc';

        this.notes = [];

        this.editingNote = null;
        this.currentImage = null;
        this.selectedColor = DEFAULT_COLOR;

        this.authMode = 'login';
        this.hasWarnedConfig = false;

        this.cacheDom();
        this.bindEvents();
        this.bootstrap();
    }

    cacheDom() {
        this.grid = document.getElementById('notes-grid');
        this.emptyStateTemplate = document.getElementById('empty-state-template');
        this.noResultsTemplate = document.getElementById('no-results-template');
        this.noteCount = document.getElementById('note-count');

        this.searchInput = document.getElementById('search-input');
        this.clearSearchBtn = document.getElementById('clear-search-btn');
        this.sortSelect = document.getElementById('sort-select');

        this.viewMyBtn = document.getElementById('view-my-btn');
        this.viewPublicBtn = document.getElementById('view-public-btn');

        this.noteActions = document.getElementById('note-actions');
        this.userActions = document.getElementById('user-actions');
        this.authActions = document.getElementById('auth-actions');

        this.exportBtn = document.getElementById('export-btn');
        this.importFile = document.getElementById('import-file');
        this.clearAllBtn = document.getElementById('clear-all-btn');
        this.addBtn = document.getElementById('add-note-btn');

        this.userName = document.getElementById('user-name');
        this.profileBtn = document.getElementById('profile-btn');
        this.signoutBtn = document.getElementById('signout-btn');

        this.openLoginBtn = document.getElementById('open-login-btn');
        this.openRegisterBtn = document.getElementById('open-register-btn');

        this.modal = document.getElementById('note-modal');
        this.modalTitle = document.getElementById('modal-title');
        this.modalBadge = document.getElementById('modal-badge');
        this.closeBtn = document.getElementById('close-modal-btn');
        this.saveBtn = document.getElementById('save-note-btn');
        this.deleteBtn = document.getElementById('delete-note-btn');

        this.titleInput = document.getElementById('note-title');
        this.noteInput = document.getElementById('note-text');
        this.tagsInput = document.getElementById('note-tags');
        this.pinnedInput = document.getElementById('note-pinned');
        this.publicInput = document.getElementById('note-public');

        this.uploadArea = document.getElementById('drop-zone');
        this.fileInput = document.getElementById('image-upload');
        this.previewContainer = document.getElementById('image-preview-container');
        this.previewImg = document.getElementById('image-preview');
        this.removeImgBtn = document.getElementById('remove-image-btn');
        this.uploadPlaceholder = document.querySelector('.upload-placeholder');

        this.toastContainer = document.getElementById('toast-container');

        this.authModal = document.getElementById('auth-modal');
        this.authModalTitle = document.getElementById('auth-modal-title');
        this.closeAuthModalBtn = document.getElementById('close-auth-modal-btn');
        this.authTabLogin = document.getElementById('auth-tab-login');
        this.authTabRegister = document.getElementById('auth-tab-register');
        this.authForm = document.getElementById('auth-form');
        this.authNameGroup = document.getElementById('auth-name-group');
        this.authNameInput = document.getElementById('auth-name');
        this.authEmailInput = document.getElementById('auth-email');
        this.authPasswordInput = document.getElementById('auth-password');
        this.authSubmitBtn = document.getElementById('auth-submit-btn');
        this.authMessage = document.getElementById('auth-message');

        this.resendConfirmBtn = document.getElementById('resend-confirm-btn');

        this.oauthGithubBtn = document.getElementById('oauth-github-btn');

        this.colorButtons = Array.from(document.querySelectorAll('.color-btn'));
    }

    bindEvents() {
        this.searchInput.addEventListener('input', () => {
            this.searchQuery = this.searchInput.value;
            this.render();
        });

        this.clearSearchBtn.addEventListener('click', () => {
            this.searchQuery = '';
            this.searchInput.value = '';
            this.render();
            this.searchInput.focus();
        });

        this.sortSelect.addEventListener('change', () => {
            this.sortMode = this.sortSelect.value;
            this.refresh();
        });

        this.viewMyBtn.addEventListener('click', () => this.setViewMode('my'));
        this.viewPublicBtn.addEventListener('click', () => this.setViewMode('public'));

        this.addBtn.addEventListener('click', () => {
            if (!this.user) {
                this.openAuthModal('login');
                this.showToast('请先登录后再创建笔记', 'info');
                return;
            }
            this.openNoteModal(null);
        });

        this.exportBtn.addEventListener('click', () => this.exportNotes());

        this.importFile.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            await this.importNotesFromFile(file);
            e.target.value = '';
        });

        this.clearAllBtn.addEventListener('click', () => this.clearAll());

        this.profileBtn.addEventListener('click', () => this.updateDisplayName());
        this.signoutBtn.addEventListener('click', () => this.signOut());

        this.openLoginBtn.addEventListener('click', () => this.openAuthModal('login'));
        this.openRegisterBtn.addEventListener('click', () => this.openAuthModal('register'));

        // Note modal
        this.closeBtn.addEventListener('click', () => this.closeNoteModal());
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.closeNoteModal();
        });

        this.saveBtn.addEventListener('click', () => this.saveFromModal());
        this.deleteBtn.addEventListener('click', () => this.deleteCurrentNote());

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (!this.modal.classList.contains('hidden')) this.closeNoteModal();
                if (!this.authModal.classList.contains('hidden')) this.closeAuthModal();
            }

            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !this.modal.classList.contains('hidden')) {
                this.saveFromModal();
            }
        });

        // Upload
        this.uploadArea.addEventListener('click', (e) => {
            if (e.target === this.removeImgBtn) return;
            if (this.isNoteModalReadOnly()) return;
            this.fileInput.click();
        });

        this.uploadArea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (this.isNoteModalReadOnly()) return;
                this.fileInput.click();
            }
        });

        this.uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (this.isNoteModalReadOnly()) return;
            this.uploadArea.classList.add('drag-over');
        });

        this.uploadArea.addEventListener('dragleave', () => {
            this.uploadArea.classList.remove('drag-over');
        });

        this.uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            this.uploadArea.classList.remove('drag-over');
            if (this.isNoteModalReadOnly()) return;
            const file = e.dataTransfer.files?.[0];
            if (file) this.handleImageUpload(file);
        });

        this.fileInput.addEventListener('change', (e) => {
            if (this.isNoteModalReadOnly()) return;
            const file = e.target.files?.[0];
            if (file) this.handleImageUpload(file);
        });

        this.removeImgBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.isNoteModalReadOnly()) return;
            this.clearImage();
        });

        this.colorButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                if (this.isNoteModalReadOnly()) return;
                this.setColor(btn.dataset.color || DEFAULT_COLOR);
            });
        });

        // Auth modal
        this.closeAuthModalBtn.addEventListener('click', () => this.closeAuthModal());
        this.authModal.addEventListener('click', (e) => {
            if (e.target === this.authModal) this.closeAuthModal();
        });

        this.authTabLogin.addEventListener('click', () => this.setAuthMode('login'));
        this.authTabRegister.addEventListener('click', () => this.setAuthMode('register'));

        this.authForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.submitAuth();
        });

        if (this.resendConfirmBtn) {
            this.resendConfirmBtn.addEventListener('click', () => this.resendConfirmationEmail());
        }

        if (this.oauthGithubBtn) {
            this.oauthGithubBtn.addEventListener('click', () => this.signInWithOAuth('github'));
        }
    }

    async bootstrap() {
        const { data } = await this.supabase.auth.getSession();
        this.session = data.session;
        this.user = data.session?.user ?? null;

        this.onAuthChanged('INITIAL', null);

        this.supabase.auth.onAuthStateChange((event, session) => {
            const prevUserId = this.user?.id ?? null;
            this.session = session;
            this.user = session?.user ?? null;
            this.onAuthChanged(event, prevUserId);
        });
    }

    onAuthChanged(event, prevUserId) {
        const loggedIn = Boolean(this.user);

        this.authActions.classList.toggle('hidden', loggedIn);
        this.userActions.classList.toggle('hidden', !loggedIn);
        this.noteActions.classList.toggle('hidden', !loggedIn);

        if (loggedIn) {
            this.userName.textContent = getDisplayNameFromUser(this.user);
        }

        const currentUserId = this.user?.id ?? null;
        const userChanged = Boolean(loggedIn && prevUserId && currentUserId && prevUserId !== currentUserId);

        if (!loggedIn) {
            this.viewMode = 'public';
        } else if (!prevUserId || userChanged || event === 'INITIAL') {
            this.viewMode = 'my';
        }

        this.updateViewButtons();
        this.refresh();
    }

    updateViewButtons() {
        const isMy = this.viewMode === 'my';

        this.viewMyBtn.classList.toggle('active', isMy);
        this.viewPublicBtn.classList.toggle('active', !isMy);

        this.viewMyBtn.setAttribute('aria-selected', String(isMy));
        this.viewPublicBtn.setAttribute('aria-selected', String(!isMy));

        if (!this.user) {
            this.viewMyBtn.classList.add('disabled');
            this.viewMyBtn.setAttribute('aria-disabled', 'true');
        } else {
            this.viewMyBtn.classList.remove('disabled');
            this.viewMyBtn.removeAttribute('aria-disabled');
        }
    }

    async setViewMode(mode) {
        if (mode === this.viewMode) return;

        if (mode === 'my' && !this.user) {
            this.openAuthModal('login');
            this.showToast('登录后才能查看“我的”', 'info');
            return;
        }

        this.viewMode = mode;
        this.updateViewButtons();
        await this.refresh();
    }

    setAuthMode(mode) {
        this.authMode = mode;

        const isLogin = mode === 'login';
        this.authTabLogin.classList.toggle('active', isLogin);
        this.authTabRegister.classList.toggle('active', !isLogin);
        this.authTabLogin.setAttribute('aria-selected', String(isLogin));
        this.authTabRegister.setAttribute('aria-selected', String(!isLogin));

        this.authNameGroup.classList.toggle('hidden', isLogin);

        this.authModalTitle.textContent = isLogin ? '登录' : '注册';
        this.authSubmitBtn.textContent = isLogin ? '登录' : '注册';

        this.authPasswordInput.setAttribute('autocomplete', isLogin ? 'current-password' : 'new-password');

        this.setAuthMessage('');
        this.setResendConfirmVisible(false);

        setTimeout(() => {
            (isLogin ? this.authEmailInput : this.authNameInput).focus();
        }, 0);
    }

    openAuthModal(mode = 'login') {
        this.authModal.classList.remove('hidden');
        this.setAuthMode(mode);
    }

    closeAuthModal() {
        this.authModal.classList.add('hidden');
        this.authForm.reset();
        this.setAuthMessage('');
        this.setResendConfirmVisible(false);
    }

    setAuthMessage(message, type = 'info') {
        if (!message) {
            this.authMessage.textContent = '';
            this.authMessage.className = 'auth-message';
            return;
        }

        this.authMessage.textContent = message;
        this.authMessage.className = `auth-message auth-${type}`;
    }

    setResendConfirmVisible(visible) {
        if (!this.resendConfirmBtn) return;
        this.resendConfirmBtn.classList.toggle('hidden', !visible);
    }

    async resendConfirmationEmail() {
        if (!isSupabaseConfigured()) {
            this.setAuthMessage('\u8bf7\u5148\u5728 scripts/config.js \u586b\u5199 Supabase \u914d\u7f6e\u3002', 'error');
            return;
        }

        const email = normalizeString(this.authEmailInput.value);
        if (!email) {
            this.setAuthMessage('\u8bf7\u5148\u8f93\u5165\u90ae\u7bb1\u3002', 'error');
            return;
        }

        if (!this.resendConfirmBtn) return;
        this.resendConfirmBtn.disabled = true;

        try {
            const { error } = await this.supabase.auth.resend({ type: 'signup', email });
            if (error) {
                this.setAuthMessage(error.message, 'error');
                return;
            }

            this.setAuthMessage('\u5df2\u53d1\u9001\uff0c\u8bf7\u68c0\u67e5\u90ae\u7bb1\uff08\u542b\u5783\u573e\u90ae\u4ef6\u7bb1\uff09\u3002', 'success');
        } finally {
            this.resendConfirmBtn.disabled = false;
        }
    }

    async signInWithOAuth(provider) {
        if (!isSupabaseConfigured()) {
            this.setAuthMessage('\u8bf7\u5148\u5728 scripts/config.js \u586b\u5199 Supabase \u914d\u7f6e\u3002', 'error');
            return;
        }

        const redirectTo = window.location.origin + window.location.pathname;

        const { error } = await this.supabase.auth.signInWithOAuth({
            provider,
            options: { redirectTo }
        });

        if (error) {
            this.setAuthMessage(error.message, 'error');
        }
    }

    async submitAuth() {
        if (!isSupabaseConfigured()) {
            this.setAuthMessage('请先在 scripts/config.js 填写 Supabase 配置。', 'error');
            return;
        }

        const email = normalizeString(this.authEmailInput.value);
        const password = normalizeString(this.authPasswordInput.value);

        if (!email || !password) {
            this.setAuthMessage('请输入邮箱和密码。', 'error');
            return;
        }

        if (this.authMode === 'register') {
            const displayName = normalizeString(this.authNameInput.value);
            if (!displayName) {
                this.setAuthMessage('请填写昵称。', 'error');
                return;
            }
        }

        this.authSubmitBtn.disabled = true;

        try {
            if (this.authMode === 'login') {
                const { error } = await this.supabase.auth.signInWithPassword({ email, password });
                if (error) {
                    this.setAuthMessage(error.message, 'error');
                    return;
                }

                this.setAuthMessage('登录成功', 'success');
                this.showToast('欢迎回来', 'success');
                this.closeAuthModal();
                return;
            }

            const displayName = normalizeString(this.authNameInput.value);

            const { error } = await this.supabase.auth.signUp({
                email,
                password,
                options: {
                    data: { display_name: displayName }
                }
            });

            if (error) {
                this.setAuthMessage(error.message, 'error');
                return;
            }

            this.setAuthMessage('注册成功！如果开启了邮箱验证，请到邮箱完成确认后再登录。', 'success');
            this.showToast('注册成功', 'success');
        } finally {
            this.authSubmitBtn.disabled = false;
        }
    }

    async signOut() {
        await this.supabase.auth.signOut();
        this.showToast('已退出', 'info');
    }

    async updateDisplayName() {
        if (!this.user) return;

        const current = getDisplayNameFromUser(this.user);
        const next = normalizeString(prompt('设置昵称（用于显示）', current));
        if (!next) return;

        const { data, error } = await this.supabase.auth.updateUser({
            data: {
                ...this.user.user_metadata,
                display_name: next
            }
        });

        if (error) {
            this.showToast(error.message, 'error');
            return;
        }

        this.user = data.user;
        this.userName.textContent = getDisplayNameFromUser(this.user);
        this.showToast('昵称已更新', 'success');
    }

    async refresh() {
        if (!isSupabaseConfigured()) {
            this.notes = [];
            this.render();
            if (!this.hasWarnedConfig) {
                this.hasWarnedConfig = true;
                this.showToast('未配置数据库：请填写 scripts/config.js，并在 Supabase 执行 supabase/schema.sql', 'error');
            }
            return;
        }

        await this.fetchNotes();
        this.render();
    }

    async fetchNotes() {
        const isMy = this.viewMode === 'my';

        if (isMy && !this.user) {
            this.notes = [];
            return;
        }

        let query = this.supabase.from('notes').select('*');

        if (isMy) query = query.eq('owner_id', this.user.id);
        else query = query.eq('is_public', true);

        // pinned 只对“我的”有意义：作为第一排序
        if (isMy) query = query.order('pinned', { ascending: false });

        const sortMode = this.sortMode;
        if (sortMode === 'created_asc') query = query.order('created_at', { ascending: true });
        else if (sortMode === 'created_desc') query = query.order('created_at', { ascending: false });
        else if (sortMode === 'title_asc') query = query.order('title', { ascending: true });
        else query = query.order('updated_at', { ascending: false });

        query = query.limit(200);

        const { data, error } = await query;

        if (error) {
            console.error(error);
            this.showToast(error.message, 'error');
            this.notes = [];
            return;
        }

        this.notes = Array.isArray(data) ? data : [];
    }

    getVisibleNotes() {
        const query = normalizeString(this.searchQuery).toLowerCase();
        const hasQuery = Boolean(query);

        let list = [...this.notes];

        if (hasQuery) {
            list = list.filter((note) => {
                const haystack = [note.title, note.content, ...(note.tags || [])]
                    .map((v) => normalizeString(v).toLowerCase())
                    .join('\n');
                return haystack.includes(query);
            });
        }

        // pinned 仅对我的视图生效（兜底）
        if (this.viewMode === 'my') {
            list.sort((a, b) => {
                if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
                const aUpdated = Date.parse(a.updated_at || a.created_at || 0);
                const bUpdated = Date.parse(b.updated_at || b.created_at || 0);
                return bUpdated - aUpdated;
            });
        }

        return { list, hasQuery };
    }

    renderEmpty(templateEl) {
        this.grid.innerHTML = '';
        const node = templateEl?.content?.cloneNode(true);
        if (node) this.grid.appendChild(node);
    }

    render() {
        this.clearSearchBtn.style.opacity = this.searchInput.value ? '1' : '0';
        this.clearSearchBtn.style.pointerEvents = this.searchInput.value ? 'auto' : 'none';

        const total = this.notes.length;
        const { list, hasQuery } = this.getVisibleNotes();

        if (!hasQuery) {
            this.noteCount.textContent = total === 0 ? '' : `共 ${total} 条`;
        } else {
            this.noteCount.textContent = `显示 ${list.length} / ${total}`;
        }

        if (total === 0) {
            this.renderEmpty(this.emptyStateTemplate);
            return;
        }

        if (list.length === 0) {
            this.renderEmpty(this.noResultsTemplate);
            return;
        }

        this.grid.innerHTML = '';

        list.forEach((note) => {
            const owned = Boolean(this.user && note.owner_id === this.user.id);

            const card = document.createElement('div');
            card.className = 'note-card';
            card.dataset.id = note.id;

            const title = normalizeString(note.title);
            const titleText = title || '无标题';

            const contentHtml = note.content
                ? `<div class="note-content">${escapeHtml(note.content)}</div>`
                : '';

            const imageHtml = note.image
                ? `<img src="${note.image}" class="note-image" alt="笔记图片">`
                : '';

            const tagsHtml = Array.isArray(note.tags) && note.tags.length
                ? `<div class="note-tags">${note.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>`
                : '';

            const pinIcon = owned && note.pinned ? '<span class="pin-indicator" aria-label="置顶">&#x1F4CC;</span>' : '';
            const publicBadge = note.is_public ? '<span class="pill" title="公开">公开</span>' : '';

            const actionsHtml = owned
                ? `<div class="note-actions">
                        <button class="pin-btn" type="button" aria-label="置顶/取消置顶" title="置顶/取消置顶">&#x1F4CC;</button>
                        <button class="delete-btn" type="button" aria-label="删除" title="删除">&times;</button>
                   </div>`
                : `<div class="note-actions"></div>`;

            card.innerHTML = `
                <div class="note-header">
                    <div class="note-meta">
                        <div class="note-title">${escapeHtml(titleText)} ${pinIcon}</div>
                        <div class="note-sub">
                            ${publicBadge}
                            <span class="note-date">${escapeHtml(formatDateTime(note.updated_at || note.created_at))}</span>
                        </div>
                    </div>
                    ${actionsHtml}
                </div>
                ${contentHtml}
                ${imageHtml}
                ${tagsHtml}
                <div class="note-tag" style="background: ${escapeHtml(note.color || DEFAULT_COLOR)}"></div>
            `;

            if (owned) {
                const deleteBtn = card.querySelector('.delete-btn');
                deleteBtn?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const ok = confirm('确定要删除这条笔记吗？');
                    if (!ok) return;
                    this.deleteNoteById(note.id);
                });

                const pinBtn = card.querySelector('.pin-btn');
                pinBtn?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.togglePinned(note);
                });
            }

            card.addEventListener('click', () => this.openNoteModal(note));
            this.grid.appendChild(card);
        });
    }

    setColor(color) {
        this.selectedColor = color;
        this.colorButtons.forEach((btn) => {
            btn.classList.toggle('selected', btn.dataset.color === color);
        });
    }

    setImage(dataUrl) {
        this.currentImage = dataUrl;
        this.previewImg.src = dataUrl;
        this.previewContainer.classList.remove('hidden');
        this.uploadPlaceholder.classList.add('hidden');
    }

    clearImage() {
        this.currentImage = null;
        this.fileInput.value = '';
        this.previewContainer.classList.add('hidden');
        this.uploadPlaceholder.classList.remove('hidden');
        this.previewImg.src = '';
    }

    async handleImageUpload(file) {
        if (!file.type.startsWith('image/')) {
            this.showToast('请选择图片文件', 'error');
            return;
        }

        this.showToast('正在处理图片...', 'info');

        try {
            const compressed = await compressImageFileToDataUrl(file);
            this.setImage(compressed);
            this.showToast('图片已添加', 'success');
        } catch (err) {
            console.error(err);
            this.showToast('图片处理失败', 'error');
        }
    }

    isNoteModalReadOnly() {
        if (!this.editingNote) return false;
        if (!this.user) return true;
        return this.editingNote.owner_id !== this.user.id;
    }

    setNoteModalReadOnly(readOnly) {
        const disable = Boolean(readOnly);

        const textFields = [this.titleInput, this.noteInput, this.tagsInput];
        textFields.forEach((el) => {
            if (!el) return;
            el.readOnly = disable;
            el.disabled = false;
        });

        [this.pinnedInput, this.publicInput, this.fileInput].forEach((el) => {
            if (!el) return;
            el.disabled = disable;
        });

        this.uploadArea.classList.toggle('disabled', disable);
        this.colorButtons.forEach((btn) => btn.classList.toggle('disabled', disable));

        if (disable) {
            this.saveBtn.classList.add('hidden');
            this.deleteBtn.classList.add('hidden');

            this.modalBadge.textContent = '只读';
            this.modalBadge.classList.remove('hidden');
        } else {
            this.saveBtn.classList.remove('hidden');
            this.modalBadge.classList.add('hidden');
        }
    }

    openNoteModal(note) {
        const owned = Boolean(note && this.user && note.owner_id === this.user.id);

        this.editingNote = note;

        if (!note) {
            this.modalTitle.textContent = '新建笔记';
            this.modalBadge.classList.add('hidden');

            this.deleteBtn.classList.add('hidden');

            this.titleInput.value = '';
            this.noteInput.value = '';
            this.tagsInput.value = '';
            this.pinnedInput.checked = false;
            this.publicInput.checked = false;
            this.setColor(DEFAULT_COLOR);
            this.clearImage();

            this.setNoteModalReadOnly(false);
        } else {
            this.modalTitle.textContent = owned ? '编辑笔记' : '查看笔记';

            this.titleInput.value = note.title ?? '';
            this.noteInput.value = note.content ?? '';
            this.tagsInput.value = Array.isArray(note.tags) ? note.tags.join(', ') : '';
            this.pinnedInput.checked = Boolean(note.pinned);
            this.publicInput.checked = Boolean(note.is_public);
            this.setColor(note.color || DEFAULT_COLOR);

            if (note.image) this.setImage(note.image);
            else this.clearImage();

            if (owned) {
                this.deleteBtn.classList.remove('hidden');
                this.setNoteModalReadOnly(false);
            } else {
                this.setNoteModalReadOnly(true);
            }
        }

        this.modal.classList.remove('hidden');
        setTimeout(() => this.titleInput.focus(), 0);
    }

    closeNoteModal() {
        this.modal.classList.add('hidden');
        this.editingNote = null;

        this.modalBadge.classList.add('hidden');

        this.titleInput.value = '';
        this.noteInput.value = '';
        this.tagsInput.value = '';
        this.pinnedInput.checked = false;
        this.publicInput.checked = false;
        this.setColor(DEFAULT_COLOR);
        this.clearImage();

        this.setNoteModalReadOnly(false);
        this.deleteBtn.classList.add('hidden');
    }

    async saveFromModal() {
        if (!this.user) {
            this.openAuthModal('login');
            this.showToast('请先登录后再保存', 'info');
            return;
        }

        if (this.isNoteModalReadOnly()) {
            this.showToast('这是只读内容', 'info');
            return;
        }

        const title = normalizeString(this.titleInput.value);
        const content = normalizeString(this.noteInput.value);
        const tags = parseTags(this.tagsInput.value);

        const pinned = Boolean(this.pinnedInput.checked);
        const isPublic = Boolean(this.publicInput.checked);

        if (!title && !content && !this.currentImage) {
            this.showToast('请输入标题/内容，或上传一张图片', 'error');
            return;
        }

        const payload = {
            owner_id: this.user.id,
            title,
            content,
            tags,
            pinned,
            is_public: isPublic,
            color: this.selectedColor,
            image: this.currentImage
        };

        this.saveBtn.disabled = true;

        try {
            if (this.editingNote) {
                const { error } = await this.supabase
                    .from('notes')
                    .update(payload)
                    .eq('id', this.editingNote.id);

                if (error) {
                    console.error(error);
                    this.showToast(error.message, 'error');
                    return;
                }

                this.showToast('已保存', 'success');
                this.closeNoteModal();
                await this.refresh();
                return;
            }

            const { error } = await this.supabase.from('notes').insert([payload]);

            if (error) {
                console.error(error);
                this.showToast(error.message, 'error');
                return;
            }

            this.showToast('已创建', 'success');
            this.closeNoteModal();
            await this.refresh();
        } finally {
            this.saveBtn.disabled = false;
        }
    }

    async deleteCurrentNote() {
        if (!this.user || !this.editingNote) return;

        if (this.editingNote.owner_id !== this.user.id) {
            this.showToast('无权限删除', 'error');
            return;
        }

        const ok = confirm('确定要删除这条笔记吗？');
        if (!ok) return;

        await this.deleteNoteById(this.editingNote.id);
        this.closeNoteModal();
    }

    async deleteNoteById(id) {
        const { error } = await this.supabase.from('notes').delete().eq('id', id);
        if (error) {
            console.error(error);
            this.showToast(error.message, 'error');
            return;
        }

        this.showToast('已删除', 'success');
        await this.refresh();
    }

    async togglePinned(note) {
        if (!this.user || note.owner_id !== this.user.id) return;

        const { error } = await this.supabase
            .from('notes')
            .update({ pinned: !note.pinned })
            .eq('id', note.id);

        if (error) {
            console.error(error);
            this.showToast(error.message, 'error');
            return;
        }

        await this.refresh();
    }

    async clearAll() {
        if (!this.user) {
            this.openAuthModal('login');
            return;
        }

        const ok = confirm('确定要清空你的全部笔记吗？此操作不可撤销，建议先导出备份。');
        if (!ok) return;

        const { error } = await this.supabase
            .from('notes')
            .delete()
            .eq('owner_id', this.user.id);

        if (error) {
            console.error(error);
            this.showToast(error.message, 'error');
            return;
        }

        this.searchQuery = '';
        this.searchInput.value = '';

        this.showToast('已清空', 'success');
        await this.refresh();
    }

    async exportNotes() {
        if (!this.user) {
            this.openAuthModal('login');
            return;
        }

        const { data, error } = await this.supabase
            .from('notes')
            .select('*')
            .eq('owner_id', this.user.id)
            .order('updated_at', { ascending: false })
            .limit(2000);

        if (error) {
            console.error(error);
            this.showToast(error.message, 'error');
            return;
        }

        const payload = {
            exportedAt: new Date().toISOString(),
            notes: data || []
        };

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        const date = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `inspiration-notes-${date}.json`;

        document.body.appendChild(a);
        a.click();
        a.remove();

        URL.revokeObjectURL(url);
        this.showToast('已导出', 'success');
    }

    async importNotesFromFile(file) {
        if (!this.user) {
            this.openAuthModal('login');
            return;
        }

        let raw;
        try {
            raw = await readFileAsText(file);
        } catch (err) {
            console.error(err);
            this.showToast('读取文件失败', 'error');
            return;
        }

        const parsed = safeJsonParse(raw);
        if (!parsed) {
            this.showToast('JSON 格式不正确', 'error');
            return;
        }

        const notes = Array.isArray(parsed)
            ? parsed
            : Array.isArray(parsed.notes)
                ? parsed.notes
                : [];

        if (notes.length === 0) {
            this.showToast('没有可导入的笔记', 'info');
            return;
        }

        const replace = confirm('导入方式：确定=覆盖当前笔记；取消=合并到当前笔记。');

        if (replace) {
            const ok = confirm('即将删除你当前的全部笔记并导入新数据，确定继续吗？');
            if (!ok) return;

            const { error: delErr } = await this.supabase
                .from('notes')
                .delete()
                .eq('owner_id', this.user.id);

            if (delErr) {
                console.error(delErr);
                this.showToast(delErr.message, 'error');
                return;
            }
        }

        const toInsert = notes
            .map((n) => {
                if (!n || typeof n !== 'object') return null;

                const rawTags = n.tags;
                const tags = Array.isArray(rawTags)
                    ? uniqueStrings(rawTags).slice(0, MAX_TAGS)
                    : typeof rawTags === 'string'
                        ? parseTags(rawTags)
                        : [];

                return {
                    owner_id: this.user.id,
                    title: normalizeString(n.title),
                    content: normalizeString(n.content ?? n.text ?? ''),
                    tags,
                    pinned: Boolean(n.pinned),
                    color: normalizeString(n.color) || DEFAULT_COLOR,
                    image: typeof n.image === 'string' ? n.image : null,
                    is_public: Boolean(n.is_public ?? n.isPublic)
                };
            })
            .filter(Boolean);

        const chunkSize = 200;
        for (let i = 0; i < toInsert.length; i += chunkSize) {
            const chunk = toInsert.slice(i, i + chunkSize);
            const { error } = await this.supabase.from('notes').insert(chunk);
            if (error) {
                console.error(error);
                this.showToast(error.message, 'error');
                return;
            }
        }

        this.showToast('导入成功', 'success');
        await this.refresh();
    }

    showToast(message, type = 'info') {
        if (!this.toastContainer) return;

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;

        this.toastContainer.appendChild(toast);

        setTimeout(() => toast.classList.add('show'), 20);

        const ttl = type === 'error' ? 3800 : 2200;
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 250);
        }, ttl);
    }
}

function main() {
    if (!isSupabaseConfigured()) {
        console.warn('Supabase 未配置：请填写 scripts/config.js');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    new NotesApp(supabase);
}

document.addEventListener('DOMContentLoaded', main);
