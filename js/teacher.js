// js/teacher.js
import { db } from "./firebase-config.js";
import { guardPage, logoutUser } from "./auth.js";
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  getDocs 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Teacher state variables
let teacherProfile = null;
let teacherClass = "";
let teacherSection = "";

let classStudentsList = []; // All registered students in this teacher's class
let todayAttendanceMap = new Map(); // Registration No -> Attendance Doc Data

const loader = document.getElementById("teacher-loader");

// Helper to raise toast alert
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
  if (window.lucide) window.lucide.createIcons();

  setTimeout(() => {
    toast.style.animation = "slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1) reverse forwards";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// 1. Initial Page Load and Authentication Guard
async function initTeacherPanel() {
  loader.classList.add("active");
  
  try {
    const authSession = await guardPage(["teacher"]);
    teacherProfile = authSession.profile;
    
    teacherClass = teacherProfile.class;
    teacherSection = teacherProfile.section;

    // Update Header labels
    document.getElementById("teacher-user-name").innerText = teacherProfile.name || "Teacher";
    document.getElementById("teacher-class-tag").innerText = `Class ${teacherClass} - ${teacherSection}`;

    setupLiveClassListeners();
    setupEventListeners();
    startLiveClock();
    
    loader.classList.remove("active");
  } catch (err) {
    console.error("Teacher initialization failed:", err);
  }
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

// 2. Setup Real-time Database Snapshot Observers
function setupLiveClassListeners() {
  const todayStr = new Date().toISOString().split('T')[0];

  // A. Observe all registered students in the teacher's class
  const studentsCol = collection(db, "students");
  const classStudentsQuery = query(
    studentsCol, 
    where("class", "==", teacherClass), 
    where("section", "==", teacherSection)
  );

  onSnapshot(classStudentsQuery, (snapshot) => {
    classStudentsList = [];
    snapshot.forEach(docSnap => {
      classStudentsList.push({ id: docSnap.id, ...docSnap.data() });
    });

    // Sort by roll number numerically if possible, otherwise string-wise
    classStudentsList.sort((a, b) => {
      const rollA = parseInt(a.rollNumber) || 0;
      const rollB = parseInt(b.rollNumber) || 0;
      return rollA - rollB;
    });

    document.getElementById("stat-class-total").innerText = classStudentsList.size || classStudentsList.length;

    // Retrieve today's attendance snapshot after loading students list
    refreshLiveAttendanceSnapshot();
  });

  // B. Observe today's check-ins log for teacher's class
  const attendCol = collection(db, "attendance");
  const classTodayAttendQuery = query(
    attendCol,
    where("date", "==", todayStr),
    where("class", "==", teacherClass),
    where("section", "==", teacherSection)
  );

  onSnapshot(classTodayAttendQuery, (snapshot) => {
    todayAttendanceMap.clear();
    let presentCount = 0;
    let lateCount = 0;

    snapshot.forEach(docSnap => {
      const record = docSnap.data();
      todayAttendanceMap.set(record.registrationNumber, record);
      presentCount++;
      if (record.status === "Late") {
        lateCount++;
      }
    });

    // Update counters
    document.getElementById("stat-class-present").innerText = presentCount;
    document.getElementById("stat-class-late").innerText = lateCount;
    
    const totalStudents = classStudentsList.length;
    const absentCount = Math.max(0, totalStudents - presentCount);
    document.getElementById("stat-class-absent").innerText = absentCount;

    // Redraw table
    renderLiveAttendanceTable();
  });
}

function refreshLiveAttendanceSnapshot() {
  renderLiveAttendanceTable();
}

// 3. Render Table functions
function renderLiveAttendanceTable() {
  const tbody = document.getElementById("class-live-tbody");
  tbody.innerHTML = "";

  if (classStudentsList.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center" style="color: var(--text-light); padding: 2rem;">No students registered in this class.</td>
      </tr>
    `;
    return;
  }

  // Read search string
  const qStr = document.getElementById("class-student-search").value.toLowerCase().trim();

  let filtered = [...classStudentsList];
  if (qStr) {
    filtered = filtered.filter(s => 
      s.name.toLowerCase().includes(qStr) || 
      s.registrationNumber.toLowerCase().includes(qStr) ||
      s.rollNumber.toLowerCase().includes(qStr)
    );
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center" style="color: var(--text-light); padding: 2rem;">No matching students found.</td>
      </tr>
    `;
    return;
  }

  filtered.forEach(student => {
    const photo = student.photoURL || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop";
    
    // Check if check-in exists for student
    const checkin = todayAttendanceMap.get(student.registrationNumber);
    
    let entryTime = "--:--:--";
    let status = "Absent";
    if (checkin) {
      entryTime = checkin.entryTime;
      status = checkin.status; // 'Present' or 'Late'
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><img src="${photo}" class="profile-avatar" alt="Photo"></td>
      <td style="font-weight: 700; font-family: monospace;">#${student.rollNumber}</td>
      <td style="font-weight: 600;">${student.name}</td>
      <td><span style="font-family: monospace; font-weight:700; color: var(--primary);">${student.registrationNumber}</span></td>
      <td style="font-family: monospace; font-weight: 600;">${entryTime}</td>
      <td><span class="badge badge-${status.toLowerCase()}">${status}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// 4. Tab / Static UI Event Listeners
function setupEventListeners() {
  // Logout Trigger
  document.getElementById("btn-teacher-logout").addEventListener("click", logoutUser);

  // Tab Switchers
  const navLinks = document.querySelectorAll(".nav-link");
  navLinks.forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      
      navLinks.forEach(n => n.classList.remove("active"));
      document.querySelectorAll(".dashboard-tab").forEach(t => t.style.display = "none");

      link.classList.add("active");
      const tabId = link.dataset.tab;
      document.getElementById(tabId).style.display = "block";
    });
  });

  // Today live search input
  document.getElementById("class-student-search").addEventListener("input", renderLiveAttendanceTable);

  // Set default date picker value to today for history tab
  const histDate = document.getElementById("history-date-filter");
  histDate.value = new Date().toISOString().split('T')[0];
  
  // History Filters triggers
  histDate.addEventListener("change", loadHistoryLogs);
  document.getElementById("history-search-input").addEventListener("input", loadHistoryLogs);

  // Export history reports
  document.getElementById("btn-export-history-csv").addEventListener("click", downloadHistoryCsv);
}

// 5. Historical Record Queries (Class & Section locked for Teacher)
async function loadHistoryLogs() {
  const tbody = document.getElementById("history-logs-tbody");
  const dateVal = document.getElementById("history-date-filter").value;
  const searchVal = document.getElementById("history-search-input").value.toLowerCase().trim();

  if (!dateVal) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center" style="color: var(--text-light); padding: 2rem;">Select a valid date.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = `
    <tr>
      <td colspan="6" class="text-center" style="color: var(--text-light); padding: 2rem;">Loading historical records...</td>
    </tr>
  `;

  try {
    const attendCol = collection(db, "attendance");
    // Standardize query by date and class constraints
    const q = query(
      attendCol,
      where("date", "==", dateVal),
      where("class", "==", teacherClass),
      where("section", "==", teacherSection)
    );

    const snapshot = await getDocs(q);
    const dateAttendMap = new Map();
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      dateAttendMap.set(data.registrationNumber, data);
    });

    // Loop through class students list
    tbody.innerHTML = "";

    let filteredStudents = [...classStudentsList];
    if (searchVal) {
      filteredStudents = filteredStudents.filter(s => s.name.toLowerCase().includes(searchVal));
    }

    if (filteredStudents.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center" style="color: var(--text-light); padding: 2rem;">No students found matching filters.</td>
        </tr>
      `;
      return;
    }

    filteredStudents.forEach(student => {
      const photo = student.photoURL || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop";
      const checkin = dateAttendMap.get(student.registrationNumber);
      
      let entryTime = "--:--:--";
      let status = "Absent";
      if (checkin) {
        entryTime = checkin.entryTime;
        status = checkin.status;
      }

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><img src="${photo}" class="profile-avatar" alt="Photo"></td>
        <td style="font-weight: 700; font-family: monospace;">#${student.rollNumber}</td>
        <td style="font-weight: 600;">${student.name}</td>
        <td><span style="font-family: monospace; font-weight:700; color: var(--primary);">${student.registrationNumber}</span></td>
        <td style="font-family: monospace; font-weight: 600;">${entryTime}</td>
        <td><span class="badge badge-${status.toLowerCase()}">${status}</span></td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    console.error("Failed to load history list:", err);
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center" style="color: var(--danger); padding: 2rem;">Failed to fetch history logs: ${err.message}</td>
      </tr>
    `;
  }
}

// 6. CSV Exporter for Teacher Portal
function downloadHistoryCsv() {
  const dateVal = document.getElementById("history-date-filter").value;
  const rows = document.querySelectorAll("#history-logs-tbody tr");

  if (rows.length === 0 || rows[0].innerText.includes("Select a valid") || rows[0].innerText.includes("Loading") || rows[0].innerText.includes("No students")) {
    showToast("Export Failed", "There are no records to export.", "warning");
    return;
  }

  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "Roll No,Student Name,Registration Number,Date,Entry Time,Status\n";

  rows.forEach(tr => {
    const cols = tr.querySelectorAll("td");
    const roll = cols[1].innerText.replace("#", "");
    const name = cols[2].innerText;
    const reg = cols[3].innerText;
    const time = cols[4].innerText;
    const status = cols[5].innerText;

    csvContent += `"${roll}","${name}","${reg}","${dateVal}","${time}","${status}"\n`;
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  
  const filename = `Attendance_Report_Class_${teacherClass}_${teacherSection}_Date_${dateVal}`;
  
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  showToast("CSV Downloaded", `Attendance records for Class ${teacherClass}-${teacherSection} exported.`, "success");
}

// Onload Handler
document.addEventListener("DOMContentLoaded", initTeacherPanel);
