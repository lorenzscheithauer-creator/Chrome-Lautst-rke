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
    // Dynamically import the module and extract the LoudnessMeter class.
    const needlesModule = await import(src);
    LoudnessMeter = needlesModule.LoudnessMeter;

    if (!LoudnessMeter) {
        throw new Error("LoudnessMeter class not found in the imported module.");
    }

    console.log('needles.js library loaded successfully.');
    main(); // Starte die Hauptlogik erst nach dem Laden
  } catch (e) {
    console.error('Failed to load or initialize needles.js library:', e);
  }
})();


// Hauptfunktion, die die Beobachtung startet
function main() {
  // Lade die initialen Einstellungen
  chrome.storage.sync.get(['isEnabled', 'targetLoudness'], (result) => {
    globalSettings = { ...globalSettings, ...result };

    // Starte die Beobachtung des DOM
    const observer = new MutationObserver(mutationCallback);
    observer.observe(document.body, { childList: true, subtree: true });

    // Verarbeite bereits vorhandene Elemente
    document.querySelectorAll('video, audio').forEach(processMediaElement);
  });

  // Lausche auf Einstellungsänderungen aus dem Popup
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
    // The `applyNormalization` function will automatically use the new `globalSettings`
    // on the next audio processing tick, so no further action is needed here.
  });
}

// Callback-Funktion für den MutationObserver
const mutationCallback = (mutationsList) => {
  for (const mutation of mutationsList) {
    // Verarbeite neu hinzugefügte Elemente
    mutation.addedNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.matches('video, audio')) {
          processMediaElement(node);
        }
        node.querySelectorAll('video, audio').forEach(processMediaElement);
      }
    });

    // Bereinige Ressourcen von entfernten Elementen
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
  // Verhindere doppelte Verarbeitung
  if (processedElements.has(element)) {
    return;
  }
  // --- Fix for Race Condition (Bug #2) ---
  // Immediately mark the element as being processed to prevent the observer
  // from triggering a second processing call for the same element.
  processedElements.set(element, { status: 'processing' });

  // console.log('Processing new media element:', element);

  try {
    const audioContext = new AudioContext();
    const sourceNode = audioContext.createMediaElementSource(element);
    const gainNode = audioContext.createGain();

    // DynamicsCompressorNode für bessere Qualität und zur Vermeidung von Clipping
    const compressorNode = audioContext.createDynamicsCompressor();
    // --- Compressor Tuning (Phase 1) ---
    // These parameters are set for a gentle, "musical" compression that evens out
    // the audio without sounding "squashed". It acts more as a leveler than a hard limiter.
    compressorNode.threshold.value = -20; // dB - Start compressing a bit earlier than just at the peaks.
    compressorNode.knee.value = 30;       // dB - A high knee ensures a very soft transition into compression.
    compressorNode.ratio.value = 4;       // 4:1 is a common, natural-sounding ratio.
    compressorNode.attack.value = 0.003;  // seconds - Fast attack to catch transients.
    compressorNode.release.value = 0.25;  // seconds - A standard release time.

    sourceNode.connect(gainNode).connect(compressorNode).connect(audioContext.destination);

    // Initialisiere den LoudnessMeter von der 'needles'-Bibliothek
    const meter = new LoudnessMeter({
      source: gainNode, // Messe nach der Verstärkung
      workerUri: chrome.runtime.getURL('lib/needles-worker.js'),
    });

    meter.on('dataavailable', (event) => {
      // Breche ab, wenn die Erweiterung deaktiviert ist
      if (!globalSettings.isEnabled) {
        // Setze die Verstärkung auf 1 (neutral) zurück
        gainNode.gain.setTargetAtTime(1.0, audioContext.currentTime, 0.1);
        return;
      }

      const loudness = event.data.value;
      // --- Behavior during silence (Phase 1) ---
      if (loudness && loudness.momentary > -70) { // -70 LUFS is effectively silence.
        const error = globalSettings.targetLoudness - loudness.momentary;
        const gainCorrection = Math.pow(10, error / 20);

        // --- Smoothing optimization (Phase 1) ---
        // A time constant of 0.12s is very responsive to sudden changes (like ads)
        // while still being smooth enough to avoid audible artifacts in most content.
        gainNode.gain.setTargetAtTime(gainCorrection, audioContext.currentTime, 0.12);
      } else {
        // If the content is silent, slowly reset the gain to 1.0 (neutral).
        // This prevents the amplification of background noise after a quiet scene.
        gainNode.gain.setTargetAtTime(1.0, audioContext.currentTime, 0.5);
      }
    });

    meter.start();

    // Replace the placeholder with the actual resources for cleanup purposes.
    processedElements.set(element, { audioContext, meter });

  } catch (error) {
    console.error('Error processing media element:', error);
    // If an error occurs, remove the element from the map so it can be retried.
    processedElements.delete(element);
  }
}

// Bereinigt die Ressourcen eines entfernten Elements
function cleanupMediaElement(element) {
    if (processedElements.has(element)) {
        // console.log('Cleaning up resources for element:', element);
        const { audioContext, meter } = processedElements.get(element);

        meter.stop();
        audioContext.close(); // Gibt alle Ressourcen des AudioContext frei

        processedElements.delete(element);
    }
}