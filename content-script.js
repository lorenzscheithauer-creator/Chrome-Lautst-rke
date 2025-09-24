// Globale Variablen für Einstellungen
let globalSettings = {
  isEnabled: true,
  targetLoudness: -16,
};

// Eine WeakMap, um den Überblick über verarbeitete Elemente und ihre Ressourcen zu behalten
const processedElements = new WeakMap();

// Lade die `needles`-Bibliothek dynamisch in den Seitenkontext
(async () => {
  try {
    const src = chrome.runtime.getURL('lib/needles.js');
    // Wichtig: 'LoudnessMeter' wird als globales Objekt verfügbar
    await import(src);
    console.log('needles.js library loaded successfully.');
    main(); // Starte die Hauptlogik erst nach dem Laden
  } catch (e) {
    console.error('Failed to load needles.js library:', e);
  }
})();


// Hauptfunktion, die die Beobachtung startet
function main() {
  // Lade die initialen Einstellungen
  chrome.storage.sync.get(['isEnabled', 'targetLoudness'], (result) => {
    globalSettings = { ...globalSettings, ...result };
    console.log('Initial settings loaded:', globalSettings);

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
    if (settingsChanged) {
        console.log('Settings updated:', globalSettings);
        // Zukünftig könnte man hier die laufende Verarbeitung anpassen
    }
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

  console.log('Processing new media element:', element);

  try {
    const audioContext = new AudioContext();
    const sourceNode = audioContext.createMediaElementSource(element);
    const gainNode = audioContext.createGain();

    // DynamicsCompressorNode für bessere Qualität und zur Vermeidung von Clipping
    const compressorNode = audioContext.createDynamicsCompressor();
    // Fine-tuned parameters for a smoother, less intrusive compression.
    // It acts as a safety limiter for peaks after the gain stage.
    compressorNode.threshold.value = -5;  // dB - Start compressing only very loud signals.
    compressorNode.knee.value = 30;       // dB - Make the compression curve very smooth.
    compressorNode.ratio.value = 12;      // 12:1 Ratio - Strong compression for what gets through.
    compressorNode.attack.value = 0.003;  // seconds - Fast attack to catch peaks.
    compressorNode.release.value = 0.25;  // seconds - Standard release time.

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
      if (loudness && loudness.momentary > -70) { // Ignoriere Stille
        const error = globalSettings.targetLoudness - loudness.momentary;
        const gainCorrection = Math.pow(10, error / 20);

        // Apply the correction smoothly. A time constant of 0.15s is a good balance
        // between responsiveness and avoiding audible "pumping".
        gainNode.gain.setTargetAtTime(gainCorrection, audioContext.currentTime, 0.15);
      }
    });

    meter.start();

    // Speichere die Ressourcen in der WeakMap, um sie später bereinigen zu können
    processedElements.set(element, { audioContext, meter });

  } catch (error) {
    console.error('Error processing media element:', error);
  }
}

// Bereinigt die Ressourcen eines entfernten Elements
function cleanupMediaElement(element) {
    if (processedElements.has(element)) {
        console.log('Cleaning up resources for element:', element);
        const { audioContext, meter } = processedElements.get(element);

        meter.stop();
        audioContext.close(); // Gibt alle Ressourcen des AudioContext frei

        processedElements.delete(element);
    }
}