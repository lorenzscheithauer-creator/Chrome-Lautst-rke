/**
 * @file content-script.js
 * @description This script is injected into every webpage to handle the core audio
 * normalization functionality. It uses a MutationObserver to detect audio/video
 * elements, attaches a Web Audio API graph to them, and uses the 'needles'
 * library to perform real-time LUFS loudness measurement and normalization.
 */

// --- Global State ---
let globalSettings = {
  isEnabled: true,
  targetLoudness: -16,
};
let LoudnessMeter; // This will be assigned after the dynamic import.

const processedElements = new WeakMap();

// Lade die `needles`-Bibliothek dynamisch in den Seitenkontext
(async () => {
  try {
    const src = chrome.runtime.getURL('lib/needles.js');
    const needlesModule = await import(src);
    LoudnessMeter = needlesModule.LoudnessMeter;

    if (!LoudnessMeter) {
        throw new Error("LoudnessMeter class not found in the imported module.");
    }

    main();
  } catch (e) {
    console.error('Failed to load or initialize needles.js library:', e);
  }
})();


// Hauptfunktion, die die Beobachtung startet
function main() {
  chrome.storage.sync.get(['isEnabled', 'targetLoudness'], (result) => {
    globalSettings = { ...globalSettings, ...result };

    document.querySelectorAll('video, audio').forEach(processMediaElement);

    const observer = new MutationObserver(mutationCallback);
    observer.observe(document.body, { childList: true, subtree: true });
  });

  chrome.storage.onChanged.addListener((changes) => {
    let settingsChanged = false;
    if (changes.isEnabled) {
      globalSettings.isEnabled = changes.isEnabled.newValue;
      settingsChanged = true;
    }
    if (changes.targetLoudness) {
      globalSettings.targetLoudness = changes.targetLoudness.newValue;
      settingsChanged = true;
    }
  });
}

const mutationCallback = (mutationsList) => {
  for (const mutation of mutationsList) {
    mutation.addedNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.matches('video, audio')) {
          processMediaElement(node);
        }
        node.querySelectorAll('video, audio').forEach(processMediaElement);
      }
    });
    mutation.removedNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.matches('video, audio')) {
          cleanupMediaElement(node);
        }
        node.querySelectorAll('video, audio').forEach(cleanupMediaElement);
      }
    });
  }
};

function processMediaElement(element) {
    // FINAL FIX: Check and set an attribute directly on the element.
    // This is faster and more reliable than just checking the WeakMap.
    if (element.dataset.volumeGuardProcessed) {
        return; // If the attribute already exists, cancel immediately.
    }
    element.dataset.volumeGuardProcessed = 'true'; // Set IMMEDIATELY to block all other calls.

    // The WeakMap is still used for later resource management (cleanup).
    processedElements.set(element, { status: 'processing' });
    // console.log(`[DEBUG] Locking element:`, element);

    try {
        const audioContext = new AudioContext();
        const sourceNode = audioContext.createMediaElementSource(element);
        const gainNode = audioContext.createGain();
        const compressorNode = audioContext.createDynamicsCompressor();

        compressorNode.threshold.value = -20;
        compressorNode.knee.value = 30;
        compressorNode.ratio.value = 4;
        compressorNode.attack.value = 0.003;
        compressorNode.release.value = 0.25;

        sourceNode.connect(gainNode).connect(compressorNode).connect(audioContext.destination);

        const meter = new LoudnessMeter({
            source: gainNode,
        });

        meter.on('dataavailable', (event) => {
            if (!globalSettings.isEnabled) {
                gainNode.gain.setTargetAtTime(1.0, audioContext.currentTime, 0.1);
                return;
            }

            const loudness = event.data.value;
            if (loudness && loudness.momentary > -70) {
                const error = globalSettings.targetLoudness - loudness.momentary;
                const gainCorrection = Math.pow(10, error / 20);
                gainNode.gain.setTargetAtTime(gainCorrection, audioContext.currentTime, 0.12);
            } else {
                gainNode.gain.setTargetAtTime(1.0, audioContext.currentTime, 0.5);
            }
        });

        meter.start();

        // If everything was successful, update the map entry with the real resources.
        processedElements.set(element, { audioContext, meter, sourceNode, gainNode, compressorNode });

    } catch (error) {
        console.error('Error processing media element:', error);
        // IMPORTANT: On error, remove the attribute again to allow reprocessing.
        delete element.dataset.volumeGuardProcessed;
        processedElements.delete(element);
    }
}

function cleanupMediaElement(element) {
    const resources = processedElements.get(element);
    if (resources && resources.status !== 'processing') {
        resources.meter.stop();
        resources.sourceNode.disconnect();
        resources.gainNode.disconnect();
        resources.compressorNode.disconnect();
        resources.audioContext.close();
        processedElements.delete(element);
        // Also remove the attribute so it can be re-processed if it's re-added to the DOM.
        delete element.dataset.volumeGuardProcessed;
    }
}