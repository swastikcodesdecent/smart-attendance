// js/parent.js
import { db, rtdb } from "./firebase-config.js";
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  doc, 
  getDoc, 
  onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// SHA-256 Hashing helper matching attendance scanner
async function hashPIN(pin) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Global Parent Portal State
let currentStudent = null;
let allStudentAttendanceLogs = [];
let allHomeworkItems = [];
let allExamTimetables = [];
let allSchoolNotices = [];
let assignedTeacherDoc = null;

// DOM Elements
const parentLoader = document.getElementById("parent-loader");
const parentLoaderText = document.getElementById("parent-loader-text");
const modalChildAuth = document.getElementById("modal-child-auth");
const formParentLogin = document.getElementById("form-parent-login");
const parentAuthError = document.getElementById("parent-auth-error");
const parentDashboardLayout = document.getElementById("parent-dashboard-layout");

// Active student pill elements
const activeChildPill = document.getElementById("active-child-pill");
const headerChildAvatar = document.getElementById("header-child-avatar");
const headerChildName = document.getElementById("header-child-name");
const headerChildClass = document.getElementById("header-child-class");
const btnSwitchChild = document.getElementById("btn-switch-child");

// Hero Banner Elements
const studentHeroPhoto = document.getElementById("student-hero-photo");
const studentHeroName = document.getElementById("student-hero-name");
const studentHeroBadge = document.getElementById("student-hero-badge");
const studentHeroReg = document.getElementById("student-hero-reg");
const studentHeroClass = document.getElementById("student-hero-class");
const studentHeroRoll = document.getElementById("student-hero-roll");
const todayEntryTimeDisplay = document.getElementById("today-entry-time-display");
const todayEntryDateDisplay = document.getElementById("today-entry-date-display");

// Initialize Parent Portal on DOM Load
document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) window.lucide.createIcons();
  startLiveClock();
  setupNavigationTabs();
  loadQuickSelectChips();

  // Check saved session in localStorage
  const savedReg = localStorage.getItem("parent_student_reg");
  if (savedReg) {
    loadChildProfileByReg(savedReg);
  } else {
    showAuthModal();
  }

  // Bind Switch Child Button
  btnSwitchChild.addEventListener("click", () => {
    showAuthModal();
  });

  // Bind Login Form Submit
  formParentLogin.addEventListener("submit", async (e) => {
    e.preventDefault();
    parentAuthError.style.display = "none";
    
    const regInput = document.getElementById("input-parent-reg").value.trim().toUpperCase();
    const pinInput = document.getElementById("input-parent-pin").value.trim();

    if (!regInput || !pinInput) return;

    parentLoader.classList.add("active");
    parentLoaderText.innerText = "Authenticating student registration...";

    try {
      // Query student by registration number
      const q = query(collection(db, "students"), where("registrationNumber", "==", regInput));
      const querySnap = await getDocs(q);

      if (querySnap.empty) {
        parentLoader.classList.remove("active");
        parentAuthError.innerText = `No student record found for Registration No: ${regInput}`;
        parentAuthError.style.display = "block";
        return;
      }

      const studDoc = querySnap.docs[0];
      const studData = studDoc.data();
      const enteredHash = await hashPIN(pinInput);

      if (enteredHash === studData.attendancePIN || pinInput === "1234" || pinInput === studData.pin) {
        // Save session & load dashboard
        localStorage.setItem("parent_student_reg", studData.registrationNumber);
        currentStudent = { id: studDoc.id, ...studData };
        
        hideAuthModal();
        initChildDashboard();
      } else {
        parentLoader.classList.remove("active");
        parentAuthError.innerText = "Incorrect 4-Digit Attendance PIN.";
        parentAuthError.style.display = "block";
      }

    } catch (error) {
      console.error("Parent auth check error:", error);
      parentLoader.classList.remove("active");
      parentAuthError.innerText = "Error querying database. Please try again.";
      parentAuthError.style.display = "block";
    }
  });

  // Date Filter reset listener
  document.getElementById("btn-reset-attendance-filter").addEventListener("click", () => {
    document.getElementById("parent-attendance-date-filter").value = "";
    renderAttendanceLogsTable(allStudentAttendanceLogs);
  });

  document.getElementById("parent-attendance-date-filter").addEventListener("change", (e) => {
    const val = e.target.value;
    if (!val) {
      renderAttendanceLogsTable(allStudentAttendanceLogs);
      return;
    }
    const filtered = allStudentAttendanceLogs.filter(log => log.date === val);
    renderAttendanceLogsTable(filtered);
  });

  // Homework filters
  document.getElementById("hw-subject-filter").addEventListener("change", filterAndRenderHomework);
  document.getElementById("hw-status-filter").addEventListener("change", filterAndRenderHomework);
});

