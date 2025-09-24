# Universal Volume Guard - Chrome Extension

## Project Goal

Universal Volume Guard is a sophisticated, commercially-oriented Chrome extension designed to analyze and normalize audio volume across all browser tabs in real-time. It aims to unify the web listening experience by automatically turning down loud content and boosting quiet content to a consistent, user-selectable level, preventing abrupt volume jumps.

## Features

*   **Universal Normalization:** Works on any website using HTML5 `<audio>` or `<video>` elements.
*   **Real-time LUFS Metering:** Uses the professional ITU-R BS.1770 (LUFS) standard for loudness measurement, ensuring perceptually consistent volume.
*   **High-Quality Audio Processing:** Employs smooth gain adjustments (`setTargetAtTime`) and a `DynamicsCompressorNode` to prevent audible artifacts like clicking or clipping.
*   **Performant:** Built with performance in mind. The core loudness analysis is offloaded to a Web Worker to avoid blocking the browser's main thread.
*   **Modern Architecture:** Fully compliant with Chrome's Manifest V3 for enhanced security and performance.
*   **Freemium-Ready:** The architecture is prepared for a freemium model, with the custom loudness slider intended as a premium feature.

## Technical Stack

*   **Manifest V3:** The latest Chrome extension standard.
*   **Web Audio API:** The core technology for all audio manipulation (`AudioContext`, `GainNode`, `DynamicsCompressorNode`).
*   **`@domchristie/needles`:** A specialized JavaScript library for real-time LUFS loudness metering.
*   **`MutationObserver`:** To dynamically detect and process media elements as they are added to or removed from a page.

## Development Setup

This extension does not require a build step (e.g., Webpack, Rollup). All files are used as-is.

To install and test the extension locally:

1.  **Clone or download this repository.**
2.  **Open Google Chrome** and navigate to `chrome://extensions`.
3.  **Enable "Developer mode"** using the toggle switch in the top-right corner.
4.  Click the **"Load unpacked"** button.
5.  **Select the root directory** of this project.

The extension icon should now appear in your browser's toolbar. You can make changes to the code and see them reflected by reloading the extension from the `chrome://extensions` page.