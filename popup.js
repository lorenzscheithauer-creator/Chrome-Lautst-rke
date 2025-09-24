document.addEventListener('DOMContentLoaded', () => {
  const enableSwitch = document.getElementById('enableSwitch');
  const loudnessSlider = document.getElementById('loudnessSlider');
  const loudnessValue = document.getElementById('loudnessValue');
  const premiumFeatureDiv = document.querySelector('.premium-feature');

  /**
   * Placeholder function to simulate checking the user's premium status.
   * In a real extension, this would involve checking license status via
   * the Chrome Web Store API or your own backend.
   * @returns {Promise<boolean>} A promise that resolves to true if the user is premium.
   */
  async function checkPremiumStatus() {
    // For demonstration, we'll keep it simple. Set to `true` to test the premium UI.
    return false;
  }

  // Function to update the UI based on the premium status
  function updatePremiumUI(isPremium) {
    if (isPremium) {
      premiumFeatureDiv.classList.add('unlocked');
      loudnessSlider.disabled = false;
      document.querySelector('.premium-label').style.display = 'none';
    } else {
      premiumFeatureDiv.classList.remove('unlocked');
      loudnessSlider.disabled = true;
    }
  }

  // Load saved settings and update the UI
  chrome.storage.sync.get(['isEnabled', 'targetLoudness'], (result) => {
    enableSwitch.checked = !!result.isEnabled;
    const targetLoudness = result.targetLoudness || -16;
    loudnessSlider.value = targetLoudness;
    loudnessValue.textContent = `${targetLoudness} LUFS`;
  });

  // Check premium status and update UI accordingly
  checkPremiumStatus().then(isPremium => {
    updatePremiumUI(isPremium);
  });

  // Save changes when the switch is toggled
  enableSwitch.addEventListener('change', () => {
    chrome.storage.sync.set({ isEnabled: enableSwitch.checked });
  });

  // Save changes when the slider is moved
  loudnessSlider.addEventListener('input', () => {
    const newLoudness = parseInt(loudnessSlider.value, 10);
    loudnessValue.textContent = `${newLoudness} LUFS`;
  });

  loudnessSlider.addEventListener('change', () => {
    const newLoudness = parseInt(loudnessSlider.value, 10);
    chrome.storage.sync.set({ targetLoudness: newLoudness });
  });
});