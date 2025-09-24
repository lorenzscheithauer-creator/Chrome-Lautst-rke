// This is the service worker script.
// It will handle background tasks, such as managing state and communication.

console.log("Service Worker loaded.");

// Initialize default settings on installation
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({
    enabled: true,
    targetLoudness: -16
  });
  console.log("Universal Volume Guard initialized with default settings.");
});

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'getSettings') {
    chrome.storage.sync.get(['enabled', 'targetLoudness'], (settings) => {
      sendResponse(settings);
    });
    return true; // Indicates that the response is sent asynchronously
  } else if (request.type === 'setSettings') {
    // TODO: Add premium check here.
    // If the user is not premium, do not allow changing 'targetLoudness'.
    // const isPremium = await checkPremiumStatus();
    // if (!isPremium && request.settings.targetLoudness) {
    //   delete request.settings.targetLoudness;
    // }

    chrome.storage.sync.set(request.settings, () => {
      // Notify content scripts about the change
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, {
            type: 'settingsUpdated',
            settings: request.settings
          }).catch(error => {
            // This can happen if the content script is not injected on a page
            // (e.g., chrome:// pages), which is expected.
            if (error.message.includes("Could not establish connection")) {
              // console.log(`Could not connect to content script in tab ${tab.id}`);
            } else {
              console.error(`Error sending message to tab ${tab.id}:`, error);
            }
          });
        });
      });
    });
  }
});