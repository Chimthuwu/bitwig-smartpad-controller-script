/* =====================================================================
   MIDIPLUS SMARTPAD — BITWIG CONTROLLER SCRIPT
   Version: 4.0 (Community Master Edition)
   Author: Chimi
   
   DESCRIPTION:
   This script turns the Midiplus Smartpad into a native-feeling, 
   rock-solid 8x8 Clip Launcher for Bitwig Studio.

   KEY FEATURES:
   - True 8x8 Clip Launching (Channel 1/16)
   - Verified Mode 1 Remote Control Grid (Channel 6)
   - Zero-polling, 100% Observer-Driven Architecture
   - Custom RGB-to-Hue color matching for the Smartpad's 7 hardware zones
   - Bitwig API compliant (No "Outside of init()" crashes)
   ===================================================================== */

loadAPI(17);

host.defineController(
    "Midiplus",
    "Midiplus Smartpad (Master)",
    "4.0",
    "a6c84c10-b962-11ee-b883-c8348e271c68",
    "Developer"
);

host.defineMidiPorts(1, 1);
host.addDeviceNameBasedDiscoveryPair(["MIDIPLUS SMARTPAD"], ["MIDIPLUS SMARTPAD"]);
host.addDeviceNameBasedDiscoveryPair(["Smartpad"], ["Smartpad"]);
host.addDeviceNameBasedDiscoveryPair(["SmartPAD"], ["SmartPAD"]);

const midiIn = host.getMidiInPort(0);
const midiOut = host.getMidiOutPort(0);

const NUM_TRACKS = 8;
const NUM_SLOTS  = 8;

let trackBank;
let slotStates = [];
let mode1Devices = [];
let mode1Remotes = [];

/* =====================================================================
   INIT
   ---------------------------------------------------------------------
   CRITICAL API NOTE: Bitwig strictly requires that ALL objects 
   (TrackBanks, CursorDevices, RemoteControls, Observers) are created 
   inside this init() function. Creating them inside a MIDI callback 
   will instantly crash the script.
   ===================================================================== */
function init() {
    println("Midiplus Smartpad Controller v4.0 (Community Edition) Loaded!");

    // 1. Create the main track bank (8 Tracks, 0 Sends, 8 Scenes)
    trackBank = host.createTrackBank(NUM_TRACKS, 0, NUM_SLOTS);

    // 2. Pre-allocate Cursor Devices and Remote Controls for Mode 1
    for (let t = 0; t < NUM_TRACKS; t++) {
        let track = trackBank.getTrack(t);
        let device = track.createCursorDevice();
        let remotes = device.createCursorRemoteControlsPage(8);
        mode1Devices[t] = device;
        mode1Remotes[t] = remotes;
    }

    // 3. Build the State Engine and attach Observers
    for (let t = 0; t < NUM_TRACKS; t++) {
        slotStates[t] = [];
        let track = trackBank.getTrack(t);
        
        // Observers MUST be attached to the SlotBank, not individual slots
        let slots = track.getClipLauncherSlots(); 

        for (let s = 0; s < NUM_SLOTS; s++) {
            // Initialize a blank state for every pad on the 8x8 grid
            slotStates[t][s] = {
                exists: false,
                playing: false,
                queued: false,
                recording: false,
                r: 0.5, g: 0.5, b: 0.5,
                lastVelocity: -1,
                lastLedState: false
            };
        }

        // Attach boolean state observers
        slots.addHasContentObserver((slotIndex, exists) => {
            slotStates[t][slotIndex].exists = exists;
            refreshSlot(t, slotIndex);
        });

        slots.addIsPlayingObserver((slotIndex, playing) => {
            slotStates[t][slotIndex].playing = playing;
            refreshSlot(t, slotIndex);
        });

        slots.addIsPlaybackQueuedObserver((slotIndex, queued) => {
            slotStates[t][slotIndex].queued = queued;
            refreshSlot(t, slotIndex);
        });

        slots.addIsRecordingObserver((slotIndex, recording) => {
            slotStates[t][slotIndex].recording = recording;
            refreshSlot(t, slotIndex);
        });

        // Attach raw RGB color observer
        slots.addColorObserver((slotIndex, r, g, b) => {
            let st = slotStates[t][slotIndex];
            st.r = r; st.g = g; st.b = b;
            refreshSlot(t, slotIndex);
        });
    }

    // Route all incoming MIDI data to our onMidi function
    midiIn.setMidiCallback(onMidi);
}

/* =====================================================================
   MIDI ROUTER
   ---------------------------------------------------------------------
   Directs incoming MIDI messages based on the Smartpad's active mode.
   - CLIP Mode defaults to Channel 1 (Grid) and 16 (Scenes).
   - MODE 1 defaults to Channel 6.
   ===================================================================== */