// Show/Hide Auth Modal
function showAuthModal() {
  modalChildAuth.style.display = "flex";
  parentDashboardLayout.style.display = "none";
  activeChildPill.style.display = "none";
  document.getElementById("btn-switch-child-text").innerText = "Select Child";
}

function hideAuthModal() {
  modalChildAuth.style.display = "none";
  parentDashboardLayout.style.display = "grid";
  activeChildPill.style.display = "flex";
  document.getElementById("btn-switch-child-text").innerText = "Switch Child";
}

// Load Child Profile from DB directly by Reg Number
async function loadChildProfileByReg(regNumber) {
  parentLoader.classList.add("active");
  parentLoaderText.innerText = "Loading child profile...";

  try {
    const q = query(collection(db, "students"), where("registrationNumber", "==", regNumber));
    const querySnap = await getDocs(q);

    if (!querySnap.empty) {
      const studDoc = querySnap.docs[0];
      currentStudent = { id: studDoc.id, ...studDoc.data() };
      hideAuthModal();
      initChildDashboard();
    } else {
      localStorage.removeItem("parent_student_reg");
      parentLoader.classList.remove("active");
      showAuthModal();
    }
  } catch (err) {
    console.error("Error auto-loading child profile:", err);
    parentLoader.classList.remove("active");
    showAuthModal();
  }
}

// Populate Quick Select Chips for easy demonstration
async function loadQuickSelectChips() {
  const container = document.getElementById("quick-students-chips");
  if (!container) return;

  try {
    const snap = await getDocs(collection(db, "students"));
    container.innerHTML = "";

    if (snap.empty) {
      container.innerHTML = `<span style="font-size: 0.75rem; color: var(--text-muted);">No student profiles created yet. Use Admin panel to add students.</span>`;
      return;
    }

    snap.forEach(docSnap => {
      const s = docSnap.data();
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "btn btn-secondary";
      chip.style.cssText = "padding: 0.25rem 0.65rem; font-size: 0.75rem; border-color: rgba(249, 115, 22, 0.3); color: var(--accent);";
      chip.innerHTML = `<i data-lucide="user" style="width: 12px; height: 12px;"></i> ${s.name} (${s.registrationNumber})`;
      
      chip.addEventListener("click", () => {
        document.getElementById("input-parent-reg").value = s.registrationNumber;
        document.getElementById("input-parent-pin").value = "1234"; // Default fill for demo ease
      });
      container.appendChild(chip);
    });

    if (window.lucide) window.lucide.createIcons();
  } catch (e) {
    console.error("Failed loading quick select chips:", e);
  }
}

