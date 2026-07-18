# Midiplus Smartpad – Bitwig Controller Script

Bitwig Studio controller script for the **MIDIPLUS Smartpad**.
This script transforms the device into a true 8x8 Clip Launcher with accurate LED color feedback, bank navigation across large projects, and a Focus Macro control surface for whichever track/device you have selected.

## 🎥 See it in Action

**Inside Bitwig:**

![Inside Bitwig](https://github.com/Chimthuwu/bitwig-smartpad-controller-script/blob/main/ClipLaunch2.gif?raw=true)

**Smartpad Response:**

![Smartpad Response](https://github.com/Chimthuwu/bitwig-smartpad-controller-script/blob/main/SMARTPAD.gif?raw=true)

---

## 🚀 Features

* **True 8x8 Clip Launcher:** Launch clips and scenes across the main grid. Pad LEDs sync with actual playing state and clip colour.
* **Bank Navigation (16+ tracks/scenes):** Jump the entire 8x8 window by 8 tracks or 8 scenes at a time using the **Volume / Send A / Send B / Pan** buttons — so you're not limited to your project's first 8 tracks/scenes.
* **Session Ring:** Bitwig's own Clip Launcher UI now draws a coloured ring around whichever 8x8 window your hardware is currently pointed at, so you can always see what you're about to trigger.
* **Track Focus + Macro Fader Bank:** The two bottom-left circular buttons cycle Bitwig's track selection (independent of the clip grid), and the **Mode 1** grid becomes a continuous 8x8 fader bank — column = one of 8 Remote Control macros on the currently focused device, row height = the value you're setting (0.0 at the bottom, 1.0 at the top).
* **Empirically Verified Color Engine:** The Smartpad does not support continuous RGB; it has exactly 7 fixed hardware colours. The script converts Bitwig's clip RGB to a hue angle and snaps it to the correct hardware zone — verified against a full visual calibration sweep, not guessed.
* **Zero-Polling Architecture:** Every LED update is driven by a Bitwig observer. No timers, no redundant MIDI.
* **Built-in MIDI Sniffer:** A single commented-out `println` in the MIDI handler — uncomment it if you're adapting this script to a different Smartpad unit or a different controller entirely.

---

## 🎛 Controls Reference

| Control | Function |
| :--- | :--- |
| Main 8x8 grid (CLIP mode) | Launch clips |
| Right-side column (CLIP mode) | Launch scenes (bottom button = Scene 1) |
| Volume | Bank: 8 tracks left |
| Send A | Bank: 8 tracks right |
| Send B | Bank: 8 scenes down |
| Pan | Bank: 8 scenes up |
| Bottom-left circular button (left) | Track Focus: previous track |
| Bottom-left circular button (right) | Track Focus: next track |
| Main 8x8 grid (MODE 1) | Set Remote Control macro `column` to value `row/7` for the focused device |

---

## 🎨 Smartpad Hardware Color Zones

Verified via a multi-round visual calibration sweep (not guessed). The script converts incoming Bitwig RGB to a hue angle and snaps it to the nearest of these 7 zones:

| Velocity Range | Hardware Color |
| :--- | :--- |
| **1 – 16** | White |
| **17 – 32** | Yellow |
| **33 – 48** | Sky Blue |
| **49 – 64** | Magenta / Pink |
| **65 – 80** | Blue |
| **81 – 96** | Green |
| **97 – 127** | Red |

> **Why this matters:** the original "everything lights up red" bug was caused by the old colour-matching code's fallback value (127) sitting inside the Red zone — any clip colour that didn't match a narrow hardcoded RGB band silently fell through to Red. Converting to hue first and snapping to the nearest real hardware colour fixes this properly instead of patching around it.

---

## 🧩 Verified Hardware Quirks

This controller's firmware has some genuine oddities that were only found by sweeping every one of the 64 grid pads — corner-only testing produced formulas that looked "confirmed" but were wrong for every pad in between. If you're adapting this script for a different Smartpad unit, sweep the full grid before trusting any note-mapping formula.

* **Shared channels per mode, not per button:** pressing the hardware's own CLIP / MODE 1 buttons changes what MIDI channel the *same* physical grid reports on. No MIDI message is sent for pressing those buttons themselves — the script only reacts to whichever channel data arrives on.
* **CLIP-mode grid uses 16-note row spacing**, not 8: `row = floor(note / 16)`, `column = note % 16`.
* **MODE-1 grid is a "split-half" layout:** each physical row is two chromatic runs of 4 notes with a +28 jump between them: `note = 36 + 4*y + x + (x >= 4 ? 28 : 0)`.
* **LED memory wipe on mode switch:** the hardware clears its own LED state the instant you flip between CLIP and MODE 1, with no MIDI notification. There's currently no way for the script to detect this and repaint automatically — pressing any bank-navigation button forces a full repaint as a workaround.

---

## 📦 Installation

1. Download the `MidiplusSmartpad.control.js` script file.
2. Place the file into your Bitwig controller scripts folder, inside a subfolder named `Midiplus`:
   * **Windows:** `%USERPROFILE%\Documents\Bitwig Studio\Controller Scripts\Midiplus\`
   * **macOS:** `~/Documents/Bitwig Studio/Controller Scripts/Midiplus/`
   * **Linux:** `~/Bitwig Studio/Controller Scripts/Midiplus/`
3. Open Bitwig Studio and navigate to **Settings > Controllers**.
4. Click **Add controller manually**, select **Midiplus** from the hardware vendor list, and choose **Midiplus Smartpad (Master)**.
5. Set both the MIDI Input and MIDI Output ports to your Smartpad.

> **Note:** the script file must end exactly in `.control.js` (watch out for Windows silently adding a `.txt` extension), and every Bitwig object (track banks, cursor devices, remote control pages) must be created inside `init()` — this is enforced strictly by the Bitwig API and was a common source of crashes during development.

---

## 🧠 Architecture & Development Notes

If you are a developer looking to learn from or modify this script:

* **State Engine:** every clip slot has one state object (`exists`, `playing`, `queued`, `recording`, `r`, `g`, `b`, `lastVelocity`, `lastLedState`). Observers only ever write into this object — a single function, `refreshSlot()`, is the only place that reads it and decides what gets sent to hardware. This keeps LED logic centralized and avoids duplicated on/off decisions scattered across the file.
* **MIDI de-duplication:** `refreshSlot()` compares against the slot's last-sent velocity/state before transmitting anything, so unchanged pads never get redundant MIDI traffic.
* **No polling:** everything is observer-driven. Bitwig fires each observer once immediately on registration with the current value, so the grid paints itself correctly on load.
* **`getClipLauncherSlots()`**, not `clipLauncherSlotBank()`, is the correct accessor for this API surface in this environment — using the wrong one was a real regression encountered during development that silently broke clip launching.
* **`slots.setIndication(true)`** is what enables the coloured session-ring overlay in Bitwig's own Clip Launcher UI.

---

## 🤝 Contributing & License

Contributions, forks, and pull requests are welcome. This script was built as a stable foundation for budget-friendly grid controllers, with every hardware-specific quirk verified against real MIDI sweeps rather than assumed.

**License:** MIT License — free to use, modify, study, and share.
