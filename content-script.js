console.log("Universal Volume Guard content script loaded.");

// --- Global State ---
const script = document.createElement('script');
script.src = chrome.runtime.getURL('lib/needles.js');
(document.head || document.documentElement).appendChild(script);

const processedElements = new Map();
let currentSettings = {
  enabled: true,
  targetLoudness: -16.0
};

// --- Core Logic ---

/**
 * Applies the normalization logic based on loudness measurement.
 * @param {HTMLMediaElement} element The media element being processed.
 * @param {number} currentLoudness The measured momentary LUFS.
 */
function applyNormalization(element, currentLoudness) {
  if (!currentSettings.enabled || !processedElements.has(element)) {
    return;
  }

  const { gainNode, audioContext } = processedElements.get(element);

  // Ignore invalid or very low loudness values to prevent extreme amplification of silence.
  if (!isFinite(currentLoudness) || currentLoudness < -70.0) {
    // We can let the gain slowly drift back to 1.0 if we want.
    // gainNode.gain.setTargetAtTime(1.0, audioContext.currentTime, 1.0);
    return;
  }

  const error = currentSettings.targetLoudness - currentLoudness; // Error in dB
  const gainCorrection = Math.pow(10, error / 20); // Convert dB to linear gain factor

  // Apply the correction smoothly. 0.1 is the time constant for the exponential change.
  gainNode.gain.setTargetAtTime(gainCorrection, audioContext.currentTime, 0.1);
}

/**
 * Updates the state of all processed elements based on the current settings.
 */
function updateAllElementsState() {
    processedElements.forEach((resources, element) => {
        if (!currentSettings.enabled) {
            // If the extension is disabled, smoothly reset the gain to 1.0 (no change).
            const { gainNode, audioContext } = resources;
            gainNode.gain.setTargetAtTime(1.0, audioContext.currentTime, 0.2);
        }
        // If it's enabled, the `applyNormalization` function will handle the gain.
    });
}

/**
 * Processes a given HTMLMediaElement to attach the audio processing graph.
 * @param {HTMLMediaElement} element The media element to process.
 */
function processMediaElement(element) {
  if (processedElements.has(element)) return;
  if (element.src && !element.crossOrigin) element.crossOrigin = "anonymous";

  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaElementSource(element);
    const gainNode = audioContext.createGain();
    const compressorNode = audioContext.createDynamicsCompressor();

    source.connect(gainNode);
    gainNode.connect(compressorNode);
    compressorNode.connect(audioContext.destination);

    const analysisChain = audioContext.createGain();
    source.connect(analysisChain);

    const loudnessMeter = new window.LoudnessMeter({
      source: analysisChain,
      workerUri: chrome.runtime.getURL('lib/needles-worker.js'),
      modes: ['momentary']
    });

    loudnessMeter.on('dataavailable', (event) => {
      if (event.data.mode === 'momentary') {
        applyNormalization(element, event.data.value);
      }
    });

    loudnessMeter.start();
    console.log('Successfully attached Audio Graph and LUFS meter to element:', element);

    processedElements.set(element, { audioContext, source, gainNode, compressorNode, loudnessMeter });

    // Apply initial state
    updateAllElementsState();

  } catch (error) {
    console.error("U-V-G: Failed to create Web Audio graph.", error);
  }
}

/**
 * Cleans up resources for a removed HTMLMediaElement.
 * @param {HTMLMediaElement} element The media element to clean up.
 */
function cleanupMediaElement(element) {
  if (!processedElements.has(element)) return;
  console.log('Cleaning up resources for:', element);
  const res = processedElements.get(element);
  res.loudnessMeter.stop();
  res.source.disconnect();
  res.gainNode.disconnect();
  res.compressorNode.disconnect();
  res.audioContext.close();
  processedElements.delete(element);
}

// --- Observers and Listeners ---

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    mutation.addedNodes.forEach(node => {
      if (node.nodeType !== 1) return;
      if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') processMediaElement(node);
      node.querySelectorAll('video, audio').forEach(processMediaElement);
    });
    mutation.removedNodes.forEach(node => {
      if (node.nodeType !== 1) return;
      if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') cleanupMediaElement(node);
      node.querySelectorAll('video, audio').forEach(cleanupMediaElement);
    });
  }
});

script.onload = () => {
    console.log('Needles library loaded.');
    setTimeout(() => document.querySelectorAll('video, audio').forEach(processMediaElement), 500);
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    else document.addEventListener('DOMContentLoaded', () => observer.observe(document.body, { childList: true, subtree: true }));
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'settingsUpdated') {
    Object.assign(currentSettings, request.settings);
    updateAllElementsState();
  } else if (request.type === 'getSettings') {
    sendResponse(currentSettings);
  }
});

// Fetch initial settings
chrome.runtime.sendMessage({ type: 'getSettings' }, (settings) => {
  if (chrome.runtime.lastError) console.error(chrome.runtime.lastError);
  else if (settings) {
    currentSettings = settings;
    updateAllElementsState();
  }
});