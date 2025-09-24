document.addEventListener('DOMContentLoaded', () => {
  const enabledCheckbox = document.getElementById('enabled-checkbox');
  const loudnessSlider = document.getElementById('loudness-slider');
  const loudnessValue = document.getElementById('loudness-value');

  // TODO: Implement a check for premium status, e.g., using chrome.runtime.getLicense()
  const isPremium = false; // Placeholder for premium status

  // Load current settings and update the UI
  chrome.runtime.sendMessage({ type: 'getSettings' }, (settings) => {
    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError);
      return;
    }
    enabledCheckbox.checked = settings.enabled;
    loudnessSlider.value = settings.targetLoudness;
    loudnessValue.textContent = `${settings.targetLoudness} LUFS`;

    // Enable slider only for premium users
    if (isPremium) {
      loudnessSlider.disabled = false;
      document.querySelector('small').style.display = 'none';
    }
  });

  // Handle enable/disable toggle
  enabledCheckbox.addEventListener('change', () => {
    const enabled = enabledCheckbox.checked;
    chrome.runtime.sendMessage({
      type: 'setSettings',
      settings: { enabled }
    });
  });

  // Handle loudness slider changes
  loudnessSlider.addEventListener('input', () => {
    const targetLoudness = parseInt(loudnessSlider.value, 10);
    loudnessValue.textContent = `${targetLoudness} LUFS`;
  });

  loudnessSlider.addEventListener('change', () => {
    const targetLoudness = parseInt(loudnessSlider.value, 10);
    chrome.runtime.sendMessage({
      type: 'setSettings',
      settings: { targetLoudness }
    });
  });
});