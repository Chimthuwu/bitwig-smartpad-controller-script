/* =====================================================================
   MIDIPLUS SMARTPAD — BITWIG STUDIO CONTROLLER SCRIPT
   Version: 5.0 (Community Master Edition)
   Author: Chimi (with community/AI-assisted development)
   License: MIT — free to use, modify, study, and share.

   -----------------------------------------------------------------
   WHAT THIS SCRIPT DOES
   -----------------------------------------------------------------
   Turns the Midiplus Smartpad into an 8x8 Bitwig Clip Launcher with:
     - Real LED feedback that matches actual clip colours (7 fixed
       hardware colour zones, not full RGB — see COLOUR ENGINE below)
     - Scene launch buttons (right-side column)
     - Bank navigation: jump the whole 8x8 window by 8 tracks/scenes
       at a time (Volume / Send A / Send B / Pan buttons)
     - A visible "session ring" in Bitwig's own Clip Launcher UI that
       tracks whichever 8x8 window is currently active on hardware
     - "Mode 1": the diagonal split-grid becomes a continuous 8x8
       fader bank (column = one of 8 Remote Control macros on your
       currently focused device, row height = value 0.0–1.0) for
       whichever track you have focused, with two buttons to cycle
       focus between tracks
     - Zero polling. Every LED write is driven by a Bitwig observer.
     - A built-in MIDI sniffer (off by default) for anyone adapting
       this to a different Smartpad unit or a different controller.

   -----------------------------------------------------------------
   VERIFIED HARDWARE QUIRKS (found by full 64-pad sweeps — read this
   before changing any of the note-decoding math below!)
   -----------------------------------------------------------------
   1. FIRMWARE PAGES SHARE MIDI CHANNELS PER FUNCTION, NOT PER BUTTON:
      Pressing the physical "CLIP" vs "MODE 1" buttons on the hardware
      changes what MIDI channel the SAME physical grid/buttons report
      on. There is no MIDI message emitted for pressing CLIP/MODE 1
      themselves — the script only ever reacts to whichever channel
      data shows up on. Confirmed:
        - Channel 1  -> Main 8x8 grid in CLIP mode
        - Channel 16 -> Scene launch buttons in CLIP mode
        - Channel 6  -> Main 8x8 grid + left-side buttons in MODE 1

   2. CLIP-MODE GRID SPACING: the hardware spaces each row of the 8x8
      grid 16 notes apart, not 8. Verified against a full top-left to
      bottom-right sweep: notes ran 0-7, 16-23, 32-39, 48-55, 64-71,
      80-87, 96-103, 112-119. So:
          hardwareRow = floor(note / 16)
          sceneColumn = note % 16

   3. MODE-1 GRID IS A "SPLIT-HALF" LAYOUT, NOT A SIMPLE DIAGONAL:
      A full 64-pad sweep proved each physical row is two chromatic
      runs of 4 notes with a +28 jump between them (e.g. top row:
      64,65,66,67, then jumps to 96,97,98,99), and each row down
      subtracts 4. The formula that fits ALL 64 pads is:
          note = 36 + 4*y + x + (x >= 4 ? 28 : 0)
      where x = column (0-7), y = row counted bottom-up (0-7).
      An earlier "36 + x*5 + y*4" diagonal formula only matched the
      4 corner pads by coincidence and was wrong for every pad in
      between — a good reminder to always sweep the FULL grid rather
      than trust corner-only calibration.

   4. COLOUR IS NOT CONTINUOUS RGB. This hardware has exactly 7 fixed
      colour zones, each spanning 16 MIDI velocity values, confirmed
      via a multi-round visual calibration sweep (not a guess):
          Velocity 1-16    -> White
          Velocity 17-32   -> Yellow
          Velocity 33-48   -> Sky Blue
          Velocity 49-64   -> Magenta / Pink
          Velocity 65-80   -> Blue
          Velocity 81-96   -> Green
          Velocity 97-127  -> Red
      Because the ORIGINAL colour-matching code's fallback velocity
      was 127 (which sits inside the Red zone), any clip colour that
      didn't hit one of its narrow RGB bands silently fell through to
      Red — this is the real, confirmed root cause of the classic
      "every clip lights up red" bug. The fix is not narrower RGB
      bands; it's converting incoming RGB to HUE and snapping it to
      the nearest of the 7 real hardware colours (see
      matchColorToSmartpadVelocity() below).

   5. KNOWN LIMITATION: the hardware wipes its own LED memory the
      instant you physically flip between CLIP and MODE 1 on the
      device. No MIDI message is sent when you do this, so the
      script has no way to know it happened and can't proactively
      repaint. Pressing any bank-navigation button (Volume/Send A/
      Send B/Pan) forces a full repaint of the current window as a
      workaround. If your unit *does* emit something identifiable
      for the CLIP/MODE1 buttons, hook forceRepaintGrid() to it.
   ===================================================================== */

