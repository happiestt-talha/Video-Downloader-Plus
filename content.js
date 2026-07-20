//video-downloader-plus/content.js
// content.js – with video count, robust detection, lazy loading, cache, and proper filenames
if (!window.__videoDownloaderInjected) {
    window.__videoDownloaderInjected = true;
    (function () {
        let sidebar = null;
        let currentVideos = [];
        let isSidebarOpen = false;

// Cache for formats
if (!window.formatCache) window.formatCache = {};

// Update video count in header
function updateVideoCount(count) {
    const countSpan = document.getElementById('video-count');
    if (countSpan) countSpan.textContent = `${count} video${count !== 1 ? 's' : ''}`;
}

// Create sidebar DOM with count badge
function createSidebar() {
    if (sidebar) return sidebar;

    const div = document.createElement('div');
    div.id = 'video-downloader-sidebar';
    div.innerHTML = `
    <div class="sidebar-header">
      <div style="display: flex; align-items: center; gap: 8px;">
        <h3 style="margin: 0;">📥 Video Downloader</h3>
        <span id="video-count" style="font-size: 12px; background: #3b82f6; padding: 2px 6px; border-radius: 12px;">0</span>
      </div>
      <div style="display: flex; gap: 8px;">
        <button id="refresh-videos" style="background: none; border: 1px solid #3a3a3a; color: #e0e0e0; border-radius: 4px; padding: 2px 8px; cursor: pointer;">🔄 Refresh</button>
        <button id="close-sidebar" style="background: none; border: none; color: #e0e0e0; font-size: 24px; cursor: pointer; padding: 0 8px;">×</button>
      </div>
    </div>
    <div class="sidebar-controls">
      <input type="text" id="video-search" placeholder="Filter videos..." />
      <div class="filter-buttons">
        <button data-filter="all" class="filter-active">All</button>
        <button data-filter="video">Videos</button>
        <button data-filter="audio">Audio</button>
      </div>
    </div>
    <div class="videos-list" id="videos-list">
      <div class="loading">Detecting videos...</div>
    </div>
    <div class="sidebar-footer">
      <small>Powered by yt-dlp + ffmpeg</small>
    </div>
  `;

    document.body.appendChild(div);

    div.querySelector('#close-sidebar').addEventListener('click', () => {
        div.remove();
        sidebar = null;
        isSidebarOpen = false;
    });

    div.querySelector('#refresh-videos').addEventListener('click', async () => {
        console.log('[Video Downloader] Manual refresh');
        if (isYouTube()) {
            currentVideos = detectVideos();
        } else {
            currentVideos = await detectVideosGeneric();
        }
        updateVideoCount(currentVideos.length);
        renderVideos(currentVideos, div.querySelector('#video-search').value,
            div.querySelector('.filter-buttons button.filter-active').dataset.filter);
    });

    div.querySelector('#video-search').addEventListener('input', (e) => {
        renderVideos(currentVideos, e.target.value);
    });

    div.querySelectorAll('.filter-buttons button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            div.querySelectorAll('.filter-buttons button').forEach(b => b.classList.remove('filter-active'));
            btn.classList.add('filter-active');
            renderVideos(currentVideos, div.querySelector('#video-search').value, btn.dataset.filter);
        });
    });

    sidebar = div;
    isSidebarOpen = true;
    return div;
}

