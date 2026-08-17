require('dotenv').config();

const express = require('express');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const jwt = require('jsonwebtoken');
const si = require('systeminformation');

const app = express();
const PORT = process.env.PORT || 3002;

// Auth Configuration from .env
const AUTH_USERNAME = process.env.AUTH_USERNAME || 'admin';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'admin123';
const JWT_SECRET = process.env.JWT_SECRET || 're_stream_jwt_secret_token_2026_super_secure';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 're_stream_jwt_refresh_secret_2026_super_secure';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Paths
const DATA_DIR = path.join(__dirname, 'data');
const PLAYLISTS_DIR = path.join(__dirname, 'playlists');
const LOGS_DIR = path.join(__dirname, 'logs');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const UPLOADS_VIDEOS_DIR = path.join(UPLOADS_DIR, 'videos');
const UPLOADS_AUDIOS_DIR = path.join(UPLOADS_DIR, 'audios');
const UPLOADS_THUMBS_DIR = path.join(UPLOADS_DIR, 'thumbnails');
const STREAMS_FILE = path.join(DATA_DIR, 'streams.json');
const CHANNELS_FILE = path.join(DATA_DIR, 'channels.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

// Ensure directories exist
[DATA_DIR, PLAYLISTS_DIR, LOGS_DIR, UPLOADS_DIR, UPLOADS_VIDEOS_DIR, UPLOADS_AUDIOS_DIR, UPLOADS_THUMBS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ============================================================
// Session & Token Management (No user DB needed, auth via .env)
// ============================================================
class SessionManager {
  constructor() {
    this.refreshTokens = new Set();
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(SESSIONS_FILE)) {
        const tokens = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
        this.refreshTokens = new Set(tokens);
      }
    } catch (_) {
      this.refreshTokens = new Set();
    }
  }

  _save() {
    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Array.from(this.refreshTokens), null, 2), 'utf-8');
    } catch (_) {}
  }

  addRefreshToken(token) {
    this.refreshTokens.add(token);
    this._save();
  }

  removeRefreshToken(token) {
    this.refreshTokens.delete(token);
    this._save();
  }

  hasRefreshToken(token) {
    return this.refreshTokens.has(token);
  }
}

const sessionManager = new SessionManager();

// Auth Middleware: Verify JWT Access Token
function authenticateToken(req, res, next) {
  let token = null;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. No token provided.', code: 'NO_TOKEN' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'Invalid or expired session token.', code: 'TOKEN_EXPIRED' });
    }
    req.user = decoded;
    next();
  });
}

// Helper: Cross-platform Path Normalizer (Linux / Windows compatible)
function normalizeFilePath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return '';
  let p = rawPath.trim();
  if (!p) return '';

  // If file exists directly
  if (fs.existsSync(p)) return path.resolve(p).replace(/\\/g, '/');

  // Check if contains 'uploads' folder (handles migration from Windows to Linux with hardcoded drive letters)
  const uploadsMatch = p.match(/(?:^|[\\/])uploads[\\/](.+)$/i);
  if (uploadsMatch && uploadsMatch[1]) {
    const sub = uploadsMatch[1].replace(/\\/g, '/');
    const localUploadsPath = path.join(UPLOADS_DIR, sub);
    if (fs.existsSync(localUploadsPath)) {
      return localUploadsPath.replace(/\\/g, '/');
    }
  }

  // Check relative to project root
  const relFromRoot = path.join(__dirname, p.replace(/^[\\/]+/, ''));
  if (fs.existsSync(relFromRoot)) {
    return relFromRoot.replace(/\\/g, '/');
  }

  return p.replace(/\\/g, '/');
}

// Helper: Safely and reliably delete file from disk across any path representation (filePath, url, thumbnail)
function safelyDeleteFile(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return false;
  let deleted = false;

  // 1. Try resolving via normalizeFilePath
  const resolved = normalizeFilePath(rawPath);
  if (resolved && fs.existsSync(resolved)) {
    try {
      const stat = fs.statSync(resolved);
      if (stat.isFile()) {
        fs.unlinkSync(resolved);
        console.log(`[File Delete] Deleted: ${resolved}`);
        deleted = true;
      }
    } catch (err) {
      console.error(`[File Delete Error] ${resolved}:`, err.message);
    }
  }

  // 2. Try resolving directly relative to project root
  if (rawPath.startsWith('/') || rawPath.startsWith('\\')) {
    const directRel = path.join(__dirname, rawPath.replace(/^[/\\]+/, ''));
    if (fs.existsSync(directRel)) {
      try {
        const stat = fs.statSync(directRel);
        if (stat.isFile()) {
          fs.unlinkSync(directRel);
          console.log(`[File Delete] Deleted relative: ${directRel}`);
          deleted = true;
        }
      } catch (err) {
        console.error(`[File Delete Error] ${directRel}:`, err.message);
      }
    }
  }

  // 3. Fallback: match filename in uploads folders
  const filename = path.basename(rawPath);
  if (filename && filename.includes('.')) {
    const candidateDirs = [UPLOADS_VIDEOS_DIR, UPLOADS_AUDIOS_DIR, UPLOADS_THUMBS_DIR, UPLOADS_DIR];
    for (const dir of candidateDirs) {
      const cand = path.join(dir, filename);
      if (fs.existsSync(cand)) {
        try {
          const stat = fs.statSync(cand);
          if (stat.isFile()) {
            fs.unlinkSync(cand);
            console.log(`[File Delete] Deleted candidate in ${dir}: ${cand}`);
            deleted = true;
          }
        } catch (_) {}
      }
    }
  }

  return deleted;
}

app.use('/uploads', express.static(UPLOADS_DIR));

// Configure fluent-ffmpeg and ffprobe binary paths (ENV > Local Bin > System PATH)
const envFfmpeg = process.env.FFMPEG_PATH;
const envFfprobe = process.env.FFPROBE_PATH;

const customFfmpegBin = path.join(__dirname, 'bin', os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const customFfprobeBin = path.join(__dirname, 'bin', os.platform() === 'win32' ? 'ffprobe.exe' : 'ffprobe');

if (envFfmpeg && fs.existsSync(envFfmpeg)) {
  ffmpeg.setFfmpegPath(envFfmpeg);
  console.log(`[FFmpeg] Using binary from ENV: ${envFfmpeg}`);
} else if (fs.existsSync(customFfmpegBin)) {
  ffmpeg.setFfmpegPath(customFfmpegBin);
  console.log(`[FFmpeg] Using local binary: ${customFfmpegBin}`);
}

if (envFfprobe && fs.existsSync(envFfprobe)) {
  ffmpeg.setFfprobePath(envFfprobe);
  console.log(`[FFprobe] Using binary from ENV: ${envFfprobe}`);
} else if (fs.existsSync(customFfprobeBin)) {
  ffmpeg.setFfprobePath(customFfprobeBin);
  console.log(`[FFprobe] Using local binary: ${customFfprobeBin}`);
}

// Multer Storage Configuration
const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_VIDEOS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const basename = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${basename}_${Date.now()}${ext}`);
  }
});

const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_AUDIOS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const basename = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${basename}_raw_${Date.now()}${ext}`);
  }
});