loadAPI(17);

host.defineController(
    "Midiplus",
    "Midiplus Smartpad (Master)",
    "5.0",
    "a6c84c10-b962-11ee-b883-c8348e271c68",
    "Community"
);

host.defineMidiPorts(1, 1);
host.addDeviceNameBasedDiscoveryPair(["Smartpad"], ["Smartpad"]);
host.addDeviceNameBasedDiscoveryPair(["SmartPAD"], ["SmartPAD"]);
host.addDeviceNameBasedDiscoveryPair(["MIDIPLUS SMARTPAD"], ["MIDIPLUS SMARTPAD"]);

// --- GRID DIMENSIONS ---
var GRID_WIDTH = 8;  // tracks
var GRID_HEIGHT = 8; // scenes

// --- CORE BITWIG OBJECTS (assigned inside init(), never before) ---
var trackBank = null;
var sceneBank = null;
var cursorTrack = null;
var cursorDevice = null;
var remoteControls = null;
var midiOut = null;

// ==========================================
// PER-SLOT STATE ENGINE
// ==========================================
// One state object per clip-launcher slot (GRID_WIDTH * GRID_HEIGHT of
// them). Observers ONLY ever write into this object. refreshSlot() is
// the single place that reads it and decides what (if anything) gets
// sent to hardware. Raw RGB is stored as-is and only ever converted to
// a Smartpad velocity inside refreshSlot(), immediately before a MIDI
// message is sent — never earlier.
var slotStates = new Array(GRID_WIDTH * GRID_HEIGHT);

function makeSlotState() {
    return {
        exists: false,      // slot has a clip in it (hasContent)
        playing: false,     // clip is actively playing
        queued: false,      // clip is queued to play (OFF for now — tracked for a future blink)
        recording: false,   // clip is recording (OFF for now — tracked for a future pulse)
        r: 0, g: 0, b: 0,   // raw Bitwig RGB (0.0 - 1.0), untouched until transmit time
        lastVelocity: -1,   // last velocity value actually sent to hardware (for de-dup)
        lastLedState: null  // 'on' | 'off' | null (nothing sent yet)
    };
}

function init() {
    println("Midiplus Smartpad v5.0 (Community Master Edition) Initialized!");

    // --- MIDI ports must be grabbed inside init(), not at file scope ---
    var midiIn = host.getMidiInPort(0);
    midiOut = host.getMidiOutPort(0); // assigns the top-level var declared above

    // --- Clip Launcher grid ---
    trackBank = host.createTrackBank(GRID_WIDTH, 0, GRID_HEIGHT);
    sceneBank = trackBank.sceneBank();

    // --- Track Focus + Mode 1 Remote Control macros ---
    // A single shared cursor, NOT one per track — this follows whatever
    // track/device you (or the two Focus-navigation buttons) select.
    cursorTrack = host.createCursorTrack("SMARTPAD_CURSOR_TRACK", "Cursor Track", 0, 0, true);
    cursorDevice = cursorTrack.createCursorDevice("SMARTPAD_CURSOR_DEVICE", "Cursor Device", 0, CursorDeviceFollowMode.FOLLOW_SELECTION);
    remoteControls = cursorDevice.createCursorRemoteControlsPage(8);

    // --- Initialize the state engine with blank slots ---
    for (var i = 0; i < GRID_WIDTH * GRID_HEIGHT; i++) {
        slotStates[i] = makeSlotState();
    }

    midiIn.setMidiCallback(onMidi0);

    setupClipLauncherObservers();

    // NOTE: there is no polling / refresh timer here on purpose. Every
    // LED update is driven entirely by a Bitwig observer firing. Bitwig
    // fires each observer once immediately on registration with the
    // current value, so the grid paints itself correctly on load.
}

