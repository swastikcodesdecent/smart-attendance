// js/teacher.js
import { db } from "./firebase-config.js";
import { guardPage, logoutUser } from "./auth.js";
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  getDocs,
  doc,
  setDoc,
  addDoc,
  deleteDoc,
  serverTimestamp
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

    // Update Header & form labels
    document.getElementById("teacher-user-name").innerText = teacherProfile.name || "Teacher";
    document.getElementById("teacher-class-tag").innerText = `Class ${teacherClass} - ${teacherSection}`;
    const hwClassInput = document.getElementById("teacher-hw-class");
    if (hwClassInput) hwClassInput.value = `Class ${teacherClass}-${teacherSection}`;

    setupLiveClassListeners();
    setupHomeworkListeners();
    setupExamListeners();
    setupNoticesListeners();
    setupCalendarListeners();
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

// 7. Homework Management for Teachers
function setupHomeworkListeners() {
  const hwCol = collection(db, "homework");
  onSnapshot(hwCol, (snapshot) => {
    const tbody = document.getElementById("teacher-hw-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    const hwItems = [];
    snapshot.forEach(d => {
      const data = d.data();
      if (!data.class || data.class === "All" || String(data.class) === String(teacherClass)) {
        hwItems.push({ id: d.id, ...data });
      }
    });

    if (hwItems.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="text-center" style="color: var(--text-light); padding: 2rem;">No active homework posted for Class ${teacherClass}.</td>
        </tr>
      `;
      return;
    }

    hwItems.forEach(hw => {
      const tr = document.createElement("tr");
      const refLink = hw.referenceLink 
        ? `<a href="${hw.referenceLink}" target="_blank" style="color: var(--accent); font-size: 0.8rem; text-decoration: none; display: inline-flex; align-items: center; gap: 0.25rem;"><i data-lucide="external-link" style="width: 12px; height: 12px;"></i> View Link</a>`
        : `<span style="color: var(--text-light); font-size: 0.8rem;">None</span>`;

      tr.innerHTML = `
        <td><span class="badge" style="background: rgba(255, 107, 0, 0.15); color: var(--primary); font-weight:700;">${hw.assignmentType || 'Daily Homework'}</span></td>
        <td><span style="font-weight: 700; color: var(--primary);">${hw.subject}</span></td>
        <td style="font-weight: 600;">${hw.title}</td>
        <td>Class ${hw.class || teacherClass}-${hw.section || teacherSection}</td>
        <td style="font-family: monospace; font-weight: 700; color: var(--accent);">${hw.dueDate}</td>
        <td style="font-size: 0.85rem; color: var(--text-muted); max-width: 220px;">${hw.description}</td>
        <td>${refLink}</td>
        <td>
          <button class="btn btn-secondary btn-delete-hw" data-id="${hw.id}" style="padding: 0.35rem 0.65rem; font-size: 0.75rem; color: var(--danger); border-color: rgba(244,63,94,0.3);">
            <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i> Delete
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Delete triggers
    document.querySelectorAll(".btn-delete-hw").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (confirm("Are you sure you want to delete this homework assignment?")) {
          try {
            await deleteDoc(doc(db, "homework", btn.dataset.id));
            showToast("Homework Deleted", "Assignment removed successfully.", "success");
          } catch (e) {
            console.error("Delete homework error:", e);
            showToast("Error", "Failed to delete homework.", "danger");
          }
        }
      });
    });

    if (window.lucide) window.lucide.createIcons();
  });

  // Form Submit Handler
  const hwForm = document.getElementById("form-teacher-post-hw");
  if (hwForm) {
    hwForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = document.getElementById("teacher-hw-title").value.trim();
      const subject = document.getElementById("teacher-hw-subject").value.trim();
      const assignmentType = document.getElementById("teacher-hw-type").value || "Daily Homework";
      const dueDate = document.getElementById("teacher-hw-duedate").value;
      const referenceLink = document.getElementById("teacher-hw-link").value.trim();
      const description = document.getElementById("teacher-hw-desc").value.trim();

      try {
        await addDoc(collection(db, "homework"), {
          title,
          subject: subject || "General",
          assignmentType: assignmentType || "Daily Homework",
          dueDate,
          referenceLink: referenceLink || "",
          description: description || "",
          class: teacherClass,
          section: teacherSection,
          assignedBy: (teacherProfile && teacherProfile.name) ? teacherProfile.name : "Class Teacher",
          assignedRole: "teacher",
          createdAt: Date.now()
        });

        hwForm.reset();
        const hwClassInput = document.getElementById("teacher-hw-class");
        if (hwClassInput) hwClassInput.value = `Class ${teacherClass}-${teacherSection}`;

        showToast("Homework Published", `New assignment posted for Class ${teacherClass}-${teacherSection}.`, "success");
      } catch (err) {
        console.error("Post homework error:", err);
        showToast("Error", err.message || "Failed to publish homework assignment.", "danger");
      }
    });
  }
}

