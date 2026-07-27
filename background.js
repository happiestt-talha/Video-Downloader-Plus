//video-downloader-plus/background.js
const API_URL = 'http://localhost:3000';

const pendingRequests = new Map();
let activeRequests = 0;
const MAX_CONCURRENT = 2;
const requestQueue = [];

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

async function downloadWithMerge(videoId, quality, filename) {
    try {
        console.log(`[Background] Downloading ${videoId} as "${filename}"`);
        const downloadUrl = `${API_URL}/download?videoId=${videoId}&quality=${quality}&filename=${encodeURIComponent(filename)}`;
        const downloadId = await chrome.downloads.download({
            url: downloadUrl,
            filename: filename,  // still provide as fallback
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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getFormats') {
        getVideoFormats(request.videoId)
            .then(data => sendResponse({ success: true, data }))
            .catch(error => sendResponse({ success: false, error: error.message }));
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
});

chrome.action.onClicked.addListener(async (tab) => {
    try {
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
        });
        chrome.tabs.sendMessage(tab.id, { action: 'toggleSidebar' });
    } catch (error) {
        console.error('Failed to inject:', error);
    }
});