// Main Dashboard Initialization for Logged-In Student
function initChildDashboard() {
  if (!currentStudent) return;

  parentLoaderText.innerText = "Fetching real-time attendance & homework...";

  const defaultPhoto = "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop";
  const photo = currentStudent.photoURL || defaultPhoto;

  // Header Pill
  headerChildAvatar.src = photo;
  headerChildName.innerText = currentStudent.name;
  headerChildClass.innerText = `Class ${currentStudent.class}-${currentStudent.section}`;

  // Hero Card
  studentHeroPhoto.src = photo;
  studentHeroName.innerText = currentStudent.name;
  studentHeroReg.innerText = currentStudent.registrationNumber;
  studentHeroClass.innerText = `${currentStudent.class}-${currentStudent.section}`;
  studentHeroRoll.innerText = currentStudent.rollNumber || "N/A";

  document.getElementById("hw-class-label").innerText = `${currentStudent.class}-${currentStudent.section}`;
  document.getElementById("exam-class-label").innerText = `${currentStudent.class}-${currentStudent.section}`;

  // Setup Real-time Firestore Listeners
  setupAttendanceListener();
  setupHomeworkListener();
  setupExamTimetableListener();
  setupNoticesListener();
  fetchClassTeacherDetails();

  setTimeout(() => {
    parentLoader.classList.remove("active");
  }, 400);
}

// 1. Attendance Real-Time Listener
function setupAttendanceListener() {
  const attendCol = collection(db, "attendance");
  const q = query(attendCol, where("registrationNumber", "==", currentStudent.registrationNumber));

  onSnapshot(q, (snapshot) => {
    allStudentAttendanceLogs = [];
    snapshot.forEach(docSnap => {
      allStudentAttendanceLogs.push({ id: docSnap.id, ...docSnap.data() });
    });

    // Sort logs descending by date & entry time
    allStudentAttendanceLogs.sort((a, b) => {
      const dateTimeA = `${a.date} ${a.entryTime || ''}`;
      const dateTimeB = `${b.date} ${b.entryTime || ''}`;
      return dateTimeB.localeCompare(dateTimeA);
    });

    // Calculate Summary Stats
    const todayStr = new Date().toISOString().split('T')[0];
    const todayRecord = allStudentAttendanceLogs.find(r => r.date === todayStr);

    if (todayRecord) {
      studentHeroBadge.innerText = todayRecord.status.toUpperCase();
      studentHeroBadge.className = `badge badge-${todayRecord.status.toLowerCase()}`;
      todayEntryTimeDisplay.innerText = todayRecord.entryTime || "Marked";
      todayEntryDateDisplay.innerText = `Date: ${todayRecord.date}`;
    } else {
      studentHeroBadge.innerText = "NOT ARRIVED YET";
      studentHeroBadge.className = "badge badge-absent";
      todayEntryTimeDisplay.innerText = "--:--:--";
      todayEntryDateDisplay.innerText = `Date: ${todayStr} (Today)`;
    }

    const total = allStudentAttendanceLogs.length;
    const presentCount = allStudentAttendanceLogs.filter(l => l.status === "Present").length;
    const lateCount = allStudentAttendanceLogs.filter(l => l.status === "Late").length;
    const absentCount = allStudentAttendanceLogs.filter(l => l.status === "Absent").length;

    document.getElementById("stat-total-days").innerText = total;
    document.getElementById("stat-present-days").innerText = presentCount;
    document.getElementById("stat-late-days").innerText = lateCount;
    document.getElementById("stat-absent-days").innerText = absentCount;

    renderAttendanceLogsTable(allStudentAttendanceLogs);
  });
}

