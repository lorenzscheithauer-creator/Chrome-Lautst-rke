// Setzt die Standardwerte bei der Installation der Erweiterung.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({
    isEnabled: true,
    targetLoudness: -16
  });
  console.log('Universal Volume Guard: Standardeinstellungen gesetzt.');
});