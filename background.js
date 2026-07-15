const API_URL = 'http://localhost:3000';

const pendingRequests = new Map();
let activeRequests = 0;
const MAX_CONCURRENT = 2;
const requestQueue = [];

// tabId -> Map(url -> {url, type, tabId})
const detectedMediaByTab = new Map();

const MEDIA_URL_PATTERN = /\.(m3u8|mp4|webm|mpd|ts|m4s|flv|mov|mkv)(\?|$|\/)/i;
const MEDIA_PATH_PATTERN = /(m3u8|mpd|master|playlist|manifest|hls|stream)/i;

function addDetectedMedia(tabId, url) {
    if (tabId < 0 || !url) return;
    if (url.startsWith('blob:') || url.startsWith('data:')) return;

    // Ignore static web assets
    if (/\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|ico|html|json)(\?|$)/i.test(url)) return;

    const lowerUrl = url.toLowerCase();
    const isMediaUrl = MEDIA_URL_PATTERN.test(lowerUrl) || MEDIA_PATH_PATTERN.test(lowerUrl);
    if (!isMediaUrl) return;

    if (!detectedMediaByTab.has(tabId)) detectedMediaByTab.set(tabId, new Map());
    const tabMap = detectedMediaByTab.get(tabId);

    let type = 'video';
    if (lowerUrl.includes('m3u8')) type = 'hls';
    else if (lowerUrl.includes('mpd')) type = 'dash';

    tabMap.set(url, { url, type, tabId });
}

// Catch media requests non-blockingly as they go out
chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
        addDetectedMedia(details.tabId, details.url);
    },
    { urls: ["<all_urls>"] }
);

// Clear stored media when a tab navigates or closes
chrome.tabs.onRemoved.addListener((tabId) => {
    detectedMediaByTab.delete(tabId);
});

chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId === 0) {
        detectedMediaByTab.delete(details.tabId);
    }
});

function processQueue() {
    if (requestQueue.length === 0 || activeRequests >= MAX_CONCURRENT) return;
    const { videoId, resolve, reject } = requestQueue.shift();
    activeRequests++;
    fetchFormatsForVideo(videoId)
        .then(result => { resolve(result); activeRequests--; processQueue(); })
        .catch(err => { reject(err); activeRequests--; processQueue(); });
}

async function fetchFormatsForVideo(videoId) {
    try {
        console.log(`[Background] Requesting formats for ${videoId} from local server`);
        const response = await fetch(`${API_URL}/formats?id=${videoId}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        console.log(`[Background] Success! ${data.formats.length} formats for ${videoId}`);
        return data;
    } catch (error) {
        console.error(`[Background] Failed:`, error.message);
        throw new Error('Local server error. Is yt-dlp+ffmpeg server running?');
    }
}

async function getVideoFormats(videoId) {
    if (pendingRequests.has(videoId)) return pendingRequests.get(videoId);
    const promise = new Promise((resolve, reject) => {
        requestQueue.push({ videoId, resolve, reject });
        processQueue();
    });
    pendingRequests.set(videoId, promise);
    promise.finally(() => pendingRequests.delete(videoId));
    return promise;
}

// Generic extraction: pass a page URL to yt-dlp's generic extractor
async function fetchFormatsForUrl(pageUrl) {
    console.log(`[Background] Requesting generic formats for ${pageUrl}`);
    const response = await fetch(`${API_URL}/formats-url?url=${encodeURIComponent(pageUrl)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

async function downloadWithMerge(videoId, quality, filename) {
    try {
        console.log(`[Background] Downloading ${videoId} as "${filename}"`);
        const downloadUrl = `${API_URL}/download?videoId=${videoId}&quality=${quality}&filename=${encodeURIComponent(filename)}`;
        const downloadId = await chrome.downloads.download({
            url: downloadUrl,
            filename: filename,
            saveAs: false
        });
        return { success: true, downloadId };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function downloadDirect(url, filename) {
    try {
        const downloadId = await chrome.downloads.download({ url, filename, saveAs: false });
        return { success: true, downloadId };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Send a sniffed media URL (e.g. .m3u8) to the server to be resolved/merged via yt-dlp
async function downloadMediaUrl(mediaUrl, pageUrl, filename) {
    try {
        const downloadUrl = `${API_URL}/download-url?mediaUrl=${encodeURIComponent(mediaUrl)}&pageUrl=${encodeURIComponent(pageUrl || '')}&filename=${encodeURIComponent(filename)}`;
        const downloadId = await chrome.downloads.download({
            url: downloadUrl,
            filename: filename,
            saveAs: false
        });
        return { success: true, downloadId };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getFormats') {
        getVideoFormats(request.videoId)
            .then(data => sendResponse({ success: true, data }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (request.action === 'getFormatsForUrl') {
        fetchFormatsForUrl(request.pageUrl)
            .then(data => sendResponse({ success: true, data }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (request.action === 'getDetectedMedia') {
        const tabId = sender.tab?.id ?? request.tabId;
        const tabMap = detectedMediaByTab.get(tabId);
        const list = tabMap ? Array.from(tabMap.values()) : [];
        sendResponse({ success: true, media: list });
        return true;
    }

    if (request.action === 'download') {
        if (request.type === 'video') {
            downloadWithMerge(request.videoId, request.quality, request.filename)
                .then(result => sendResponse(result))
                .catch(error => sendResponse({ success: false, error: error.message }));
        } else {
            downloadDirect(request.url, request.filename)
                .then(result => sendResponse(result))
                .catch(error => sendResponse({ success: false, error: error.message }));
        }
        return true;
    }

    if (request.action === 'downloadMediaUrl') {
        downloadMediaUrl(request.mediaUrl, request.pageUrl, request.filename)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
});

chrome.action.onClicked.addListener(async (tab) => {
    try {
        await chrome.tabs.sendMessage(tab.id, { action: 'toggleSidebar' });
    } catch (error) {
        // Content script may not be loaded yet on this tab (e.g. page loaded
        // before the extension was installed/reloaded) — inject as a fallback
        console.warn('No content script listener found, injecting as fallback:', error.message);
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['content.js']
            });
            chrome.tabs.sendMessage(tab.id, { action: 'toggleSidebar' });
        } catch (injectError) {
            console.error('Fallback injection also failed:', injectError);
        }
    }
});