// 8. Exam Timetables Management for Teachers
function setupExamListeners() {
  const examCol = collection(db, "examTimetables");
  onSnapshot(examCol, (snapshot) => {
    const tbody = document.getElementById("teacher-exam-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    const examItems = [];
    snapshot.forEach(d => {
      const data = d.data();
      if (!data.class || data.class === "All" || data.class === teacherClass) {
        examItems.push({ id: d.id, ...data });
      }
    });

    if (examItems.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="text-center" style="color: var(--text-light); padding: 2rem;">No exam timetables published for Class ${teacherClass}.</td>
        </tr>
      `;
      return;
    }

    examItems.forEach(exam => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="font-weight: 700; color: #ffffff;">${exam.examName}</td>
        <td><span style="font-weight: 700; color: var(--primary);">${exam.subject}</span></td>
        <td style="font-family: monospace; font-weight: 600; color: var(--accent);">${exam.date}</td>
        <td style="font-family: monospace; font-size: 0.85rem;">${exam.timeSlot}</td>
        <td style="font-size: 0.85rem;">${exam.roomNo}</td>
        <td style="font-size: 0.85rem; color: var(--text-muted); max-width: 180px;">${exam.syllabus}</td>
        <td style="font-weight: 700; color: var(--success); font-family: monospace;">${exam.totalMarks} M</td>
        <td>
          <button class="btn btn-secondary btn-delete-exam" data-id="${exam.id}" style="padding: 0.35rem 0.65rem; font-size: 0.75rem; color: var(--danger); border-color: rgba(244,63,94,0.3);">
            <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i> Delete
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Delete triggers
    document.querySelectorAll(".btn-delete-exam").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (confirm("Are you sure you want to delete this exam timetable entry?")) {
          try {
            await deleteDoc(doc(db, "examTimetables", btn.dataset.id));
            showToast("Exam Entry Deleted", "Exam timetable entry removed.", "success");
          } catch (e) {
            console.error("Delete exam error:", e);
            showToast("Error", "Failed to delete exam entry.", "danger");
          }
        }
      });
    });

    if (window.lucide) window.lucide.createIcons();
  });

  // Form Submit Handler
  const examForm = document.getElementById("form-teacher-post-exam");
  if (examForm) {
    examForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const examName = document.getElementById("teacher-exam-name").value.trim();
      const subject = document.getElementById("teacher-exam-subject").value.trim();
      const date = document.getElementById("teacher-exam-date").value;
      const timeSlot = document.getElementById("teacher-exam-time").value.trim();
      const roomNo = document.getElementById("teacher-exam-room").value.trim();
      const syllabus = document.getElementById("teacher-exam-syllabus").value.trim();
      const totalMarks = document.getElementById("teacher-exam-marks").value || "100";

      try {
        await addDoc(collection(db, "examTimetables"), {
          examName: examName || "Examination",
          subject: subject || "General",
          date,
          timeSlot: timeSlot || "09:00 AM - 11:30 AM",
          roomNo: roomNo || "Main Examination Hall",
          syllabus: syllabus || "",
          totalMarks: totalMarks,
          class: teacherClass,
          section: teacherSection,
          assignedBy: (teacherProfile && teacherProfile.name) ? teacherProfile.name : "Class Teacher",
          createdAt: Date.now()
        });

        examForm.reset();
        showToast("Exam Timetable Published", `${examName} (${subject}) schedule published.`, "success");
      } catch (err) {
        console.error("Post exam error:", err);
        showToast("Error", err.message || "Failed to publish exam schedule.", "danger");
      }
    });
  }
}

// 9. Class Notices Management for Teachers
function setupNoticesListeners() {
  const noticeCol = collection(db, "notices");
  onSnapshot(noticeCol, (snapshot) => {
    const tbody = document.getElementById("teacher-notice-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    const noticeItems = [];
    snapshot.forEach(d => {
      const data = d.data();
      if (!data.class || data.class === "All" || String(data.class) === String(teacherClass)) {
        noticeItems.push({ id: d.id, ...data });
      }
    });

    if (noticeItems.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="text-center" style="color: var(--text-light); padding: 2rem;">No class announcements posted.</td>
        </tr>
      `;
      return;
    }

    noticeItems.forEach(n => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><span style="font-size: 0.75rem; font-weight: 700; background: rgba(249, 115, 22, 0.15); color: var(--primary); padding: 0.2rem 0.5rem; border-radius: 9999px; border: 1px solid rgba(249, 115, 22, 0.3);">${n.category}</span></td>
        <td style="font-weight: 600;">${n.title}</td>
        <td style="font-family: monospace; font-size: 0.85rem;">${n.date}</td>
        <td style="font-size: 0.85rem; color: var(--text-muted); max-width: 250px;">${n.content}</td>
        <td>
          <button class="btn btn-secondary btn-delete-notice" data-id="${n.id}" style="padding: 0.35rem 0.65rem; font-size: 0.75rem; color: var(--danger); border-color: rgba(244,63,94,0.3);">
            <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i> Delete
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Delete triggers
    document.querySelectorAll(".btn-delete-notice").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (confirm("Are you sure you want to delete this notice?")) {
          try {
            await deleteDoc(doc(db, "notices", btn.dataset.id));
            showToast("Notice Deleted", "Notice broadcast removed.", "success");
          } catch (e) {
            console.error("Delete notice error:", e);
            showToast("Error", "Failed to delete notice.", "danger");
          }
        }
      });
    });

    if (window.lucide) window.lucide.createIcons();
  });

  // Form Submit Handler
  const noticeForm = document.getElementById("form-teacher-post-notice");
  if (noticeForm) {
    noticeForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = document.getElementById("teacher-notice-title").value.trim();
      const category = document.getElementById("teacher-notice-category").value || "General";
      const content = document.getElementById("teacher-notice-content").value.trim();
      const todayStr = new Date().toISOString().split('T')[0];

      try {
        await addDoc(collection(db, "notices"), {
          title,
          category,
          content,
          date: todayStr,
          class: teacherClass,
          section: teacherSection,
          postedBy: (teacherProfile && teacherProfile.name) ? teacherProfile.name : "Class Teacher",
          createdAt: Date.now()
        });

        noticeForm.reset();
        showToast("Notice Broadcasted", `Announcement posted for parents & students of Class ${teacherClass}.`, "success");
      } catch (err) {
        console.error("Post notice error:", err);
        showToast("Error", "Failed to post notice announcement.", "danger");
      }
    });
  }
}