function onMidi0(status, data1, data2) {
    // ==========================================
    // 🕵️ MIDI SNIFFER — commented out by default.
    // Uncomment this line if you're adapting this script to a
    // different Smartpad unit (or a different controller) and need
    // to see the raw channel/note/CC data your hardware is sending.
    // ==========================================
    // println("MIDI -> Status: " + status + " | Data1: " + data1 + " | Data2: " + data2);

    var isDown = data2 > 0;
    var channel = (status & 0x0F) + 1; // convert 0-15 to human-readable 1-16
    var msgType = status & 0xF0;

    // ==========================================
    // CHANNEL 16: CLIP MODE — Scene launch buttons (right-side column)
    // ==========================================
    if (msgType === 0x90 && channel === 16 && isDown) {
        if (data1 >= 112 && data1 <= 119) {
            var sceneIndex = 119 - data1; // bottom button = Scene 1, top button = Scene 8
            sceneBank.getItemAt(sceneIndex).launch();
        }
        return;
    }

    // ==========================================
    // CHANNEL 6: MODE 1 — Bank navigation, Track Focus target, and
    // the continuous Remote Control macro grid
    // ==========================================
    if (msgType === 0x90 && channel === 6 && isDown) {

        // --- Bank paging: jump the whole 8x8 window by 8 at a time ---
        // Confirmed via direct MIDI sniffing of these exact buttons.
        if (data1 === 108) { trackBank.scrollPageBackwards(); forceRepaintGrid(); return; } // Volume: 8 tracks left
        if (data1 === 109) { trackBank.scrollPageForwards();  forceRepaintGrid(); return; } // Send A: 8 tracks right
        if (data1 === 110) { sceneBank.scrollPageForwards();  forceRepaintGrid(); return; } // Send B: 8 scenes down
        if (data1 === 111) { sceneBank.scrollPageBackwards(); forceRepaintGrid(); return; } // Pan:    8 scenes up

        // --- Main grid: Focus Macro fader bank (split-half layout) ---
        if (data1 >= 36 && data1 <= 99) {
            handleMode1Grid(data1);
            return;
        }
    }

    // ==========================================
    // CHANNEL 1: CLIP MODE — Main 8x8 clip launcher grid
    // ==========================================
    if (msgType === 0x90 && channel === 1 && isDown) {
        handleClipLaunch(data1);
        return;
    }

    // ==========================================
    // CC MESSAGES: Arrow / navigation buttons
    // ==========================================
    if (msgType === 0xB0 && isDown) {
        if (data1 === 104) { trackBank.scrollScenesUp();   forceRepaintGrid(); return; } // scene step up
        if (data1 === 105) { trackBank.scrollScenesDown(); forceRepaintGrid(); return; } // scene step down
        // Bottom-left circular buttons: Track Focus navigation (does NOT
        // move the clip-launcher grid — only changes which track/device
        // the Mode 1 macro grid above is controlling).
        if (data1 === 106) { cursorTrack.selectPrevious(); return; }
        if (data1 === 107) { cursorTrack.selectNext();     return; }
    }
}

// ==========================================
// CLIP MODE GRID (Channel 1) — 16-step row spacing
// ==========================================
function handleClipLaunch(note) {
    var hardwareRow = Math.floor(note / 16);
    var sceneColumn = note % 16;

    if (hardwareRow < GRID_HEIGHT && sceneColumn < GRID_WIDTH) {
        trackBank.getItemAt(hardwareRow).getClipLauncherSlots().launch(sceneColumn);
    }
}

