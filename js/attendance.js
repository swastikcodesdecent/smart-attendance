import { db, rtdb } from "./firebase-config.js";
import { ref as dbRef, set, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  doc, 
  getDoc, 
  setDoc, 
  deleteDoc, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Audio Context Synthesizer (Native Web Audio API)
let audioCtx = null;

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function playSuccessSound() {
  try {
    initAudio();
    const playNote = (frequency, startTime, duration) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(frequency, startTime);
      gain.gain.setValueAtTime(0.08, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      osc.start(startTime);
      osc.stop(startTime + duration);
    };
    const now = audioCtx.currentTime;
    playNote(523.25, now, 0.12);     // C5
    playNote(659.25, now + 0.08, 0.25); // E5
  } catch (e) {
    console.warn("Audio synthesis block:", e);
  }
}

function playFailureSound() {
  try {
    initAudio();
    const playNote = (frequency, startTime, duration) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(frequency, startTime);
      gain.gain.setValueAtTime(0.08, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      osc.start(startTime);
      osc.stop(startTime + duration);
    };
    const now = audioCtx.currentTime;
    playNote(180.00, now, 0.35); // Low buzzing G3/F#3
  } catch (e) {
    console.warn("Audio synthesis block:", e);
  }
}

// PIN SHA-256 Hashing Function
async function hashPIN(pin) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Format date & time helper functions
function getLocalDateString() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getLocalTimeString() {
  const d = new Date();
  return d.toTimeString().split(' ')[0]; // HH:MM:SS
}

// DOM Elements
const screenIdle = document.getElementById("screen-idle");
const screenPin = document.getElementById("screen-pin");
const screenLoading = document.getElementById("screen-loading");
const screenSuccess = document.getElementById("screen-success");
const screenError = document.getElementById("screen-error");

const previewPhoto = document.getElementById("student-preview-photo");
const previewName = document.getElementById("student-preview-name");
const previewReg = document.getElementById("student-preview-reg");
const previewClass = document.getElementById("student-preview-class");
const successStudentName = document.getElementById("success-student-name");

const errorTitle = document.getElementById("error-title");
const errorDescription = document.getElementById("error-description");
const btnErrorReset = document.getElementById("btn-error-reset");

const btnStartCam = document.getElementById("btn-start-camera");
const btnStopCam = document.getElementById("btn-stop-camera");
const scannerViewport = document.getElementById("scanner-view-container");
const pinCancelBtn = document.getElementById("btn-pin-cancel");
const pinBackspaceBtn = document.getElementById("btn-pin-backspace");

// UI State Constants
let html5QrCode = null;
let currentStudent = null;
let pinBuffer = "";
let isCameraActive = false;

// 1. Toast Notification Helper
function showToast(title, message, type = "info") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  
  let iconName = "info";
  if (type === "success") iconName = "check-circle";
  if (type === "danger") iconName = "x-circle";
  if (type === "warning") iconName = "alert-triangle";

  toast.innerHTML = `
    <i data-lucide="${iconName}" style="width: 20px; height: 20px; flex-shrink: 0;"></i>
    <div>
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
  `;
  container.appendChild(toast);
  lucide.createIcons();

  setTimeout(() => {
    toast.style.animation = "slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1) reverse forwards";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// 2. View Switcher Screen Utility
function showScreen(screen) {
  screenIdle.style.display = "none";
  screenPin.style.display = "none";
  screenLoading.style.display = "none";
  screenSuccess.style.display = "none";
  screenError.style.display = "none";

  if (screen === "idle") screenIdle.style.display = "flex";
  if (screen === "pin") screenPin.style.display = "flex";
  if (screen === "loading") screenLoading.style.display = "flex";
  if (screen === "success") screenSuccess.style.display = "flex";
  if (screen === "error") screenError.style.display = "flex";
}

// 3. Camera lifecycle handlers
async function startCamera() {
  
  try {
    initAudio(); // Initialize audio context on user interaction
    
    if (!html5QrCode) {
      html5QrCode = new Html5Qrcode("reader");
    }
    
    btnStartCam.disabled = true;
    showToast("Camera Initializing", "Starting scanner viewport...", "info");

    await html5QrCode.start(
      { facingMode: "environment" },
      {
        fps: 10,
        qrbox: { width: 250, height: 250 }
      },
      onScanSuccess,
      onScanFailure
    );

    isCameraActive = true;
    scannerViewport.classList.add("scanning");
    btnStopCam.disabled = false;
    showToast("Scanner Ready", "Place QR code inside scanner brackets.", "success");
  } catch (err) {
    console.error("Camera startup failed:", err);
    btnStartCam.disabled = false;
    showToast("Camera Error", "Could not request camera access. Ensure permission is granted.", "danger");
  }
}

async function stopCamera() {
  if (html5QrCode && isCameraActive) {
    try {
      await html5QrCode.stop();
      isCameraActive = false;
      scannerViewport.classList.remove("scanning");
      btnStartCam.disabled = false;
      btnStopCam.disabled = true;
      showToast("Scanner Stopped", "Camera turned off.", "warning");
    } catch (err) {
      console.error("Camera stop failed:", err);
    }
  }
}

// 4. Scanning trigger handler
async function onScanSuccess(decodedText) {
  const registrationNumber = decodedText.trim();
  if (!registrationNumber) return;

  // Temporarily pause camera scanning logic by stopping camera to prevent overlapping requests
  await stopCamera();

  showScreen("loading");
  showToast("Card Read", `Processing Registration: ${registrationNumber}`, "info");

  try {
    const today = getLocalDateString();

    // A. Check failedAttempts lock state first
    const lockRef = doc(db, "failedAttempts", registrationNumber);
    const lockSnap = await getDoc(lockRef);
    if (lockSnap.exists()) {
      const lockData = lockSnap.data();
      const lockedUntil = lockData.lockedUntil?.toDate().getTime() || 0;
      if (lockedUntil > Date.now()) {
        const remainingSec = Math.ceil((lockedUntil - Date.now()) / 1000);
        playFailureSound();
        showScreen("error");
        errorTitle.innerText = "Account Locked";
        errorDescription.innerText = `Too many incorrect attempts. Please contact the school office. Locked for another ${remainingSec} seconds.`;
        return;
      }
    }

    // B. Check duplicate daily attendance
    const attendanceDocId = `${registrationNumber}_${today}`;
    const attendRef = doc(db, "attendance", attendanceDocId);
    const attendSnap = await getDoc(attendRef);
    if (attendSnap.exists()) {
      playFailureSound();
      showScreen("error");
      errorTitle.innerText = "Duplicate Scan";
      errorDescription.innerText = "Attendance already marked for today.";
      return;
    }

    // C. Search student or teacher in Firestore
    let matchedPerson = null;
    let personRole = "student";

    if (registrationNumber.startsWith("TCH")) {
      const teachersCol = collection(db, "teachers");
      const q = query(teachersCol, where("teacherId", "==", registrationNumber));
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        const teacherDoc = querySnapshot.docs[0];
        matchedPerson = { id: teacherDoc.id, ...teacherDoc.data() };
        personRole = "teacher";
      }
    } else {
      const studentsCol = collection(db, "students");
      const q = query(studentsCol, where("registrationNumber", "==", registrationNumber));
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        const studentDoc = querySnapshot.docs[0];
        matchedPerson = { id: studentDoc.id, ...studentDoc.data() };
        personRole = "student";
      }
    }

    if (!matchedPerson) {
      playFailureSound();
      showScreen("error");
      errorTitle.innerText = "Record Not Found";
      errorDescription.innerText = `No student or teacher matched code: ${registrationNumber}`;
      return;
    }

    currentStudent = matchedPerson;
    currentStudent.role = personRole;

    // D. Launch PIN panel
    previewName.innerText = currentStudent.name;
    previewReg.innerText = (currentStudent.role === "teacher") ? currentStudent.teacherId : currentStudent.registrationNumber;
    previewClass.innerText = `Class: ${currentStudent.class} - Section ${currentStudent.section}`;
    
    const defaultPhoto = (currentStudent.role === "teacher")
      ? "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop"
      : "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop";
    previewPhoto.src = currentStudent.photoURL || defaultPhoto;

    // Show PIN screen & reset input states
    pinBuffer = "";
    updatePinDots();
    showScreen("pin");

  } catch (error) {
    console.error("Scanning search database fail:", error);
    playFailureSound();
    showScreen("error");
    errorTitle.innerText = "System Query Error";
    errorDescription.innerText = "Unable to fetch student details. Try scanning again.";
  }
}

function onScanFailure(error) {
  // Silent parsing warnings
}

// 5. PIN Interface Keypad Logic
const keypadBtns = document.querySelectorAll(".keypad-btn:not(.action-btn)");
keypadBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    if (pinBuffer.length < 4) {
      pinBuffer += btn.dataset.val;
      updatePinDots();
      
      // Auto submit on reaching 4 digits
      if (pinBuffer.length === 4) {
        verifyEnteredPin();
      }
    }
  });
});