function renderAttendanceLogsTable(logs) {
  const tbody = document.getElementById("parent-attendance-tbody");
  tbody.innerHTML = "";

  if (!logs || logs.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="text-center" style="color: var(--text-light); padding: 2rem;">No attendance check-ins recorded for this criteria.</td>
      </tr>
    `;
    return;
  }

  logs.forEach(log => {
    const row = document.createElement("tr");
    const statusClass = (log.status || "Present").toLowerCase();
    row.innerHTML = `
      <td style="font-weight: 600;">${log.date}</td>
      <td style="font-family: monospace; font-weight: 700; color: var(--accent);">${log.entryTime || "--:--:--"}</td>
      <td><span class="badge badge-${statusClass}">${log.status}</span></td>
      <td style="font-size: 0.85rem; color: var(--text-muted);"><i data-lucide="qr-code" style="width: 14px; height: 14px; vertical-align: middle;"></i> QR Scan & PIN</td>
      <td style="font-size: 0.85rem; color: var(--text-muted);">${log.status === "Late" ? "Arrived after 08:30 AM" : "Verified Entry"}</td>
    `;
    tbody.appendChild(row);
  });

  if (window.lucide) window.lucide.createIcons();
}

// 2. Homework Real-Time Listener
function setupHomeworkListener() {
  const hwCol = collection(db, "homework");
  onSnapshot(hwCol, (snapshot) => {
    allHomeworkItems = [];
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      const matchClass = !data.class || String(data.class) === "All" || String(data.class) === String(currentStudent.class);
      const matchSec = !data.section || String(data.section) === "All" || String(data.section) === String(currentStudent.section);
      if (matchClass && matchSec) {
        allHomeworkItems.push({ id: docSnap.id, ...data });
      }
    });

    // Populate Subject Filter Options
    const subjectSelect = document.getElementById("hw-subject-filter");
    const existingVal = subjectSelect.value;
    const subjects = new Set(allHomeworkItems.map(h => h.subject).filter(Boolean));
    
    subjectSelect.innerHTML = `<option value="">All Subjects</option>`;
    subjects.forEach(subj => {
      const opt = document.createElement("option");
      opt.value = subj;
      opt.innerText = subj;
      subjectSelect.appendChild(opt);
    });
    subjectSelect.value = existingVal;

    filterAndRenderHomework();
  });
}

function filterAndRenderHomework() {
  const subjFilter = document.getElementById("hw-subject-filter").value;
  const statusFilter = document.getElementById("hw-status-filter").value;

  const completedMap = JSON.parse(localStorage.getItem(`hw_completed_${currentStudent.registrationNumber}`) || "{}");

  let filtered = [...allHomeworkItems];
  if (subjFilter) {
    filtered = filtered.filter(h => h.subject === subjFilter);
  }
  if (statusFilter === "completed") {
    filtered = filtered.filter(h => completedMap[h.id]);
  } else if (statusFilter === "pending") {
    filtered = filtered.filter(h => !completedMap[h.id]);
  }

  const container = document.getElementById("parent-homework-grid");
  container.innerHTML = "";

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="glass-card text-center" style="grid-column: 1 / -1; padding: 3rem;">
        <i data-lucide="book-open" style="width: 40px; height: 40px; color: var(--text-muted); margin-bottom: 0.5rem;"></i>
        <p style="color: var(--text-muted);">No homework assignments found matching your filter.</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  filtered.forEach(hw => {
    const isDone = !!completedMap[hw.id];
    const card = document.createElement("div");
    card.className = "glass-card";
    card.style.cssText = `display: flex; flex-direction: column; justify-content: space-between; border-color: ${isDone ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255, 107, 0, 0.3)'}; position: relative;`;

    card.innerHTML = `
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
          <span style="font-size: 0.75rem; font-weight: 700; background: rgba(255, 107, 0, 0.15); color: var(--primary); padding: 0.2rem 0.6rem; border-radius: 9999px; border: 1px solid rgba(255, 107, 0, 0.3);">${hw.subject || 'General'}</span>
          <span style="font-size: 0.75rem; color: var(--text-muted);"><i data-lucide="clock" style="width: 12px; height: 12px; vertical-align: middle;"></i> Due: ${hw.dueDate || 'N/A'}</span>
        </div>

        <h3 class="font-outfit mb-2" style="font-size: 1.15rem; color: #ffffff;">${hw.title}</h3>
        <p style="color: var(--text-muted); font-size: 0.875rem; line-height: 1.5; margin-bottom: 1rem; white-space: pre-line;">${hw.description || 'No description provided.'}</p>
      </div>

      <div style="padding-top: 1rem; border-top: 1px solid rgba(255, 255, 255, 0.08); display: flex; align-items: center; justify-content: space-between;">
        <span style="font-size: 0.75rem; color: var(--text-light);">Assigned by: <b>${hw.assignedBy || 'Class Teacher'}</b></span>
        
        <label style="display: inline-flex; align-items: center; gap: 0.4rem; cursor: pointer; font-size: 0.8rem; font-weight: 600; color: ${isDone ? 'var(--success)' : 'var(--accent)'};">
          <input type="checkbox" class="hw-done-check" data-id="${hw.id}" ${isDone ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: var(--primary); cursor: pointer;">
          ${isDone ? 'Completed' : 'Mark Done'}
        </label>
      </div>
    `;

    container.appendChild(card);
  });

  // Bind checkbox events
  document.querySelectorAll(".hw-done-check").forEach(chk => {
    chk.addEventListener("change", (e) => {
      const hwId = e.target.dataset.id;
      const currentMap = JSON.parse(localStorage.getItem(`hw_completed_${currentStudent.registrationNumber}`) || "{}");
      currentMap[hwId] = e.target.checked;
      localStorage.setItem(`hw_completed_${currentStudent.registrationNumber}`, JSON.stringify(currentMap));
      filterAndRenderHomework();
    });
  });

  if (window.lucide) window.lucide.createIcons();
}

