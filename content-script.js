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

// Eine WeakMap, um den Überblick über verarbeitete Elemente und ihre Ressourcen zu behalten
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

    // console.log('needles.js library loaded successfully.');
    main(); // Starte die Hauptlogik erst nach dem Laden
  } catch (e) {
    console.error('Failed to load or initialize needles.js library:', e);
  }
})();


// Hauptfunktion, die die Beobachtung startet
function main() {
  chrome.storage.sync.get(['isEnabled', 'targetLoudness'], (result) => {
    globalSettings = { ...globalSettings, ...result };
    const observer = new MutationObserver(mutationCallback);
    observer.observe(document.body, { childList: true, subtree: true });
    document.querySelectorAll('video, audio').forEach(processMediaElement);
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

// Callback-Funktion für den MutationObserver
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

// Verarbeitet ein einzelnes Audio-/Video-Element
function processMediaElement(element) {
  // Step 1: Check if the element is already being processed or is fully processed.
  if (processedElements.has(element)) {
    return;
  }

  // Step 2: Immediately mark the element as "processing" to prevent re-entry.
  processedElements.set(element, { status: 'processing' });

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

    // Step 3: Update the map entry with the actual resources, replacing the placeholder.
    processedElements.set(element, { audioContext, meter, sourceNode, gainNode, compressorNode });

  } catch (error) {
    console.error('Error processing media element:', error);
    // On error, remove the element from the map to allow a retry if needed.
    processedElements.delete(element);
  }
}

// Bereinigt die Ressourcen eines entfernten Elements
function cleanupMediaElement(element) {
    const resources = processedElements.get(element);
    if (resources && resources.status !== 'processing') {
        // console.log('Cleaning up resources for element:', element.src || 'No Source');
        resources.meter.stop();
        resources.sourceNode.disconnect();
        resources.gainNode.disconnect();
        resources.compressorNode.disconnect();
        resources.audioContext.close();
        processedElements.delete(element);
    }
}