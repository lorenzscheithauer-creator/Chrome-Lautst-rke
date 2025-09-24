document.addEventListener('DOMContentLoaded', () => {
  const enableSwitch = document.getElementById('enableSwitch');
  const loudnessSlider = document.getElementById('loudnessSlider');
  const loudnessValue = document.getElementById('loudnessValue');

  // Load saved settings and update the UI
  chrome.storage.sync.get(['isEnabled', 'targetLoudness'], (result) => {
    enableSwitch.checked = !!result.isEnabled;
    const targetLoudness = result.targetLoudness || -16;
    loudnessSlider.value = targetLoudness;
    loudnessValue.textContent = `${targetLoudness} LUFS`;
  });

  // Save changes when the switch is toggled
  enableSwitch.addEventListener('change', () => {
    chrome.storage.sync.set({ isEnabled: enableSwitch.checked });
  });

  // Update the UI and save the setting in real-time as the slider moves.
  loudnessSlider.addEventListener('input', () => {
    const newLoudness = parseInt(loudnessSlider.value, 10);

    // 1. Update the text label immediately.
    loudnessValue.textContent = `${newLoudness} LUFS`;

    // 2. Save the new value to storage immediately.
    chrome.storage.sync.set({ targetLoudness: newLoudness });
  });
});