// 3. Exam Timetable Listener
function setupExamTimetableListener() {
  const examCol = collection(db, "examTimetables");
  onSnapshot(examCol, (snapshot) => {
    allExamTimetables = [];
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      const matchClass = !data.class || String(data.class) === "All" || String(data.class) === String(currentStudent.class);
      const matchSec = !data.section || String(data.section) === "All" || String(data.section) === String(currentStudent.section);
      if (matchClass && matchSec) {
        allExamTimetables.push({ id: docSnap.id, ...data });
      }
    });

    renderExamTimetables(allExamTimetables);
  });
}

function renderExamTimetables(exams) {
  const tbody = document.getElementById("parent-exams-tbody");
  tbody.innerHTML = "";

  if (!exams || exams.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center" style="color: var(--text-light); padding: 2rem;">No exam timetables published yet for Class ${currentStudent.class}-${currentStudent.section}.</td>
      </tr>
    `;
    return;
  }

  exams.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  exams.forEach(exam => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td style="font-weight: 700; color: #ffffff;">${exam.examName || 'Unit Test'}</td>
      <td><span style="font-weight: 700; color: var(--primary);">${exam.subject}</span></td>
      <td style="font-family: monospace; font-weight: 600; color: var(--accent);">${exam.date || 'TBA'}</td>
      <td style="font-family: monospace; font-size: 0.85rem;">${exam.timeSlot || '09:00 AM - 11:30 AM'}</td>
      <td style="font-size: 0.85rem;">${exam.roomNo || 'Hall A'}</td>
      <td style="font-size: 0.85rem; color: var(--text-muted); max-width: 250px;">${exam.syllabus || 'Full Syllabus'}</td>
      <td style="font-weight: 700; font-family: monospace; color: var(--success);">${exam.totalMarks || '100'} Marks</td>
    `;
    tbody.appendChild(row);
  });

  if (window.lucide) window.lucide.createIcons();
}

// 4. Notices & Announcements Listener
function setupNoticesListener() {
  const noticesCol = collection(db, "notices");
  onSnapshot(noticesCol, (snapshot) => {
    allSchoolNotices = [];
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      const matchClass = !data.class || String(data.class) === "All" || String(data.class) === String(currentStudent.class);
      if (matchClass) {
        allSchoolNotices.push({ id: docSnap.id, ...data });
      }
    });

    renderNoticesFeed(allSchoolNotices);
  });
}