// Sanitize filename (remove invalid characters)
function sanitizeFilename(title) {
    if (!title) return 'video';
    return title.replace(/[\\/*?:"<>|]/g, '').trim().substring(0, 200);
}

// Robust video detection
function detectVideos() {
    const videos = [];
    const currentUrl = window.location.href;
    const currentVideoId = currentUrl.includes('/watch') ? new URLSearchParams(window.location.search).get('v') : null;

    function addVideo(id, title, thumbnail, duration, isCurrent = false) {
        if (!id) return;
        if (!videos.some(v => v.id === id)) {
            videos.push({
                id: id,
                title: title || 'Unknown Title',
                thumbnail: thumbnail || `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
                duration: duration || '',
                type: 'video',
                isCurrent: isCurrent
            });
        }
    }

    // Current video
    if (currentVideoId) {
        const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, h1.title yt-formatted-string, #title h1');
        const title = titleEl ? titleEl.textContent.trim() : 'Current Video';
        addVideo(currentVideoId, title, null, getVideoDuration(), true);
    }

    // Scan all watch links
    const watchLinks = document.querySelectorAll('a[href*="/watch"]');
    console.log(`[Video Downloader] Found ${watchLinks.length} watch links`);
    watchLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (!href) return;
        const params = new URLSearchParams(href.split('?')[1]);
        const videoId = params.get('v');
        if (!videoId || videoId === currentVideoId) return;

        let title = '';
        let thumbnail = '';
        let duration = '';
        let container = link.closest('ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-playlist-video-renderer, #dismissible, .ytd-video-renderer');
        if (container) {
            const titleEl = container.querySelector('#video-title, #title, yt-formatted-string#title, h3 a, a#video-title');
            if (titleEl) title = titleEl.textContent.trim();
            const thumbEl = container.querySelector('img#img, yt-image img, #thumbnail img, .ytd-thumbnail img');
            if (thumbEl) thumbnail = thumbEl.src;
            const durationEl = container.querySelector('#badge, #text, span.ytd-thumbnail-overlay-time-status-renderer, .badge-shape-wiz__text');
            if (durationEl) duration = durationEl.textContent.trim();
        }
        if (!title && link.textContent.trim()) title = link.textContent.trim();
        if (!title) title = 'Video';
        if (thumbnail && thumbnail.startsWith('//')) thumbnail = 'https:' + thumbnail;

        addVideo(videoId, title, thumbnail, duration, false);
    });

    console.log(`[Video Downloader] Total videos detected: ${videos.length}`);
    return videos;
}

function getVideoDuration() {
    const durationEl = document.querySelector('.ytp-time-duration');
    return durationEl ? durationEl.textContent : '';
}

function isYouTube() {
    return window.location.hostname.includes('youtube.com');
}

// Generic: find <video> tags, <iframe> embeds, sniffed network media, and page extraction
async function detectVideosGeneric() {
    const videos = [];
    const seen = new Set();

    // 1. Direct <video> elements & <source> tags
    document.querySelectorAll('video').forEach((el, idx) => {
        const src = el.currentSrc || el.src;
        if (src && !seen.has(src)) {
            seen.add(src);
            videos.push({
                id: `dom-video-${idx}`,
                title: document.title || 'Video',
                thumbnail: '',
                duration: '',
                type: 'video',
                mediaUrl: src,
                isGeneric: true
            });
        }
        el.querySelectorAll('source').forEach((sourceEl, sIdx) => {
            const sSrc = sourceEl.src;
            if (sSrc && !seen.has(sSrc)) {
                seen.add(sSrc);
                videos.push({
                    id: `dom-video-${idx}-src-${sIdx}`,
                    title: document.title || 'Video',
                    thumbnail: '',
                    duration: '',
                    type: 'video',
                    mediaUrl: sSrc,
                    isGeneric: true
                });
            }
        });
    });

    // 2. Media URLs sniffed from network requests by background.js
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getDetectedMedia' });
        if (response && response.success && Array.isArray(response.media)) {
            response.media.forEach((m, idx) => {
                if (m.url && !seen.has(m.url)) {
                    seen.add(m.url);
                    let label = m.type === 'hls' ? 'HLS Stream (.m3u8)' : (m.type === 'dash' ? 'DASH Stream (.mpd)' : 'Media Stream');
                    videos.push({
                        id: `net-media-${idx}`,
                        title: `${document.title || 'Video'} (${label})`,
                        thumbnail: '',
                        duration: '',
                        type: 'video',
                        mediaUrl: m.url,
                        isGeneric: true
                    });
                }
            });
        }
    } catch (e) {
        console.warn('[Video Downloader] Could not fetch sniffed media', e);
    }

    // 3. Scan <iframe> elements for embedded video players
    const ignoreIframes = ['facebook', 'twitter', 'google', 'disqus', 'analytics', 'doubleclick', 'captcha'];
    document.querySelectorAll('iframe').forEach((iframe, idx) => {
        const src = iframe.src || iframe.dataset.src;
        if (src && src.startsWith('http') && !seen.has(src)) {
            const isIgnored = ignoreIframes.some(domain => src.toLowerCase().includes(domain));
            if (!isIgnored) {
                seen.add(src);
                try {
                    const host = new URL(src).hostname;
                    videos.push({
                        id: `iframe-embed-${idx}`,
                        title: `Embed Player (${host})`,
                        thumbnail: '',
                        duration: '',
                        type: 'page',
                        pageUrl: src,
                        isPageExtractor: true
                    });
                } catch (_) { }
            }
        }
    });

    // 4. Main Page URL (yt-dlp Extractor)
    const currentUrl = window.location.href;
    if (!seen.has(currentUrl)) {
        seen.add(currentUrl);
        videos.unshift({
            id: `page-extractor-main`,
            title: `${document.title || 'Page Video'} (Page Extractor)`,
            thumbnail: '',
            duration: '',
            type: 'page',
            pageUrl: currentUrl,
            isPageExtractor: true
        });
    }

    return videos;
}

async function loadFormatsForPageUrl(videoId, pageUrl) {
    const actionsDiv = document.getElementById(`actions-${videoId}`);
    if (actionsDiv) {
        actionsDiv.innerHTML = `
      <select class="format-select" data-video-id="${videoId}"><option>Extracting formats with yt-dlp...</option></select>
      <button class="download-btn" data-video-id="${videoId}" disabled>Download</button>
    `;
    }
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getFormatsForUrl', pageUrl });
        if (response && response.success && response.data && response.data.formats && response.data.formats.length > 0) {
            window.formatCache[videoId] = {
                formats: response.data.formats,
                title: response.data.title || document.title,
                thumbnail: response.data.thumbnail || '',
                pageUrl: pageUrl
            };
            populateDropdownFromCache(videoId);
        } else {
            if (actionsDiv) actionsDiv.innerHTML = '<span style="font-size:12px; color:#ef4444;">No formats found via yt-dlp</span>';
        }
    } catch (error) {
        console.error('Error extracting formats for page:', error);
        if (actionsDiv) actionsDiv.innerHTML = '<span style="font-size:12px; color:#ef4444;">Extraction failed</span>';
    }
}

// Render videos with caching and lazy loading
function renderVideos(videos, searchTerm = '', filter = 'all') {
    const container = document.querySelector('#videos-list');
    if (!container) return;
    updateVideoCount(videos.length);

    let filtered = videos;
    if (searchTerm) filtered = filtered.filter(v => v.title.toLowerCase().includes(searchTerm.toLowerCase()));
    if (filter === 'video') filtered = filtered.filter(v => v.type === 'video');
    else if (filter === 'audio') filtered = filtered.filter(v => v.type === 'audio');

    if (filtered.length === 0) {
        container.innerHTML = '<div class="no-videos">No videos found</div>';
        return;
    }

    container.innerHTML = filtered.map(video => {
        if (video.isGeneric) {
            return `
      <div class="video-item" data-video-id="${video.id}">
        <div class="video-info" style="flex:1;">
          <div class="video-title" title="${escapeHtml(video.title)}">${escapeHtml(video.title)}</div>
          <div class="video-actions">
            <button class="download-btn generic-download-btn" data-media-url="${escapeHtml(video.mediaUrl)}">Download</button>
          </div>
        </div>
      </div>
    `;
        }

        if (video.isPageExtractor) {
            const cached = window.formatCache[video.id];
            if (cached && cached.formats && cached.formats.length > 0) {
                return `
          <div class="video-item" data-video-id="${video.id}">
            <div class="video-info" style="flex:1;">
              <div class="video-title" title="${escapeHtml(video.title)}">${escapeHtml(video.title)}</div>
              <div class="video-actions" id="actions-${video.id}">
                <select class="format-select" data-video-id="${video.id}">
                  ${buildFormatOptions(cached.formats)}
                </select>
                <button class="download-btn" data-video-id="${video.id}">Download</button>
              </div>
            </div>
          </div>
        `;
            } else {
                return `
          <div class="video-item" data-video-id="${video.id}">
            <div class="video-info" style="flex:1;">
              <div class="video-title" title="${escapeHtml(video.title)}">${escapeHtml(video.title)}</div>
              <div class="video-actions" id="actions-${video.id}">
                <button class="extract-page-formats-btn" data-video-id="${video.id}" data-page-url="${escapeHtml(video.pageUrl)}">📥 Extract Formats (yt-dlp)</button>
              </div>
            </div>
          </div>
        `;
            }
        }

        const cached = window.formatCache[video.id];
        const hasCached = cached && cached.formats && cached.formats.length > 0;

        if (video.isCurrent) {
            return `
        <div class="video-item" data-video-id="${video.id}" data-is-current="true">
          <div class="video-thumbnail">
            <img src="${video.thumbnail}" alt="${escapeHtml(video.title)}" loading="lazy" />
            ${video.duration ? `<span class="video-duration">${video.duration}</span>` : ''}
          </div>
          <div class="video-info">
            <div class="video-title" title="${escapeHtml(video.title)}">${escapeHtml(video.title)}</div>
            <div class="video-actions" id="actions-${video.id}">
              <select class="format-select" data-video-id="${video.id}"><option>Loading formats...</option></select>
              <button class="download-btn" data-video-id="${video.id}" disabled>Download</button>
            </div>
          </div>
        </div>
      `;
        } else {
            if (hasCached) {
                return `
          <div class="video-item" data-video-id="${video.id}">
            <div class="video-thumbnail">
              <img src="${video.thumbnail}" alt="${escapeHtml(video.title)}" loading="lazy" />
              ${video.duration ? `<span class="video-duration">${video.duration}</span>` : ''}
            </div>
            <div class="video-info">
              <div class="video-title" title="${escapeHtml(video.title)}">${escapeHtml(video.title)}</div>
              <div class="video-actions" id="actions-${video.id}">
                <select class="format-select" data-video-id="${video.id}">
                  ${buildFormatOptions(cached.formats)}
                </select>
                <button class="download-btn" data-video-id="${video.id}">Download</button>
              </div>
            </div>
          </div>
        `;
            } else {
                return `
          <div class="video-item" data-video-id="${video.id}">
            <div class="video-thumbnail">
              <img src="${video.thumbnail}" alt="${escapeHtml(video.title)}" loading="lazy" />
              ${video.duration ? `<span class="video-duration">${video.duration}</span>` : ''}
            </div>
            <div class="video-info">
              <div class="video-title" title="${escapeHtml(video.title)}">${escapeHtml(video.title)}</div>
              <div class="video-actions" id="actions-${video.id}">
                <button class="load-formats-btn" data-video-id="${video.id}">📥 Load formats</button>
              </div>
            </div>
          </div>
        `;
            }
        }
    }).join('');

    // Attach event handlers
    filtered.forEach(video => {
        if (video.isGeneric) {
            const btn = document.querySelector(`.generic-download-btn[data-media-url="${CSS.escape(video.mediaUrl)}"]`);
            if (btn) {
                btn.onclick = async () => {
                    btn.textContent = 'Downloading...';
                    btn.disabled = true;
                    const filename = sanitizeFilename(document.title) + '.mp4';
                    const resp = await chrome.runtime.sendMessage({
                        action: 'downloadMediaUrl',
                        mediaUrl: video.mediaUrl,
                        pageUrl: window.location.href,
                        filename
                    });
                    btn.textContent = resp.success ? 'Downloaded!' : 'Failed';
                    setTimeout(() => { btn.textContent = 'Download'; btn.disabled = false; }, 2000);
                };
            }
            return;
        }

        if (video.isPageExtractor) {
            const extractBtn = document.querySelector(`.extract-page-formats-btn[data-video-id="${video.id}"]`);
            if (extractBtn) {
                extractBtn.onclick = () => {
                    loadFormatsForPageUrl(video.id, video.pageUrl);
                };
            } else {
                const select = document.querySelector(`.format-select[data-video-id="${video.id}"]`);
                const downloadBtn = document.querySelector(`.download-btn[data-video-id="${video.id}"]`);
                if (select && downloadBtn && window.formatCache[video.id]) {
                    attachDownloadHandler(video.id, window.formatCache[video.id].formats, window.formatCache[video.id].title);
                }
            }
            return;
        }

        if (video.isCurrent) {
            if (!window.formatCache[video.id]) loadFormatsForVideo(video.id);
            else populateDropdownFromCache(video.id);
        } else {
            const loadBtn = document.querySelector(`.load-formats-btn[data-video-id="${video.id}"]`);
            if (loadBtn) {
                loadBtn.onclick = () => {
                    loadBtn.textContent = 'Loading...';
                    loadBtn.disabled = true;
                    const actionsDiv = document.getElementById(`actions-${video.id}`);
                    actionsDiv.innerHTML = `
            <select class="format-select" data-video-id="${video.id}"><option>Loading formats...</option></select>
            <button class="download-btn" data-video-id="${video.id}" disabled>Download</button>
          `;
                    loadFormatsForVideo(video.id);
                };
            } else {
                const select = document.querySelector(`.format-select[data-video-id="${video.id}"]`);
                const downloadBtn = document.querySelector(`.download-btn[data-video-id="${video.id}"]`);
                if (select && downloadBtn && window.formatCache[video.id]) {
                    attachDownloadHandler(video.id, window.formatCache[video.id].formats, window.formatCache[video.id].title);
                }
            }
        }
    });
}

function buildFormatOptions(formats) {
    return formats.map((format, idx) => {
        const icon = format.type === 'video' ? '🎬' : '🎵';
        return `<option value="${idx}" data-type="${format.type}" data-height="${format.height || ''}">${icon} ${format.label}</option>`;
    }).join('');
}

function attachDownloadHandler(videoId, formats, videoTitle) {
    const select = document.querySelector(`.format-select[data-video-id="${videoId}"]`);
    const downloadBtn = document.querySelector(`.download-btn[data-video-id="${videoId}"]`);
    if (!select || !downloadBtn) return;

    if (select.options.length === 1 && (select.options[0].text.includes('Loading') || select.options[0].text.includes('Extracting'))) {
        select.innerHTML = buildFormatOptions(formats);
    }
    downloadBtn.disabled = false;

    downloadBtn.onclick = async () => {
        const selectedIdx = select.value;
        if (selectedIdx === '' || selectedIdx === null) return;
        const format = formats[parseInt(selectedIdx)];
        if (!format) return;

        downloadBtn.textContent = 'Downloading...';
        downloadBtn.disabled = true;

        const safeTitle = sanitizeFilename(videoTitle);
        const ext = format.extension || (format.type === 'audio' ? 'mp3' : 'mp4');
        const filename = `${safeTitle}.${ext}`;

        let downloadResponse;
        const cached = window.formatCache[videoId];
        const isGenericOrExtractor = videoId.startsWith('page-extractor') || videoId.startsWith('iframe-embed') || videoId.startsWith('dom-video') || videoId.startsWith('net-media');

        if (isGenericOrExtractor) {
            const targetUrl = format.url || (cached ? cached.pageUrl : window.location.href);
            downloadResponse = await chrome.runtime.sendMessage({
                action: 'downloadMediaUrl',
                mediaUrl: targetUrl,
                pageUrl: window.location.href,
                filename
            });
        } else if (format.type === 'video') {
            const quality = format.label.split('p')[0] + 'p';
            console.log(`[Content] Downloading video: "${videoTitle}" -> "${filename}"`);
            downloadResponse = await chrome.runtime.sendMessage({
                action: 'download',
                type: 'video',
                videoId: videoId,
                quality: quality,
                filename: filename
            });
        } else {
            downloadResponse = await chrome.runtime.sendMessage({
                action: 'download',
                type: 'audio',
                url: format.url,
                filename: filename
            });
        }

        if (downloadResponse && downloadResponse.success) {
            downloadBtn.textContent = 'Downloaded!';
        } else {
            downloadBtn.textContent = 'Failed';
        }
        setTimeout(() => {
            downloadBtn.textContent = 'Download';
            downloadBtn.disabled = false;
        }, 2500);
    };
}

function populateDropdownFromCache(videoId) {
    const cached = window.formatCache[videoId];
    if (!cached) return;
    const select = document.querySelector(`.format-select[data-video-id="${videoId}"]`);
    const downloadBtn = document.querySelector(`.download-btn[data-video-id="${videoId}"]`);
    if (select && downloadBtn) {
        select.innerHTML = buildFormatOptions(cached.formats);
        downloadBtn.disabled = false;
        attachDownloadHandler(videoId, cached.formats, cached.title);
    }
}

async function loadFormatsForVideo(videoId) {
    if (window.formatCache[videoId]) {
        populateDropdownFromCache(videoId);
        return;
    }
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getFormats', videoId });
        if (response.success && response.data.formats.length > 0) {
            window.formatCache[videoId] = {
                formats: response.data.formats,
                title: response.data.title,
                thumbnail: response.data.thumbnail
            };
            populateDropdownFromCache(videoId);
        } else {
            const select = document.querySelector(`.format-select[data-video-id="${videoId}"]`);
            if (select) select.innerHTML = '<option value="">No formats available</option>';
        }
    } catch (error) {
        console.error('Error loading formats:', error);
        const select = document.querySelector(`.format-select[data-video-id="${videoId}"]`);
        if (select) select.innerHTML = '<option value="">Failed to load</option>';
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function (m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function toggleSidebar() {
    if (sidebar && document.body.contains(sidebar)) {
        sidebar.remove();
        sidebar = null;
        isSidebarOpen = false;
    } else {
        createSidebar();

        if (isYouTube()) {
            currentVideos = detectVideos();
            updateVideoCount(currentVideos.length);
            renderVideos(currentVideos);
        } else {
            updateVideoCount(0);
            renderVideos([]);
            detectVideosGeneric().then(videos => {
                currentVideos = videos;
                updateVideoCount(currentVideos.length);
                renderVideos(currentVideos);
            });
        }

        if (window.videoObserver) window.videoObserver.disconnect();
        window.videoObserver = new MutationObserver(() => {
            if (isSidebarOpen && isYouTube()) {
                const newVideos = detectVideos();
                if (newVideos.length !== currentVideos.length) {
                    currentVideos = newVideos;
                    updateVideoCount(currentVideos.length);
                    const searchInput = document.querySelector('#video-search');
                    const activeFilter = document.querySelector('.filter-buttons button.filter-active')?.dataset.filter || 'all';
                    renderVideos(currentVideos, searchInput ? searchInput.value : '', activeFilter);
                }
            }
        });
        window.videoObserver.observe(document.body, { childList: true, subtree: true });
    }
}

        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'toggleSidebar') {
                toggleSidebar();
                sendResponse({ success: true });
            }
        });

        console.log('Video Downloader content script loaded (final version with proper filenames)');
    })();
}