const uploadVideosMulter = multer({ storage: videoStorage });
const uploadAudiosMulter = multer({ storage: audioStorage });

// Helper: FFmpeg Audio Conversion to AAC
function convertAudioToAAC(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const safeInput = normalizeFilePath(inputPath);
    ffmpeg(safeInput)
      .outputOptions([
        '-y',
        '-map', '0:a:0',
        '-vn', '-sn', '-dn',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ar', '44100',
        '-ac', '2'
      ])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .run();
  });
}

function generateVideoThumbnail(videoPath, thumbPath) {
  return new Promise((resolve) => {
    const safeVideoPath = normalizeFilePath(videoPath);
    if (!safeVideoPath || !fs.existsSync(safeVideoPath)) return resolve(null);
    ffmpeg(safeVideoPath)
      .screenshots({
        timestamps: ['00:00:01'],
        filename: path.basename(thumbPath),
        folder: path.dirname(thumbPath),
        size: '320x180'
      })
      .on('end', () => resolve(thumbPath))
      .on('error', () => {
        // Fallback without size constraint if format fails
        ffmpeg(safeVideoPath)
          .screenshots({
            timestamps: ['00:00:01'],
            filename: path.basename(thumbPath),
            folder: path.dirname(thumbPath)
          })
          .on('end', () => resolve(thumbPath))
          .on('error', () => resolve(null));
      });
  });
}

function getMediaDuration(filePath) {
  return new Promise((resolve) => {
    const safePath = normalizeFilePath(filePath);
    if (!safePath || !fs.existsSync(safePath)) return resolve('0:00');
    ffmpeg.ffprobe(safePath, (err, metadata) => {
      if (err || !metadata || !metadata.format || !metadata.format.duration) {
        return resolve('0:00');
      }
      const durSec = Math.floor(metadata.format.duration);
      const m = Math.floor(durSec / 60);
      const s = durSec % 60;
      const formatted = `${m}:${String(s).padStart(2, '0')}`;
      resolve(formatted);
    });
  });
}

// ============================================================
// Channel Manager
// ============================================================