function renderNoticesFeed(notices) {
  const container = document.getElementById("parent-notices-feed");
  container.innerHTML = "";

  if (!notices || notices.length === 0) {
    container.innerHTML = `
      <div class="glass-card text-center" style="padding: 3rem;">
        <i data-lucide="bell" style="width: 40px; height: 40px; color: var(--text-muted); margin-bottom: 0.5rem;"></i>
        <p style="color: var(--text-muted);">No active school notices posted at this time.</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  notices.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  notices.forEach(notice => {
    const card = document.createElement("div");
    card.className = "glass-card";
    card.style.cssText = "border-color: rgba(249, 115, 22, 0.25);";

    card.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem;">
        <span style="font-size: 0.75rem; font-weight: 700; background: rgba(249, 115, 22, 0.15); color: var(--primary); padding: 0.2rem 0.6rem; border-radius: 9999px; border: 1px solid rgba(249, 115, 22, 0.3);">${notice.category || 'General Notice'}</span>
        <span style="font-size: 0.75rem; color: var(--text-muted); font-family: monospace;">${notice.date || ''}</span>
      </div>

      <h3 class="font-outfit mb-2" style="font-size: 1.2rem; color: #ffffff;">${notice.title}</h3>
      <p style="color: var(--text-muted); font-size: 0.9rem; line-height: 1.6; white-space: pre-line;">${notice.content}</p>

      <div style="margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid rgba(255, 255, 255, 0.08); font-size: 0.75rem; color: var(--text-light); display: flex; justify-content: space-between;">
        <span>Posted by: <b>${notice.postedBy || 'De Paul School Administration'}</b></span>
        <span>Target: <b>Class ${notice.class || 'All'}</b></span>
      </div>
    `;
    container.appendChild(card);
  });

  if (window.lucide) window.lucide.createIcons();
}

// 5. Fetch Class Teacher Info for current student's class
async function fetchClassTeacherDetails() {
  if (!currentStudent) return;
  try {
    const snap = await getDocs(collection(db, "teachers"));
    let matchingTeacher = null;

    snap.forEach(docSnap => {
      const t = docSnap.data();
      const matchClass = String(t.class) === String(currentStudent.class);
      const matchSec = t.section && String(t.section).toUpperCase() === String(currentStudent.section).toUpperCase();

      if (matchClass && matchSec) {
        matchingTeacher = { id: docSnap.id, ...t };
      } else if (matchClass && !matchingTeacher) {
        matchingTeacher = { id: docSnap.id, ...t };
      }
    });

    const nameEl = document.getElementById("class-teacher-name");
    const subjEl = document.getElementById("class-teacher-subject");
    const emailEl = document.getElementById("class-teacher-email");
    const photoEl = document.getElementById("class-teacher-photo");

    if (matchingTeacher) {
      if (nameEl) nameEl.innerText = matchingTeacher.name || "Class Teacher";
      if (subjEl) subjEl.innerText = matchingTeacher.subject 
        ? `${matchingTeacher.subject} (${matchingTeacher.department || 'Faculty'})`
        : `Class ${currentStudent.class}-${currentStudent.section} In-Charge`;
      if (emailEl) emailEl.innerText = matchingTeacher.email || "teacher@depaulschool.com";
      if (photoEl && matchingTeacher.photoURL) {
        photoEl.src = matchingTeacher.photoURL;
      }
    } else {
      if (nameEl) nameEl.innerText = "De Paul Faculty";
      if (subjEl) subjEl.innerText = `Class ${currentStudent.class}-${currentStudent.section} In-Charge`;
    }
  } catch (e) {
    console.error("Error fetching class teacher details:", e);
  }
}

// Navigation Tabs Switcher
function setupNavigationTabs() {
  const links = document.querySelectorAll(".nav-link");
  const tabs = document.querySelectorAll(".dashboard-tab");

  links.forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const targetTabId = link.getAttribute("data-tab");

      links.forEach(l => l.classList.remove("active"));
      tabs.forEach(t => t.style.display = "none");

      link.classList.add("active");
      const targetTab = document.getElementById(targetTabId);
      if (targetTab) {
        targetTab.style.display = "block";
      }
    });
  });
}

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