// 10. School Calendar Observer for Teachers
let allTeacherCalendarEvents = [];

function setupCalendarListeners() {
  const calCol = collection(db, "calendarEvents");
  onSnapshot(calCol, (snapshot) => {
    allTeacherCalendarEvents = [];
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      if (!data.targetClass || data.targetClass === "All" || String(data.targetClass) === String(teacherClass)) {
        allTeacherCalendarEvents.push({ id: docSnap.id, ...data });
      }
    });

    renderTeacherCalendarGrid(allTeacherCalendarEvents);
  });

  const filterSelect = document.getElementById("teacher-calendar-category-filter");
  if (filterSelect) {
    filterSelect.addEventListener("change", () => {
      const catVal = filterSelect.value;
      let filtered = [...allTeacherCalendarEvents];
      if (catVal) {
        filtered = filtered.filter(e => e.category === catVal);
      }
      renderTeacherCalendarGrid(filtered);
    });
  }
}

function renderTeacherCalendarGrid(events) {
  const container = document.getElementById("teacher-calendar-grid");
  if (!container) return;
  container.innerHTML = "";

  if (!events || events.length === 0) {
    container.innerHTML = `
      <div class="glass-card text-center" style="grid-column: 1 / -1; padding: 3rem;">
        <i data-lucide="calendar-days" style="width: 40px; height: 40px; color: var(--text-muted); margin-bottom: 0.5rem;"></i>
        <p style="color: var(--text-muted);">No calendar events published.</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  events.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  events.forEach(ev => {
    const card = document.createElement("div");
    card.className = "glass-card";
    card.style.cssText = "border-color: rgba(255, 107, 0, 0.3); display: flex; flex-direction: column; justify-content: space-between;";

    let badgeColor = "rgba(255, 107, 0, 0.15)";
    let textColor = "var(--primary)";

    if (ev.category === "Holiday") {
      badgeColor = "rgba(244, 63, 94, 0.18)";
      textColor = "#f43f5e";
    } else if (ev.category === "PTM Meeting") {
      badgeColor = "rgba(16, 185, 129, 0.18)";
      textColor = "#10b981";
    } else if (ev.category === "Exams") {
      badgeColor = "rgba(168, 85, 247, 0.18)";
      textColor = "#c084fc";
    }

    card.innerHTML = `
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
          <span style="font-size: 0.75rem; font-weight: 700; background: ${badgeColor}; color: ${textColor}; padding: 0.25rem 0.65rem; border-radius: 9999px; border: 1px solid ${badgeColor};">${ev.category || 'Event'}</span>
          <span style="font-size: 0.8rem; font-weight: 700; color: var(--accent); font-family: monospace;"><i data-lucide="calendar" style="width: 13px; height: 13px; vertical-align: middle;"></i> ${ev.date || 'TBA'}</span>
        </div>

        <h3 class="font-outfit mb-2" style="font-size: 1.2rem; color: #ffffff;">${ev.title}</h3>
        <p style="color: var(--text-muted); font-size: 0.875rem; line-height: 1.5; margin-bottom: 1rem; white-space: pre-line;">${ev.description || 'No description provided.'}</p>
      </div>

      <div style="padding-top: 0.75rem; border-top: 1px solid rgba(255, 255, 255, 0.08); font-size: 0.75rem; color: var(--text-light); display: flex; justify-content: space-between;">
        <span>Target: <b>Class ${ev.targetClass || 'All'}</b></span>
        <span>Published by: <b>${ev.createdBy || 'Administration'}</b></span>
      </div>
    `;

    container.appendChild(card);
  });

  if (window.lucide) window.lucide.createIcons();
}

// Onload Handler
document.addEventListener("DOMContentLoaded", initTeacherPanel);