class ChannelStore {
  constructor() {
    this.channels = new Map();
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(CHANNELS_FILE)) {
        const list = JSON.parse(fs.readFileSync(CHANNELS_FILE, 'utf-8'));
        for (const c of list) {
          if (c.id) this.channels.set(c.id, c);
        }
      } else {
        this.channels.clear();
        this._save();
      }
    } catch (e) {
      console.error('Failed to load channels.json:', e.message);
    }
  }

  _save() {
    try {
      fs.writeFileSync(CHANNELS_FILE, JSON.stringify(Array.from(this.channels.values()), null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to save channels.json:', e.message);
    }
  }

  list() {
    return Array.from(this.channels.values());
  }

  get(id) {
    return this.channels.get(id) || null;
  }

  add({ name, description }) {
    const id = 'ch_' + Date.now().toString(36);
    const channel = {
      id,
      name: name || 'New Channel',
      description: description || 'No description provided',
      status: 'Active',
      url: '',
      videos: [],
      playlists: []
    };
    this.channels.set(id, channel);
    this._save();
    return channel;
  }

  update(id, fields) {
    const c = this.channels.get(id);
    if (!c) return null;
    Object.assign(c, fields);
    this._save();
    return c;
  }

  delete(id) {
    const channel = this.channels.get(id);
    if (!channel) return false;

    // Delete all video files and thumbnails from disk
    if (Array.isArray(channel.videos)) {
      for (const v of channel.videos) {
        if (v.filePath) safelyDeleteFile(v.filePath);
        if (v.url) safelyDeleteFile(v.url);
        if (v.thumbnail) safelyDeleteFile(v.thumbnail);
      }
    }

    // Delete all audio files from disk
    if (Array.isArray(channel.audios)) {
      for (const a of channel.audios) {
        if (a.filePath) safelyDeleteFile(a.filePath);
        if (a.url) safelyDeleteFile(a.url);
      }
    }

    const ok = this.channels.delete(id);
    if (ok) this._save();
    return ok;
  }

  addVideo(channelId, video) {
    const c = this.channels.get(channelId);
    if (!c) return null;
    if (!c.videos) c.videos = [];
    const newVideo = {
      id: 'v_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      title: video.title || 'Untitled Video',
      size: video.size || '0 MB',
      duration: video.duration || '0:00',
      url: video.url || '',
      filePath: video.filePath || ''
    };
    c.videos.push(newVideo);
    this._save();
    return newVideo;
  }

  addAudio(channelId, audio) {
    const c = this.channels.get(channelId);
    if (!c) return null;
    if (!c.audios) c.audios = [];
    const newAudio = {
      id: 'a_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      title: audio.title || 'Untitled Audio',
      size: audio.size || '0 MB',
      duration: audio.duration || '0:00',
      url: audio.url || '',
      filePath: audio.filePath || ''
    };
    c.audios.push(newAudio);
    this._save();
    return newAudio;
  }

  addPlaylist(channelId, { name, description, type, items }) {
    const c = this.channels.get(channelId);
    if (!c) return null;
    const isVideo = type === 'video';
    const field = isVideo ? 'videoPlaylists' : 'audioPlaylists';
    if (!c[field]) c[field] = [];

    // Start with 0 items unless user selected items
    const validItems = Array.isArray(items) ? items : [];

    const newPlaylist = {
      id: 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name: name || (isVideo ? 'Video Playlist' : 'Audio Playlist'),
      description: description || '',
      type: isVideo ? 'video' : 'audio',
      items: validItems,
      count: validItems.length,
      createdAt: Date.now()
    };
    c[field].push(newPlaylist);
    this._save();
    return newPlaylist;
  }

  updatePlaylist(channelId, playlistId, { name, description, items }) {
    const c = this.channels.get(channelId);
    if (!c) return null;
    let playlist = null;
    if (Array.isArray(c.audioPlaylists)) {
      playlist = c.audioPlaylists.find(p => p.id === playlistId);
    }
    if (!playlist && Array.isArray(c.videoPlaylists)) {
      playlist = c.videoPlaylists.find(p => p.id === playlistId);
    }
    if (!playlist) return null;

    if (name !== undefined) playlist.name = name;
    if (description !== undefined) playlist.description = description;
    if (Array.isArray(items)) {
      playlist.items = items;
      playlist.count = items.length;
    }
    this._save();
    return playlist;
  }

  deletePlaylist(channelId, playlistId) {
    const c = this.channels.get(channelId);
    if (!c) return false;
    let ok = false;
    if (Array.isArray(c.audioPlaylists)) {
      const idx = c.audioPlaylists.findIndex(p => p.id === playlistId);
      if (idx !== -1) {
        c.audioPlaylists.splice(idx, 1);
        ok = true;
      }
    }
    if (Array.isArray(c.videoPlaylists)) {
      const idx = c.videoPlaylists.findIndex(p => p.id === playlistId);
      if (idx !== -1) {
        c.videoPlaylists.splice(idx, 1);
        ok = true;
      }
    }
    if (ok) this._save();
    return ok;
  }

  async fixDurations() {
    let changed = false;
    for (const [, channel] of this.channels) {
      if (Array.isArray(channel.videos)) {
        for (const v of channel.videos) {
          const raw = v.filePath || (v.url ? path.join(__dirname, v.url.replace(/^\//, '')) : '');
          const resolved = normalizeFilePath(raw);
          if (resolved && resolved !== v.filePath) {
            v.filePath = resolved;
            changed = true;
          }
          if ((!v.duration || v.duration === '0:00') && v.filePath && fs.existsSync(v.filePath)) {
            v.duration = await getMediaDuration(v.filePath);
            changed = true;
          }
          if (!v.thumbnail && v.filePath && fs.existsSync(v.filePath)) {
            const thumbFilename = path.basename(v.filePath, path.extname(v.filePath)) + '.jpg';
            const thumbPath = path.join(UPLOADS_THUMBS_DIR, thumbFilename);
            await generateVideoThumbnail(v.filePath, thumbPath);
            if (fs.existsSync(thumbPath)) {
              v.thumbnail = `/uploads/thumbnails/${thumbFilename}`;
              changed = true;
            }
          }
        }
      }
      if (Array.isArray(channel.audios)) {
        for (const a of channel.audios) {
          const raw = a.filePath || (a.url ? path.join(__dirname, a.url.replace(/^\//, '')) : '');
          const resolved = normalizeFilePath(raw);
          if (resolved && resolved !== a.filePath) {
            a.filePath = resolved;
            changed = true;
          }
          if ((!a.duration || a.duration === '0:00') && a.filePath && fs.existsSync(a.filePath)) {
            a.duration = await getMediaDuration(a.filePath);
            changed = true;
          }
        }
      }
    }
    if (changed) {
      this._save();
      console.log('✔ Normalized media paths, durations, and video thumbnails for channel files');
    }
  }

  deleteVideo(channelId, videoId) {
    const c = this.channels.get(channelId);
    if (!c || !c.videos) return false;
    const idx = c.videos.findIndex(v => v.id === videoId);
    if (idx === -1) return false;
    const [removed] = c.videos.splice(idx, 1);

    // Also remove from any video playlists in this channel
    if (Array.isArray(c.videoPlaylists)) {
      for (const pl of c.videoPlaylists) {
        if (Array.isArray(pl.items)) {
          pl.items = pl.items.filter(id => id !== videoId);
          pl.count = pl.items.length;
        }
      }
    }
    this._save();

    // Delete physical video and thumbnail files from disk
    if (removed) {
      if (removed.filePath) safelyDeleteFile(removed.filePath);
      if (removed.url) safelyDeleteFile(removed.url);
      if (removed.thumbnail) safelyDeleteFile(removed.thumbnail);
    }
    return true;
  }

  deleteAudio(channelId, audioId) {
    const c = this.channels.get(channelId);
    if (!c || !c.audios) return false;
    const idx = c.audios.findIndex(a => a.id === audioId);
    if (idx === -1) return false;
    const [removed] = c.audios.splice(idx, 1);

    // Also remove from any audio playlists in this channel
    if (Array.isArray(c.audioPlaylists)) {
      for (const pl of c.audioPlaylists) {
        if (Array.isArray(pl.items)) {
          pl.items = pl.items.filter(id => id !== audioId);
          pl.count = pl.items.length;
        }
      }
    }
    this._save();

    // Delete physical audio file from disk
    if (removed) {
      if (removed.filePath) safelyDeleteFile(removed.filePath);
      if (removed.url) safelyDeleteFile(removed.url);
    }
    return true;
  }

  addStreamKey(channelId, keyData) {
    const c = this.channels.get(channelId);
    if (!c) return null;
    if (!c.streamKeys) c.streamKeys = [];
    const newKey = {
      id: 'k_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name: keyData.name || 'KEY' + (c.streamKeys.length + 1),
      key: keyData.key || '',
      createdAt: Date.now()
    };
    c.streamKeys.push(newKey);
    this._save();
    return newKey;
  }

  updateStreamKey(channelId, keyId, keyData) {
    const c = this.channels.get(channelId);
    if (!c || !c.streamKeys) return null;
    const item = c.streamKeys.find(k => k.id === keyId);
    if (!item) return null;
    if (keyData.name !== undefined) item.name = keyData.name;
    if (keyData.key !== undefined) item.key = keyData.key;
    this._save();
    return item;
  }

  deleteStreamKey(channelId, keyId) {
    const c = this.channels.get(channelId);
    if (!c || !c.streamKeys) return false;
    const idx = c.streamKeys.findIndex(k => k.id === keyId);
    if (idx === -1) return false;
    c.streamKeys.splice(idx, 1);
    this._save();
    return true;
  }
}

const channelStore = new ChannelStore();

// ============================================================
// Stream Manager
// ============================================================

class StreamManager {
  constructor() {
    this.streams = new Map();
    this.sseClients = new Map();
    this.globalSSEClients = [];
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(STREAMS_FILE)) {
        const raw = JSON.parse(fs.readFileSync(STREAMS_FILE, 'utf-8'));
        const list = Array.isArray(raw) ? raw : (raw.streams || []);
        for (const s of list) {
          if (!s.id) continue;
          this.streams.set(s.id, {
            id: s.id,
            name: s.name || '',
            channelName: s.channelName || 'Default Channel',
            thumbnail: s.thumbnail || '',
            streamKey: s.streamKey || '',
            videoPath: s.videoPath || '',
            audioPath: s.audioPath || '',
            videoMode: s.videoMode || 'single',
            audioMode: s.audioMode || 'shuffle',
            audioType: s.audioType || 'track',
            videoLoop1Hour: s.videoLoop1Hour === true,
            rtmpUrl: s.rtmpUrl || '',
            platform: s.platform || 'YouTube',
            type: s.type || (s.videoMode === 'playlist' ? 'Playlist' : 'Single'),
            status: 'idle',
            commandInstance: null,
            proc: null,
            startTime: null,
            retryCount: 0,
            pid: null,
            logs: [],
            _stopRequested: false,
          });
        }
      }
    } catch (e) {
      console.error('Failed to load streams.json:', e.message);
    }
  }

  _save() {
    try {
      const list = [];
      for (const [, s] of this.streams) {
        list.push({
          id: s.id,
          name: s.name,
          channelName: s.channelName,
          thumbnail: s.thumbnail,
          streamKey: s.streamKey,
          videoPath: s.videoPath,
          audioPath: s.audioPath,
          videoMode: s.videoMode,
          audioMode: s.audioMode,
          audioType: s.audioType,
          videoLoop1Hour: s.videoLoop1Hour === true,
          rtmpUrl: s.rtmpUrl,
          platform: s.platform,
          type: s.type,
        });
      }
      fs.writeFileSync(STREAMS_FILE, JSON.stringify(list, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to save streams.json:', e.message);
    }
  }

  list() {
    return Array.from(this.streams.values()).map(s => this._toPublic(s));
  }

  get(id) {
    const s = this.streams.get(id);
    return s ? this._toPublic(s) : null;
  }

  add(fields) {
    const id = this._genId();
    const isPlaylist = fields.videoMode === 'playlist' || fields.type === 'Playlist' || (fields.videoPath && fields.videoPath.startsWith('pl_'));
    const stream = {
      id,
      name: fields.name || `Stream ${id.slice(0, 6)}`,
      channelName: fields.channelName || 'Default Channel',
      thumbnail: fields.thumbnail || '',
      streamKey: fields.streamKey || '',
      videoPath: fields.videoPath || '',
      audioPath: fields.audioPath || '',
      videoMode: fields.videoMode || (isPlaylist ? 'playlist' : 'single'),
      audioMode: fields.audioMode || 'shuffle',
      audioType: fields.audioType || 'track',
      videoLoop1Hour: fields.videoLoop1Hour === true || fields.videoLoop1Hour === 'true',
      rtmpUrl: fields.rtmpUrl || '',
      platform: fields.platform || 'YouTube',
      type: isPlaylist ? 'Playlist' : 'Single',
      status: 'idle',
      commandInstance: null,
      proc: null,
      startTime: null,
      retryCount: 0,
      pid: null,
      logs: [],
      _stopRequested: false,
    };
    this.streams.set(id, stream);
    this._save();
    return this._toPublic(stream);
  }

  update(id, fields) {
    const s = this.streams.get(id);
    if (!s) return null;
    if (s.status !== 'idle') {
      return { error: 'Cannot edit while streaming. Stop first.' };
    }
    const allowed = ['name', 'channelName', 'thumbnail', 'streamKey', 'videoPath', 'audioPath', 'videoMode', 'audioMode', 'audioType', 'videoLoop1Hour', 'rtmpUrl', 'platform', 'type'];
    for (const k of allowed) {
      if (fields[k] !== undefined) s[k] = fields[k];
    }
    if (fields.videoMode === 'playlist' || fields.type === 'Playlist') {
      s.type = 'Playlist';
    } else if (fields.videoMode === 'single') {
      s.type = 'Single';
    }
    this._save();
    return this._toPublic(s);
  }

  remove(id) {
    const s = this.streams.get(id);
    if (!s) return false;
    if (s.status !== 'idle') this._stopInternal(s);
    this.streams.delete(id);
    this._save();
    try {
      const vp = path.join(PLAYLISTS_DIR, `video_${id}.txt`);
      const ap = path.join(PLAYLISTS_DIR, `audio_${id}.txt`);
      const lp = path.join(LOGS_DIR, `${id}.log`);
      if (fs.existsSync(vp)) fs.unlinkSync(vp);
      if (fs.existsSync(ap)) fs.unlinkSync(ap);
      if (fs.existsSync(lp)) fs.unlinkSync(lp);
    } catch (_) {}
    this._broadcastStatus();
    return true;
  }

  duplicate(id) {
    const s = this.streams.get(id);
    if (!s) return null;
    return this.add({
      ...s,
      name: `${s.name} (Copy)`,
      id: undefined,
    });
  }

  async start(id) {
    const s = this.streams.get(id);
    if (!s) return { error: 'Stream not found' };
    if (s.status !== 'idle') return { error: 'Already running' };
    if (!s.streamKey) return { error: 'Stream key is empty' };
    if (!s.videoPath) return { error: 'Video path is empty' };

    const videos = this._resolveFiles(s.videoPath, ['.mp4', '.avi', '.mkv', '.mov', '.flv', '.webm', '.ts']);
    if (videos.length === 0) return { error: `No video files found in: ${s.videoPath}` };

    let audios = [];
    if (s.audioPath) {
      audios = this._resolveFiles(s.audioPath, ['.mp3', '.aac', '.wav', '.m4a', '.ogg', '.flac']);
    }

    s.type = (videos.length > 1 || audios.length > 1) ? 'Concat' : 'Single';

    let rtmpUrl;
    if (s.rtmpUrl) {
      if (s.rtmpUrl.includes('?')) {
        const [baseUrl, query] = s.rtmpUrl.split('?');
        rtmpUrl = `${baseUrl.replace(/\/+$/, '')}/${s.streamKey}?${query}`;
      } else {
        rtmpUrl = `${s.rtmpUrl.replace(/\/+$/, '')}/${s.streamKey}`;
      }
    } else {
      rtmpUrl = `rtmp://a.rtmp.youtube.com/live2/${s.streamKey}`;
    }

    const videoPlaylist = await this._buildPlaylist(
      videos,
      s.videoMode,
      path.join(PLAYLISTS_DIR, `video_${s.id}.txt`),
      s.videoLoop1Hour === true
    );
    let audioPlaylist = null;
    if (audios.length > 0) {
      audioPlaylist = await this._buildPlaylist(
        audios,
        s.audioMode,
        path.join(PLAYLISTS_DIR, `audio_${s.id}.txt`),
        false
      );
    }

    s.status = 'live';
    s.startTime = Date.now();
    s.retryCount = 0;
    s._stopRequested = false;
    s.logs = [];

    this._log(s, `Streaming started. ${videos.length} video(s), ${audios.length} audio(s).`, 'success');
    this._streamingLoop(s, rtmpUrl, videoPlaylist, audioPlaylist, videos, audios);

    this._broadcastStatus();
    return this._toPublic(s);
  }

  stop(id) {
    const s = this.streams.get(id);
    if (!s) return { error: 'Stream not found' };
    if (s.status === 'idle') return { error: 'Not running' };
    this._stopInternal(s);
    this._log(s, 'Streaming stopped by user.', 'warning');
    this._broadcastStatus();
    return this._toPublic(s);
  }

  async startAll() {
    const results = [];
    for (const [id, s] of this.streams) {
      if (s.status === 'idle') {
        results.push(await this.start(id));
      }
    }
    return results;
  }

  stopAll() {
    const results = [];
    for (const [id, s] of this.streams) {
      if (s.status !== 'idle') {
        results.push(this.stop(id));
      }
    }
    return results;
  }

  addSSEClient(id, res) {
    if (!this.sseClients.has(id)) this.sseClients.set(id, []);
    this.sseClients.get(id).push(res);
    res.on('close', () => {
      const clients = this.sseClients.get(id) || [];
      this.sseClients.set(id, clients.filter(c => c !== res));
    });
    const s = this.streams.get(id);
    if (s) {
      const last50 = s.logs.slice(-50);
      for (const log of last50) {
        res.write(`data: ${JSON.stringify(log)}\n\n`);
      }
    }
  }

  addGlobalSSEClient(res) {
    this.globalSSEClients.push(res);
    res.on('close', () => {
      this.globalSSEClients = this.globalSSEClients.filter(c => c !== res);
    });
    res.write(`data: ${JSON.stringify({ type: 'status', streams: this.list() })}\n\n`);
  }

  getLogs(id, last = 100) {
    const s = this.streams.get(id);
    if (!s) return [];
    return s.logs.slice(-last);
  }

  _stopInternal(s) {
    s._stopRequested = true;
    if (s.commandInstance) {
      try { s.commandInstance.kill('SIGKILL'); } catch (_) {}
      s.commandInstance = null;
    }
    if (s.proc) {
      try {
        if (os.platform() === 'win32') {
          spawn('taskkill', ['/pid', String(s.proc.pid), '/f', '/t'], { stdio: 'ignore' });
        } else {
          s.proc.kill('SIGKILL');
        }
      } catch (_) {}
      s.proc = null;
    }
    s.status = 'idle';
    s.startTime = null;
    s.retryCount = 0;
    s.pid = null;
  }

  async _streamingLoop(s, rtmpUrl, videoPlaylist, audioPlaylist, videos, audios) {
    while (!s._stopRequested) {
      try {
        if (s.retryCount > 0) {
          await this._buildPlaylist(videos, s.videoMode, videoPlaylist, s.videoLoop1Hour === true);
          if (audios.length > 0) {
            await this._buildPlaylist(audios, s.audioMode, audioPlaylist, false);
          }
          this._log(s, `Playlist rebuilt (${s.videoMode}, 1H loop: ${s.videoLoop1Hour ? 'yes' : 'no'}): ${videos.length} video(s)`, 'info');
        }

        const isVideoPlaylistMode = (videos.length > 1 || s.videoMode === 'playlist' || (s.videoPath && s.videoPath.startsWith('pl_')));
        const isAudioPlaylistMode = (audios.length > 1 || s.audioType === 'playlist' || (s.audioPath && (s.audioPath.startsWith('pl_') || s.audioPath.includes(','))));

        let command = ffmpeg();

        if (isVideoPlaylistMode) {
          command.input(videoPlaylist)
            .inputOptions([
              '-hwaccel', 'auto',
              '-loglevel', 'info',
              '-fflags', '+genpts+igndts',
              '-avoid_negative_ts', 'make_zero',
              '-f', 'concat',
              '-safe', '0',
              '-stream_loop', '-1'
            ]);
        } else {
          command.input(videos[0])
            .inputOptions([
              '-hwaccel', 'auto',
              '-loglevel', 'info',
              '-fflags', '+genpts+igndts',
              '-avoid_negative_ts', 'make_zero',
              '-stream_loop', '-1'
            ]);
        }

        if (audios.length > 0) {
          if (isAudioPlaylistMode) {
            command.input(audioPlaylist)
              .inputOptions(['-re', '-f', 'concat', '-safe', '0', '-stream_loop', '-1']);
          } else {
            command.input(audios[0])
              .inputOptions(['-re', '-stream_loop', '-1']);
          }
          command.outputOptions(['-map', '0:v:0', '-map', '1:a:0']);
        } else {
          command.outputOptions(['-map', '0:v:0', '-map', '0:a:0']);
        }

        command.outputOptions([
          '-c:v', 'copy',
          '-c:a', 'copy',
          '-max_muxing_queue_size', '4096',
          '-f', 'flv',
          '-flvflags', 'no_duration_filesize'
        ]);

        command.output(rtmpUrl);

        let lastProgress = 0;
        command
          .on('start', (commandLine) => {
            this._log(s, `fluent-ffmpeg launched: ${commandLine}`, 'info');
          })
          .on('progress', (progress) => {
            const now = Date.now();
            if (now - lastProgress >= 10000) {
              this._log(s, `frame=${progress.frames || 0} fps=${progress.currentFps || 0} time=${progress.timemark || '00:00:00'} kbps=${progress.currentKbps || 0}`, 'info');
              lastProgress = now;
            }
          })
          .on('stderr', (stderrLine) => {
            if (!stderrLine.trim()) return;
            const ll = stderrLine.toLowerCase();
            if (ll.includes('error') || ll.includes('failed')) {
              this._log(s, stderrLine.trim(), 'error');
            } else if (ll.includes('warning') || ll.includes('warn')) {
              this._log(s, stderrLine.trim(), 'warning');
            }
          });

        const proc = command.run();
        s.commandInstance = command;
        s.proc = proc;
        if (proc && proc.pid) {
          s.pid = proc.pid;
          this._log(s, `FFmpeg running via fluent-ffmpeg (PID ${proc.pid})`, 'success');
        }
        s.status = 'live';
        this._broadcastStatus();

        const exitCode = await new Promise((resolve) => {
          command.on('end', () => resolve(0));
          command.on('error', (err) => {
            this._log(s, `FFmpeg error: ${err.message}`, 'error');
            resolve(-1);
          });
        });

        if (s._stopRequested) return;

        const elapsed = s.startTime ? (Date.now() - s.startTime) / 1000 : 0;
        if (elapsed > 30) s.retryCount = 0;
        s.retryCount++;
        s.status = 'retrying';
        s.proc = null;
        s.pid = null;

        const delay = Math.min(30, s.retryCount * 5);
        this._log(s, `FFmpeg exited (code ${exitCode}). Retrying in ${delay}s...`, 'error');
        this._broadcastStatus();

        await new Promise((resolve) => {
          const timer = setTimeout(resolve, delay * 1000);
          const checkStop = setInterval(() => {
            if (s._stopRequested) {
              clearTimeout(timer);
              clearInterval(checkStop);
              resolve();
            }
          }, 500);
        });

        if (s._stopRequested) return;
        s.startTime = Date.now();

      } catch (err) {
        this._log(s, `Error: ${err.message}`, 'error');
        if (s._stopRequested) return;
        s.retryCount++;
        const delay = Math.min(30, s.retryCount * 5);
        await new Promise(r => setTimeout(r, delay * 1000));
        if (s._stopRequested) return;
      }
    }
  }

  _resolveFiles(filePath, extensions, channelName = '') {
    if (!filePath) return [];

    // Check if filePath is a playlist ID (e.g. pl_xxx)
    if (filePath.startsWith('pl_') || (!filePath.includes('/') && !filePath.includes('\\') && !filePath.includes('.'))) {
      for (const [, channel] of channelStore.channels) {
        if (channelName && channel.name !== channelName && channel.id !== channelName) continue;
        const pl = [...(channel.videoPlaylists || []), ...(channel.audioPlaylists || [])].find(p => p.id === filePath);
        if (pl && Array.isArray(pl.items) && pl.items.length > 0) {
          const allMedia = [...(channel.videos || []), ...(channel.audios || [])];
          const resolvedPaths = [];
          for (const itemId of pl.items) {
            const media = allMedia.find(m => m.id === itemId);
            if (media) {
              const fullPath = normalizeFilePath(media.filePath || media.url || '');
              if (fullPath && fs.existsSync(fullPath)) {
                resolvedPaths.push(fullPath);
              }
            }
          }
          if (resolvedPaths.length > 0) return resolvedPaths;
        }
      }
    }

    const candidates = filePath.includes(',')
      ? filePath.split(',').map(f => f.trim()).filter(Boolean)
      : [filePath.trim()];

    const resolved = [];
    for (const raw of candidates) {
      const p = normalizeFilePath(raw);
      try {
        if (fs.existsSync(p)) {
          const stat = fs.statSync(p);
          if (stat.isFile()) {
            resolved.push(p);
          } else if (stat.isDirectory()) {
            const dirFiles = fs.readdirSync(p)
              .filter(f => extensions.some(ext => f.toLowerCase().endsWith(ext)))
              .map(f => path.join(p, f).replace(/\\/g, '/'))
              .sort();
            resolved.push(...dirFiles);
          }
        }
      } catch (_) {}
    }
    return resolved;
  }

  async _buildPlaylist(files, mode, outputPath, loop1Hour = false) {
    let ordered = [...files];
    if (mode === 'shuffle') {
      for (let i = ordered.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
      }
    }

    const lines = [];
    for (const f of ordered) {
      const sanitized = f.replace(/\\/g, '/').replace(/'/g, "'\\''");
      if (loop1Hour) {
        const durFormatted = await getMediaDuration(f);
        const parts = durFormatted.split(':').map(Number);
        let sec = (parts.length === 2) ? (parts[0] * 60 + parts[1]) : 5;
        if (sec <= 0) sec = 5;
        const repeats = Math.max(1, Math.ceil(3600 / sec));
        for (let r = 0; r < repeats; r++) {
          lines.push(`file '${sanitized}'`);
        }
      } else {
        lines.push(`file '${sanitized}'`);
      }
    }

    fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
    return outputPath;
  }

  _log(s, message, level = 'info') {
    const timestamp = new Date().toLocaleTimeString('en-GB', { hour12: false });
    const logEntry = { timestamp, level, message };
    s.logs.push(logEntry);
    if (s.logs.length > 500) s.logs = s.logs.slice(-400);

    try {
      const logFile = path.join(LOGS_DIR, `${s.id}.log`);
      fs.appendFileSync(logFile, `${timestamp}|${level}|${message}\n`, 'utf-8');
    } catch (_) {}

    const clients = this.sseClients.get(s.id) || [];
    const data = JSON.stringify(logEntry);
    for (const client of clients) {
      try { client.write(`data: ${data}\n\n`); } catch (_) {}
    }

    console.log(`[${s.name || s.id.slice(0, 8)}] ${message}`);
  }

  _broadcastStatus() {
    const data = JSON.stringify({ type: 'status', streams: this.list() });
    for (const client of this.globalSSEClients) {
      try { client.write(`data: ${data}\n\n`); } catch (_) {}
    }
  }

  _broadcastSystemStats(stats) {
    if (!stats || this.globalSSEClients.size === 0) return;
    const data = JSON.stringify({ type: 'system_stats', stats });
    for (const client of this.globalSSEClients) {
      try { client.write(`data: ${data}\n\n`); } catch (_) {}
    }
  }

  _toPublic(s) {
    return {
      id: s.id,
      name: s.name,
      channelName: s.channelName,
      thumbnail: s.thumbnail,
      streamKey: s.streamKey,
      streamKeyMasked: this._maskKey(s.streamKey),
      videoPath: s.videoPath,
      audioPath: s.audioPath,
      videoMode: s.videoMode,
      audioMode: s.audioMode,
      audioType: s.audioType || 'track',
      videoLoop1Hour: s.videoLoop1Hour === true,
      rtmpUrl: s.rtmpUrl,
      platform: s.platform,
      type: s.type,
      status: s.status,
      startTime: s.startTime,
      retryCount: s.retryCount,
      pid: s.pid,
    };
  }

  _maskKey(key) {
    if (!key) return '';
    if (key.length <= 8) return key.slice(0, 2) + '***' + key.slice(-2);
    return key.slice(0, 4) + '...' + key.slice(-4);
  }

  _genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
}

const manager = new StreamManager();

// ============================================================
// API Routes: AUTHENTICATION (Direct comparison with .env)
// ============================================================

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const validUsername = process.env.AUTH_USERNAME || 'admin';
  const validPassword = process.env.AUTH_PASSWORD || 'admin123';

  // Direct comparison with .env without hashing
  if (username !== validUsername || password !== validPassword) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const payload = { username: validUsername, role: 'admin' };
  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: '7d' });

  sessionManager.addRefreshToken(refreshToken);

  res.json({
    success: true,
    accessToken,
    refreshToken,
    user: { username: validUsername, role: 'admin' }
  });
});

// POST /api/auth/refresh
app.post('/api/auth/refresh', (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token is required' });
  }

  jwt.verify(refreshToken, JWT_REFRESH_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'Invalid or expired refresh token. Please log in again.' });
    }

    if (!sessionManager.hasRefreshToken(refreshToken)) {
      return res.status(401).json({ error: 'Refresh token revoked or invalid.' });
    }

    const payload = { username: decoded.username || process.env.AUTH_USERNAME || 'admin', role: 'admin' };
    const newAccessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' });

    res.json({
      success: true,
      accessToken: newAccessToken
    });
  });
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    sessionManager.removeRefreshToken(refreshToken);
  }
  res.json({ success: true, message: 'Logged out successfully' });
});

