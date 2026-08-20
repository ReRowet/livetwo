/**
 * StreamBoss — Complete Frontend Logic
 * Nav: Streams | Channels | Manage Channel
 */

const API = '';

const App = {
  streams: [],
  channels: [],
  filteredStreams: [],
  currentChannel: null,
  selectedStreamId: null,
  logSSE: null,
  statusSSE: null,

  pendingVideoFiles: [],
  pendingAudioFiles: [],
  currentSubTab: 'videos',

  defaultThumb: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="38" viewBox="0 0 64 38"><rect width="64" height="38" fill="%231a1b24"/><path d="M26 12L42 19L26 26V12Z" fill="%233b82f6"/></svg>',

  accessToken: localStorage.getItem('re_stream_access_token') || sessionStorage.getItem('re_stream_access_token') || '',
  refreshToken: localStorage.getItem('re_stream_refresh_token') || sessionStorage.getItem('re_stream_refresh_token') || '',
  currentUser: JSON.parse(localStorage.getItem('re_stream_user') || sessionStorage.getItem('re_stream_user') || 'null'),
  _refreshPromise: null,

  async init() {
    this.setupFetchInterceptor();
    this.updateClock();
    setInterval(() => this.updateClock(), 1000);
    setInterval(() => this.updateDurations(), 1000);

    // Proactive silent token refresh every 10 minutes (access token expires in 15 mins)
    setInterval(() => {
      if (this.accessToken && this.refreshToken) {
        this.refreshAuthToken();
      }
    }, 10 * 60 * 1000);

    this.refreshIcons();

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeModal();
        this.closeLogModal();
        this.closeCreateChannelModal();
        this.closeEditChannelModal();
        const dropdown = document.getElementById('channelSelectDropdown');
        if (dropdown) dropdown.style.display = 'none';
        const tDropdown = document.getElementById('toolbarChannelFilterDropdown');
        if (tDropdown) tDropdown.style.display = 'none';
      }
    });

    document.addEventListener('click', (e) => {
      // Modal channel select
      const trigger = document.getElementById('channelSelectTrigger');
      const dropdown = document.getElementById('channelSelectDropdown');
      if (dropdown && trigger && !trigger.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.style.display = 'none';
        trigger.classList.remove('active');
        const chevron = document.getElementById('channelSelectChevron');
        if (chevron) chevron.style.transform = 'rotate(0deg)';
      }
      // Toolbar channel filter
      const tTrigger = document.getElementById('toolbarChannelFilterTrigger');
      const tDropdown = document.getElementById('toolbarChannelFilterDropdown');
      if (tDropdown && tTrigger && !tTrigger.contains(e.target) && !tDropdown.contains(e.target)) {
        tDropdown.style.display = 'none';
        tTrigger.classList.remove('active');
        const tChevron = document.getElementById('toolbarChannelFilterChevron');
        if (tChevron) tChevron.style.transform = 'rotate(0deg)';
      }
    });

    // Check Session Auth on launch
    const isAuthed = await this.checkAuth();
    if (isAuthed) {
      this.showApp();
      this.fetchStreams();
      this.fetchChannels();
      this.fetchSystemStats();
      this.connectStatusSSE();
    } else {
      this.showLogin();
    }
  },

  setupFetchInterceptor() {
    const _originalFetch = window.fetch;
    const self = this;

    window.fetch = async function(resource, init = {}) {
      let url = typeof resource === 'string' ? resource : (resource ? resource.url : '');
      
      // Inject Authorization Bearer token for API endpoints (except login/refresh)
      if (url && url.includes('/api/') && !url.includes('/api/auth/login') && !url.includes('/api/auth/refresh')) {
        if (!init.headers) init.headers = {};
        if (init.headers instanceof Headers) {
          if (self.accessToken && !init.headers.has('Authorization')) {
            init.headers.set('Authorization', `Bearer ${self.accessToken}`);
          }
        } else {
          if (self.accessToken && !init.headers['Authorization']) {
            init.headers['Authorization'] = `Bearer ${self.accessToken}`;
          }
        }
      }

      let response;
      try {
        response = await _originalFetch(resource, init);
      } catch (err) {
        throw err;
      }

      // Handle 401 Unauthorized with automatic JWT Token Refresh
      if (response.status === 401 && url && url.includes('/api/') && !url.includes('/api/auth/')) {
        if (self.refreshToken) {
          const ok = await self.refreshAuthToken();
          if (ok) {
            if (!init.headers) init.headers = {};
            if (init.headers instanceof Headers) {
              init.headers.set('Authorization', `Bearer ${self.accessToken}`);
            } else {
              init.headers['Authorization'] = `Bearer ${self.accessToken}`;
            }
            return await _originalFetch(resource, init);
          } else {
            self.handleAuthFailure('Session expired. Please log in again.');
          }
        } else {
          self.handleAuthFailure('Session token required. Please log in.');
        }
      }

      return response;
    };
  },

  async checkAuth() {
    if (!this.accessToken && !this.refreshToken) {
      return false;
    }

    try {
      const res = await fetch(`${API}/api/auth/me`);
      if (res && res.ok) {
        const data = await res.json();
        if (data.user) {
          this.currentUser = data.user;
          this.updateUserUI();
          return true;
        }
      }
      return false;
    } catch (e) {
      return false;
    }
  },

  async refreshAuthToken() {
    if (!this.refreshToken) return false;

    // If a refresh is already in flight, return the same promise to prevent multiple concurrent refresh calls
    if (this._refreshPromise) {
      return this._refreshPromise;
    }

    this._refreshPromise = (async () => {
      try {
        const res = await fetch(`${API}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: this.refreshToken })
        });

        if (!res.ok) return false;

        const data = await res.json();
        if (data.success && data.accessToken) {
          this.accessToken = data.accessToken;
          if (localStorage.getItem('re_stream_access_token')) {
            localStorage.setItem('re_stream_access_token', data.accessToken);
          } else {
            sessionStorage.setItem('re_stream_access_token', data.accessToken);
          }
          return true;
        }
        return false;
      } catch (e) {
        return false;
      } finally {
        this._refreshPromise = null;
      }
    })();

    return this._refreshPromise;
  },

  async handleLogin(event) {
    if (event) event.preventDefault();
    const usernameInput = document.getElementById('loginUsername');
    const passwordInput = document.getElementById('loginPassword');
    const rememberInput = document.getElementById('loginRememberMe');
    const submitBtn = document.getElementById('loginSubmitBtn');
    const btnText = document.getElementById('loginBtnText');
    const alertEl = document.getElementById('loginAlert');
    const alertMsg = document.getElementById('loginAlertMsg');

    const username = usernameInput ? usernameInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value : '';
    const remember = rememberInput ? rememberInput.checked : true;

    if (!username || !password) {
      if (alertMsg) alertMsg.textContent = 'Please enter both username and password';
      if (alertEl) alertEl.style.display = 'flex';
      return;
    }

    if (alertEl) alertEl.style.display = 'none';
    if (btnText) btnText.textContent = 'Authenticating...';
    if (submitBtn) submitBtn.disabled = true;

    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        if (alertMsg) alertMsg.textContent = data.error || 'Invalid username or password';
        if (alertEl) alertEl.style.display = 'flex';
        return;
      }

      this.accessToken = data.accessToken;
      this.refreshToken = data.refreshToken;
      this.currentUser = data.user;

      if (remember) {
        localStorage.setItem('re_stream_access_token', data.accessToken);
        localStorage.setItem('re_stream_refresh_token', data.refreshToken);
        localStorage.setItem('re_stream_user', JSON.stringify(data.user));
      } else {
        sessionStorage.setItem('re_stream_access_token', data.accessToken);
        sessionStorage.setItem('re_stream_refresh_token', data.refreshToken);
        sessionStorage.setItem('re_stream_user', JSON.stringify(data.user));
      }

      this.updateUserUI();
      this.showApp();
      this.fetchStreams();
      this.fetchChannels();
      this.fetchSystemStats();
      this.connectStatusSSE();

      this.toast(`Welcome back, ${data.user.username}!`, 'success');
    } catch (err) {
      console.error('Login error:', err);
      if (alertMsg) alertMsg.textContent = 'Connection error. Please check server status.';
      if (alertEl) alertEl.style.display = 'flex';
    } finally {
      if (btnText) btnText.textContent = 'Sign In to RE Stream';
      if (submitBtn) submitBtn.disabled = false;
      this.refreshIcons();
    }
  },

  async logout() {
    try {
      if (this.refreshToken) {
        await fetch(`${API}/api/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: this.refreshToken })
        });
      }
    } catch (_) {}

    this.accessToken = '';
    this.refreshToken = '';
    this.currentUser = null;
    localStorage.removeItem('re_stream_access_token');
    localStorage.removeItem('re_stream_refresh_token');
    localStorage.removeItem('re_stream_user');
    sessionStorage.clear();

    if (this.statusSSE) { this.statusSSE.close(); this.statusSSE = null; }
    if (this.logSSE) { this.logSSE.close(); this.logSSE = null; }

    this.showLogin('You have been logged out.');
    this.toast('Logged out successfully', 'info');
  },

  handleAuthFailure(msg) {
    this.accessToken = '';
    this.refreshToken = '';
    this.currentUser = null;
    localStorage.removeItem('re_stream_access_token');
    localStorage.removeItem('re_stream_refresh_token');
    localStorage.removeItem('re_stream_user');
    sessionStorage.clear();

    if (this.statusSSE) { this.statusSSE.close(); this.statusSSE = null; }
    if (this.logSSE) { this.logSSE.close(); this.logSSE = null; }

    this.showLogin(msg || 'Session expired. Please log in.');
  },

  showApp() {
    const loginView = document.getElementById('loginView');
    const appContainer = document.getElementById('appContainer');
    if (loginView) loginView.style.display = 'none';
    if (appContainer) appContainer.style.display = 'flex';
    this.refreshIcons();
  },

  showLogin(msg = '') {
    const loginView = document.getElementById('loginView');
    const appContainer = document.getElementById('appContainer');
    if (loginView) loginView.style.display = 'flex';
    if (appContainer) appContainer.style.display = 'none';

    const alertEl = document.getElementById('loginAlert');
    const alertMsg = document.getElementById('loginAlertMsg');
    if (alertEl && alertMsg) {
      if (msg) {
        alertMsg.textContent = msg;
        alertEl.style.display = 'flex';
      } else {
        alertEl.style.display = 'none';
      }
    }
    this.refreshIcons();
  },

  updateUserUI() {
    const userEl = document.getElementById('navUsername');
    if (userEl && this.currentUser) {
      userEl.textContent = this.currentUser.username || 'admin';
    }
  },

  togglePasswordVisibility() {
    const pwdInput = document.getElementById('loginPassword');
    const pwdEye = document.getElementById('loginPwdEye');
    if (!pwdInput) return;
    if (pwdInput.type === 'password') {
      pwdInput.type = 'text';
      if (pwdEye) pwdEye.setAttribute('data-lucide', 'eye-off');
    } else {
      pwdInput.type = 'password';
      if (pwdEye) pwdEye.setAttribute('data-lucide', 'eye');
    }
    this.refreshIcons();
  },

  refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  },

  updateClock() {
    const now = new Date();
    const time = now.toLocaleTimeString('en-GB', { hour12: false });
    const clockEl = document.getElementById('navClock');
    if (clockEl) clockEl.textContent = time;
  },

  // ============================================================
  // Navigation & Views
  // ============================================================

  switchNav(viewName) {
    document.querySelectorAll('.page-view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

    if (viewName === 'streams') {
      document.getElementById('viewStreams').classList.add('active');
      document.getElementById('navBtnStreams').classList.add('active');
      this.fetchStreams();
    } else if (viewName === 'channels') {
      document.getElementById('viewChannels').classList.add('active');
      document.getElementById('navBtnChannels').classList.add('active');
      this.fetchChannels();
    } else if (viewName === 'manageChannel') {
      document.getElementById('viewManageChannel').classList.add('active');
      document.getElementById('navBtnChannels').classList.add('active');
    }
  },

  // ============================================================
  // Channels API & Render (Gambar 1 & Gambar 3)
  // ============================================================

  async fetchChannels() {
    try {
      const res = await fetch(`${API}/api/channels`);
      if (!res.ok) return;
      const data = await res.json();
      this.channels = Array.isArray(data) ? data : [];
      this.renderChannelsGrid();
      this.populateChannelFilter();
    } catch (e) {
      console.error('Failed to fetch channels:', e);
    }
  },

  renderChannelsGrid() {
    const grid = document.getElementById('channelsGrid');
    if (!grid) return;

    if (this.channels.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: span 4; text-align: center; padding: 60px 0; color: var(--text-sub);">
          <p>No channels found. Click "+ Create Channel" to add one.</p>
        </div>`;
      return;
    }

    grid.innerHTML = this.channels.map(c => `
      <div class="channel-card">
        <div class="channel-card-top">
          <div>
            <h3 class="channel-card-title">${this.escHtml(c.name)}</h3>
            <p class="channel-card-desc">${this.escHtml(c.description || 'No description provided')}</p>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <span class="channel-card-badge">${this.escHtml(c.status || 'Active')}</span>
            <button class="icon-btn" onclick="event.stopPropagation();App.editCurrentChannel('${c.id}')" title="Edit"><i data-lucide="edit-3" style="width:14px;height:14px"></i></button>
            <button class="icon-btn" onclick="event.stopPropagation();App.deleteChannelById('${c.id}')" title="Delete Channel"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
          </div>
        </div>
        <button class="channel-card-btn" onclick="App.openManageChannel('${c.id}')">Manage &gt;</button>
      </div>
    `).join('');
    this.refreshIcons();
  },

  editCurrentChannel(id) {
    const targetId = id || (this.currentChannel && this.currentChannel.id);
    const channel = this.channels.find(c => c.id === targetId) || this.currentChannel;
    if (!channel) {
      this.toast('Channel not found', 'error');
      return;
    }

    this.currentChannel = channel;
    document.getElementById('editChannelId').value = channel.id;
    document.getElementById('editChannelName').value = channel.name || '';
    document.getElementById('editChannelDesc').value = channel.description || '';
    document.getElementById('editChannelUrl').value = channel.url || '';
    document.getElementById('editChannelModal').classList.add('active');
  },

  closeEditChannelModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('editChannelModal').classList.remove('active');
  },

  async saveEditedChannel(event) {
    event.preventDefault();
    const id = document.getElementById('editChannelId').value;
    const name = document.getElementById('editChannelName').value.trim();
    const description = document.getElementById('editChannelDesc').value.trim();
    const url = document.getElementById('editChannelUrl').value.trim();

    const res = await fetch(`${API}/api/channels/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, url })
    });
    const data = await res.json();

    if (data.id) {
      this.toast('Channel updated successfully', 'success');
      this.closeEditChannelModal();
      await this.fetchChannels();
      if (this.currentChannel && this.currentChannel.id === id) {
        this.openManageChannel(id);
      }
    } else {
      this.toast('Failed to update channel', 'error');
    }
  },

  async deleteCurrentChannel(event) {
    if (event) event.preventDefault();
    const idInput = document.getElementById('editChannelId');
    const id = (idInput && idInput.value) || (this.currentChannel && this.currentChannel.id);

    if (!id) {
      this.toast('Channel ID not found', 'error');
      return;
    }

    this.closeEditChannelModal();
    await this.deleteChannelById(id);
  },

  confirmAction({ message, onConfirm }) {
    const modal = document.getElementById('confirmDeleteModal');
    const textEl = document.getElementById('confirmDeleteText');
    const btn = document.getElementById('confirmDeleteSubmitBtn');
    if (!modal || !textEl || !btn) {
      if (window.confirm(message)) onConfirm();
      return;
    }

    textEl.textContent = message;
    btn.onclick = () => {
      this.closeConfirmDeleteModal();
      onConfirm();
    };
    modal.classList.add('active');
  },

  closeConfirmDeleteModal(event) {
    if (event && event.target !== event.currentTarget) return;
    const modal = document.getElementById('confirmDeleteModal');
    if (modal) modal.classList.remove('active');
  },

  deleteChannelById(id) {
    const targetId = id || (this.currentChannel && this.currentChannel.id);
    if (!targetId) {
      this.toast('Channel ID not found', 'error');
      return;
    }
    const channel = this.channels.find(c => c.id === targetId) || this.currentChannel;
    const name = channel ? channel.name : 'this channel';

    this.confirmAction({
      message: `Are you sure you want to delete channel "${name}"?`,
      onConfirm: async () => {
        try {
          const res = await fetch(`${API}/api/channels/${targetId}`, {
            method: 'DELETE'
          });
          const data = await res.json();

          if (res.ok && data.success) {
            this.toast('Channel deleted successfully', 'info');
            if (this.currentChannel && this.currentChannel.id === targetId) {
              this.currentChannel = null;
            }
            await this.fetchChannels();
            await this.fetchStreams();
            this.switchNav('channels');
          } else {
            this.toast((data && data.error) || 'Failed to delete channel', 'error');
          }
        } catch (e) {
          console.error('Delete channel error:', e);
          this.toast('Error deleting channel', 'error');
        }
      }
    });
  },

  openManageChannel(id) {
    const channel = this.channels.find(c => c.id === id);
    if (!channel) return;

    this.currentChannel = channel;
    this.activeEditingPlaylistId = null;
    this.selectedItemsForPlaylist.clear();

    document.getElementById('manageChannelTitle').textContent = channel.name;
    document.getElementById('manageChannelDesc').textContent = channel.description || 'No description provided';

    const urlEl = document.getElementById('manageChannelUrl');
    if (channel.url) {
      urlEl.href = channel.url;
      urlEl.textContent = channel.url;
      urlEl.style.display = 'inline-block';
    } else {
      urlEl.style.display = 'none';
    }

    this.switchSubTab(this.currentSubTab || 'videos');
    this.switchNav('manageChannel');
  },

  // ============================================================
  // Playlist Management State & Controller (Matching Screenshot 1 & 2)
  // ============================================================
  activeEditingPlaylistId: null,
  selectedItemsForPlaylist: new Set(),

  renderPlaylistsColumn() {
    const container = document.getElementById('playlistContentContainer');
    const headerTitle = document.getElementById('playlistCardHeaderTitle');
    const subtitle = document.getElementById('playlistCardSubtitle');
    const countBadge = document.getElementById('playlistCountBadge');
    if (!container || !this.currentChannel) return;

    const isVideo = this.currentSubTab === 'videos';
    const playlists = isVideo ? (this.currentChannel.videoPlaylists || []) : (this.currentChannel.audioPlaylists || []);

    if (headerTitle) headerTitle.textContent = isVideo ? 'Video Playlists' : 'Audio Playlists';
    if (subtitle) subtitle.textContent = 'Manage your playlists';
    if (countBadge) countBadge.textContent = `${playlists.length} Playlist`;

    if (!this.activeEditingPlaylistId) {
      // Normal Playlists List View (Screenshot 1)
      if (playlists.length === 0) {
        container.innerHTML = `
          <div class="playlist-empty-box" style="padding: 30px 10px; text-align: center; color: #64748b; font-size: 12px; border: 1px dashed #242738; border-radius: 8px;">
            <p>Belum ada playlist ${isVideo ? 'video' : 'audio'}.</p>
          </div>
        `;
        return;
      }

      container.innerHTML = `
        <div class="playlist-header-row">
          <span>PLAYLIST NAME</span>
          <span>ACTIONS</span>
        </div>
        <div>
          ${playlists.map(p => `
            <div class="playlist-manage-item">
              <div>
                <div class="playlist-name-title">${this.escHtml(p.name)}</div>
                <div class="playlist-count-sub">${(p.items || []).length} ${isVideo ? 'videos' : 'audios'}</div>
              </div>
              <div class="playlist-actions-row">
                <button type="button" class="btn-xs-blue" onclick="App.editPlaylist('${p.id}')">Edit</button>
                <button type="button" class="btn-xs-red" onclick="App.deletePlaylist('${p.id}')">Delete</button>
              </div>
            </div>
          `).join('')}
        </div>
      `;
      this.refreshIcons();
    } else {
      // Active Playlist Editing View (Screenshot 2)
      const p = playlists.find(x => x.id === this.activeEditingPlaylistId);
      if (!p) {
        this.activeEditingPlaylistId = null;
        return this.renderPlaylistsColumn();
      }

      const fileList = isVideo ? (this.currentChannel.videos || []) : (this.currentChannel.audios || []);
      
      // Calculate total duration
      let totalSec = 0;
      (p.items || []).forEach(itemId => {
        const item = fileList.find(f => f.id === itemId);
        if (item && item.duration) {
          const parts = item.duration.split(':').map(Number);
          if (parts.length === 2) totalSec += parts[0] * 60 + parts[1];
        }
      });
      const durFormatted = this._fmtTime(totalSec);

      container.innerHTML = `
        <div class="playlist-header-row">
          <span>PLAYLIST NAME</span>
          <span>ACTIONS</span>
        </div>
        <div class="playlist-manage-item" style="margin-bottom: 10px;">
          <div>
            <div class="playlist-name-title">${this.escHtml(p.name)}</div>
            <div class="playlist-count-sub">${(p.items || []).length} ${isVideo ? 'videos' : 'audios'}</div>
          </div>
          <div class="playlist-actions-row">
            <button type="button" class="btn-xs-blue" style="opacity: 0.8;" disabled>Edit</button>
            <button type="button" class="btn-xs-red" onclick="App.deletePlaylist('${p.id}')">Delete</button>
          </div>
        </div>

        <!-- Inline Name Editor -->
        <div class="playlist-edit-header-box">
          <div style="display: flex; gap: 6px; align-items: center;">
            <span style="font-size: 12px; color: #94a3b8; font-weight: 600;">Edit:</span>
            <input type="text" id="editPlaylistNameInput" value="${this.escHtml(p.name)}" style="flex: 1; padding: 6px 10px; font-size: 12px; background: #181b28; border: 1px solid #2e344e; border-radius: 6px; color: #fff;">
            <button type="button" class="btn-xs-dark" onclick="App.exitPlaylistEditMode()">Cancel</button>
            <button type="button" class="btn-xs-blue" onclick="App.savePlaylistName('${p.id}')">Save</button>
          </div>
        </div>

        <!-- Summary row -->
        <div style="display: flex; justify-content: space-between; padding: 4px 2px; margin-bottom: 8px; font-size: 11px; color: #94a3b8; font-weight: 700;">
          <span>${(p.items || []).length} ${isVideo ? 'videos' : 'audios'}</span>
          <span>Total: ${durFormatted}</span>
        </div>

        <!-- Songs inside Playlist list -->
        <div class="playlist-songs-list">
          ${(p.items && p.items.length > 0) ? p.items.map((itemId, idx) => {
            const item = fileList.find(f => f.id === itemId);
            const title = item ? item.title : itemId;
            const dur = item ? item.duration || '0:00' : '0:00';
            return `
              <div class="playlist-song-row">
                <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                  <span style="font-size: 11px; color: #64748b; width: 14px;">${idx + 1}</span>
                  <i data-lucide="${isVideo ? 'film' : 'music'}" style="width: 14px; height: 14px; color: #3b82f6; flex-shrink: 0;"></i>
                  <span style="font-size: 12px; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px;" title="${this.escHtml(title)}">${this.escHtml(title)}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                  <span style="font-size: 11px; color: #94a3b8;">${this.escHtml(dur)}</span>
                  <button type="button" class="btn-text-link" style="color: #ef4444; padding: 2px;" onclick="App.removeItemFromPlaylist('${p.id}', '${itemId}')" title="Remove from playlist">
                    <i data-lucide="x" style="width: 14px; height: 14px;"></i>
                  </button>
                </div>
              </div>
            `;
          }).join('') : `
            <div style="padding: 16px; text-align: center; color: #64748b; font-size: 11px;">
              No ${isVideo ? 'videos' : 'audios'} added yet.<br>Select from the middle column to add.
            </div>
          `}
        </div>
      `;
      this.refreshIcons();
    }
  },

  editPlaylist(playlistId) {
    this.activeEditingPlaylistId = playlistId;
    this.selectedItemsForPlaylist.clear();
    this.renderGallery();
    this.renderPlaylistsColumn();
  },

  exitPlaylistEditMode() {
    this.activeEditingPlaylistId = null;
    this.selectedItemsForPlaylist.clear();
    this.renderGallery();
    this.renderPlaylistsColumn();
  },

  toggleSelectForPlaylist(itemId) {
    if (this.selectedItemsForPlaylist.has(itemId)) {
      this.selectedItemsForPlaylist.delete(itemId);
    } else {
      this.selectedItemsForPlaylist.add(itemId);
    }

    const btn = document.getElementById('btnAddToPlaylist');
    if (btn) {
      btn.innerHTML = `<i data-lucide="plus" style="width: 13px; height: 13px;"></i> Add to Playlist (${this.selectedItemsForPlaylist.size})`;
      this.refreshIcons();
    }

    const itemEl = document.getElementById(`galleryItem_${itemId}`);
    const checkEl = document.getElementById(`galleryCheck_${itemId}`);
    const isSelected = this.selectedItemsForPlaylist.has(itemId);
    if (itemEl) itemEl.classList.toggle('active', isSelected);
    if (checkEl) checkEl.classList.toggle('checked', isSelected);
  },

  toggleSelectAllForPlaylist(selectAll) {
    const isVideo = this.currentSubTab === 'videos';
    const files = isVideo ? (this.currentChannel.videos || []) : (this.currentChannel.audios || []);
    const playlists = isVideo ? (this.currentChannel.videoPlaylists || []) : (this.currentChannel.audioPlaylists || []);
    const p = playlists.find(x => x.id === this.activeEditingPlaylistId);
    const existingItems = p ? (p.items || []) : [];

    if (selectAll) {
      files.forEach(f => {
        if (!existingItems.includes(f.id)) {
          this.selectedItemsForPlaylist.add(f.id);
        }
      });
    } else {
      this.selectedItemsForPlaylist.clear();
    }

    this.renderGallery();
  },

  async addSelectedToActivePlaylist() {
    if (!this.currentChannel || !this.activeEditingPlaylistId) return;
    if (this.selectedItemsForPlaylist.size === 0) {
      this.toast('Please select at least one item to add', 'warning');
      return;
    }

    const isVideo = this.currentSubTab === 'videos';
    const playlists = isVideo ? (this.currentChannel.videoPlaylists || []) : (this.currentChannel.audioPlaylists || []);
    const p = playlists.find(x => x.id === this.activeEditingPlaylistId);
    if (!p) return;

    const currentItems = [...(p.items || [])];
    this.selectedItemsForPlaylist.forEach(id => {
      if (!currentItems.includes(id)) {
        currentItems.push(id);
      }
    });

    try {
      const res = await fetch(`${API}/api/channels/${this.currentChannel.id}/playlists/${p.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: currentItems })
      });
      if (res.ok) {
        this.toast(`Added ${this.selectedItemsForPlaylist.size} file(s) to "${p.name}"!`, 'success');
        this.selectedItemsForPlaylist.clear();
        await this.fetchChannels();
        this.currentChannel = this.channels.find(c => c.id === this.currentChannel.id);
        this.renderGallery();
        this.renderPlaylistsColumn();
      } else {
        const data = await res.json();
        this.toast(data.error || 'Failed to update playlist', 'error');
      }
    } catch (e) {
      console.error('Add to playlist error:', e);
      this.toast('Error updating playlist', 'error');
    }
  },

  async removeItemFromPlaylist(playlistId, itemId) {
    if (!this.currentChannel) return;
    const isVideo = this.currentSubTab === 'videos';
    const playlists = isVideo ? (this.currentChannel.videoPlaylists || []) : (this.currentChannel.audioPlaylists || []);
    const p = playlists.find(x => x.id === playlistId);
    if (!p) return;

    const newItems = (p.items || []).filter(id => id !== itemId);

    try {
      const res = await fetch(`${API}/api/channels/${this.currentChannel.id}/playlists/${playlistId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: newItems })
      });
      if (res.ok) {
        this.toast('Item removed from playlist', 'info');
        await this.fetchChannels();
        this.currentChannel = this.channels.find(c => c.id === this.currentChannel.id);
        this.renderGallery();
        this.renderPlaylistsColumn();
      }
    } catch (e) {
      console.error('Remove item error:', e);
    }
  },

  async savePlaylistName(playlistId) {
    if (!this.currentChannel) return;
    const input = document.getElementById('editPlaylistNameInput');
    const newName = input ? input.value.trim() : '';
    if (!newName) return;

    try {
      const res = await fetch(`${API}/api/channels/${this.currentChannel.id}/playlists/${playlistId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
      });
      if (res.ok) {
        this.toast('Playlist name updated', 'success');
        await this.fetchChannels();
        this.currentChannel = this.channels.find(c => c.id === this.currentChannel.id);
        this.renderPlaylistsColumn();
      }
    } catch (e) {
      console.error('Save playlist name error:', e);
    }
  },

  deletePlaylist(playlistId) {
    if (!this.currentChannel) return;
    const isVideo = this.currentSubTab === 'videos';
    const playlists = isVideo ? (this.currentChannel.videoPlaylists || []) : (this.currentChannel.audioPlaylists || []);
    const p = playlists.find(x => x.id === playlistId);
    const name = p ? p.name : 'Playlist';

    this.confirmAction({
      message: `Are you sure you want to delete playlist "${name}"?`,
      onConfirm: async () => {
        try {
          const res = await fetch(`${API}/api/channels/${this.currentChannel.id}/playlists/${playlistId}`, {
            method: 'DELETE'
          });
          if (res.ok) {
            this.toast('Playlist deleted', 'info');
            if (this.activeEditingPlaylistId === playlistId) {
              this.activeEditingPlaylistId = null;
            }
            await this.fetchChannels();
            this.currentChannel = this.channels.find(c => c.id === this.currentChannel.id);
            this.renderGallery();
            this.renderPlaylistsColumn();
          } else {
            this.toast('Failed to delete playlist', 'error');
          }
        } catch (e) {
          console.error('Delete playlist error:', e);
          this.toast('Error deleting playlist', 'error');
        }
      }
    });
  },

  renderGallery() {
    const container = document.getElementById('galleryList');
    const headerNormal = document.getElementById('galleryHeaderNormal');
    const headerPlaylist = document.getElementById('galleryHeaderPlaylistMode');
    if (!container || !this.currentChannel) return;

    const isVideoTab = this.currentSubTab === 'videos';
    const items = isVideoTab ? (this.currentChannel.videos || []) : (this.currentChannel.audios || []);

    if (this.activeEditingPlaylistId) {
      // Playlist Add/Selection Mode (Screenshot 2)
      if (headerNormal) headerNormal.style.display = 'none';
      if (headerPlaylist) headerPlaylist.style.display = 'block';

      const playlists = isVideoTab ? (this.currentChannel.videoPlaylists || []) : (this.currentChannel.audioPlaylists || []);
      const p = playlists.find(x => x.id === this.activeEditingPlaylistId);
      const playlistItems = p ? (p.items || []) : [];

      const addTitle = document.getElementById('playlistAddTitle');
      const addSubtitle = document.getElementById('playlistAddSubtitle');
      const btnAdd = document.getElementById('btnAddToPlaylist');

      if (addTitle) addTitle.textContent = isVideoTab ? 'Video List' : 'Audio List';
      if (addSubtitle) addSubtitle.textContent = `Select ${isVideoTab ? 'videos' : 'audios'} to add`;
      if (btnAdd) {
        btnAdd.innerHTML = `<i data-lucide="plus" style="width: 13px; height: 13px;"></i> Add to Playlist (${this.selectedItemsForPlaylist.size})`;
      }

      if (items.length === 0) {
        container.innerHTML = `<div style="color: var(--text-muted); font-size: 11px; padding: 20px; text-align: center;">No ${isVideoTab ? 'videos' : 'audios'} in channel.</div>`;
        return;
      }

      container.innerHTML = items.map((item, i) => {
        const isSelected = this.selectedItemsForPlaylist.has(item.id);
        const inPlaylist = playlistItems.includes(item.id);
        return `
          <div class="gallery-item ${isSelected ? 'active' : ''}" id="galleryItem_${item.id}" onclick="App.toggleSelectForPlaylist('${item.id}')" style="cursor: pointer;">
            <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
              <div class="circle-checkbox ${isSelected ? 'checked' : ''}" id="galleryCheck_${item.id}"></div>
              <div class="file-icon-box" style="width: 32px; height: 32px; font-size: 14px; flex-shrink: 0;">
                <i data-lucide="${isVideoTab ? 'film' : 'music'}" style="width:16px;height:16px;"></i>
              </div>
              <div class="gallery-info" style="min-width: 0;">
                <span class="gallery-title" title="${this.escHtml(item.title)}">
                  ${this.escHtml(item.title)}
                  ${inPlaylist ? '<span class="in-playlist-badge">• In Playlist</span>' : ''}
                </span>
                <span class="gallery-meta">${this.escHtml(item.duration || '0:00')} • ${this.escHtml(item.size || '0 MB')}</span>
              </div>
            </div>
          </div>
        `;
      }).join('');
      this.refreshIcons();

    } else {
      // Normal Gallery Mode (Screenshot 1)
      if (headerNormal) headerNormal.style.display = 'flex';
      if (headerPlaylist) headerPlaylist.style.display = 'none';

      if (items.length === 0) {
        container.innerHTML = `<div style="color: var(--text-muted); font-size: 11px; padding: 20px; text-align: center;">No ${isVideoTab ? 'videos' : 'audios'} uploaded yet.</div>`;
        return;
      }

      container.innerHTML = items.map((item, i) => `
        <div class="gallery-item ${i === 0 ? 'active' : ''}" onclick="App.${isVideoTab ? 'selectVideo' : 'selectAudio'}('${item.url}', '${this.escHtml(item.title)}', this, ${i})">
          <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
            <div class="file-icon-box" style="width: 32px; height: 32px; font-size: 14px;">
              <i data-lucide="${isVideoTab ? 'film' : 'music'}" style="width:16px;height:16px;"></i>
            </div>
            <div class="gallery-info" style="min-width: 0;">
              <span class="gallery-title" title="${this.escHtml(item.title)}">${this.escHtml(item.title)}</span>
              <span class="gallery-meta">${this.escHtml(item.duration || '0:00')} • ${this.escHtml(item.size || '0 MB')}</span>
            </div>
          </div>
          <button class="btn-file-remove" onclick="event.stopPropagation(); App.deleteMediaItem('${item.id}', '${isVideoTab ? 'video' : 'audio'}')" title="Delete ${isVideoTab ? 'video' : 'audio'}">
            <i data-lucide="trash-2" style="width:15px;height:15px;"></i>
          </button>
        </div>
      `).join('');
      this.refreshIcons();
    }
  },

  deleteMediaItem(itemId, type) {
    if (!this.currentChannel) return;
    const isVideo = type === 'video';
    const list = isVideo ? (this.currentChannel.videos || []) : (this.currentChannel.audios || []);
    const item = list.find(x => x.id === itemId);
    const title = item ? item.title : (isVideo ? 'video' : 'audio');

    this.confirmAction({
      message: `Are you sure you want to delete ${isVideo ? 'video' : 'audio'} "${title}"?`,
      onConfirm: async () => {
        const endpoint = isVideo ? 'videos' : 'audios';
        try {
          const res = await fetch(`${API}/api/channels/${this.currentChannel.id}/${endpoint}/${itemId}`, {
            method: 'DELETE'
          });
          const data = await res.json();
          if (res.ok && data.success) {
            this.toast(`${isVideo ? 'Video' : 'Audio'} deleted successfully`, 'info');
            await this.fetchChannels();
            this.openManageChannel(this.currentChannel.id);
          } else {
            this.toast((data && data.error) || 'Failed to delete file', 'error');
          }
        } catch (e) {
          console.error('Delete media error:', e);
          this.toast('Error deleting media file', 'error');
        }
      }
    });
  },

  selectVideo(url, title, element) {
    if (!url) return;
    document.querySelectorAll('.gallery-item').forEach(el => el.classList.remove('active'));
    element.classList.add('active');

    const player = document.getElementById('videoPlayer');
    const source = document.getElementById('videoPlayerSource');
    if (player && source) {
      source.src = url;
      player.load();
      player.play().catch(() => {});
    }
  },

  // ============================================================
  // Custom Audio Player Controller
  // ============================================================
  audioCurrentIndex: -1,
  audioShuffle: false,
  audioLoop: false,
  _audioTimerRAF: null,

  selectAudio(url, title, element, index) {
    if (!url) return;
    document.querySelectorAll('.gallery-item').forEach(el => el.classList.remove('active'));
    element.classList.add('active');
    this.audioCurrentIndex = index;

    const audioEl = document.getElementById('audioElement');
    const titleEl = document.getElementById('audioPlayerTitle');
    const subtitleEl = document.getElementById('audioPlayerSubtitle');

    if (titleEl) titleEl.textContent = title || 'Unknown Audio';
    if (subtitleEl) subtitleEl.textContent = 'Now Playing';

    if (audioEl) {
      audioEl.src = url;
      audioEl.load();
      audioEl.play().catch(() => {});
      this._updatePlayIcon(true);
      this._startAudioTimer();
    }
  },

  toggleAudioPlay() {
    const audioEl = document.getElementById('audioElement');
    if (!audioEl || !audioEl.src) return;
    if (audioEl.paused) {
      audioEl.play().catch(() => {});
      this._updatePlayIcon(true);
      this._startAudioTimer();
    } else {
      audioEl.pause();
      this._updatePlayIcon(false);
      this._stopAudioTimer();
    }
  },

  prevAudio() {
    if (!this.currentChannel) return;
    const audios = this.currentChannel.audios || [];
    if (audios.length === 0) return;
    let idx = this.audioCurrentIndex - 1;
    if (idx < 0) idx = audios.length - 1;
    this._playAudioByIndex(idx);
  },

  nextAudio() {
    if (!this.currentChannel) return;
    const audios = this.currentChannel.audios || [];
    if (audios.length === 0) return;
    let idx;
    if (this.audioShuffle) {
      idx = Math.floor(Math.random() * audios.length);
    } else {
      idx = this.audioCurrentIndex + 1;
      if (idx >= audios.length) idx = 0;
    }
    this._playAudioByIndex(idx);
  },

  toggleAudioShuffle() {
    this.audioShuffle = !this.audioShuffle;
    const btn = document.getElementById('audioShuffleBtn');
    if (btn) btn.classList.toggle('active', this.audioShuffle);
  },

  toggleAudioLoop() {
    this.audioLoop = !this.audioLoop;
    const btn = document.getElementById('audioLoopBtn');
    if (btn) btn.classList.toggle('active', this.audioLoop);
    const audioEl = document.getElementById('audioElement');
    if (audioEl) audioEl.loop = this.audioLoop;
  },

  seekAudio(event) {
    const audioEl = document.getElementById('audioElement');
    const bar = document.getElementById('audioSeekBar');
    if (!audioEl || !bar || !audioEl.duration) return;
    const rect = bar.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    audioEl.currentTime = pct * audioEl.duration;
  },

  _playAudioByIndex(idx) {
    const audios = this.currentChannel.audios || [];
    if (idx < 0 || idx >= audios.length) return;
    const item = audios[idx];
    const galleryItems = document.querySelectorAll('.gallery-item');
    const el = galleryItems[idx];
    if (el) this.selectAudio(item.url, item.title, el, idx);
  },

  _updatePlayIcon(playing) {
    const icon = document.getElementById('audioPlayIcon');
    if (!icon) return;
    icon.setAttribute('data-lucide', playing ? 'pause' : 'play');
    this.refreshIcons();
  },

  _resetAudioPlayerUI() {
    const titleEl = document.getElementById('audioPlayerTitle');
    const subtitleEl = document.getElementById('audioPlayerSubtitle');
    const curTime = document.getElementById('audioCurrentTime');
    const durTime = document.getElementById('audioDurationTime');
    const fill = document.getElementById('audioSeekFill');
    const thumb = document.getElementById('audioSeekThumb');
    if (titleEl) titleEl.textContent = 'Select an audio to play';
    if (subtitleEl) subtitleEl.textContent = 'No audio selected';
    if (curTime) curTime.textContent = '0:00';
    if (durTime) durTime.textContent = '0:00';
    if (fill) fill.style.width = '0%';
    if (thumb) thumb.style.left = '0%';
    this._updatePlayIcon(false);
    this._stopAudioTimer();
    this.audioCurrentIndex = -1;
  },

  _startAudioTimer() {
    this._stopAudioTimer();
    const tick = () => {
      const audioEl = document.getElementById('audioElement');
      if (!audioEl) return;
      const cur = audioEl.currentTime || 0;
      const dur = audioEl.duration || 0;
      const pct = dur > 0 ? (cur / dur) * 100 : 0;
      const curEl = document.getElementById('audioCurrentTime');
      const durEl = document.getElementById('audioDurationTime');
      const fill = document.getElementById('audioSeekFill');
      const thumb = document.getElementById('audioSeekThumb');
      if (curEl) curEl.textContent = this._fmtTime(cur);
      if (durEl) durEl.textContent = this._fmtTime(dur);
      if (fill) fill.style.width = pct + '%';
      if (thumb) thumb.style.left = pct + '%';

      if (audioEl.ended && !this.audioLoop) {
        this._updatePlayIcon(false);
        this.nextAudio();
        return;
      }
      this._audioTimerRAF = requestAnimationFrame(tick);
    };
    this._audioTimerRAF = requestAnimationFrame(tick);
  },

  _stopAudioTimer() {
    if (this._audioTimerRAF) {
      cancelAnimationFrame(this._audioTimerRAF);
      this._audioTimerRAF = null;
    }
  },

  _fmtTime(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  },

  filterGallery() {
    const q = document.getElementById('gallerySearch').value.toLowerCase();
    document.querySelectorAll('.gallery-item').forEach(item => {
      const text = item.textContent.toLowerCase();
      item.style.display = text.includes(q) ? 'flex' : 'none';
    });
  },

  switchSubTab(tabName) {
    this.currentSubTab = tabName;
    document.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
    const btnUpload = document.getElementById('btnUploadMedia');
    const galleryTitle = document.getElementById('galleryCardTitle');
    const gallerySearch = document.getElementById('gallerySearch');
    const videoCard = document.getElementById('videoPreviewCard');
    const audioCard = document.getElementById('audioPreviewCard');

    // Stop video player
    const videoPlayer = document.getElementById('videoPlayer');
    if (videoPlayer) {
      videoPlayer.pause();
      videoPlayer.currentTime = 0;
      const source = document.getElementById('videoPlayerSource');
      if (source) source.src = '';
      videoPlayer.load();
    }

    // Stop audio player
    const audioEl = document.getElementById('audioElement');
    if (audioEl) {
      audioEl.pause();
      audioEl.currentTime = 0;
      audioEl.src = '';
    }
    this._resetAudioPlayerUI();

    if (tabName === 'videos') {
      document.getElementById('subTabVideos').classList.add('active');
      if (btnUpload) {
        btnUpload.innerHTML = '<i data-lucide="upload" class="lucide-icon" style="width:16px;height:16px;"></i> Upload Video';
        btnUpload.onclick = () => this.openUploadVideoModal();
      }
      if (galleryTitle) galleryTitle.textContent = 'VIDEO GALLERY';
      if (gallerySearch) gallerySearch.placeholder = 'Search videos...';
      if (videoCard) videoCard.style.display = '';
      if (audioCard) audioCard.style.display = 'none';
    } else {
      document.getElementById('subTabAudios').classList.add('active');
      if (btnUpload) {
        btnUpload.innerHTML = '<i data-lucide="music" class="lucide-icon" style="width:16px;height:16px;"></i> Upload Audio';
        btnUpload.onclick = () => this.openUploadAudioModal();
      }
      if (galleryTitle) galleryTitle.textContent = 'AUDIO GALLERY';
      if (gallerySearch) gallerySearch.placeholder = 'Search audios...';
      if (videoCard) videoCard.style.display = 'none';
      if (audioCard) audioCard.style.display = '';
    }
    this.renderGallery();
    this.renderPlaylistsColumn();
    this.refreshIcons();
  },

  // ============================================================
  // Video & Audio Upload Modal Logic with Drag & Drop Queue
  // ============================================================

  openUploadVideoModal() {
    this.pendingVideoFiles = [];
    this.renderUploadVideoQueue();
    document.getElementById('uploadVideoModal').classList.add('active');
  },

  closeUploadVideoModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('uploadVideoModal').classList.remove('active');
  },

  handleDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.add('dragover');
  },

  handleDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.remove('dragover');
  },

  handleVideoDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.remove('dragover');
    if (event.dataTransfer && event.dataTransfer.files) {
      this.addVideoFilesToQueue(event.dataTransfer.files);
    }
  },

  handleVideoFileSelect(event) {
    if (event.target && event.target.files) {
      this.addVideoFilesToQueue(event.target.files);
      event.target.value = '';
    }
  },

  addVideoFilesToQueue(files) {
    const validExts = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
    for (const file of files) {
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      if (!validExts.includes(ext)) {
        this.toast(`File "${file.name}" rejected: invalid video format`, 'error');
        continue;
      }
      if (!this.pendingVideoFiles.some(f => f.name === file.name && f.size === file.size)) {
        this.pendingVideoFiles.push(file);
      }
    }
    this.renderUploadVideoQueue();
  },

  removePendingVideoFile(index) {
    this.pendingVideoFiles.splice(index, 1);
    this.renderUploadVideoQueue();
  },

  renderUploadVideoQueue() {
    const container = document.getElementById('uploadVideoFileList');
    const submitBtn = document.getElementById('uploadVideoSubmitBtn');
    const dropzoneText = document.getElementById('uploadVideoDropzoneText');

    if (!container || !submitBtn) return;

    if (this.pendingVideoFiles.length === 0) {
      container.innerHTML = '';
      submitBtn.disabled = true;
      if (dropzoneText) dropzoneText.textContent = 'Drag or Browse Files';
    } else {
      submitBtn.disabled = false;
      if (dropzoneText) dropzoneText.textContent = 'Add More Videos';
      container.innerHTML = this.pendingVideoFiles.map((f, i) => `
        <div class="upload-file-card" id="videoFileCard_${i}">
          <div class="upload-file-left" style="width: 100%;">
            <div class="file-icon-box"><i data-lucide="film" style="width:18px;height:18px"></i></div>
            <div class="upload-file-info" style="width: 100%;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <span class="upload-file-name" title="${this.escHtml(f.name)}">${this.escHtml(f.name)}</span>
                <span class="file-progress-percent" id="videoFilePercent_${i}"></span>
              </div>
              <div class="upload-file-size" id="videoFileStatus_${i}">${this.formatFileSize(f.size)}</div>
              <div class="file-progress-bar-wrap" id="videoProgressWrap_${i}">
                <div class="file-progress-bar-fill" id="videoProgressFill_${i}" style="width: 0%;"></div>
              </div>
            </div>
          </div>
          <button class="btn-file-remove" id="videoFileRemove_${i}" onclick="App.removePendingVideoFile(${i})" title="Remove file">
            <i data-lucide="trash-2" style="width:15px;height:15px"></i>
          </button>
        </div>
      `).join('');
      this.refreshIcons();
    }
  },

  async submitVideoUpload() {
    if (!this.currentChannel || this.pendingVideoFiles.length === 0) return;
    const submitBtn = document.getElementById('uploadVideoSubmitBtn');
    const totalFiles = this.pendingVideoFiles.length;
    let successCount = 0;
    let failCount = 0;

    if (submitBtn) submitBtn.disabled = true;

    // Activate all progress bars & hide remove buttons
    this.pendingVideoFiles.forEach((_, i) => {
      const wrap = document.getElementById(`videoProgressWrap_${i}`);
      const btn = document.getElementById(`videoFileRemove_${i}`);
      const statusEl = document.getElementById(`videoFileStatus_${i}`);
      if (wrap) wrap.classList.add('active');
      if (btn) btn.style.display = 'none';
      if (statusEl) statusEl.textContent = i === 0 ? 'Mempersiapkan upload...' : 'Menunggu antrian...';
    });

    // Process files sequentially one-by-one
    for (let i = 0; i < totalFiles; i++) {
      const file = this.pendingVideoFiles[i];
      if (submitBtn) {
        submitBtn.textContent = `Uploading (${i + 1}/${totalFiles})...`;
      }

      const fill = document.getElementById(`videoProgressFill_${i}`);
      const percentEl = document.getElementById(`videoFilePercent_${i}`);
      const statusEl = document.getElementById(`videoFileStatus_${i}`);

      if (statusEl) statusEl.textContent = 'Mengunggah (0%)...';

      const formData = new FormData();
      formData.append('videos', file);

      try {
        const data = await this.uploadXHR(`${API}/api/channels/${this.currentChannel.id}/upload-videos`, formData, (percent) => {
          if (fill) fill.style.width = `${percent}%`;
          if (percentEl) percentEl.textContent = `${percent}%`;
          if (statusEl) {
            statusEl.textContent = percent >= 100 
              ? 'Memproses thumbnail & durasi...' 
              : `Mengunggah (${percent}%)...`;
          }
        });

        if (data && data.success) {
          successCount++;
          if (fill) {
            fill.style.width = '100%';
            fill.classList.add('success');
          }
          if (percentEl) {
            percentEl.textContent = '100%';
            percentEl.classList.add('success');
          }
          if (statusEl) statusEl.textContent = 'Selesai ✅';
        } else {
          failCount++;
          if (fill) fill.classList.add('error');
          if (percentEl) percentEl.classList.add('error');
          if (statusEl) statusEl.textContent = `Gagal: ${(data && data.error) || 'Upload error'} ❌`;
        }
      } catch (err) {
        failCount++;
        console.error(`Upload error on ${file.name}:`, err);
        if (fill) fill.classList.add('error');
        if (percentEl) percentEl.classList.add('error');
        if (statusEl) statusEl.textContent = `Gagal: ${(err && err.error) || 'Network error'} ❌`;
      }
    }

    if (successCount > 0) {
      this.toast(`Berhasil mengunggah ${successCount} dari ${totalFiles} video!`, 'success');
      await this.fetchChannels();
      this.openManageChannel(this.currentChannel.id);
      setTimeout(() => {
        this.closeUploadVideoModal();
      }, 1000);
    } else {
      this.toast('Semua upload video gagal.', 'error');
    }

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Upload';
    }
  },

  openUploadAudioModal() {
    this.pendingAudioFiles = [];
    this.renderUploadAudioQueue();
    document.getElementById('uploadAudioModal').classList.add('active');
  },

  closeUploadAudioModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('uploadAudioModal').classList.remove('active');
  },

  handleAudioDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.remove('dragover');
    if (event.dataTransfer && event.dataTransfer.files) {
      this.addAudioFilesToQueue(event.dataTransfer.files);
    }
  },

  handleAudioFileSelect(event) {
    if (event.target && event.target.files) {
      this.addAudioFilesToQueue(event.target.files);
      event.target.value = '';
    }
  },

  addAudioFilesToQueue(files) {
    const validExts = ['.mp3', '.wav', '.ogg', '.aac', '.flac', '.m4a', '.mp4'];
    for (const file of files) {
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      if (!validExts.includes(ext)) {
        this.toast(`File "${file.name}" rejected: invalid audio format`, 'error');
        continue;
      }
      if (!this.pendingAudioFiles.some(f => f.name === file.name && f.size === file.size)) {
        this.pendingAudioFiles.push(file);
      }
    }
    this.renderUploadAudioQueue();
  },

  removePendingAudioFile(index) {
    this.pendingAudioFiles.splice(index, 1);
    this.renderUploadAudioQueue();
  },

  renderUploadAudioQueue() {
    const container = document.getElementById('uploadAudioFileList');
    const submitBtn = document.getElementById('uploadAudioSubmitBtn');
    const dropzoneText = document.getElementById('uploadAudioDropzoneText');

    if (!container || !submitBtn) return;

    if (this.pendingAudioFiles.length === 0) {
      container.innerHTML = '';
      submitBtn.disabled = true;
      if (dropzoneText) dropzoneText.textContent = 'Drag or Browse Files';
    } else {
      submitBtn.disabled = false;
      if (dropzoneText) dropzoneText.textContent = 'Add More Audios';
      container.innerHTML = this.pendingAudioFiles.map((f, i) => `
        <div class="upload-file-card" id="audioFileCard_${i}">
          <div class="upload-file-left" style="width: 100%;">
            <div class="file-icon-box"><i data-lucide="music" style="width:18px;height:18px"></i></div>
            <div class="upload-file-info" style="width: 100%;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <span class="upload-file-name" title="${this.escHtml(f.name)}">${this.escHtml(f.name)}</span>
                <span class="file-progress-percent" id="audioFilePercent_${i}"></span>
              </div>
              <div class="upload-file-size" id="audioFileStatus_${i}">${this.formatFileSize(f.size)}</div>
              <div class="file-progress-bar-wrap" id="audioProgressWrap_${i}">
                <div class="file-progress-bar-fill" id="audioProgressFill_${i}" style="width: 0%;"></div>
              </div>
            </div>
          </div>
          <button class="btn-file-remove" id="audioFileRemove_${i}" onclick="App.removePendingAudioFile(${i})" title="Remove file">
            <i data-lucide="trash-2" style="width:15px;height:15px"></i>
          </button>
        </div>
      `).join('');
      this.refreshIcons();
    }
  },

  async submitAudioUpload() {
    if (!this.currentChannel || this.pendingAudioFiles.length === 0) return;
    const submitBtn = document.getElementById('uploadAudioSubmitBtn');
    const totalFiles = this.pendingAudioFiles.length;
    let successCount = 0;
    let failCount = 0;

    if (submitBtn) submitBtn.disabled = true;

    // Activate all progress bars & hide remove buttons
    this.pendingAudioFiles.forEach((_, i) => {
      const wrap = document.getElementById(`audioProgressWrap_${i}`);
      const btn = document.getElementById(`audioFileRemove_${i}`);
      const statusEl = document.getElementById(`audioFileStatus_${i}`);
      if (wrap) wrap.classList.add('active');
      if (btn) btn.style.display = 'none';
      if (statusEl) statusEl.textContent = i === 0 ? 'Mempersiapkan upload...' : 'Menunggu antrian...';
    });

    // Process audios sequentially one-by-one
    for (let i = 0; i < totalFiles; i++) {
      const file = this.pendingAudioFiles[i];
      if (submitBtn) {
        submitBtn.textContent = `Uploading & Converting (${i + 1}/${totalFiles})...`;
      }

      const fill = document.getElementById(`audioProgressFill_${i}`);
      const percentEl = document.getElementById(`audioFilePercent_${i}`);
      const statusEl = document.getElementById(`audioFileStatus_${i}`);

      if (statusEl) statusEl.textContent = 'Mengunggah (0%)...';

      const formData = new FormData();
      formData.append('audios', file);

      try {
        const data = await this.uploadXHR(`${API}/api/channels/${this.currentChannel.id}/upload-audios`, formData, (percent) => {
          if (fill) fill.style.width = `${percent}%`;
          if (percentEl) percentEl.textContent = `${percent}%`;
          if (statusEl) {
            statusEl.textContent = percent >= 100 
              ? 'Mengonversi ke 192k AAC...' 
              : `Mengunggah (${percent}%)...`;
          }
        });

        if (data && data.success) {
          successCount++;
          if (fill) {
            fill.style.width = '100%';
            fill.classList.add('success');
          }
          if (percentEl) {
            percentEl.textContent = '100%';
            percentEl.classList.add('success');
          }
          if (statusEl) statusEl.textContent = 'Selesai (192k AAC) ✅';
        } else {
          failCount++;
          if (fill) fill.classList.add('error');
          if (percentEl) percentEl.classList.add('error');
          if (statusEl) statusEl.textContent = `Gagal: ${(data && data.error) || 'Upload error'} ❌`;
        }
      } catch (err) {
        failCount++;
        console.error(`Upload audio error on ${file.name}:`, err);
        if (fill) fill.classList.add('error');
        if (percentEl) percentEl.classList.add('error');
        if (statusEl) statusEl.textContent = `Gagal: ${(err && err.error) || 'Network error'} ❌`;
      }
    }

    if (successCount > 0) {
      this.toast(`Berhasil mengunggah & mengonversi ${successCount} dari ${totalFiles} audio ke 192k AAC!`, 'success');
      await this.fetchChannels();
      this.openManageChannel(this.currentChannel.id);
      setTimeout(() => {
        this.closeUploadAudioModal();
      }, 1000);
    } else {
      this.toast('Semua upload audio gagal.', 'error');
    }

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Upload';
    }
  },

  async uploadXHR(url, formData, onProgress) {
    const doUpload = (token) => {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        if (token) {
          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        }
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && onProgress) {
            const percent = Math.round((e.loaded / e.total) * 100);
            onProgress(percent);
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try { resolve(JSON.parse(xhr.responseText)); } catch (_) { resolve(xhr.responseText); }
          } else {
            let errObj = { status: xhr.status, error: `Server status ${xhr.status}` };
            try {
              const parsed = JSON.parse(xhr.responseText);
              errObj = { status: xhr.status, ...parsed };
            } catch (_) {}
            reject(errObj);
          }
        };
        xhr.onerror = () => reject({ status: 0, error: 'Network upload error' });
        xhr.send(formData);
      });
    };

    try {
      return await doUpload(this.accessToken);
    } catch (err) {
      // Auto refresh token on 401 Unauthorized
      if (err && err.status === 401 && this.refreshToken && !this.isRefreshing) {
        this.isRefreshing = true;
        const refreshed = await this.refreshAuthToken();
        this.isRefreshing = false;
        if (refreshed) {
          return await doUpload(this.accessToken);
        } else {
          this.handleAuthFailure('Session expired. Please log in again.');
        }
      }
      throw err;
    }
  },

  formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return mb.toFixed(2) + ' MB';
    const kb = bytes / 1024;
    return kb.toFixed(1) + ' KB';
  },

  // ============================================================
  // Create Channel Modal (Gambar 2)
  // ============================================================

  openCreateChannelModal() {
    document.getElementById('newChannelName').value = '';
    document.getElementById('newChannelDesc').value = '';
    document.getElementById('createChannelModal').classList.add('active');
  },

  closeCreateChannelModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('createChannelModal').classList.remove('active');
  },

  async saveNewChannel(event) {
    event.preventDefault();
    const name = document.getElementById('newChannelName').value.trim();
    const description = document.getElementById('newChannelDesc').value.trim();

    const res = await fetch(`${API}/api/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description })
    });
    const data = await res.json();

    if (data.id) {
      this.toast('Channel created successfully', 'success');
      this.closeCreateChannelModal();
      this.fetchChannels();
    } else {
      this.toast('Failed to create channel', 'error');
    }
  },



  // ============================================================
  // Create Playlist Modal Logic (Matching User's Screenshot)
  // ============================================================
  createPlaylist() {
    this.openCreatePlaylistModal();
  },

  openCreatePlaylistModal() {
    if (!this.currentChannel) {
      this.toast('Please select a channel first', 'warning');
      return;
    }

    const isVideo = this.currentSubTab === 'videos';
    const files = isVideo ? (this.currentChannel.videos || []) : (this.currentChannel.audios || []);
    const count = files.length;

    const titleEl = document.getElementById('createPlaylistTitle');
    const subtitleEl = document.getElementById('createPlaylistSubtitle');
    const typeInput = document.getElementById('playlistType');
    const nameInput = document.getElementById('playlistName');
    const descInput = document.getElementById('playlistDescription');
    const nameHelper = document.getElementById('playlistNameHelper');
    const cardTitle = document.getElementById('playlistCardTitle');
    const filesCount = document.getElementById('playlistFilesCount');
    const modalIcon = document.getElementById('playlistModalIcon');
    const cardIcon = document.getElementById('playlistCardIcon');

    if (typeInput) typeInput.value = isVideo ? 'video' : 'audio';
    if (titleEl) titleEl.textContent = isVideo ? 'Create Video Playlist' : 'Create Playlist';
    if (subtitleEl) subtitleEl.textContent = `0 ${isVideo ? 'video' : 'audio'} files selected for this playlist.`;
    if (nameInput) nameInput.value = '';
    if (descInput) descInput.value = '';
    if (nameHelper) nameHelper.textContent = `Choose a unique name for your ${isVideo ? 'video' : 'audio'} playlist`;
    if (cardTitle) cardTitle.textContent = isVideo ? 'Total Video Files' : 'Total Audio Files';
    if (filesCount) filesCount.textContent = '0';

    if (modalIcon) modalIcon.setAttribute('data-lucide', isVideo ? 'film' : 'music');
    if (cardIcon) cardIcon.setAttribute('data-lucide', isVideo ? 'film' : 'music');

    document.getElementById('createPlaylistModal').classList.add('active');
    this.refreshIcons();
  },

  closeCreatePlaylistModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('createPlaylistModal').classList.remove('active');
  },

  async saveNewPlaylist(event) {
    event.preventDefault();
    if (!this.currentChannel) return;

    const type = document.getElementById('playlistType').value;
    const name = document.getElementById('playlistName').value.trim();
    const description = document.getElementById('playlistDescription').value.trim();

    try {
      const res = await fetch(`${API}/api/channels/${this.currentChannel.id}/playlists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, type })
      });
      const data = await res.json();

      if (res.ok && data.id) {
        this.toast(`${type === 'video' ? 'Video' : 'Audio'} Playlist "${name}" created successfully!`, 'success');
        this.closeCreatePlaylistModal();
        await this.fetchChannels();
        if (this.currentChannel) {
          this.openManageChannel(this.currentChannel.id);
        }
      } else {
        this.toast((data && data.error) || 'Failed to create playlist', 'error');
      }
    } catch (e) {
      console.error('Create playlist error:', e);
      this.toast('Error creating playlist', 'error');
    }
  },

  // ============================================================
  // Stream Key Manager (Gambar 1 & Gambar 2)
  // ============================================================
  channelStreamKeys: [],

  async openStreamKeyManagerModal() {
    if (!this.currentChannel) return;
    await this.fetchChannelStreamKeys();
    document.getElementById('streamKeyManagerModal').classList.add('active');
  },

  closeStreamKeyManagerModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('streamKeyManagerModal').classList.remove('active');
  },

  async fetchChannelStreamKeys() {
    if (!this.currentChannel) return;
    try {
      const res = await fetch(`${API}/api/channels/${this.currentChannel.id}/keys`);
      this.channelStreamKeys = await res.json();
      this.renderStreamKeyTable();
    } catch (e) {
      console.error('Failed to fetch stream keys:', e);
    }
  },

  renderStreamKeyTable() {
    const tbody = document.getElementById('streamKeyTableBody');
    if (!tbody) return;

    if (!this.channelStreamKeys || this.channelStreamKeys.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; color: var(--text-sub); padding: 40px 0;">
            No stream keys added for this channel yet. Click "+ Add Stream Key" above.
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = this.channelStreamKeys.map(k => {
      const statusClass = k.status === 'Live' ? 'live'
        : k.status === 'Idle' ? 'idle'
        : 'not-use';

      return `
        <tr>
          <td style="font-weight: 600; color: #ffffff;">${this.escHtml(k.name)}</td>
          <td>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="streamkey-code" title="${this.escHtml(k.key)}">${this.escHtml(k.key)}</span>
              <button class="icon-btn" onclick="App.copyStreamKey('${this.escHtml(k.key)}')" title="Copy Key">
                <i data-lucide="copy" style="width: 14px; height: 14px;"></i>
              </button>
            </div>
          </td>
          <td>
            <span class="badge-key-status ${statusClass}">${this.escHtml(k.status)}</span>
          </td>
          <td>
            <span class="streamkey-use-title" title="${this.escHtml(k.streamUse)}">${this.escHtml(k.streamUse)}</span>
          </td>
          <td style="text-align: right;">
            <div style="display: flex; align-items: center; justify-content: flex-end; gap: 6px;">
              <button class="icon-btn" onclick="App.openAddStreamKeyModal('${k.id}')" title="Edit">
                <i data-lucide="edit-3" style="width: 14px; height: 14px;"></i>
              </button>
              <button class="icon-btn" onclick="App.deleteStreamKey('${k.id}', '${this.escHtml(k.name)}')" title="Delete">
                <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
    this.refreshIcons();
  },

  openAddStreamKeyModal(keyId) {
    const titleEl = document.getElementById('addStreamKeyTitle');
    const idInput = document.getElementById('formStreamKeyId');
    const nameInput = document.getElementById('formStreamKeyName');
    const keyInput = document.getElementById('formStreamKeyValue');

    if (keyId) {
      const item = this.channelStreamKeys.find(k => k.id === keyId);
      if (titleEl) titleEl.textContent = 'Edit Stream Key';
      if (idInput) idInput.value = keyId;
      if (nameInput) nameInput.value = item ? item.name : '';
      if (keyInput) keyInput.value = item ? item.key : '';
    } else {
      if (titleEl) titleEl.textContent = 'Add Stream Key';
      if (idInput) idInput.value = '';
      if (nameInput) nameInput.value = `KEY${(this.channelStreamKeys.length || 0) + 1}`;
      if (keyInput) keyInput.value = '';
    }

    document.getElementById('addStreamKeyModal').classList.add('active');
  },

  closeAddStreamKeyModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('addStreamKeyModal').classList.remove('active');
  },

  async saveStreamKey(event) {
    event.preventDefault();
    if (!this.currentChannel) return;

    const id = document.getElementById('formStreamKeyId').value;
    const name = document.getElementById('formStreamKeyName').value.trim();
    const key = document.getElementById('formStreamKeyValue').value.trim();

    try {
      let res;
      if (id) {
        res = await fetch(`${API}/api/channels/${this.currentChannel.id}/keys/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, key })
        });
      } else {
        res = await fetch(`${API}/api/channels/${this.currentChannel.id}/keys`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, key })
        });
      }

      if (res.ok) {
        this.toast(id ? 'Stream key updated' : 'Stream key added', 'success');
        this.closeAddStreamKeyModal();
        await this.fetchChannelStreamKeys();
      } else {
        const data = await res.json();
        this.toast(data.error || 'Failed to save stream key', 'error');
      }
    } catch (e) {
      console.error('Save stream key error:', e);
      this.toast('Error saving stream key', 'error');
    }
  },

  deleteStreamKey(keyId, name) {
    if (!this.currentChannel) return;
    this.confirmAction({
      message: `Are you sure you want to delete stream key "${name}"?`,
      onConfirm: async () => {
        try {
          const res = await fetch(`${API}/api/channels/${this.currentChannel.id}/keys/${keyId}`, {
            method: 'DELETE'
          });
          if (res.ok) {
            this.toast('Stream key deleted', 'info');
            await this.fetchChannelStreamKeys();
          } else {
            this.toast('Failed to delete stream key', 'error');
          }
        } catch (e) {
          console.error('Delete stream key error:', e);
          this.toast('Error deleting stream key', 'error');
        }
      }
    });
  },

  copyStreamKey(key) {
    if (!key) return;
    navigator.clipboard.writeText(key).then(() => {
      this.toast('Stream key copied to clipboard', 'info');
    }).catch(() => {
      this.toast('Key: ' + key, 'info');
    });
  },

  // ============================================================
  // Streams API & Render
  // ============================================================

  async fetchStreams() {
    try {
      const res = await fetch(`${API}/api/streams`);
      if (!res.ok) return;
      const data = await res.json();
      this.streams = Array.isArray(data) ? data : [];
      this.populateChannelFilter();
      this.applyFilters();
    } catch (e) {
      console.error('Failed to fetch streams:', e);
    }
  },

  async apiPost(url) {
    try {
      const res = await fetch(`${API}${url}`, { method: 'POST' });
      const data = await res.json();
      if (data.error) {
        this.toast(data.error, 'error');
        return null;
      }
      return data;
    } catch (e) {
      this.toast('Request failed', 'error');
      return null;
    }
  },

  async apiSave(method, url, body) {
    try {
      const res = await fetch(`${API}${url}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) {
        this.toast(data.error, 'error');
        return null;
      }
      return data;
    } catch (e) {
      this.toast('Request failed', 'error');
      return null;
    }
  },

  async apiDelete(url) {
    try {
      const res = await fetch(`${API}${url}`, { method: 'DELETE' });
      return await res.json();
    } catch (e) {
      this.toast('Request failed', 'error');
      return null;
    }
  },

  connectStatusSSE() {
    if (this.statusSSE) this.statusSSE.close();
    const tokenParam = this.accessToken ? `?token=${encodeURIComponent(this.accessToken)}` : '';
    this.statusSSE = new EventSource(`${API}/api/events${tokenParam}`);
    this.statusSSE.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'status' && data.streams) {
          this.streams = data.streams;
          this.populateChannelFilter();
          this.applyFilters();
        } else if (data.type === 'system_stats' && data.stats) {
          this.updateSystemMetricsUI(data.stats);
        }
      } catch (_) {}
    };
    this.statusSSE.onerror = () => {
      if (this.accessToken) {
        setTimeout(() => this.connectStatusSSE(), 3000);
      }
    };
  },

  async fetchSystemStats() {
    try {
      const res = await fetch(`${API}/api/system/stats`);
      if (!res.ok) return;
      const stats = await res.json();
      this.updateSystemMetricsUI(stats);
    } catch (_) {}
  },

  updateSystemMetricsUI(stats) {
    if (!stats) return;

    // CPU Usage
    if (stats.cpu) {
      const cpuVal = document.getElementById('sysCpuValue');
      const cpuBar = document.getElementById('sysCpuBar');
      const cpuSub = document.getElementById('sysCpuSub');
      const cpuStatus = document.getElementById('sysCpuStatus');
      const pct = stats.cpu.percent || 0;

      if (cpuVal) cpuVal.textContent = `${pct}%`;
      if (cpuBar) cpuBar.style.width = `${pct}%`;
      if (cpuSub) cpuSub.textContent = `${stats.cpu.cores || 1} Cores Active`;
      if (cpuStatus) {
        cpuStatus.textContent = pct > 85 ? 'High' : pct > 60 ? 'Busy' : 'Normal';
        cpuStatus.style.color = pct > 85 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#38bdf8';
      }
    }

    // RAM Memory
    if (stats.memory) {
      const ramVal = document.getElementById('sysRamValue');
      const ramBar = document.getElementById('sysRamBar');
      const ramSub = document.getElementById('sysRamSub');
      const ramStatus = document.getElementById('sysRamStatus');
      const pct = stats.memory.percent || 0;

      if (ramVal) ramVal.textContent = `${pct}%`;
      if (ramBar) ramBar.style.width = `${pct}%`;
      if (ramSub) ramSub.textContent = `${stats.memory.usedGb || '0'} GB / ${stats.memory.totalGb || '0'} GB`;
      if (ramStatus) {
        ramStatus.textContent = pct > 90 ? 'Critical' : pct > 75 ? 'Heavy' : 'Healthy';
        ramStatus.style.color = pct > 90 ? '#ef4444' : pct > 75 ? '#c084fc' : '#a855f7';
      }
    }

    // Disk Space
    if (stats.disk) {
      const diskVal = document.getElementById('sysDiskValue');
      const diskBar = document.getElementById('sysDiskBar');
      const diskSub = document.getElementById('sysDiskSub');
      const diskDrive = document.getElementById('sysDiskDrive');
      const pct = stats.disk.percent || 0;

      if (diskVal) diskVal.textContent = `${pct}%`;
      if (diskBar) diskBar.style.width = `${pct}%`;
      if (diskSub) diskSub.textContent = `${stats.disk.usedGb || '0'} GB / ${stats.disk.totalGb || '0'} GB`;
      if (diskDrive) diskDrive.textContent = stats.disk.drive || 'Drive';
    }

    // Network Upload & Download
    if (stats.network) {
      const netUp = document.getElementById('sysNetUp');
      const netDown = document.getElementById('sysNetDown');
      const netUpBar = document.getElementById('sysNetUpBar');
      const netDownBar = document.getElementById('sysNetDownBar');
      const netSub = document.getElementById('sysNetSub');

      if (netUp) netUp.textContent = `▲ ${stats.network.upload || '0 KB/s'}`;
      if (netDown) netDown.textContent = `▼ ${stats.network.download || '0 KB/s'}`;
      if (netUpBar) netUpBar.style.width = `${stats.network.uploadPercent || 2}%`;
      if (netDownBar) netDownBar.style.width = `${stats.network.downloadPercent || 2}%`;
      if (netSub) netSub.textContent = 'Live Streaming Traffic';
    }
  },

  connectLogSSE(streamId) {
    if (this.logSSE) this.logSSE.close();
    const tokenParam = this.accessToken ? `?token=${encodeURIComponent(this.accessToken)}` : '';
    this.logSSE = new EventSource(`${API}/api/streams/${streamId}/logs${tokenParam}`);
    this.logSSE.onmessage = (e) => {
      try {
        const log = JSON.parse(e.data);
        this.appendLog(log);
      } catch (_) {}
    };
  },

  toggleToolbarChannelFilter(event) {
    if (event) event.stopPropagation();
    const dropdown = document.getElementById('toolbarChannelFilterDropdown');
    const trigger = document.getElementById('toolbarChannelFilterTrigger');
    const chevron = document.getElementById('toolbarChannelFilterChevron');
    const searchInput = document.getElementById('toolbarChannelSearchInput');
    if (!dropdown) return;

    const isOpen = dropdown.style.display === 'block';
    if (isOpen) {
      dropdown.style.display = 'none';
      if (trigger) trigger.classList.remove('active');
      if (chevron) chevron.style.transform = 'rotate(0deg)';
    } else {
      dropdown.style.display = 'block';
      if (trigger) trigger.classList.add('active');
      if (chevron) chevron.style.transform = 'rotate(180deg)';
      if (searchInput) {
        searchInput.value = '';
        setTimeout(() => searchInput.focus(), 50);
      }
      this.renderToolbarChannelFilterOptions('');
    }
    this.refreshIcons();
  },

  renderToolbarChannelFilterOptions(filterText = '') {
    const listEl = document.getElementById('toolbarChannelFilterList');
    if (!listEl) return;
    const currentVal = document.getElementById('filterChannel').value;

    const channelNames = Array.from(new Set([
      ...this.channels.map(c => c.name),
      ...this.streams.map(s => s.channelName || 'Default Channel')
    ])).filter(Boolean).sort();

    const filtered = channelNames.filter(name =>
      name.toLowerCase().includes((filterText || '').toLowerCase())
    );

    let html = `
      <div class="custom-filter-item ${!currentVal ? 'selected' : ''}" onclick="App.selectToolbarChannelFilter('')">
        All Channels
      </div>
    `;

    if (filtered.length === 0 && filterText) {
      html += '<div style="padding: 12px; font-size: 12px; color: #64748b; text-align: center;">No channels found</div>';
    } else {
      html += filtered.map(name => {
        const isSelected = currentVal && currentVal.toLowerCase() === name.toLowerCase();
        return `
          <div class="custom-filter-item ${isSelected ? 'selected' : ''}" onclick="App.selectToolbarChannelFilter('${this.escHtml(name)}')">
            ${this.escHtml(name)}
          </div>
        `;
      }).join('');
    }

    listEl.innerHTML = html;
  },

  filterToolbarChannelDropdown(query) {
    this.renderToolbarChannelFilterOptions(query);
  },

  selectToolbarChannelFilter(channelName) {
    const hiddenInput = document.getElementById('filterChannel');
    const label = document.getElementById('toolbarChannelFilterLabel');
    const dropdown = document.getElementById('toolbarChannelFilterDropdown');
    const trigger = document.getElementById('toolbarChannelFilterTrigger');
    const chevron = document.getElementById('toolbarChannelFilterChevron');

    if (hiddenInput) hiddenInput.value = channelName || '';
    if (label) {
      label.textContent = channelName ? channelName : 'Filter by Channel';
      label.style.color = channelName ? '#ffffff' : '#cbd5e1';
    }

    if (dropdown) dropdown.style.display = 'none';
    if (trigger) trigger.classList.remove('active');
    if (chevron) chevron.style.transform = 'rotate(0deg)';

    this.applyFilters();
  },

  populateChannelFilter() {
    this.renderToolbarChannelFilterOptions('');
  },

  applyFilters() {
    const channelSelect = document.getElementById('filterChannel');
    const statusSelect = document.getElementById('filterStatus');
    const searchInput = document.getElementById('searchInput');
    if (!channelSelect || !statusSelect || !searchInput) return;

    const channelFilter = channelSelect.value.toLowerCase();
    const statusFilter = statusSelect.value.toLowerCase();
    const searchVal = searchInput.value.toLowerCase();

    this.filteredStreams = this.streams.filter(s => {
      const matchChannel = !channelFilter || (s.channelName || '').toLowerCase() === channelFilter;
      const matchStatus = !statusFilter || (s.status || '').toLowerCase() === statusFilter;
      const matchSearch = !searchVal ||
        (s.name || '').toLowerCase().includes(searchVal) ||
        (s.channelName || '').toLowerCase().includes(searchVal) ||
        (s.streamKey || '').toLowerCase().includes(searchVal);
      return matchChannel && matchStatus && matchSearch;
    });

    this.updateStats();
    this.renderTable();
  },

  updateStats() {
    const uniqueChannels = new Set(this.streams.map(s => s.channelName || 'Default Channel')).size;
    const totalStreams = this.streams.length;
    const liveStreams = this.streams.filter(s => s.status === 'live').length;

    const cEl = document.getElementById('statChannels');
    const tEl = document.getElementById('statTotalStreams');
    const lEl = document.getElementById('statLiveStreams');
    const sEl = document.getElementById('statScheduled');

    if (cEl) cEl.textContent = uniqueChannels;
    if (tEl) tEl.textContent = totalStreams;
    if (lEl) lEl.textContent = liveStreams;
    if (sEl) sEl.textContent = '0';
  },

  getStreamThumbnailHTML(s) {
    const channel = this.channels.find(c => c.name === s.channelName || c.id === s.channelId);
    let thumbUrl = s.thumbnail || '';
    let videoUrl = '';

    if (channel) {
      if (s.videoMode === 'playlist' || s.type === 'Playlist' || (s.videoPath && s.videoPath.startsWith('pl_'))) {
        const pl = (channel.videoPlaylists || []).find(p => p.id === s.videoPath);
        const firstVideoId = pl && pl.items && pl.items[0];
        const firstVideo = (channel.videos || []).find(v => v.id === firstVideoId || v.url === s.videoPath || v.filePath === s.videoPath);
        if (firstVideo) {
          thumbUrl = firstVideo.thumbnail || '';
          videoUrl = firstVideo.url || firstVideo.filePath || '';
        }
      } else {
        const matchedVideo = (channel.videos || []).find(v => v.url === s.videoPath || v.filePath === s.videoPath || v.id === s.videoPath || v.title === s.videoPath);
        if (matchedVideo) {
          thumbUrl = matchedVideo.thumbnail || '';
          videoUrl = matchedVideo.url || matchedVideo.filePath || '';
        }
      }
    }

    if (!videoUrl && s.videoPath && (s.videoPath.startsWith('http') || s.videoPath.startsWith('/'))) {
      videoUrl = s.videoPath;
    }

    if (thumbUrl && (thumbUrl.startsWith('http') || thumbUrl.startsWith('/'))) {
      return `<img src="${this.escHtml(thumbUrl)}" class="stream-thumb" style="width: 64px; height: 38px; object-fit: cover; border-radius: 6px; background: #141724; border: 1px solid #23283c; flex-shrink: 0;" alt="thumb">`;
    }

    if (videoUrl && (videoUrl.startsWith('http') || videoUrl.startsWith('/'))) {
      return `<video src="${this.escHtml(videoUrl)}#t=0.5" class="stream-thumb" preload="metadata" muted playsinline style="width: 64px; height: 38px; object-fit: cover; background: #000; border-radius: 6px; border: 1px solid #23283c; flex-shrink: 0;"></video>`;
    }

    const isPlaylist = (s.videoMode === 'playlist' || s.type === 'Playlist' || (s.videoPath && s.videoPath.startsWith('pl_')));
    return `
      <div class="stream-thumb" style="display: flex; align-items: center; justify-content: center; background: #141724; border-radius: 6px; border: 1px solid #23283c; width: 64px; height: 38px; flex-shrink: 0;">
        <i data-lucide="${isPlaylist ? 'layers' : 'film'}" style="width: 18px; height: 18px; color: #3b82f6;"></i>
      </div>
    `;
  },

  renderTable() {
    const tbody = document.getElementById('streamTableBody');
    if (!tbody) return;

    if (this.filteredStreams.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="empty-cell">
            <div class="empty-state">
              <p>No streams found. Click "+ New Stream" to create one.</p>
            </div>
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = this.filteredStreams.map(s => {
      const isSelected = s.id === this.selectedStreamId ? 'selected-row' : '';
      const isPlaylist = (s.videoMode === 'playlist' || s.type === 'Playlist' || (s.videoPath && s.videoPath.startsWith('pl_')));

      const statusClass = s.status === 'live' ? 'live'
        : s.status === 'retrying' ? 'retrying'
        : 'idle';
      const statusLabel = s.status === 'live' ? 'Live'
        : s.status === 'retrying' ? 'Retry'
        : 'Idle';

      const duration = (s.startTime && s.status !== 'idle')
        ? this.formatDuration(Date.now() - s.startTime)
        : '--';

      const isBackup = s.rtmpUrl && (s.rtmpUrl.includes('backup') || s.rtmpUrl.includes('b.rtmp'));

      return `
        <tr class="${isSelected}" data-id="${s.id}">
          <td>
            <div class="stream-name-cell" style="display: flex; align-items: center; gap: 10px;">
              ${this.getStreamThumbnailHTML(s)}
              <div class="stream-info">
                <span class="stream-title" title="${this.escHtml(s.name)}">${this.escHtml(s.name)}</span>
                <span class="stream-channel">${this.escHtml(s.channelName || 'Default Channel')}</span>
              </div>
            </div>
          </td>

          <td>
            <span class="badge-type">
              <i data-lucide="${isPlaylist ? 'layers' : 'video'}" style="width:12px;height:12px;margin-right:4px;"></i>
              ${isPlaylist ? 'Playlist' : 'Single'}
            </span>
          </td>

          <td>
            <div class="platform-cell">
              <i data-lucide="youtube" class="yt-icon" style="width:14px;height:14px;color:#ef4444;margin-right:4px;"></i>
              <span>${this.escHtml(s.platform || 'YouTube')}</span>
              ${isBackup ? `<span class="badge-backup">Backup</span>` : ''}
            </div>
          </td>

          <td>
            <span class="duration-cell" data-start="${s.startTime || ''}" data-status="${s.status}">${duration}</span>
          </td>

          <td>
            <span class="badge-status ${statusClass}">${statusLabel}</span>
          </td>

          <td>
            <div class="actions-cell">
              ${s.status === 'idle' ? `
                <button class="btn btn-start" onclick="event.stopPropagation();App.startStream('${s.id}')">Start</button>
              ` : `
                <button class="btn btn-stop" onclick="event.stopPropagation();App.stopStream('${s.id}')">Stop</button>
              `}
              <button class="icon-btn" onclick="event.stopPropagation();App.openEditModal('${s.id}')" title="Edit">
                <i data-lucide="edit-3" style="width:15px;height:15px"></i>
              </button>
              <button class="icon-btn" onclick="event.stopPropagation();App.showStreamLog('${s.id}')" title="View Log">
                <i data-lucide="terminal" style="width:15px;height:15px"></i>
              </button>
              <button class="icon-btn" onclick="event.stopPropagation();App.deleteStream('${s.id}')" title="Delete">
                <i data-lucide="trash-2" style="width:15px;height:15px"></i>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');
    this.refreshIcons();
  },

  updateDurations() {
    document.querySelectorAll('.duration-cell').forEach(cell => {
      const start = parseInt(cell.dataset.start);
      const status = cell.dataset.status;
      if (start && status !== 'idle') {
        cell.textContent = this.formatDuration(Date.now() - start);
      }
    });
  },

  async startStream(id) {
    const result = await this.apiPost(`/api/streams/${id}/start`);
    if (result) {
      this.toast('Stream started', 'success');
      this.fetchStreams();
    }
  },

  async stopStream(id) {
    const result = await this.apiPost(`/api/streams/${id}/stop`);
    if (result) {
      this.toast('Stream stopped', 'info');
      this.fetchStreams();
    }
  },

  deleteStream(id) {
    const stream = this.streams.find(s => s.id === id);
    const title = stream ? stream.name : id;

    this.confirmAction({
      message: `Are you sure you want to delete stream "${title}"?`,
      onConfirm: async () => {
        const result = await this.apiDelete(`/api/streams/${id}`);
        if (result && result.success) {
          this.toast('Stream deleted', 'info');
          await this.fetchStreams();
        } else {
          this.toast((result && result.error) || 'Failed to delete stream', 'error');
        }
      }
    });
  },

  showStreamLog(id) {
    this.selectedStreamId = id;
    const stream = this.streams.find(s => s.id === id);
    if (!stream) return;

    document.getElementById('logModalStreamName').textContent = stream.name || 'Stream';
    document.getElementById('logModalStreamKey').textContent = stream.streamKeyMasked || stream.streamKey;
    document.getElementById('logModalContent').innerHTML = '<div class="log-placeholder">Connecting to stream logs...</div>';

    this.connectLogSSE(id);
    document.getElementById('logModalBackdrop').classList.add('active');
  },

  closeLogModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('logModalBackdrop').classList.remove('active');
    if (this.logSSE) {
      this.logSSE.close();
      this.logSSE = null;
    }
  },

  appendLog(log) {
    const container = document.getElementById('logModalContent');
    if (!container) return;

    const placeholder = container.querySelector('.log-placeholder');
    if (placeholder) placeholder.remove();

    const row = document.createElement('div');
    row.className = 'log-row';
    row.innerHTML = `
      <span class="log-ts">[${this.escHtml(log.timestamp)}]</span>
      <span class="log-text ${log.level}">${this.escHtml(log.message)}</span>
    `;
    container.appendChild(row);

    while (container.children.length > 500) {
      container.removeChild(container.firstChild);
    }
    container.scrollTop = container.scrollHeight;
  },

  clearLogModal() {
    const container = document.getElementById('logModalContent');
    if (container) {
      container.innerHTML = '<div class="log-placeholder">Log cleared</div>';
    }
  },

  // ============================================================
  // Create / Edit Stream Modal Logic (Matching User's Design)
  // ============================================================
  streamVideoMode: 'single',
  streamAudioType: 'track',
  selectedAudioTrackIds: new Set(),

  // Custom Searchable Channel Select Component
  toggleChannelDropdown(event) {
    if (event) event.stopPropagation();
    const dropdown = document.getElementById('channelSelectDropdown');
    const trigger = document.getElementById('channelSelectTrigger');
    const chevron = document.getElementById('channelSelectChevron');
    const searchInput = document.getElementById('channelSearchInput');
    if (!dropdown) return;

    const isOpen = dropdown.style.display === 'block';
    if (isOpen) {
      dropdown.style.display = 'none';
      if (trigger) trigger.classList.remove('active');
      if (chevron) chevron.style.transform = 'rotate(0deg)';
    } else {
      dropdown.style.display = 'block';
      if (trigger) trigger.classList.add('active');
      if (chevron) chevron.style.transform = 'rotate(180deg)';
      if (searchInput) {
        searchInput.value = '';
        setTimeout(() => searchInput.focus(), 50);
      }
      this.renderChannelDropdownOptions('');
    }
    this.refreshIcons();
  },

  renderChannelDropdownOptions(filterText = '') {
    const listEl = document.getElementById('channelSelectList');
    if (!listEl) return;
    const currentId = document.getElementById('formChannelSelect').value;

    const filtered = this.channels.filter(c => 
      c.name.toLowerCase().includes((filterText || '').toLowerCase())
    );

    if (filtered.length === 0) {
      listEl.innerHTML = '<div style="padding: 14px; font-size: 12px; color: #64748b; text-align: center;">No channels found</div>';
      return;
    }

    listEl.innerHTML = filtered.map(c => {
      const isSelected = c.id === currentId;
      return `
        <div class="custom-select-item ${isSelected ? 'selected' : ''}" onclick="App.selectChannelOption('${c.id}')">
          <span class="custom-select-item-title">${this.escHtml(c.name)}</span>
          <span class="custom-select-item-subtitle">Active</span>
        </div>
      `;
    }).join('');
  },

  filterChannelDropdown(query) {
    this.renderChannelDropdownOptions(query);
  },

  selectChannelOption(channelId) {
    this.setChannelSelectValue(channelId);
    const dropdown = document.getElementById('channelSelectDropdown');
    const trigger = document.getElementById('channelSelectTrigger');
    const chevron = document.getElementById('channelSelectChevron');

    if (dropdown) dropdown.style.display = 'none';
    if (trigger) trigger.classList.remove('active');
    if (chevron) chevron.style.transform = 'rotate(0deg)';

    this.onStreamChannelChange();
  },

  setChannelSelectValue(channelId) {
    const hiddenInput = document.getElementById('formChannelSelect');
    const label = document.getElementById('channelSelectLabel');
    const channel = this.channels.find(c => c.id === channelId);
    if (hiddenInput) hiddenInput.value = channelId || '';
    if (label) label.textContent = channel ? channel.name : 'Select channel...';
  },

  openAddModal() {
    const modalTitle = document.getElementById('modalTitle');
    const submitBtn = document.getElementById('formSubmitBtn');
    if (modalTitle) modalTitle.textContent = 'Create New Stream';
    if (submitBtn) submitBtn.textContent = 'Create Stream';

    document.getElementById('formId').value = '';
    document.getElementById('formName').value = '';
    document.getElementById('formRtmp').value = 'rtmp://a.rtmp.youtube.com/live2';
    const loop1h = document.getElementById('formVideoLoop1Hour');
    if (loop1h) loop1h.checked = false;
    this.selectedAudioTrackIds.clear();

    // Select initial channel
    if (this.currentChannel) {
      this.setChannelSelectValue(this.currentChannel.id);
    } else if (this.channels.length > 0) {
      this.setChannelSelectValue(this.channels[0].id);
    } else {
      this.setChannelSelectValue('');
    }

    this.setStreamVideoMode('single');
    this.setStreamAudioType('track');
    this.onStreamChannelChange();
    this.updateModalServerTime();

    document.getElementById('modalBackdrop').classList.add('active');
    this.refreshIcons();
  },

  openEditModal(id) {
    const s = this.streams.find(s => s.id === id);
    if (!s) return;
    if (s.status !== 'idle') {
      this.toast('Stop stream first before editing', 'warning');
      return;
    }

    const modalTitle = document.getElementById('modalTitle');
    const submitBtn = document.getElementById('formSubmitBtn');
    if (modalTitle) modalTitle.textContent = 'Edit Stream';
    if (submitBtn) submitBtn.textContent = 'Save Changes';

    document.getElementById('formId').value = s.id;
    document.getElementById('formName').value = s.name || '';
    document.getElementById('formRtmp').value = s.rtmpUrl || 'rtmp://a.rtmp.youtube.com/live2';
    this.selectedAudioTrackIds.clear();

    // Find channel & set label
    const matchedChannel = this.channels.find(c => c.name === s.channelName || c.id === s.channelId) || this.channels[0];
    this.setChannelSelectValue(matchedChannel ? matchedChannel.id : '');

    // Determine Video Mode: playlist or single
    const isVideoPlaylist = s.videoMode === 'playlist' || s.type === 'Playlist' || (s.videoPath && s.videoPath.startsWith('pl_'));
    this.setStreamVideoMode(isVideoPlaylist ? 'playlist' : 'single');

    // Determine Audio Mode: playlist or track
    let isAudioPlaylist = s.audioType === 'playlist';
    if (s.audioPath && (s.audioPath.startsWith('pl_') || (matchedChannel && matchedChannel.audioPlaylists && matchedChannel.audioPlaylists.some(p => p.id === s.audioPath)))) {
      isAudioPlaylist = true;
    }
    this.setStreamAudioType(isAudioPlaylist ? 'playlist' : 'track');

    // Restore selected track IDs if in track mode
    if (!isAudioPlaylist && s.audioPath && matchedChannel && matchedChannel.audios) {
      const paths = s.audioPath.split(',').map(p => p.trim());
      matchedChannel.audios.forEach(a => {
        if (paths.includes(a.id) || paths.includes(a.url) || paths.includes(a.filePath)) {
          this.selectedAudioTrackIds.add(a.id);
        }
      });
    }

    this.onStreamChannelChange(s);

    // Playback Modes
    const audioMode = s.audioMode || 'shuffle';
    const aRadio = document.querySelector(`input[name="formAudioPlayMode"][value="${audioMode}"]`);
    if (aRadio) aRadio.checked = true;

    const videoMode = s.videoMode || 'shuffle';
    const vRadio = document.querySelector(`input[name="formVideoPlayMode"][value="${videoMode}"]`);
    if (vRadio) vRadio.checked = true;

    // Set videoLoop1Hour LAST — after all mode switches that may rebuild the UI
    const loop1hEl = document.getElementById('formVideoLoop1Hour');
    if (loop1hEl) {
      loop1hEl.checked = (s.videoLoop1Hour === true || s.videoLoop1Hour === 'true');
    }

    this.updateModalServerTime();
    document.getElementById('modalBackdrop').classList.add('active');
    this.refreshIcons();
  },

  updateModalServerTime() {
    const timeEl = document.getElementById('modalServerTime');
    if (!timeEl) return;
    const now = new Date();
    const d = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const t = now.toLocaleTimeString('en-GB', { hour12: false });
    timeEl.textContent = `${d} ${t}`;
  },

  onStreamChannelChange(existingStreamData) {
    const chSelect = document.getElementById('formChannelSelect');
    const channelId = chSelect ? chSelect.value : '';
    const channel = this.channels.find(c => c.id === channelId);

    const videoSelect = document.getElementById('formVideoSelect');
    const audioSelect = document.getElementById('formAudioSelect');
    const trackListBox = document.getElementById('audioTrackListBox');
    const keySelect = document.getElementById('formKeySelect');
    const previewVideo = document.getElementById('streamPreviewVideo');
    const previewPlaceholder = document.getElementById('streamPreviewPlaceholder');

    // Reset video preview
    if (previewVideo && previewPlaceholder) {
      previewVideo.pause();
      previewVideo.src = '';
      previewVideo.style.display = 'none';
      previewPlaceholder.style.display = 'flex';
    }

    if (!channel) {
      if (videoSelect) videoSelect.innerHTML = '<option value="">Choose a video...</option>';
      if (audioSelect) audioSelect.innerHTML = '<option value="">Select a channel to view playlists</option>';
      if (trackListBox) trackListBox.innerHTML = '<div style="color: var(--text-sub); font-size: 11px; padding: 20px; text-align: center;">Select a channel to view tracks</div>';
      if (keySelect) keySelect.innerHTML = '<option value="">Select stream key...</option>';
      return;
    }

    // Populate Videos / Video Playlist
    this.populateStreamVideoOptions(channel, existingStreamData);

    // Populate Audio / Audio Playlist / Track List
    this.populateStreamAudioOptions(channel, existingStreamData);

    // Populate Stream Keys from channel
    if (keySelect) {
      const keys = channel.streamKeys || [];
      const streams = this.streams || [];
      const currentEditingId = document.getElementById('formId').value;

      if (keys.length === 0) {
        keySelect.innerHTML = '<option value="">No stream keys available. Add keys in Channel > Stream Key</option>';
      } else {
        keySelect.innerHTML = '<option value="">Select stream key...</option>' +
          keys.map(k => {
            // Check if key is used by another stream
            const usedStream = streams.find(s => s.streamKey === k.key && s.id !== currentEditingId);
            if (usedStream) {
              return `<option value="${this.escHtml(k.key)}" disabled style="color: #64748b;">${this.escHtml(k.name)} (${this.escHtml(k.key)}) — In Use: ${this.escHtml(usedStream.name)}</option>`;
            } else {
              return `<option value="${this.escHtml(k.key)}">${this.escHtml(k.name)} (${this.escHtml(k.key)})</option>`;
            }
          }).join('');
      }

      if (existingStreamData && existingStreamData.streamKey) {
        keySelect.value = existingStreamData.streamKey;
      }
    }
  },

  populateStreamVideoOptions(channel, existingStreamData) {
    const videoSelect = document.getElementById('formVideoSelect');
    if (!videoSelect) return;

    if (this.streamVideoMode === 'single') {
      const videos = channel.videos || [];
      if (videos.length === 0) {
        videoSelect.innerHTML = '<option value="">No videos uploaded in this channel</option>';
      } else {
        videoSelect.innerHTML = '<option value="">Choose a video...</option>' +
          videos.map(v => `<option value="${this.escHtml(v.url || v.filePath)}" data-url="${this.escHtml(v.url || '')}" data-title="${this.escHtml(v.title)}">${this.escHtml(v.title)} (${this.escHtml(v.size || '0 MB')})</option>`).join('');
      }
    } else {
      const playlists = channel.videoPlaylists || [];
      if (playlists.length === 0) {
        videoSelect.innerHTML = '<option value="">Select Video Playlist...</option>';
      } else {
        videoSelect.innerHTML = '<option value="">Select Video Playlist...</option>' +
          playlists.map(p => `<option value="${this.escHtml(p.id)}">${this.escHtml(p.name)} (${p.count || 0} videos)</option>`).join('');
      }
    }

    if (existingStreamData && existingStreamData.videoPath) {
      videoSelect.value = existingStreamData.videoPath;
      this.onStreamVideoChange();
    }
  },

  populateStreamAudioOptions(channel, existingStreamData) {
    const playlistWrap = document.getElementById('audioPlaylistSelectWrap');
    const trackListBox = document.getElementById('audioTrackListBox');
    const quickSelect = document.getElementById('audioTrackQuickSelect');
    const audioSelect = document.getElementById('formAudioSelect');
    const subtitle = document.getElementById('audioSelectedSubtitle');

    if (this.streamAudioType === 'playlist') {
      if (playlistWrap) playlistWrap.style.display = 'block';
      if (trackListBox) trackListBox.style.display = 'none';
      this.updateAudioTrackSubtitle();

      const playlists = channel.audioPlaylists || [];
      if (!audioSelect) return;
      if (playlists.length === 0) {
        audioSelect.innerHTML = '<option value="">No audio playlists found in channel</option>';
      } else {
        audioSelect.innerHTML = '<option value="">Select audio playlist...</option>' +
          playlists.map(p => `<option value="${this.escHtml(p.id)}">${this.escHtml(p.name)}</option>`).join('');
      }

      if (existingStreamData && existingStreamData.audioPath) {
        audioSelect.value = existingStreamData.audioPath;
      }
    } else {
      // Track mode
      if (playlistWrap) playlistWrap.style.display = 'none';
      if (trackListBox) trackListBox.style.display = 'flex';

      const audios = channel.audios || [];
      if (!trackListBox) return;

      if (audios.length === 0) {
        trackListBox.innerHTML = '<div style="color: var(--text-sub); font-size: 11px; padding: 20px; text-align: center;">No audio tracks uploaded in this channel.</div>';
        this.updateAudioTrackSubtitle();
        return;
      }

      // If existing stream data, restore selected tracks
      if (existingStreamData && existingStreamData.audioPath && this.selectedAudioTrackIds.size === 0) {
        const paths = existingStreamData.audioPath.split(',').map(p => p.trim());
        audios.forEach(a => {
          if (paths.includes(a.url) || paths.includes(a.filePath)) {
            this.selectedAudioTrackIds.add(a.id);
          }
        });
      }

      this.updateAudioTrackSubtitle();

      trackListBox.innerHTML = audios.map(a => {
        const isSelected = this.selectedAudioTrackIds.has(a.id);
        return `
          <div class="track-list-item ${isSelected ? 'selected' : ''}" id="trackItem_${a.id}" onclick="App.toggleTrackSelection('${a.id}')">
            <div class="circle-checkbox ${isSelected ? 'checked' : ''}" id="trackCheckbox_${a.id}"></div>
            <div class="file-icon-box" style="width: 28px; height: 28px; font-size: 12px; flex-shrink: 0;">
              <i data-lucide="music" style="width: 14px; height: 14px;"></i>
            </div>
            <div class="track-item-info">
              <span class="track-item-title" title="${this.escHtml(a.title)}">"${this.escHtml(a.title)}"</span>
              <span class="track-item-meta">${this.escHtml(a.duration || '0:00')} • ${this.escHtml(a.size || '0 MB')}</span>
            </div>
            <span class="track-item-duration">${this.escHtml(a.duration || '0:00')}</span>
          </div>
        `;
      }).join('');
      this.refreshIcons();
    }
  },

  updateAudioTrackSubtitle() {
    const subtitle = document.getElementById('audioSelectedSubtitle');
    if (!subtitle) return;
    if (this.streamAudioType === 'playlist') {
      subtitle.innerHTML = '<span>No playlist selected</span>';
    } else {
      const count = this.selectedAudioTrackIds.size;
      const countText = count > 0 ? `${count} selected` : 'Select tracks';
      subtitle.innerHTML = `<span>${countText}</span> <span style="color: #4b5563; margin: 0 4px;">|</span> <button type="button" class="btn-text-link" style="color: #3b82f6; font-weight: 700;" onclick="App.selectAllTracks(true)">All</button> <button type="button" class="btn-text-link" style="color: #94a3b8; font-weight: 600;" onclick="App.selectAllTracks(false)">None</button>`;
    }
  },

  toggleTrackSelection(audioId) {
    if (this.selectedAudioTrackIds.has(audioId)) {
      this.selectedAudioTrackIds.delete(audioId);
    } else {
      this.selectedAudioTrackIds.add(audioId);
    }

    const item = document.getElementById(`trackItem_${audioId}`);
    const checkbox = document.getElementById(`trackCheckbox_${audioId}`);
    const isSelected = this.selectedAudioTrackIds.has(audioId);

    if (item) item.classList.toggle('selected', isSelected);
    if (checkbox) checkbox.classList.toggle('checked', isSelected);
    this.updateAudioTrackSubtitle();
  },

  selectAllTracks(select) {
    const chSelect = document.getElementById('formChannelSelect');
    const channelId = chSelect ? chSelect.value : '';
    const channel = this.channels.find(c => c.id === channelId);
    if (!channel || !channel.audios) return;

    if (select) {
      channel.audios.forEach(a => this.selectedAudioTrackIds.add(a.id));
    } else {
      this.selectedAudioTrackIds.clear();
    }

    channel.audios.forEach(a => {
      const item = document.getElementById(`trackItem_${a.id}`);
      const checkbox = document.getElementById(`trackCheckbox_${a.id}`);
      const isSelected = this.selectedAudioTrackIds.has(a.id);
      if (item) item.classList.toggle('selected', isSelected);
      if (checkbox) checkbox.classList.toggle('checked', isSelected);
    });
    this.updateAudioTrackSubtitle();
  },

  setStreamVideoMode(mode) {
    this.streamVideoMode = mode;
    const pillSingle = document.getElementById('pillVideoSingle');
    const pillPlaylist = document.getElementById('pillVideoPlaylist');
    const playlistModeRow = document.getElementById('videoPlaylistPlayModeRow');

    if (pillSingle) pillSingle.classList.toggle('active', mode === 'single');
    if (pillPlaylist) pillPlaylist.classList.toggle('active', mode === 'playlist');
    if (playlistModeRow) playlistModeRow.style.display = mode === 'playlist' ? 'flex' : 'none';

    const chSelect = document.getElementById('formChannelSelect');
    const channelId = chSelect ? chSelect.value : '';
    const channel = this.channels.find(c => c.id === channelId);
    if (channel) this.populateStreamVideoOptions(channel);
  },

  setStreamAudioType(type) {
    this.streamAudioType = type;
    const pillPlaylist = document.getElementById('pillAudioPlaylist');
    const pillTrack = document.getElementById('pillAudioTrack');
    if (pillPlaylist) pillPlaylist.classList.toggle('active', type === 'playlist');
    if (pillTrack) pillTrack.classList.toggle('active', type === 'track');

    const chSelect = document.getElementById('formChannelSelect');
    const channelId = chSelect ? chSelect.value : '';
    const channel = this.channels.find(c => c.id === channelId);
    if (channel) this.populateStreamAudioOptions(channel);
  },

  onStreamVideoChange() {
    const videoSelect = document.getElementById('formVideoSelect');
    const previewVideo = document.getElementById('streamPreviewVideo');
    const previewPlaceholder = document.getElementById('streamPreviewPlaceholder');
    if (!videoSelect || !previewVideo || !previewPlaceholder) return;

    const opt = videoSelect.selectedOptions[0];
    const url = opt ? (opt.dataset.url || opt.value) : '';

    if (url && (url.startsWith('http') || url.startsWith('/'))) {
      previewPlaceholder.style.display = 'none';
      previewVideo.style.display = 'block';
      previewVideo.src = url;
      previewVideo.load();
    } else {
      previewVideo.pause();
      previewVideo.src = '';
      previewVideo.style.display = 'none';
      previewPlaceholder.style.display = 'flex';
    }

    // Auto-fill title if empty
    const titleInput = document.getElementById('formName');
    if (titleInput && !titleInput.value.trim() && opt && opt.dataset.title) {
      titleInput.value = opt.dataset.title.replace(/\.[^/.]+$/, "");
    }
  },

  onStreamAudioChange() {
    // optional audio selection handler
  },

  copyFieldValue(elementId) {
    const el = document.getElementById(elementId);
    if (!el || !el.value) return;
    navigator.clipboard.writeText(el.value).then(() => {
      this.toast('Copied to clipboard', 'info');
    });
  },

  closeModal(event) {
    if (event && event.target !== event.currentTarget) return;
    const previewVideo = document.getElementById('streamPreviewVideo');
    if (previewVideo) {
      previewVideo.pause();
      previewVideo.src = '';
    }
    document.getElementById('modalBackdrop').classList.remove('active');
  },

  async saveStream(event) {
    event.preventDefault();
    const id = document.getElementById('formId').value;
    const chSelect = document.getElementById('formChannelSelect');
    const channelId = chSelect ? chSelect.value : '';
    const channel = this.channels.find(c => c.id === channelId);

    const name = document.getElementById('formName').value.trim();
    const videoPath = document.getElementById('formVideoSelect').value;
    const streamKey = document.getElementById('formKeySelect').value.trim();
    const rtmpUrl = document.getElementById('formRtmp').value.trim();

    // Video play mode
    const vModeRadio = document.querySelector('input[name="formVideoPlayMode"]:checked');
    const videoMode = (this.streamVideoMode === 'playlist' && vModeRadio) ? vModeRadio.value : 'sequential';

    // Audio play mode & selected audio tracks/playlist
    const aModeRadio = document.querySelector('input[name="formAudioPlayMode"]:checked');
    const audioMode = aModeRadio ? aModeRadio.value : 'shuffle';

    let audioPath = '';
    if (this.streamAudioType === 'track') {
      if (this.selectedAudioTrackIds.size === 0) {
        this.toast('Please select at least one audio track', 'error');
        return;
      }
      const selectedAudios = (channel.audios || []).filter(a => this.selectedAudioTrackIds.has(a.id));
      audioPath = selectedAudios.map(a => a.filePath || a.url).join(',');
    } else {
      audioPath = document.getElementById('formAudioSelect').value;
    }

    if (!channel) {
      this.toast('Please select a channel', 'error');
      return;
    }
    if (!videoPath) {
      this.toast('Please select a video', 'error');
      return;
    }
    if (!streamKey) {
      this.toast('Please select a stream key', 'error');
      return;
    }

    const isVideoPlaylist = this.streamVideoMode === 'playlist';
    const type = isVideoPlaylist ? 'Playlist' : 'Single';
    const videoLoop1Hour = isVideoPlaylist && document.getElementById('formVideoLoop1Hour') ? document.getElementById('formVideoLoop1Hour').checked : false;

    const body = {
      name: name || `${channel.name} Stream`,
      channelName: channel.name,
      platform: 'YouTube',
      streamKey,
      videoPath,
      audioPath,
      videoMode,
      videoLoop1Hour,
      audioType: this.streamAudioType,
      audioMode,
      type,
      rtmpUrl: rtmpUrl || 'rtmp://a.rtmp.youtube.com/live2'
    };

    let result;
    if (id) {
      result = await this.apiSave('PUT', `/api/streams/${id}`, body);
    } else {
      result = await this.apiSave('POST', '/api/streams', body);
    }

    if (result) {
      this.toast(id ? 'Stream updated' : 'Stream created successfully', 'success');
      this.closeModal();
      this.fetchStreams();
    }
  },

  toast(message) {
    const stack = document.getElementById('toastStack');
    if (!stack) return;
    const toast = document.createElement('div');
    toast.className = 'toast-item';
    toast.textContent = message;
    stack.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3000);
  },

  formatDuration(ms) {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  },

  refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  },

  openCredentialsModal() {
    const modal = document.getElementById('credentialsModal');
    if (!modal) return;
    const currentPassEl = document.getElementById('credCurrentPassword');
    const newUsernameEl = document.getElementById('credNewUsername');
    const newPassEl = document.getElementById('credNewPassword');
    const confirmPassEl = document.getElementById('credConfirmPassword');
    
    if (currentPassEl) currentPassEl.value = '';
    if (newUsernameEl) newUsernameEl.value = (this.currentUser && this.currentUser.username) || 'admin';
    if (newPassEl) newPassEl.value = '';
    if (confirmPassEl) confirmPassEl.value = '';

    const resBox = document.getElementById('maintResultBox');
    if (resBox) resBox.style.display = 'none';

    this.switchProfileTab('account');
    modal.classList.add('active');
    this.refreshIcons();
    
    // Silently check maintenance status
    this.loadMaintenanceStatus(false);
  },

  switchProfileTab(tabName) {
    const tabAccountBtn = document.getElementById('tabBtnAccount');
    const tabMaintBtn = document.getElementById('tabBtnMaintenance');
    const paneAccount = document.getElementById('profileTabAccount');
    const paneMaint = document.getElementById('profileTabMaintenance');

    if (tabName === 'maintenance') {
      if (tabAccountBtn) tabAccountBtn.classList.remove('active');
      if (tabMaintBtn) tabMaintBtn.classList.add('active');
      if (paneAccount) {
        paneAccount.classList.remove('active');
        paneAccount.style.display = 'none';
      }
      if (paneMaint) {
        paneMaint.classList.add('active');
        paneMaint.style.display = 'block';
      }
      this.loadMaintenanceStatus(false);
    } else {
      if (tabMaintBtn) tabMaintBtn.classList.remove('active');
      if (tabAccountBtn) tabAccountBtn.classList.add('active');
      if (paneMaint) {
        paneMaint.classList.remove('active');
        paneMaint.style.display = 'none';
      }
      if (paneAccount) {
        paneAccount.classList.add('active');
        paneAccount.style.display = 'block';
      }
    }
    this.refreshIcons();
  },

  async loadMaintenanceStatus(isManualRefresh = false) {
    const refreshIcon = document.getElementById('maintRefreshIcon');
    if (isManualRefresh && refreshIcon) refreshIcon.classList.add('spin-icon');

    try {
      const res = await fetch('/api/system/maintenance/status');
      if (!res.ok) throw new Error('Failed to fetch maintenance status');
      const data = await res.json();

      if (data.success) {
        const cacheStat = document.getElementById('maintCacheStat');
        const cacheSub = document.getElementById('maintCacheSub');
        const orphanStat = document.getElementById('maintOrphanStat');
        const orphanSub = document.getElementById('maintOrphanSub');
        const zombieStat = document.getElementById('maintZombieStat');
        const zombieSub = document.getElementById('maintZombieSub');
        const badgeDot = document.getElementById('maintBadgeDot');

        if (cacheStat) cacheStat.textContent = `${data.cache.count} file${data.cache.count !== 1 ? 's' : ''}`;
        if (cacheSub) cacheSub.textContent = data.cache.totalFormatted;

        if (orphanStat) orphanStat.textContent = `${data.orphanUploads.count} file${data.orphanUploads.count !== 1 ? 's' : ''}`;
        if (orphanSub) orphanSub.textContent = data.orphanUploads.totalFormatted;

        if (zombieStat) zombieStat.textContent = `${data.zombies.count} proc`;
        if (zombieSub) zombieSub.textContent = data.zombies.count > 0 ? `${data.zombies.count} orphan active` : 'Clean';

        const hasWork = data.cache.count > 0 || data.orphanUploads.count > 0 || data.zombies.count > 0;
        if (badgeDot) badgeDot.style.display = hasWork ? 'inline-block' : 'none';

        if (isManualRefresh) {
          this.toast('Maintenance status refreshed', 'success');
        }
      }
    } catch (err) {
      if (isManualRefresh) this.toast(err.message || 'Failed to refresh status', 'error');
    } finally {
      if (refreshIcon) refreshIcon.classList.remove('spin-icon');
    }
  },

  async runMaintenanceAction(actionType) {
    let targetBtn = null;
    let originalHtml = '';

    if (actionType === 'clean-all') {
      targetBtn = document.getElementById('btnMaintDeepClean');
    } else if (actionType === 'clean-cache') {
      targetBtn = document.getElementById('btnCleanCache');
    } else if (actionType === 'clean-zombies') {
      targetBtn = document.getElementById('btnCleanZombies');
    } else if (actionType === 'clean-uploads') {
      targetBtn = document.getElementById('btnCleanUploads');
    }

    if (targetBtn) {
      originalHtml = targetBtn.innerHTML;
      targetBtn.disabled = true;
      targetBtn.innerHTML = `<i data-lucide="loader-2" class="spin-icon" style="width: 14px; height: 14px;"></i> <span>Cleaning...</span>`;
      this.refreshIcons();
    }

    try {
      const res = await fetch(`/api/system/maintenance/${actionType}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Maintenance action failed');
      }

      const resBox = document.getElementById('maintResultBox');
      const resMsg = document.getElementById('maintResultMsg');
      if (resBox && resMsg) {
        resMsg.textContent = data.message || 'Cleanup operation completed successfully';
        resBox.style.display = 'block';
      }

      this.toast(data.message || 'Cleanup completed successfully', 'success');

      await this.loadMaintenanceStatus(false);
      this.fetchStreams();
      this.fetchChannels();
    } catch (err) {
      this.toast(err.message || 'Action failed', 'error');
    } finally {
      if (targetBtn) {
        targetBtn.disabled = false;
        targetBtn.innerHTML = originalHtml;
        this.refreshIcons();
      }
    }
  },

  closeCredentialsModal(e) {
    if (e && e.target !== e.currentTarget && !e.target.closest('.btn-close') && !e.target.closest('.btn-dark-full')) return;
    const modal = document.getElementById('credentialsModal');
    if (modal) modal.classList.remove('active');
  },

  async saveCredentials(e) {
    e.preventDefault();
    const currentPassword = document.getElementById('credCurrentPassword').value;
    const newUsername = document.getElementById('credNewUsername').value.trim();
    const newPassword = document.getElementById('credNewPassword').value;
    const confirmPassword = document.getElementById('credConfirmPassword').value;

    if (!currentPassword) {
      this.toast('Please enter your current password', 'error');
      return;
    }
    if (!newUsername) {
      this.toast('Username cannot be empty', 'error');
      return;
    }
    if (newPassword && newPassword !== confirmPassword) {
      this.toast('New passwords do not match', 'error');
      return;
    }

    const submitBtn = document.getElementById('credSubmitBtn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving...';
    }

    try {
      const res = await fetch('/api/auth/credentials', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          newUsername,
          newPassword: newPassword || undefined
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update credentials');
      }

      this.closeCredentialsModal();
      this.toast('Credentials updated! Please log in with your new credentials.', 'success');
      
      // Immediately log out and redirect to login screen
      setTimeout(() => {
        this.handleAuthFailure('Credentials updated successfully. Please log in with your new credentials.');
      }, 500);
    } catch (err) {
      this.toast(err.message || 'Failed to update credentials', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save Changes';
      }
    }
  },

  escHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
