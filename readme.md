# Midiplus Smartpad – Bitwig Controller Script 

Bitwig Studio controller script for the **MIDIPLUS Smartpad**. 
This script transforms the device into a true 8x8 Clip Launcher with accurate LED color feedback. 

## 🎥 See it in Action

<div align="center">

**Inside Bitwig:**

![Inside Bitwig](https://github.com/Chimthuwu/bitwig-smartpad-controller-script/blob/main/ClipLaunch2.gif?raw=true)

**Smartpad Response:**

![Smartpad Response](https://github.com/Chimthuwu/bitwig-smartpad-controller-script/blob/main/SMARTPAD.gif?raw=true)

</div>

---

## 🚀 Features

*   **True 8x8 Clip Launcher:** Launch clips and scenes effortlessly across the main grid. Pad LEDs perfectly sync with your active playing, queued, and recording states.
*   **Empirically Verified Color Engine:** The Smartpad does not support continuous RGB blending; it has exactly 7 fixed hardware colors. This script reads Bitwig's raw clip RGB data, calculates the exact Hue, and mathematically snaps it to the correct Smartpad hardware zone for crisp, accurate lighting.
*   **Mode 1 Remote Controls (Channel 6):** Turns the Smartpad into an 8x8 parameter controller. The non-linear, split-chromatic matrix of Mode 1 has been fully mapped and decoded to ensure flawless parameter targeting.
*   **Zero-Polling Architecture:** All updates are strictly driven by Bitwig’s native observers. No CPU-wasting timer loops and no redundant MIDI spam.
*   **100% API Compliant:** Built to respect Bitwig's strict initialization rules, eliminating the dreaded *"Trying to create section outside of init()"* and *"Unknown identifier"* crashes.

---

## 🎨 Smartpad Hardware Color Zones

Thanks to Bitwig's Console we were able to map the Smartpad's internal LED velocity bands. 
The script automatically translates your Bitwig clip colors into these 16-step velocity zones:

| Velocity Range | Target Velocity | Hardware Color |
| :--- | :--- | :--- |
| **1 – 16** | 8 | White |
| **17 – 32** | 24 | Yellow |
| **33 – 48** | 40 | Sky Blue |
| **49 – 64** | 56 | Magenta / Pink |
| **65 – 80** | 72 | Blue |
| **81 – 96** | 88 | Green |
| **97 – 127** | 112 | Red |

> **Note on Blank Clips:** The Smartpad firmware requires a strict MIDI Note Off (`0x80`) message to properly extinguish an LED. The script automatically handles this whenever a clip stops or a slot is empty.

---

## 📦 Installation

1. Download the `MidiplusSmartpad.control.js` script file.
2. Place the file into your Bitwig controller scripts folder:
   * **Windows:** `%USERPROFILE%\Documents\Bitwig Studio\Controller Scripts\`
   * **macOS:** `~/Documents/Bitwig Studio/Controller Scripts/`
   * **Linux:** `~/Bitwig Studio/Controller Scripts/`
3. Open Bitwig Studio and navigate to **Settings > Controllers**.
4. Click **Add controller manually**, select **Midiplus** from the hardware vendor list, and choose **Midiplus Smartpad (Master)**.
5. Set both the MIDI Input and MIDI Output ports to your Smartpad.

---

## 🧠 Architecture & Development Notes

If you are a developer looking to learn from or modify this script, keep these crucial Bitwig API constraints in mind:

*   **The `init()` Rule:** Bitwig requires that all object creation (`createTrackBank`, `createCursorDevice`, `createCursorRemoteControlsPage`) occurs strictly inside the `init()` function. Instantiating these inside a MIDI callback will instantly crash the script.
*   **Slot Observers:** Observers for clip states (`addHasContentObserver`, `addColorObserver`, etc.) must be attached to the `ClipLauncherSlotBank` itself, not to individual `ClipLauncherSlotProxy` objects.
*   **MIDI Transmission:** Bitwig API 17+ uses `sendMidi(status, data1, data2)` for output. Avoid using deprecated or non-existent methods like `sendNoteOn()`.

---

## 🤝 Contributing & License

Contributions, forks, and pull requests are highly encouraged! This script was built with assistance from the community to serve as a stable foundation for budget-friendly grid controllers. 

**License:** MIT License — free to use, modify, study, and share.