// Helper to persist credentials in .env
function updateEnvCredentials(username, password) {
  try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      let content = fs.readFileSync(envPath, 'utf-8');
      if (content.includes('AUTH_USERNAME=')) {
        content = content.replace(/^AUTH_USERNAME=.*$/m, `AUTH_USERNAME=${username}`);
      } else {
        content += `\nAUTH_USERNAME=${username}`;
      }
      if (content.includes('AUTH_PASSWORD=')) {
        content = content.replace(/^AUTH_PASSWORD=.*$/m, `AUTH_PASSWORD=${password}`);
      } else {
        content += `\nAUTH_PASSWORD=${password}`;
      }
      fs.writeFileSync(envPath, content, 'utf-8');
    }
  } catch (err) {
    console.error('Failed to write .env:', err);
  }
}

// GET /api/auth/me
app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({
    user: { username: req.user.username || process.env.AUTH_USERNAME || 'admin', role: req.user.role || 'admin' }
  });
});

// PUT /api/auth/credentials
app.put('/api/auth/credentials', authenticateToken, (req, res) => {
  const { currentPassword, newUsername, newPassword } = req.body;
  const currentEnvPassword = process.env.AUTH_PASSWORD || 'admin123';
  const currentEnvUsername = process.env.AUTH_USERNAME || 'admin';

  if (!currentPassword || currentPassword !== currentEnvPassword) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }

  const updatedUsername = (newUsername && newUsername.trim()) ? newUsername.trim() : currentEnvUsername;
  const updatedPassword = (newPassword && newPassword.trim()) ? newPassword.trim() : currentEnvPassword;

  process.env.AUTH_USERNAME = updatedUsername;
  process.env.AUTH_PASSWORD = updatedPassword;
  updateEnvCredentials(updatedUsername, updatedPassword);

  sessionManager.refreshTokens.clear();
  sessionManager._save();

  res.json({
    success: true,
    message: 'Credentials updated successfully'
  });
});