// ==========================================
// MODE 1 GRID (Channel 6) — split-half layout, decoded to X/Y,
// used here as a continuous 8x8 fader bank for Focus Macros:
//   column (x) = which of the 8 Remote Control macros
//   row height (y, bottom-up) = the value to set it to (0.0 - 1.0)
// ==========================================
function decodeMode1Grid(note) {
    var n = note - 36;
    var x, y;

    if (n < 32) {
        y = Math.floor(n / 4);
        x = n % 4;
    } else {
        var m = n - 32;
        y = Math.floor(m / 4);
        x = 4 + (m % 4);
    }
    return { x: x, y: y };
}

function handleMode1Grid(note) {
    var coords = decodeMode1Grid(note);
    var parameter = remoteControls.getParameter(coords.x);
    var targetValue = coords.y / 7; // bottom row = 0.0, top row = 1.0
    parameter.set(targetValue);
}

// ==========================================
// CLIP LAUNCHER OBSERVERS -> STATE ENGINE ONLY
// ==========================================
// Every observer below does exactly one thing: write a field into the
// slot's state object, then call refreshSlot(). None of them decide
// what the LED should look like — that's refreshSlot()'s job alone.

function setupClipLauncherObservers() {
    for (var t = 0; t < GRID_WIDTH; t++) {
        var track = trackBank.getItemAt(t);
        var slots = track.getClipLauncherSlots();

        // Draws Bitwig's own coloured "session ring" around whichever
        // 8x8 window is currently active, so you can see on-screen
        // exactly what your hardware is pointed at.
        slots.setIndication(true);

        makeClipObservers(slots, t);
    }
}

function makeClipObservers(slots, trackIndex) {
    // 1. Colour observer: store the RAW rgb. Do NOT reduce to a
    //    velocity here — that only happens at transmit time.
    slots.addColorObserver(function(slotIndex, r, g, b) {
        var cacheIndex = (trackIndex * GRID_HEIGHT) + slotIndex;
        var state = slotStates[cacheIndex];
        state.r = r;
        state.g = g;
        state.b = b;

        // Required debug logging: prove what Bitwig actually sent us
        // and what the colour mapper currently produces from it.
        var mappedVelocity = matchColorToSmartpadVelocity(r, g, b);
        println("Track " + (trackIndex + 1) + " / Slot " + (slotIndex + 1) +
                "  RGB(" + r.toFixed(2) + ", " + g.toFixed(2) + ", " + b.toFixed(2) +
                ")  -> Velocity " + mappedVelocity);

        refreshSlot(trackIndex, slotIndex);
    });

    // 2. Play / queued / recording state — one observer per slot, no polling.
    for (var i = 0; i < GRID_HEIGHT; i++) {
        (function(slotIndex) {
            var slot = slots.getItemAt(slotIndex);

            slot.hasContent().addValueObserver(function(hasContent) {
                slotStates[(trackIndex * GRID_HEIGHT) + slotIndex].exists = hasContent;
                refreshSlot(trackIndex, slotIndex);
            });

            slot.isPlaying().addValueObserver(function(isPlaying) {
                slotStates[(trackIndex * GRID_HEIGHT) + slotIndex].playing = isPlaying;
                refreshSlot(trackIndex, slotIndex);
            });

            slot.isPlaybackQueued().addValueObserver(function(isQueued) {
                slotStates[(trackIndex * GRID_HEIGHT) + slotIndex].queued = isQueued;
                refreshSlot(trackIndex, slotIndex);
            });

            slot.isRecording().addValueObserver(function(isRecording) {
                slotStates[(trackIndex * GRID_HEIGHT) + slotIndex].recording = isRecording;
                refreshSlot(trackIndex, slotIndex);
            });
        })(i);
    }
}

