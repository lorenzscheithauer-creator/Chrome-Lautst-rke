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

  // Update the loudness value display as the slider moves
  loudnessSlider.addEventListener('input', () => {
    const newLoudness = parseInt(loudnessSlider.value, 10);
    loudnessValue.textContent = `${newLoudness} LUFS`;
  });

  // Save the new loudness value when the user releases the slider
  loudnessSlider.addEventListener('change', () => {
    const newLoudness = parseInt(loudnessSlider.value, 10);
    chrome.storage.sync.set({ targetLoudness: newLoudness });
  });
});