// ============================================================
// API Security Middleware: Protect all subsequent /api/* endpoints
// ============================================================
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth')) {
    return next();
  }
  authenticateToken(req, res, next);
});

// ============================================================
// API Routes: STREAMS
// ============================================================

app.get('/api/streams', (req, res) => {
  res.json(manager.list());
});

app.get('/api/streams/:id', (req, res) => {
  const s = manager.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json(s);
});

app.post('/api/streams', (req, res) => {
  const s = manager.add(req.body);
  res.status(201).json(s);
});

app.post('/api/streams/:id/duplicate', (req, res) => {
  const s = manager.duplicate(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.status(201).json(s);
});

app.put('/api/streams/:id', (req, res) => {
  const result = manager.update(req.params.id, req.body);
  if (!result) return res.status(404).json({ error: 'Not found' });
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.delete('/api/streams/:id', (req, res) => {
  const ok = manager.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

app.post('/api/streams/:id/start', async (req, res) => {
  const result = await manager.start(req.params.id);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/streams/:id/stop', (req, res) => {
  const result = manager.stop(req.params.id);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/streams/start-all', async (req, res) => {
  res.json(await manager.startAll());
});

app.post('/api/streams/stop-all', (req, res) => {
  res.json(manager.stopAll());
});

app.get('/api/streams/:id/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  manager.addSSEClient(req.params.id, res);
});

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  manager.addGlobalSSEClient(res);
});

// GET /api/system/stats
app.get('/api/system/stats', async (req, res) => {
  const stats = await getSystemMetrics();
  res.json(stats || {});
});

// ============================================================
// API Routes: CHANNELS
// ============================================================

app.get('/api/channels', (req, res) => {
  res.json(channelStore.list());
});

app.get('/api/channels/:id', (req, res) => {
  const c = channelStore.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Channel not found' });
  res.json(c);
});

app.post('/api/channels', (req, res) => {
  const c = channelStore.add(req.body);
  res.status(201).json(c);
});

app.put('/api/channels/:id', (req, res) => {
  const c = channelStore.update(req.params.id, req.body);
  if (!c) return res.status(404).json({ error: 'Channel not found' });
  res.json(c);
});

app.delete('/api/channels/:id', (req, res) => {
  const channel = channelStore.get(req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  const channelName = channel.name;

  // Validation 1: Check if any stream in this channel is currently LIVE or RETRYING
  const streams = Array.from(manager.streams.values());
  const activeStreams = streams.filter(s => s.channelName === channelName && s.status !== 'idle');
  if (activeStreams.length > 0) {
    return res.status(400).json({
      error: `Cannot delete channel "${channelName}" while stream "${activeStreams[0].name}" is currently ${activeStreams[0].status.toUpperCase()}. Please Stop all streams first.`
    });
  }

  // Delete all idle streams associated with this channel
  const streamsToDelete = streams.filter(s => s.channelName === channelName);
  for (const s of streamsToDelete) {
    manager.remove(s.id);
  }

  // Delete channel and all its video/audio files from disk
  const ok = channelStore.delete(req.params.id);
  if (!ok) return res.status(500).json({ error: 'Failed to delete channel' });

  manager._save();
  manager._broadcastStatus();

  res.json({ success: true, message: `Channel "${channelName}", its files, and associated streams deleted successfully.` });
});

app.post('/api/channels/:id/videos', (req, res) => {
  const v = channelStore.addVideo(req.params.id, req.body);
  if (!v) return res.status(404).json({ error: 'Channel not found' });
  res.status(201).json(v);
});

app.delete('/api/channels/:id/videos/:videoId', (req, res) => {
  const ok = channelStore.deleteVideo(req.params.id, req.params.videoId);
  if (!ok) return res.status(404).json({ error: 'Video not found' });
  res.json({ success: true });
});

app.delete('/api/channels/:id/audios/:audioId', (req, res) => {
  const ok = channelStore.deleteAudio(req.params.id, req.params.audioId);
  if (!ok) return res.status(404).json({ error: 'Audio not found' });
  res.json({ success: true });
});

// Stream Keys API
app.get('/api/channels/:id/keys', (req, res) => {
  const c = channelStore.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Channel not found' });
  const keys = c.streamKeys || [];
  const streams = Array.from(manager.streams.values());
  const enriched = keys.map(k => {
    const usedStream = streams.find(s => s.streamKey === k.key);
    let status = 'Not Use';
    let streamUse = '-';
    if (usedStream) {
      status = usedStream.status === 'live' ? 'Live' : 'Idle';
      streamUse = usedStream.name || '-';
    }
    return {
      ...k,
      status,
      streamUse
    };
  });
  res.json(enriched);
});

app.post('/api/channels/:id/keys', (req, res) => {
  const k = channelStore.addStreamKey(req.params.id, req.body);
  if (!k) return res.status(404).json({ error: 'Channel not found' });
  res.status(201).json(k);
});

app.put('/api/channels/:id/keys/:keyId', (req, res) => {
  const k = channelStore.updateStreamKey(req.params.id, req.params.keyId, req.body);
  if (!k) return res.status(404).json({ error: 'Key not found' });
  res.json(k);
});

app.delete('/api/channels/:id/keys/:keyId', (req, res) => {
  const ok = channelStore.deleteStreamKey(req.params.id, req.params.keyId);
  if (!ok) return res.status(404).json({ error: 'Key not found' });
  res.json({ success: true });
});

// Playlists API
app.post('/api/channels/:id/playlists', (req, res) => {
  const pl = channelStore.addPlaylist(req.params.id, req.body);
  if (!pl) return res.status(404).json({ error: 'Channel not found' });
  res.status(201).json(pl);
});

app.put('/api/channels/:id/playlists/:playlistId', (req, res) => {
  const pl = channelStore.updatePlaylist(req.params.id, req.params.playlistId, req.body);
  if (!pl) return res.status(404).json({ error: 'Playlist not found' });
  res.json(pl);
});

app.delete('/api/channels/:id/playlists/:playlistId', (req, res) => {
  const ok = channelStore.deletePlaylist(req.params.id, req.params.playlistId);
  if (!ok) return res.status(404).json({ error: 'Playlist not found' });
  res.json({ success: true });
});

app.post('/api/channels/:id/upload-videos', uploadVideosMulter.array('videos'), async (req, res) => {
  const channelId = req.params.id;
  const channel = channelStore.get(channelId);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No video files uploaded' });
  }

  const added = [];
  for (const file of req.files) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
    const webUrl = `/uploads/videos/${file.filename}`;
    const fullPath = file.path.replace(/\\/g, '/');
    const duration = await getMediaDuration(file.path);

    const thumbFilename = path.basename(file.filename, path.extname(file.filename)) + '.jpg';
    const thumbPath = path.join(UPLOADS_THUMBS_DIR, thumbFilename);
    await generateVideoThumbnail(file.path, thumbPath);
    const thumbWebUrl = fs.existsSync(thumbPath) ? `/uploads/thumbnails/${thumbFilename}` : '';

    const videoItem = channelStore.addVideo(channelId, {
      title: file.originalname,
      size: sizeMb,
      duration: duration,
      thumbnail: thumbWebUrl,
      url: webUrl,
      filePath: fullPath
    });
    added.push(videoItem);
  }

  res.status(201).json({ success: true, count: added.length, videos: added });
});

app.post('/api/channels/:id/upload-audios', uploadAudiosMulter.array('audios'), async (req, res) => {
  const channelId = req.params.id;
  const channel = channelStore.get(channelId);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No audio files uploaded' });
  }

  const added = [];
  for (const file of req.files) {
    const rawPath = file.path;
    const aacFilename = path.basename(file.filename, path.extname(file.filename)) + '.aac';
    const aacPath = path.join(UPLOADS_AUDIOS_DIR, aacFilename);

    try {
      // Auto convert to standard 192k AAC 44.1kHz
      await convertAudioToAAC(rawPath, aacPath);
      // Remove raw file after successful conversion
      try { if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath); } catch (_) {}

      const stat = fs.statSync(aacPath);
      const sizeMb = (stat.size / (1024 * 1024)).toFixed(2) + ' MB';
      const webUrl = `/uploads/audios/${aacFilename}`;
      const fullPath = aacPath.replace(/\\/g, '/');
      const duration = await getMediaDuration(aacPath);

      const audioItem = channelStore.addAudio(channelId, {
        title: file.originalname.replace(/\.[^/.]+$/, "") + '.aac',
        size: sizeMb,
        duration: duration,
        url: webUrl,
        filePath: fullPath
      });
      added.push(audioItem);
    } catch (err) {
      console.error(`Audio conversion failed for ${file.originalname}:`, err.message);
      // Fallback if conversion fails
      const sizeMb = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
      const webUrl = `/uploads/audios/${file.filename}`;
      const fullPath = file.path.replace(/\\/g, '/');
      const duration = await getMediaDuration(rawPath);
      const audioItem = channelStore.addAudio(channelId, {
        title: file.originalname,
        size: sizeMb,
        duration: duration,
        url: webUrl,
        filePath: fullPath
      });
      added.push(audioItem);
    }
  }

  res.status(201).json({ success: true, count: added.length, audios: added });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// System Metrics Helper
let cachedSystemMetrics = null;
async function getSystemMetrics() {
  try {
    const [cpu, mem, fsSize, netStats] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.networkStats()
    ]);

    const cpuPercent = Math.min(100, Math.max(0, Math.round(cpu.currentLoad || 0)));
    const memUsedGb = ((mem.active || (mem.total - mem.available)) / (1024 ** 3)).toFixed(1);
    const memTotalGb = (mem.total / (1024 ** 3)).toFixed(1);
    const memPercent = Math.min(100, Math.max(0, Math.round(((mem.active || (mem.total - mem.available)) / mem.total) * 100)));

    const disk = (Array.isArray(fsSize) && (
      fsSize.find(d => d.mount === '/' || d.mount === '/home') ||
      fsSize.find(d => d.mount === 'C:' || d.mount === 'D:') ||
      fsSize.find(d => __dirname.startsWith(d.mount)) ||
      fsSize[0]
    )) || {};
    const diskUsedGb = ((disk.used || 0) / (1024 ** 3)).toFixed(1);
    const diskTotalGb = ((disk.size || 0) / (1024 ** 3)).toFixed(1);
    const diskPercent = Math.min(100, Math.max(0, Math.round(disk.use || 0)));

    let txSec = 0;
    let rxSec = 0;
    if (Array.isArray(netStats)) {
      netStats.forEach(n => {
        txSec += Math.max(0, n.tx_sec || 0);
        rxSec += Math.max(0, n.rx_sec || 0);
      });
    }

    const uploadSpeed = txSec > 1024 * 1024 ? (txSec / (1024 * 1024)).toFixed(1) + ' MB/s' : (txSec / 1024).toFixed(0) + ' KB/s';
    const downloadSpeed = rxSec > 1024 * 1024 ? (rxSec / (1024 * 1024)).toFixed(1) + ' MB/s' : (rxSec / 1024).toFixed(0) + ' KB/s';

    const uploadPercent = Math.min(100, Math.max(1, Math.round((txSec / (1024 * 1024 * 10)) * 100)));
    const downloadPercent = Math.min(100, Math.max(1, Math.round((rxSec / (1024 * 1024 * 10)) * 100)));

    cachedSystemMetrics = {
      cpu: { percent: cpuPercent, cores: cpu.cpus ? cpu.cpus.length : os.cpus().length },
      memory: { percent: memPercent, usedGb: memUsedGb, totalGb: memTotalGb },
      disk: { percent: diskPercent, usedGb: diskUsedGb, totalGb: diskTotalGb, drive: disk.fs || disk.mount || 'Drive' },
      network: { upload: uploadSpeed, download: downloadSpeed, uploadPercent, downloadPercent, txSec, rxSec }
    };
    return cachedSystemMetrics;
  } catch (err) {
    return cachedSystemMetrics || {
      cpu: { percent: 0, cores: os.cpus().length },
      memory: { percent: 0, usedGb: '0.0', totalGb: (os.totalmem() / (1024 ** 3)).toFixed(1) },
      disk: { percent: 0, usedGb: '0.0', totalGb: '0.0', drive: 'Disk' },
      network: { upload: '0 KB/s', download: '0 KB/s', uploadPercent: 0, downloadPercent: 0 }
    };
  }
}