// ==========================================
// THE SINGLE LED DECISION FUNCTION
// ==========================================
// This is the ONLY function in the script that decides whether a pad is
// lit and what colour it shows. Everything above just updates state and
// calls this. This is also where the RGB -> Smartpad velocity
// conversion happens, immediately before transmission (never earlier).
function refreshSlot(trackIndex, slotIndex) {
    var cacheIndex = (trackIndex * GRID_HEIGHT) + slotIndex;
    var state = slotStates[cacheIndex];
    var note = (trackIndex * 16) + slotIndex; // hardware's 16-step row spacing (Channel 1 grid)

    // --- Desired behaviour ---
    // Empty slot     -> OFF
    // Stopped clip   -> OFF
    // Playing clip   -> ON, colour = Bitwig clip colour
    // Queued clip    -> OFF for now (state.queued is tracked for a future blink)
    // Recording clip -> OFF for now (state.recording is tracked for a future pulse)
    var shouldBeOn = state.playing;

    var velocity = 0;
    if (shouldBeOn) {
        velocity = matchColorToSmartpadVelocity(state.r, state.g, state.b);
        if (velocity <= 0) velocity = 1; // guard against an "on" pad with a 0 (off) velocity
    }
    var ledState = shouldBeOn ? "on" : "off";

    // --- MIDI de-duplication: never retransmit LEDs that haven't changed ---
    if (ledState === state.lastLedState && velocity === state.lastVelocity) {
        return;
    }

    if (shouldBeOn) {
        midiOut.sendMidi(0x90, note, velocity);
    } else {
        midiOut.sendMidi(0x80, note, 0);
    }

    state.lastLedState = ledState;
    state.lastVelocity = velocity;
}

// ==========================================
// FORCE REPAINT
// ==========================================
// Invalidates the de-dup cache for every slot and re-runs refreshSlot()
// on all of them, forcing a full LED resend even if nothing in Bitwig's
// state actually changed. Used after bank-navigation jumps so the new
// 8x8 window's colours show up immediately and reliably.
function forceRepaintGrid() {
    for (var t = 0; t < GRID_WIDTH; t++) {
        for (var s = 0; s < GRID_HEIGHT; s++) {
            slotStates[(t * GRID_HEIGHT) + s].lastVelocity = -1;
            slotStates[(t * GRID_HEIGHT) + s].lastLedState = null;
            refreshSlot(t, s);
        }
    }
}

// ==========================================
// COLOUR ENGINE
// ==========================================
// The Smartpad does NOT support continuous RGB — see hardware quirk #4
// at the top of this file. This converts Bitwig's raw RGB into a hue
// angle (0-360°) and snaps it to the nearest of the 7 empirically
// verified hardware colour zones, using the midpoint velocity of each
// zone for a clean, unambiguous match. A low-saturation check catches
// greys/whites before the hue math even runs.
function matchColorToSmartpadVelocity(r, g, b) {
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var delta = max - min;

    // Pure black / very low saturation -> White zone
    var saturation = max === 0 ? 0 : delta / max;
    if (saturation < 0.25) {
        return 16; // White (zone: velocity 1-16)
    }

    // Standard HSV hue calculation (0-360 degrees)
    var hue;
    if (max === r) {
        hue = 60 * (((g - b) / delta) % 6);
    } else if (max === g) {
        hue = 60 * (((b - r) / delta) + 2);
    } else {
        hue = 60 * (((r - g) / delta) + 4);
    }
    if (hue < 0) hue += 360;

    // Snap hue to the nearest of the 6 remaining verified hardware zones
    if (hue < 30 || hue >= 330) return 112; // Red      (zone: velocity 97-127)
    if (hue < 90)               return 24;  // Yellow   (zone: velocity 17-32)
    if (hue < 150)              return 88;  // Green    (zone: velocity 81-96)
    if (hue < 210)              return 40;  // Sky Blue (zone: velocity 33-48)
    if (hue < 270)              return 72;  // Blue     (zone: velocity 65-80)
    return 56;                              // Magenta  (zone: velocity 49-64)
}

/* =====================================================================
   REQUIRED BITWIG API STUBS
   ===================================================================== */
function flush() {
    // All LED output is already handled by refreshSlot(); nothing
    // additional needs to happen here, but Bitwig requires this
    // function to exist.
}

function exit() {
    // Optional cleanup logic.
}