pinBackspaceBtn.addEventListener("click", () => {
  if (pinBuffer.length > 0) {
    pinBuffer = pinBuffer.slice(0, -1);
    updatePinDots();
  }
});

pinCancelBtn.addEventListener("click", () => {
  pinBuffer = "";
  currentStudent = null;
  showScreen("idle");
  // Automatically resume camera
  startCamera();
});

btnErrorReset.addEventListener("click", () => {
  showScreen("idle");
  startCamera();
});

function updatePinDots() {
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById(`dot-${i}`);
    if (i < pinBuffer.length) {
      dot.classList.add("filled");
    } else {
      dot.classList.remove("filled");
    }
  }
}

// 6. Security PIN verification & Daily write execution
async function verifyEnteredPin() {
  showScreen("loading");

  try {
    const enteredHash = await hashPIN(pinBuffer);
    const dbHash = currentStudent.attendancePIN;

    const isTeacher = currentStudent.role === "teacher";
    const idNumber = isTeacher ? currentStudent.teacherId : currentStudent.registrationNumber;

    if (enteredHash === dbHash) {
      // SUCCESS: MARK ATTENDANCE
      const today = getLocalDateString();
      const nowTime = getLocalTimeString();
      
      // Fetch school system settings to read late-in parameters
      let checkInStatus = "Present";
      try {
        const sysSettings = await getDoc(doc(db, "settings", "system"));
        if (sysSettings.exists()) {
          const sysData = sysSettings.data();
          const lateTimeString = sysData.lateTime || "08:30";
          
          if (!isTeacher) {
            if (nowTime > "11:30") {
              checkInStatus = "Absent"; // Arriving after 11:30 marks them Absent
            } else if (nowTime > lateTimeString) {
              checkInStatus = "Late";   // Arriving after lateTime but before 11:30 marks them Late
            }
          }
        }
      } catch (e) {
        console.error("System settings read error:", e);
      }

      // Write attendance record
      const attendanceDocId = `${idNumber}_${today}`;
      const record = {
        registrationNumber: idNumber,
        studentName: currentStudent.name,
        class: currentStudent.class,
        section: currentStudent.section,
        role: isTeacher ? "teacher" : "student",
        teacherId: isTeacher ? currentStudent.id : (currentStudent.teacherId || ""),
        date: today,
        entryTime: nowTime,
        timestamp: serverTimestamp(),
        status: checkInStatus
      };

      // Write attendance record to Firestore
      await setDoc(doc(db, "attendance", attendanceDocId), record);

      // Write attendance record to Realtime Database
      await set(dbRef(rtdb, `attendance/${today}/${idNumber}`), {
        ...record,
        timestamp: Date.now()
      });

      // Clean up failed attempts logs on success
      await deleteDoc(doc(db, "failedAttempts", idNumber));
      await remove(dbRef(rtdb, `failedAttempts/${idNumber}`));

      // Trigger alerts and animations
      playSuccessSound();
      successStudentName.innerText = currentStudent.name;
      showScreen("success");
      showToast("Success", `Attendance marked for ${currentStudent.name}`, "success");

      // Auto-reset back to idle screen after delay and resume scanning
      setTimeout(() => {
        pinBuffer = "";
        currentStudent = null;
        showScreen("idle");
        startCamera();
      }, 3000);

    } else {
      // FAIL: WRONG PIN ENTRY
      playFailureSound();
      
      const lockRef = doc(db, "failedAttempts", idNumber);
      const lockSnap = await getDoc(lockRef);
      
      let attemptsCount = 1;
      let logs = [];
      const timestampNow = new Date();

      if (lockSnap.exists()) {
        const lockData = lockSnap.data();
        attemptsCount = (lockData.count || 0) + 1;
        logs = lockData.logs || [];
      }

      logs.push({
        timestamp: timestampNow,
        type: "Incorrect PIN"
      });

      const lockRecord = {
        registrationNumber: idNumber,
        count: attemptsCount,
        lockedUntil: null,
        lastAttempt: timestampNow.getTime()
      };

      if (attemptsCount >= 3) {
        // LOCK ACCOUNT FOR 2 MINUTES (120,000ms)
        const lockedUntilTime = new Date(Date.now() + 120000);
        lockRecord.lockedUntil = lockedUntilTime.getTime();

        // Write lock to Firestore
        await setDoc(lockRef, {
          ...lockRecord,
          lockedUntil: lockedUntilTime,
          lastAttempt: timestampNow,
          logs: logs
        });

        // Write lock to Realtime Database
        await set(dbRef(rtdb, `failedAttempts/${idNumber}`), lockRecord);

        showScreen("error");
        errorTitle.innerText = "Account Locked";
        errorDescription.innerText = "Too many incorrect attempts. Please contact the school office. Access locked for 2 minutes.";
        showToast("Access Locked", "Too many invalid entries.", "danger");
      } else {
        // Increment attempts, write back, flash input screen
        // Write attempt log to Firestore
        await setDoc(lockRef, {
          ...lockRecord,
          lastAttempt: timestampNow,
          logs: logs
        });

        // Write attempt log to Realtime Database
        await set(dbRef(rtdb, `failedAttempts/${idNumber}`), lockRecord);

        // Let them retype the PIN with visual alert toast
        pinBuffer = "";
        updatePinDots();
        showScreen("pin");
        showToast("Incorrect PIN", `Invalid credentials. Attempts left: ${3 - attemptsCount}`, "danger");
      }
    }

  } catch (error) {
    console.error("PIN verification process failure:", error);
    playFailureSound();
    showScreen("error");
    errorTitle.innerText = "Processing Error";
    errorDescription.innerText = "An error occurred during verification. Try scan again.";
  }
}

// 7. Parent telegram webhook trigger


// 8. Onload configuration and bindings
document.addEventListener("DOMContentLoaded", () => {
  btnStartCam.addEventListener("click", startCamera);
  btnStopCam.addEventListener("click", stopCamera);
  
  // Initialize lucide icons
  if (window.lucide) {
    window.lucide.createIcons();
  }

  startLiveClock();
});

// Live running clock helper in header
function startLiveClock() {
  const clockElement = document.getElementById("live-clock");
  if (!clockElement) return;
  const updateClock = () => {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    clockElement.innerHTML = `<span style="font-family: 'Outfit'; font-weight: 500; font-size: 0.75rem; color: var(--text-muted); margin-right: 0.5rem;">${dateStr}</span> ${timeStr}`;
  };
  updateClock();
  setInterval(updateClock, 1000);
}