// Global Error Handling Middleware (including Multer & client request aborts)
app.use((err, req, res, next) => {
  if (err) {
    if (err.message === 'Request aborted' || err.code === 'ECONNABORTED' || req.aborted) {
      console.warn(`[Upload Warning] Request aborted by client: ${req.originalUrl}`);
      if (!res.headersSent) {
        return res.status(499).json({ error: 'Client aborted upload request' });
      }
      return;
    }
    if (err instanceof multer.MulterError) {
      console.warn(`[Multer Error] ${err.code}: ${err.message}`);
      if (!res.headersSent) {
        return res.status(400).json({ error: `Upload error: ${err.message}` });
      }
      return;
    }
    console.error('[Unhandled Server Error]', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  }
  next();
});

// Start Server
app.listen(PORT, async () => {
  console.log(`\n  ╔══════════════════════════════════════════╗`);
  console.log(`  ║   RE Stream — Live Streaming Server      ║`);
  console.log(`  ║   http://localhost:${PORT}                  ║`);
  console.log(`  ╚══════════════════════════════════════════╝\n`);
  await channelStore.fixDurations();

  // Periodic System Stats Broadcast every 2.5 seconds
  setInterval(async () => {
    try {
      const stats = await getSystemMetrics();
      manager._broadcastSystemStats(stats);
    } catch (_) {}
  }, 2500);
});