function onMidi(status, data1, data2) {
    let type = status & 0xF0;
    let channel = (status & 0x0F) + 1; // Convert 0-15 to human-readable 1-16
    let isDown = data2 > 0;

    // Handle Pad Presses (Note On)
    if (type === 0x90 && isDown) {
        
        // A. CLIP MODE - MAIN GRID (Channel 1)
        if (channel === 1) {
            handleClipPress(data1);
        }
        
        // B. CLIP MODE - SCENE LAUNCH BUTTONS (Channel 16)
        else if (channel === 16) {
            if (data1 >= 112 && data1 <= 119) {
                let sceneIndex = 119 - data1; // Reverses the hardware order to match UI
                trackBank.sceneBank().getItemAt(sceneIndex).launch();
            }
        }
        
        // C. MODE 1 - REMOTE CONTROLS (Channel 6)
        else if (channel === 6) {
            handleMode1Press(data1);
        }
    } 
    
    // Handle Navigation Arrows (CC Messages)
    else if (type === 0xB0 && isDown) {
        if (data1 === 104) trackBank.scrollScenesUp();
        if (data1 === 105) trackBank.scrollScenesDown();
        if (data1 === 106) trackBank.scrollTracksUp();
        if (data1 === 107) trackBank.scrollTracksDown();
    }
}

/* =====================================================================
   CLIP MODE HANDLER
   ---------------------------------------------------------------------
   The Smartpad spaces its Clip grid using 16-note intervals per row.
   ===================================================================== */
function handleClipPress(note) {
    let trackIndex = Math.floor(note / 16);
    let slotIndex  = note % 16;

    if (trackIndex < NUM_TRACKS && slotIndex < NUM_SLOTS) {
        trackBank.getTrack(trackIndex).getClipLauncherSlots().launch(slotIndex);
    }
}

/* =====================================================================
   MODE 1 HANDLER (REMOTE CONTROLS)
   ---------------------------------------------------------------------
   Through empirical testing, the Smartpad's Mode 1 grid is wired as 
   two 4-column split-chromatic blocks. This mathematically decodes 
   the note number into clean X/Y grid coordinates.
   ===================================================================== */
function decodeMode1(note) {
    let n = note - 36;
    if (n < 32) {
        return { x: n % 4, y: Math.floor(n / 4) };
    } else {
        let m = n - 32;
        return { x: 4 + (m % 4), y: Math.floor(m / 4) };
    }
}

function handleMode1Press(note) {
    // Only process notes inside the actual Mode 1 grid
    if (note >= 36 && note <= 99) {
        let { x, y } = decodeMode1(note);
        // Sets the mapped parameter to maximum value upon press
        mode1Remotes[y].getParameter(x).set(127, 128); 
    }
}

/* =====================================================================
   LED COLOR ENGINE
   ---------------------------------------------------------------------
   The Smartpad does not support continuous RGB blending. It uses 7 
   fixed hardware colors divided into 16-step velocity zones. 
   This function converts Bitwig's raw RGB into Hue, and snaps it 
   to the correct Smartpad velocity zone.
   ===================================================================== */
function matchColorToSmartpadVelocity(r, g, b) {
    // 1. Catch pure black (Off)
    if (r === 0 && g === 0 && b === 0) return 0;

    let max = Math.max(r, g, b);
    let min = Math.min(r, g, b);
    let delta = max - min;

    // 2. Catch Whites and Greys (Low Saturation)
    let saturation = max === 0 ? 0 : delta / max;
    if (saturation < 0.25) {
        return 8; // White (Velocity Band: 1-16)
    }

    // 3. Calculate Hue (0 to 360 degrees)
    let hue = 0;
    if (delta !== 0) {
        if (max === r) hue = ((g - b) / delta) % 6;
        else if (max === g) hue = ((b - r) / delta) + 2;
        else hue = ((r - g) / delta) + 4;
        
        hue = Math.round(hue * 60);
        if (hue < 0) hue += 360;
    }

    // 4. Snap Hue to the nearest Smartpad hardware zone
    if (hue >= 330 || hue < 25) return 112; // Red (Band 97-127)
    if (hue >= 25 && hue < 80) return 24;   // Yellow (Band 17-32)
    if (hue >= 80 && hue < 160) return 88;  // Green (Band 81-96)
    if (hue >= 160 && hue < 200) return 40; // Sky Blue (Band 33-48)
    if (hue >= 200 && hue < 260) return 72; // Blue (Band 65-80)
    if (hue >= 260 && hue < 330) return 56; // Magenta / Pink (Band 49-64)

    return 112; // Fallback to Red
}

/* =====================================================================
   LED REFRESH ENGINE (SOLID COLORS)
   ---------------------------------------------------------------------
   This acts as the single choke-point for all LED output, ensuring 
   MIDI data is de-duplicated and only sent when a state actually changes.
   ===================================================================== */
function refreshSlot(t, s) {
    let st = slotStates[t][s];
    
    // Only illuminate if the slot has content AND is active
    let shouldBeOn = st.exists && (st.playing || st.recording || st.queued);
    let velocity = 0;
    
    if (shouldBeOn) {
        velocity = matchColorToSmartpadVelocity(st.r, st.g, st.b);
        if (velocity <= 0) velocity = 1; // Failsafe to prevent invisible "On" states
    }

    // MIDI De-duplication: Do nothing if the light is already correct
    if (st.lastVelocity === velocity && st.lastLedState === shouldBeOn) return;

    st.lastVelocity = velocity;
    st.lastLedState = shouldBeOn;

    let note = (t * 16) + s;
    
    // Send to hardware via Channel 1 (0x90/0x80)
    if (shouldBeOn) {
        midiOut.sendMidi(0x90, note, velocity); // Proper Note On 
    } else {
        midiOut.sendMidi(0x80, note, 0);        // Proper Note Off (Extinguishes LED)
    }
}

/* =====================================================================
   EXIT
   ===================================================================== */
function exit() {
    // Optional cleanup logic
}