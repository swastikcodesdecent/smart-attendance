import { auth, db, rtdb, firebaseConfig } from "./firebase-config.js";
import { guardPage, logoutUser } from "./auth.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
  collection, 
  doc, 
  getDoc, 
  setDoc, 
  addDoc,
  getDocs, 
  deleteDoc, 
  query, 
  where, 
  onSnapshot, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { ref as dbRef, set, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// Page level state
let totalStudentsCount = 0;
let totalTeachersCount = 0;
let registeredClasses = new Set();
let attendanceTodayCount = 0;
let lateTodayCount = 0;

let teachersList = [];
let studentsList = [];
let activeFilters = { date: "", class: "", section: "" };

// Dynamic QRious instance for student cards
let qrInstance = null;

// Modal variables
const loader = document.getElementById("admin-loader");
const loaderText = document.getElementById("admin-loader-text");

// 1. Route guard execution
async function initAdminPanel() {
  loader.classList.add("active");
  loaderText.innerText = "Verifying authorization...";

  try {
    const authSession = await guardPage(["admin"]);
    
    // Fill admin username
    if (authSession && authSession.profile) {
      document.getElementById("admin-user-name").innerText = authSession.profile.name || "Administrator";
    }

    loaderText.innerText = "Initializing live listeners...";
    setupLiveDashboardListeners();
    setupAcademicDashboardListeners();
    setupStaticEventListeners();
    startLiveClock();
    
    loader.classList.remove("active");
  } catch (error) {
    console.error("Initialization failed:", error);
    // guardPage will auto-redirect unauthorized users
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

// 2. Real-time statistics & activity observers
function setupLiveDashboardListeners() {
  const todayStr = new Date().toISOString().split('T')[0];

  // Listener A: Students count & classes compilation
  onSnapshot(collection(db, "students"), (snapshot) => {
    totalStudentsCount = snapshot.size;
    document.getElementById("stat-total-students").innerText = totalStudentsCount;

    registeredClasses.clear();
    studentsList = [];
    
    snapshot.forEach(docSnap => {
      const stud = { id: docSnap.id, ...docSnap.data() };
      studentsList.push(stud);
      if (stud.class && stud.section) {
        registeredClasses.add(`${stud.class} ${stud.section}`);
      }
    });

    document.getElementById("stat-total-classes").innerText = registeredClasses.size;
    updateDashboardAverages();
    renderStudentsTable(studentsList);
    populateFilterOptions();
  });

  // Listener B: Teachers count
  onSnapshot(collection(db, "teachers"), (snapshot) => {
    totalTeachersCount = snapshot.size;
    document.getElementById("stat-total-teachers").innerText = totalTeachersCount;

    teachersList = [];
    snapshot.forEach(docSnap => {
      teachersList.push({ id: docSnap.id, ...docSnap.data() });
    });
    
    renderTeachersTable(teachersList);
  });

  // Listener C: Today's check-ins log
  const attendColRef = collection(db, "attendance");
  const todayQuery = query(attendColRef, where("date", "==", todayStr));
  
  onSnapshot(todayQuery, (snapshot) => {
    attendanceTodayCount = 0;
    lateTodayCount = 0;
    const studentTbody = document.getElementById("realtime-student-tbody");
    const teacherTbody = document.getElementById("realtime-teacher-tbody");
    
    studentTbody.innerHTML = "";
    teacherTbody.innerHTML = "";
    
    if (snapshot.empty) {
      studentTbody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center" style="color: var(--text-light); padding: 2rem;">No student entries recorded today yet.</td>
        </tr>
      `;
      teacherTbody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center" style="color: var(--text-light); padding: 2rem;">No teacher entries recorded today yet.</td>
        </tr>
      `;
    } else {
      // Sort snapshots locally to show newest check-ins first
      const sortedDocs = [];
      snapshot.forEach(d => sortedDocs.push({ id: d.id, ...d.data() }));
      sortedDocs.sort((a, b) => b.entryTime.localeCompare(a.entryTime));

      let studentRows = 0;
      let teacherRows = 0;

      sortedDocs.forEach(record => {
        attendanceTodayCount++;
        if (record.status === "Late") {
          lateTodayCount++;
        }

        const isTeacher = record.role === "teacher" || record.registrationNumber?.startsWith("TCH");

        if (isTeacher) {
          teacherRows++;
          // Try searching for teacher photo
          const matchingTeacher = teachersList.find(t => t.teacherId === record.registrationNumber);
          const photoSrc = matchingTeacher?.photoURL || "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop";
          const subjectDept = matchingTeacher 
            ? `${matchingTeacher.subject || "N/A"} (${matchingTeacher.department || "N/A"})`
            : "Faculty";

          const row = document.createElement("tr");
          row.innerHTML = `
            <td><img src="${photoSrc}" class="profile-avatar" alt="Photo"></td>
            <td style="font-weight: 600;">${record.studentName}</td>
            <td><span style="font-family: monospace; font-weight: 700; color: #10b981;">${record.registrationNumber}</span></td>
            <td>${subjectDept}</td>
            <td style="font-family: monospace; font-weight: 600;">${record.entryTime}</td>
            <td><span class="badge badge-${record.status.toLowerCase()}">${record.status}</span></td>
          `;
          teacherTbody.appendChild(row);
        } else {
          studentRows++;
          // Try searching for student photo
          const matchingStudent = studentsList.find(s => s.registrationNumber === record.registrationNumber);
          const photoSrc = matchingStudent?.photoURL || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop";

          const row = document.createElement("tr");
          row.innerHTML = `
            <td><img src="${photoSrc}" class="profile-avatar" alt="Photo"></td>
            <td style="font-weight: 600;">${record.studentName}</td>
            <td><span style="font-family: monospace; font-weight: 700; color: var(--primary);">${record.registrationNumber}</span></td>
            <td>Class ${record.class}-${record.section}</td>
            <td style="font-family: monospace; font-weight: 600;">${record.entryTime}</td>
            <td><span class="badge badge-${record.status.toLowerCase()}">${record.status}</span></td>
          `;
          studentTbody.appendChild(row);
        }
      });

      if (studentRows === 0) {
        studentTbody.innerHTML = `
          <tr>
            <td colspan="6" class="text-center" style="color: var(--text-light); padding: 2rem;">No student entries recorded today yet.</td>
          </tr>
        `;
      }
      if (teacherRows === 0) {
        teacherTbody.innerHTML = `
          <tr>
            <td colspan="6" class="text-center" style="color: var(--text-light); padding: 2rem;">No teacher entries recorded today yet.</td>
          </tr>
        `;
      }
    }

    document.getElementById("stat-present-today").innerText = attendanceTodayCount;
    updateDashboardAverages();
  });

  // Listener D: Load Settings UI inputs
  getDoc(doc(db, "settings", "system")).then(docSnap => {
    if (docSnap.exists()) {
      const data = docSnap.data();
      document.getElementById("settings-school-name").value = data.schoolName || "De Paul School";
      document.getElementById("settings-late-time").value = data.lateTime || "08:30";
    }
  });
}

// Academic Management Listeners (Homework, Exam Timetables, Notices)
function setupAcademicDashboardListeners() {
  // 1. Homework Listener & Admin Form
  onSnapshot(collection(db, "homework"), (snapshot) => {
    const tbody = document.getElementById("admin-hw-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (snapshot.empty) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="color: var(--text-light); padding: 2rem;">No published homework assignments found.</td></tr>`;
      return;
    }
    snapshot.forEach(docSnap => {
      const hw = { id: docSnap.id, ...docSnap.data() };
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><span class="badge" style="background: rgba(255, 107, 0, 0.15); color: var(--primary); font-weight:700;">Class ${hw.class || 'All'}</span></td>
        <td><span style="font-weight: 700; color: var(--accent);">${hw.subject || 'General'}</span></td>
        <td style="font-weight: 600;">${hw.title}</td>
        <td style="font-family: monospace; font-weight: 700; color: var(--accent);">${hw.dueDate || 'N/A'}</td>
        <td><span style="font-size: 0.85rem; color: var(--text-muted);">${hw.assignedBy || 'Administration'}</span></td>
        <td style="font-size: 0.85rem; color: var(--text-muted); max-width: 250px;">${hw.description || ''}</td>
        <td>
          <button class="btn btn-secondary btn-del-admin-hw" data-id="${hw.id}" style="padding: 0.35rem 0.65rem; font-size: 0.75rem; color: var(--danger); border-color: rgba(244,63,94,0.3);">
            <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i> Delete
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    document.querySelectorAll(".btn-del-admin-hw").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (confirm("Delete this homework assignment?")) {
          try {
            await deleteDoc(doc(db, "homework", btn.dataset.id));
            showToast("Deleted", "Homework assignment deleted.", "success");
          } catch (err) {
            showToast("Error", err.message, "danger");
          }
        }
      });
    });
    if (window.lucide) window.lucide.createIcons();
  });

  const formHw = document.getElementById("form-admin-post-hw");
  if (formHw) {
    formHw.addEventListener("submit", async (e) => {
      e.preventDefault();
      const targetClass = document.getElementById("admin-hw-class-select").value || "All";
      const subject = document.getElementById("admin-hw-subject").value.trim();
      const title = document.getElementById("admin-hw-title").value.trim();
      const dueDate = document.getElementById("admin-hw-duedate").value;
      const description = document.getElementById("admin-hw-desc").value.trim();

      try {
        await addDoc(collection(db, "homework"), {
          class: targetClass,
          subject: subject || "General",
          title: title,
          dueDate: dueDate,
          description: description || "",
          assignedBy: "School Administration",
          assignedRole: "admin",
          createdAt: Date.now()
        });
        formHw.reset();
        showToast("Homework Published", `Posted homework for Class ${targetClass}`, "success");
      } catch (err) {
        console.error("Post homework error:", err);
        showToast("Error", err.message || "Failed to publish homework", "danger");
      }
    });
  }

  // 2. Exam Timetables Listener & Admin Form
  onSnapshot(collection(db, "examTimetables"), (snapshot) => {
    const tbody = document.getElementById("admin-exam-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (snapshot.empty) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center" style="color: var(--text-light); padding: 2rem;">No published exam timetables found.</td></tr>`;
      return;
    }
    snapshot.forEach(docSnap => {
      const ex = { id: docSnap.id, ...docSnap.data() };
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><span class="badge" style="background: rgba(255, 107, 0, 0.15); color: var(--primary); font-weight:700;">Class ${ex.class || 'All'}</span></td>
        <td style="font-weight: 700; color: #ffffff;">${ex.examName || 'Exam'}</td>
        <td><span style="font-weight: 700; color: var(--primary);">${ex.subject}</span></td>
        <td style="font-family: monospace; font-weight: 600; color: var(--accent);">${ex.date || 'TBA'}</td>
        <td style="font-family: monospace; font-size: 0.85rem;">${ex.timeSlot || '09:00 AM - 11:30 AM'}</td>
        <td style="font-size: 0.85rem;">${ex.roomNo || 'Hall'}</td>
        <td style="font-size: 0.85rem; color: var(--text-muted); max-width: 200px;">${ex.syllabus || ''}</td>
        <td style="font-weight: 700; font-family: monospace; color: var(--success);">${ex.totalMarks || 100} Marks</td>
        <td>
          <button class="btn btn-secondary btn-del-admin-exam" data-id="${ex.id}" style="padding: 0.35rem 0.65rem; font-size: 0.75rem; color: var(--danger); border-color: rgba(244,63,94,0.3);">
            <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i> Delete
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    document.querySelectorAll(".btn-del-admin-exam").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (confirm("Delete this exam timetable entry?")) {
          try {
            await deleteDoc(doc(db, "examTimetables", btn.dataset.id));
            showToast("Deleted", "Exam timetable deleted.", "success");
          } catch (err) {
            showToast("Error", err.message, "danger");
          }
        }
      });
    });
    if (window.lucide) window.lucide.createIcons();
  });

  const formExam = document.getElementById("form-admin-post-exam");
  if (formExam) {
    formExam.addEventListener("submit", async (e) => {
      e.preventDefault();
      const targetClass = document.getElementById("admin-exam-class-select").value || "All";
      const examName = document.getElementById("admin-exam-name").value.trim();
      const subject = document.getElementById("admin-exam-subject").value.trim();
      const date = document.getElementById("admin-exam-date").value;
      const timeSlot = document.getElementById("admin-exam-time").value.trim();
      const roomNo = document.getElementById("admin-exam-room").value.trim();
      const syllabus = document.getElementById("admin-exam-syllabus").value.trim();
      const totalMarks = document.getElementById("admin-exam-marks").value || "100";

      try {
        await addDoc(collection(db, "examTimetables"), {
          class: targetClass,
          examName: examName || "Examination",
          subject: subject || "General",
          date: date,
          timeSlot: timeSlot || "09:00 AM - 11:30 AM",
          roomNo: roomNo || "Main Examination Hall",
          syllabus: syllabus || "",
          totalMarks: totalMarks,
          assignedBy: "School Administration",
          createdAt: Date.now()
        });
        formExam.reset();
        showToast("Exam Schedule Published", `Posted exam schedule for Class ${targetClass}`, "success");
      } catch (err) {
        console.error("Post exam error:", err);
        showToast("Error", err.message || "Failed to publish exam timetable", "danger");
      }
    });
  }

  // 3. School Notices Listener & Admin Form
  onSnapshot(collection(db, "notices"), (snapshot) => {
    const tbody = document.getElementById("admin-notice-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (snapshot.empty) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="color: var(--text-light); padding: 2rem;">No posted school notices found.</td></tr>`;
      return;
    }
    snapshot.forEach(docSnap => {
      const n = { id: docSnap.id, ...docSnap.data() };
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><span class="badge" style="background: rgba(255, 107, 0, 0.15); color: var(--primary); font-weight:700;">Class ${n.class || 'All'}</span></td>
        <td><span style="font-weight: 700; color: var(--accent);">${n.category || 'General'}</span></td>
        <td style="font-weight: 600;">${n.title}</td>
        <td style="font-family: monospace; font-size: 0.85rem;">${n.date || ''}</td>
        <td style="font-size: 0.85rem; color: var(--text-muted);">${n.postedBy || 'Administration'}</td>
        <td style="font-size: 0.85rem; color: var(--text-muted); max-width: 250px;">${n.content}</td>
        <td>
          <button class="btn btn-secondary btn-del-admin-notice" data-id="${n.id}" style="padding: 0.35rem 0.65rem; font-size: 0.75rem; color: var(--danger); border-color: rgba(244,63,94,0.3);">
            <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i> Delete
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    document.querySelectorAll(".btn-del-admin-notice").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (confirm("Delete this school notice?")) {
          try {
            await deleteDoc(doc(db, "notices", btn.dataset.id));
            showToast("Deleted", "School notice removed.", "success");
          } catch (err) {
            showToast("Error", err.message, "danger");
          }
        }
      });
    });
    if (window.lucide) window.lucide.createIcons();
  });

  const formNotice = document.getElementById("form-admin-post-notice");
  if (formNotice) {
    formNotice.addEventListener("submit", async (e) => {
      e.preventDefault();
      const targetClass = document.getElementById("admin-notice-class-select").value || "All";
      const category = document.getElementById("admin-notice-category").value || "General";
      const title = document.getElementById("admin-notice-title").value.trim();
      const content = document.getElementById("admin-notice-content").value.trim();
      const todayStr = new Date().toISOString().split('T')[0];

      try {
        await addDoc(collection(db, "notices"), {
          class: targetClass,
          category: category,
          title: title,
          content: content,
          date: todayStr,
          postedBy: "School Administration",
          createdAt: Date.now()
        });
        formNotice.reset();
        showToast("Notice Broadcasted", `Published notice for Class ${targetClass}`, "success");
      } catch (err) {
        console.error("Post notice error:", err);
        showToast("Error", err.message || "Failed to post school notice", "danger");
      }
    });
  }

  // 4. School Calendar Listener & Admin Form
  onSnapshot(collection(db, "calendarEvents"), (snapshot) => {
    const tbody = document.getElementById("admin-calendar-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (snapshot.empty) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="color: var(--text-light); padding: 2rem;">No published school calendar events found.</td></tr>`;
      return;
    }
    snapshot.forEach(docSnap => {
      const ev = { id: docSnap.id, ...docSnap.data() };
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><span class="badge" style="background: rgba(255, 107, 0, 0.15); color: var(--primary); font-weight:700;">${ev.category || 'General'}</span></td>
        <td><span class="badge" style="background: rgba(255, 255, 255, 0.1); color: #ffffff;">Class ${ev.targetClass || 'All'}</span></td>
        <td style="font-weight: 600;">${ev.title}</td>
        <td style="font-family: monospace; font-weight: 700; color: var(--accent);">${ev.date || 'TBA'}</td>
        <td style="font-size: 0.85rem; color: var(--text-muted);">${ev.createdBy || 'Administration'}</td>
        <td style="font-size: 0.85rem; color: var(--text-muted); max-width: 250px;">${ev.description || ''}</td>
        <td>
          <button class="btn btn-secondary btn-del-admin-event" data-id="${ev.id}" style="padding: 0.35rem 0.65rem; font-size: 0.75rem; color: var(--danger); border-color: rgba(244,63,94,0.3);">
            <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i> Delete
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    document.querySelectorAll(".btn-del-admin-event").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (confirm("Delete this calendar event?")) {
          try {
            await deleteDoc(doc(db, "calendarEvents", btn.dataset.id));
            showToast("Deleted", "Calendar event removed.", "success");
          } catch (err) {
            showToast("Error", err.message, "danger");
          }
        }
      });
    });
    if (window.lucide) window.lucide.createIcons();
  });

  const formEvent = document.getElementById("form-admin-post-event");
  if (formEvent) {
    formEvent.addEventListener("submit", async (e) => {
      e.preventDefault();
      const categoryEl = document.getElementById("admin-event-category");
      const targetClassEl = document.getElementById("admin-event-class-select");
      const titleEl = document.getElementById("admin-event-title");
      const dateEl = document.getElementById("admin-event-date");
      const descEl = document.getElementById("admin-event-desc");

      const category = categoryEl ? categoryEl.value : "Holiday";
      const targetClass = targetClassEl ? targetClassEl.value : "All";
      const title = titleEl ? titleEl.value.trim() : "";
      const date = dateEl ? dateEl.value : "";
      const description = descEl ? descEl.value.trim() : "";

      if (!title || !date) {
        showToast("Missing Fields", "Please enter the event title and date.", "warning");
        return;
      }

      try {
        await addDoc(collection(db, "calendarEvents"), {
          category: category || "Holiday",
          targetClass: targetClass || "All",
          title: title,
          date: date,
          description: description || "",
          createdBy: "School Administration",
          createdAt: Date.now()
        });
        formEvent.reset();
        showToast("Calendar Event Published", `Event broadcasted for Class ${targetClass}`, "success");
      } catch (err) {
        console.error("Post calendar event error:", err);
        showToast("Error", err.message || "Failed to publish calendar event", "danger");
      }
    });
  }
}

function updateDashboardAverages() {
  // Absent = Total - Checked In
  const absentCount = Math.max(0, totalStudentsCount - attendanceTodayCount);
  document.getElementById("stat-absent-today").innerText = absentCount;

  // Rate = (Checked In / Total) * 100
  let rate = 0;
  if (totalStudentsCount > 0) {
    rate = ((attendanceTodayCount / totalStudentsCount) * 100).toFixed(1);
  }
  document.getElementById("stat-attendance-rate").innerText = `${rate}%`;
}

// 3. Event handling wiring
function setupStaticEventListeners() {
  // Logout Trigger
  document.getElementById("btn-admin-logout").addEventListener("click", logoutUser);

  // Tab Switching
  const navLinks = document.querySelectorAll(".nav-link");
  navLinks.forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      
      // Remove active from all nav and tabs
      navLinks.forEach(n => n.classList.remove("active"));
      document.querySelectorAll(".dashboard-tab").forEach(t => t.style.display = "none");

      // Add active to current
      link.classList.add("active");
      const tabId = link.dataset.tab;
      document.getElementById(tabId).style.display = "block";
    });
  });

  // Settings Save Form
  document.getElementById("settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    loader.classList.add("active");
    loaderText.innerText = "Saving settings...";

    const sName = document.getElementById("settings-school-name").value.trim();
    const lTime = document.getElementById("settings-late-time").value;

    try {
      // 1. Write to Firestore
      await setDoc(doc(db, "settings", "system"), {
        schoolName: sName,
        lateTime: lTime
      });
      // 2. Write to Realtime Database
      await set(dbRef(rtdb, "settings/system"), {
        schoolName: sName,
        lateTime: lTime
      });
      loader.classList.remove("active");
      showToast("Settings Updated", "Configurations saved successfully.", "success");
    } catch (err) {
      console.error(err);
      loader.classList.remove("active");
      showToast("Save Failed", "Could not write configurations.", "danger");
    }
  });

  // Modal open buttons
  document.getElementById("btn-add-teacher").addEventListener("click", () => openTeacherModal());
  document.getElementById("btn-add-student").addEventListener("click", () => openStudentModal());

  // Modal Cancel/Closes
  document.getElementById("btn-close-teacher-modal").addEventListener("click", () => closeTeacherModal());
  document.getElementById("btn-cancel-teacher-modal").addEventListener("click", () => closeTeacherModal());
  document.getElementById("btn-close-student-modal").addEventListener("click", () => closeStudentModal());
  document.getElementById("btn-cancel-student-modal").addEventListener("click", () => closeStudentModal());
  document.getElementById("btn-close-id-card-modal").addEventListener("click", () => {
    document.getElementById("modal-id-card").classList.remove("active");
  });

  // Form Submits
  document.getElementById("teacher-form").addEventListener("submit", handleTeacherFormSubmit);
  document.getElementById("student-form").addEventListener("submit", handleStudentFormSubmit);

  // Student Search input filter
  document.getElementById("student-search-input").addEventListener("input", (e) => {
    const qStr = e.target.value.toLowerCase().trim();
    const filtered = studentsList.filter(s => 
      s.name.toLowerCase().includes(qStr) || 
      s.registrationNumber.toLowerCase().includes(qStr) ||
      s.class.toLowerCase().includes(qStr) ||
      s.section.toLowerCase().includes(qStr)
    );
    renderStudentsTable(filtered);
  });

  // Reports Date Change trigger list update
  const repDate = document.getElementById("report-date-filter");
  repDate.value = new Date().toISOString().split('T')[0]; // Default reports date to today
  repDate.addEventListener("change", loadReportsList);
  document.getElementById("report-role-filter").addEventListener("change", loadReportsList);
  document.getElementById("report-class-filter").addEventListener("change", loadReportsList);
  document.getElementById("report-section-filter").addEventListener("change", loadReportsList);

  // Export CSV
  document.getElementById("btn-export-csv").addEventListener("click", triggerCsvDownload);

  // ID Card printer and download trigger links
  document.getElementById("btn-print-id-card").addEventListener("click", () => {
    window.print();
  });

  document.getElementById("btn-download-front").addEventListener("click", () => downloadIdCardSideAsPng("id-card-front", "Front"));
  document.getElementById("btn-download-back").addEventListener("click", () => downloadIdCardSideAsPng("id-card-back", "Back"));
}

// 4. Render lists helper functions
function renderTeachersTable(list) {
  const tbody = document.getElementById("teachers-list-tbody");
  tbody.innerHTML = "";

  if (list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="text-center" style="color: var(--text-light); padding: 2rem;">No teachers registered.</td>
      </tr>
    `;
    return;
  }

  list.forEach(teacher => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="font-weight: 600;">${teacher.name}</td>
      <td>${teacher.email}</td>
      <td><span style="font-weight: 600; color: var(--primary);">${teacher.subject || "N/A"}</span> <span style="font-size: 0.75rem; color: var(--text-muted);">(${teacher.department || "N/A"})</span></td>
      <td>Class ${teacher.class}</td>
      <td>Section ${teacher.section}</td>
      <td class="text-right" style="white-space: nowrap;">
        <button class="btn btn-secondary btn-icon btn-card-teach" data-id="${teacher.id}" title="Generate ID Card" style="border-color: rgba(245, 158, 11, 0.4); color: var(--warning);">
          <i data-lucide="contact" style="width: 14px; height: 14px;"></i>
        </button>
        <button class="btn btn-secondary btn-icon btn-edit-teach" data-id="${teacher.id}" title="Edit Profile">
          <i data-lucide="edit" style="width: 14px; height: 14px;"></i>
        </button>
        <button class="btn btn-danger btn-icon btn-del-teach" data-id="${teacher.id}" title="Delete Teacher">
          <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Bind buttons
  document.querySelectorAll(".btn-card-teach").forEach(btn => {
    btn.addEventListener("click", () => openIdCardModal(btn.dataset.id, true));
  });
  document.querySelectorAll(".btn-edit-teach").forEach(btn => {
    btn.addEventListener("click", () => openTeacherModal(btn.dataset.id));
  });
  document.querySelectorAll(".btn-del-teach").forEach(btn => {
    btn.addEventListener("click", () => deleteTeacherAccount(btn.dataset.id));
  });

  if (window.lucide) window.lucide.createIcons();
}

function renderStudentsTable(list) {
  const tbody = document.getElementById("students-list-tbody");
  tbody.innerHTML = "";

  if (list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center" style="color: var(--text-light); padding: 2rem;">No students found matching filters.</td>
      </tr>
    `;
    return;
  }

  list.forEach(student => {
    const photo = student.photoURL || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop";
    
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><img src="${photo}" class="profile-avatar" alt="Student Photo"></td>
      <td style="font-weight: 600;">${student.name}</td>
      <td><span style="font-family: monospace; font-weight:700; color:var(--primary);">${student.registrationNumber}</span></td>
      <td>Roll ${student.rollNumber}</td>
      <td>Class ${student.class}-${student.section}</td>
      <td>${student.bloodGroup || "N/A"}</td>
      <td>${student.parentName} (${student.parentPhone})</td>
      <td class="text-right" style="white-space: nowrap;">
        <button class="btn btn-secondary btn-icon btn-card-stud" data-id="${student.id}" title="Generate ID Card" style="border-color: rgba(245, 158, 11, 0.4); color: var(--warning);">
          <i data-lucide="contact" style="width: 14px; height: 14px;"></i>
        </button>
        <button class="btn btn-secondary btn-icon btn-edit-stud" data-id="${student.id}" title="Edit Record">
          <i data-lucide="edit" style="width: 14px; height: 14px;"></i>
        </button>
        <button class="btn btn-danger btn-icon btn-del-stud" data-id="${student.id}" title="Delete Student">
          <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Bind Actions
  document.querySelectorAll(".btn-card-stud").forEach(btn => {
    btn.addEventListener("click", () => openIdCardModal(btn.dataset.id));
  });
  document.querySelectorAll(".btn-edit-stud").forEach(btn => {
    btn.addEventListener("click", () => openStudentModal(btn.dataset.id));
  });
  document.querySelectorAll(".btn-del-stud").forEach(btn => {
    btn.addEventListener("click", () => deleteStudentAccount(btn.dataset.id));
  });

  if (window.lucide) window.lucide.createIcons();
}

function populateFilterOptions() {
  const classFilter = document.getElementById("report-class-filter");
  const secFilter = document.getElementById("report-section-filter");
  const hwClassSelect = document.getElementById("admin-hw-class-select");
  const examClassSelect = document.getElementById("admin-exam-class-select");
  const noticeClassSelect = document.getElementById("admin-notice-class-select");
  const eventClassSelect = document.getElementById("admin-event-class-select");
  
  // Extract unique classes and sections
  const classes = new Set();
  const sections = new Set();
  
  studentsList.forEach(s => {
    if (s.class) classes.add(s.class);
    if (s.section) sections.add(s.section);
  });

  // Retain existing values selected
  const prevClassVal = classFilter ? classFilter.value : "";
  const prevSecVal = secFilter ? secFilter.value : "";

  if (classFilter) {
    classFilter.innerHTML = '<option value="">All Classes</option>';
    Array.from(classes).sort((a,b) => String(a).localeCompare(String(b), undefined, {numeric: true})).forEach(c => {
      classFilter.innerHTML += `<option value="${c}">Class ${c}</option>`;
    });
    classFilter.value = prevClassVal;
  }

  if (secFilter) {
    secFilter.innerHTML = '<option value="">All Sections</option>';
    Array.from(sections).sort().forEach(s => {
      secFilter.innerHTML += `<option value="${s}">Section ${s}</option>`;
    });
    secFilter.value = prevSecVal;
  }

  const classListSorted = Array.from(classes).sort((a,b) => String(a).localeCompare(String(b), undefined, {numeric: true}));
  [hwClassSelect, examClassSelect, noticeClassSelect, eventClassSelect].forEach(selectEl => {
    if (!selectEl) return;
    const currentVal = selectEl.value;
    selectEl.innerHTML = '<option value="All">All Classes</option>';
    classListSorted.forEach(c => {
      selectEl.innerHTML += `<option value="${c}">Class ${c}</option>`;
    });
    if (currentVal) selectEl.value = currentVal;
  });
}

// 5. Teacher Modal CRUD Logic
function openTeacherModal(id = "") {
  const modal = document.getElementById("modal-teacher");
  const form = document.getElementById("teacher-form");
  const passGroup = document.getElementById("teacher-password-group");
  const passInput = document.getElementById("teacher-password-input");
  
  form.reset();

  if (id) {
    // Edit Mode
    document.getElementById("modal-teacher-title").innerText = "Edit Teacher Account";
    document.getElementById("teacher-edit-id").value = id;
    
    // Fill credentials
    const teacher = teachersList.find(t => t.id === id);
    if (teacher) {
      document.getElementById("teacher-name-input").value = teacher.name;
      document.getElementById("teacher-email-input").value = teacher.email;
      document.getElementById("teacher-email-input").disabled = true; // Email changes blocked in firebase
      document.getElementById("teacher-class-input").value = teacher.class;
      document.getElementById("teacher-section-input").value = teacher.section;
      document.getElementById("teacher-photo-input").value = teacher.photoURL || "";
      document.getElementById("teacher-subject-input").value = teacher.subject || "";
      document.getElementById("teacher-dept-input").value = teacher.department || "";
      
      // Pin field settings
      document.getElementById("teacher-pin-input").required = false;
      document.getElementById("teacher-pin-input").placeholder = "Leave blank to keep current PIN";
    }
    passGroup.style.display = "none";
    passInput.required = false;
  } else {
    // Create Mode
    document.getElementById("modal-teacher-title").innerText = "Create Teacher Account";
    document.getElementById("teacher-edit-id").value = "";
    document.getElementById("teacher-email-input").disabled = false;
    
    // Pin field requirements
    document.getElementById("teacher-pin-input").required = true;
    document.getElementById("teacher-pin-input").placeholder = "E.g. 1234";
    
    passGroup.style.display = "block";
    passInput.required = true;
  }

  modal.classList.add("active");
  if (window.lucide) window.lucide.createIcons();
}

function closeTeacherModal() {
  document.getElementById("modal-teacher").classList.remove("active");
}

async function handleTeacherFormSubmit(e) {
  e.preventDefault();
  closeTeacherModal();
  loader.classList.add("active");

  const editId = document.getElementById("teacher-edit-id").value;
  const name = document.getElementById("teacher-name-input").value.trim();
  const email = document.getElementById("teacher-email-input").value.trim();
  const pass = document.getElementById("teacher-password-input").value;
  const tClass = document.getElementById("teacher-class-input").value.trim();
  const tSec = document.getElementById("teacher-section-input").value.trim();
  const photoURL = document.getElementById("teacher-photo-input").value.trim();
  const rawPin = document.getElementById("teacher-pin-input").value;
  const tSubject = document.getElementById("teacher-subject-input").value.trim();
  const tDept = document.getElementById("teacher-dept-input").value.trim();

  try {
    let teacherId = "";
    let hashedPin = "";

    if (editId) {
      // Find existing teacher
      const existing = teachersList.find(t => t.id === editId);
      teacherId = existing.teacherId || `TCH${new Date().getFullYear()}${Date.now().toString().slice(-6)}`;
      
      // Hash PIN if updated, otherwise use existing
      if (rawPin) {
        hashedPin = await hashPIN(rawPin);
      } else {
        hashedPin = existing.attendancePIN || "";
      }

      loaderText.innerText = "Updating teacher profile...";
      const tRef = doc(db, "teachers", editId);
      await setDoc(tRef, {
        name: name,
        class: tClass,
        section: tSec,
        photoURL: photoURL,
        attendancePIN: hashedPin,
        subject: tSubject,
        department: tDept
      }, { merge: true });

      // Update Realtime Database
      await set(dbRef(rtdb, `teachers/${editId}`), {
        name: name,
        class: tClass,
        section: tSec,
        photoURL: photoURL,
        attendancePIN: hashedPin,
        subject: tSubject,
        department: tDept
      });

      showToast("Success", "Teacher account details updated successfully.", "success");
    } else {
      // Create: Initialize secondary auth instance
      loaderText.innerText = "Creating secure login credentials...";
      const secApp = initializeApp(firebaseConfig, "secondaryTeacherApp");
      const secAuth = getAuth(secApp);
      
      const cred = await createUserWithEmailAndPassword(secAuth, email, pass);
      const uid = cred.user.uid;
      
      await signOut(secAuth);
      await deleteApp(secApp); // Release secondary instance

      // Generate unique Teacher ID
      const year = new Date().getFullYear();
      const rollingSeq = Date.now().toString().slice(-6);
      teacherId = `TCH${year}${rollingSeq}`;
      
      hashedPin = await hashPIN(rawPin);

      loaderText.innerText = "Writing teacher record to databases...";
      const teacherData = {
        teacherId: teacherId,
        name: name,
        email: email,
        class: tClass,
        section: tSec,
        role: "teacher",
        photoURL: photoURL,
        attendancePIN: hashedPin,
        subject: tSubject,
        department: tDept,
        createdAt: Date.now()
      };

      // Write profile doc to Firestore
      const tRef = doc(db, "teachers", uid);
      await setDoc(tRef, {
        ...teacherData,
        createdAt: serverTimestamp() // Use serverTimestamp for Firestore
      });

      // Write profile to Realtime Database
      await set(dbRef(rtdb, `teachers/${uid}`), teacherData);

      // Write registration record under classes as well
      const classKey = `${tClass}_${tSec}`;
      const classData = {
        class: tClass,
        section: tSec,
        teacherId: uid
      };

      await setDoc(doc(db, "classes", classKey), classData);
      await set(dbRef(rtdb, `classes/${classKey}`), classData);

      showToast("Success", "Teacher account initialized successfully.", "success");
    }
  } catch (err) {
    console.error("Teacher CRUD failed:", err);
    showToast("Transaction Error", err.message, "danger");
  } finally {
    loader.classList.remove("active");
  }
}

async function deleteTeacherAccount(uid) {
  if (confirm("Are you sure you want to delete this teacher account? They will lose access immediately.")) {
    loader.classList.add("active");
    loaderText.innerText = "De-registering teacher profile...";
    try {
      // 1. Delete from Firestore
      await deleteDoc(doc(db, "teachers", uid));
      // 2. Delete from Realtime Database
      await remove(dbRef(rtdb, `teachers/${uid}`));
      showToast("Account De-activated", "Teacher credentials deleted from databases.", "warning");
    } catch (err) {
      console.error(err);
      showToast("Delete Failed", err.message, "danger");
    } finally {
      loader.classList.remove("active");
    }
  }
}

// 6. Student Modal CRUD Logic
function openStudentModal(id = "") {
  const modal = document.getElementById("modal-student");
  const form = document.getElementById("student-form");
  const regGroup = document.getElementById("student-reg-num-group");
  
  form.reset();

  if (id) {
    // Edit
    document.getElementById("modal-student-title").innerText = "Edit Student Profile";
    document.getElementById("student-edit-id").value = id;
    regGroup.style.display = "block";
    
    const student = studentsList.find(s => s.id === id);
    if (student) {
      document.getElementById("student-reg-input").value = student.registrationNumber;
      document.getElementById("student-name-input").value = student.name;
      document.getElementById("student-class-input").value = student.class;
      document.getElementById("student-section-input").value = student.section;
      document.getElementById("student-roll-input").value = student.rollNumber;
      document.getElementById("student-blood-input").value = student.bloodGroup || "";
      document.getElementById("student-parent-name").value = student.parentName;
      document.getElementById("student-parent-phone").value = student.parentPhone;
      document.getElementById("student-photo-input").value = student.photoURL || "";
      
      // Pin field requires filling (or keep existing by adding info tag)
      document.getElementById("student-pin-input").required = false;
      document.getElementById("student-pin-input").placeholder = "Leave blank to keep current PIN";
    }
  } else {
    // Create
    document.getElementById("modal-student-title").innerText = "Register Student";
    document.getElementById("student-edit-id").value = "";
    regGroup.style.display = "none";
    document.getElementById("student-pin-input").required = true;
    document.getElementById("student-pin-input").placeholder = "E.g. 1234";
  }

  modal.classList.add("active");
}

function closeStudentModal() {
  document.getElementById("modal-student").classList.remove("active");
}

// Hashing helper
async function hashPIN(pin) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Image compression helper (resizes and compresses to JPEG to fit database doc limits)
function compressImage(file, maxWidth = 250, maxHeight = 250) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;
        
        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.7)); // 70% quality compressed JPEG
      };
      img.onerror = () => resolve("");
      img.src = e.target.result;
    };
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}

async function handleStudentFormSubmit(e) {
  e.preventDefault();
  closeStudentModal();
  loader.classList.add("active");

  const editId = document.getElementById("student-edit-id").value;
  const name = document.getElementById("student-name-input").value.trim();
  const sClass = document.getElementById("student-class-input").value.trim();
  const sSec = document.getElementById("student-section-input").value.trim();
  const roll = document.getElementById("student-roll-input").value.trim();
  const blood = document.getElementById("student-blood-input").value;
  const pName = document.getElementById("student-parent-name").value.trim();
  const pPhone = document.getElementById("student-parent-phone").value.trim();
  const rawPin = document.getElementById("student-pin-input").value;
  const photoURLInput = document.getElementById("student-photo-input").value.trim();

  try {
    let regNum = "";
    let photoURL = photoURLInput;
    let hashedPin = "";

    // A. Generate/Retrieve Registration number
    if (editId) {
      const existing = studentsList.find(s => s.id === editId);
      regNum = existing.registrationNumber;
      
      // If photo input is empty, retain existing photoURL
      if (!photoURL) {
        photoURL = existing.photoURL || "";
      }
      
      // Only hash PIN if they updated it
      if (rawPin) {
        hashedPin = await hashPIN(rawPin);
      } else {
        hashedPin = existing.attendancePIN;
      }
    } else {
      // Auto generate format: REG + current_year + rolling_timestamp_digits
      const year = new Date().getFullYear();
      const rollingSeq = Date.now().toString().slice(-6); // 6 digits safe rolling
      regNum = `REG${year}${rollingSeq}`;
      hashedPin = await hashPIN(rawPin);
    }

    loaderText.innerText = "Finding assigned class teacher...";
    // C. Detect Assigned Teacher
    let teacherUid = "";
    const classesQuery = query(collection(db, "classes"), where("class", "==", sClass), where("section", "==", sSec));
    const classSnapshot = await getDocs(classesQuery);
    if (!classSnapshot.empty) {
      teacherUid = classSnapshot.docs[0].data().teacherId || "";
    }

    loaderText.innerText = "Saving student record...";
    // D. Write Student details
    const studentData = {
      registrationNumber: regNum,
      name: name,
      rollNumber: roll,
      class: sClass,
      section: sSec,
      bloodGroup: blood,
      photoURL: photoURL,
      parentName: pName,
      parentPhone: pPhone,
      attendancePIN: hashedPin,
      teacherId: teacherUid,
      createdAt: Date.now()
    };

    // 1. Write to Firestore
    const studentRef = doc(db, "students", regNum);
    await setDoc(studentRef, {
      ...studentData,
      createdAt: serverTimestamp() // Firestore timestamp
    }, { merge: true });

    // 2. Write to Realtime Database
    await set(dbRef(rtdb, `students/${regNum}`), studentData);

    showToast("Registration Success", `${name} saved successfully.`, "success");

  } catch (err) {
    console.error("Student registration failed:", err);
    showToast("Database Error", err.message, "danger");
  } finally {
    loader.classList.remove("active");
  }
}

async function deleteStudentAccount(regNum) {
  if (confirm("Are you sure you want to delete this student record? All logs will remain but access PIN check-ins will terminate.")) {
    loader.classList.add("active");
    loaderText.innerText = "De-registering student...";

    try {
      // 1. Delete image from Storage if exists
      const existing = studentsList.find(s => s.registrationNumber === regNum);
      if (existing && existing.photoURL) {
        try {
          const fileRef = ref(storage, `student_photos/${regNum}`);
          await deleteObject(fileRef);
        } catch (storageErr) {
          console.warn("Photo could not be deleted from storage (perhaps not found):", storageErr);
        }
      }

      // 2. Delete from Firestore and Realtime Database
      await deleteDoc(doc(db, "students", regNum));
      await remove(dbRef(rtdb, `students/${regNum}`));
      showToast("Student Removed", `Student record ${regNum} deleted.`, "warning");
    } catch (err) {
      console.error(err);
      showToast("Delete Failed", err.message, "danger");
    } finally {
      loader.classList.remove("active");
    }
  }
}

// 7. Student ID Card Generation
// 7. ID Card Generation (Student & Teacher)
function openIdCardModal(id, isTeacher = false) {
  let photo = "";
  let name = "";
  let idNumber = "";
  let label1 = "Reg No", val1 = "-";
  let label2 = "Roll No", val2 = "-";
  let label3 = "Class / Sec", val3 = "-";
  let label4 = "Blood Grp", val4 = "-";
  let footerContact = "";
  let roleText = "STUDENT";
  let badgeColor = "var(--primary-light)";
  let badgeText = "var(--primary)";

  if (isTeacher) {
    const teacher = teachersList.find(t => t.id === id);
    if (!teacher) return;
    photo = teacher.photoURL || "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop";
    name = teacher.name;
    idNumber = teacher.teacherId || "N/A";
    
    label1 = "Teacher ID"; val1 = idNumber;
    label2 = "Email"; val2 = teacher.email;
    label3 = "Class / Sec"; val3 = `Class ${teacher.class}-${teacher.section}`;
    label4 = "Subject"; val4 = teacher.subject || "N/A";
    footerContact = teacher.email;
    roleText = "TEACHER";
    
    // Greenish styles for Teacher badge
    badgeColor = "rgba(16, 185, 129, 0.15)";
    badgeText = "rgb(16, 185, 129)";
  } else {
    const student = studentsList.find(s => s.id === id);
    if (!student) return;
    photo = student.photoURL || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop";
    name = student.name;
    idNumber = student.registrationNumber;
    
    label1 = "Reg No"; val1 = idNumber;
    label2 = "Roll No"; val2 = student.rollNumber;
    label3 = "Class / Sec"; val3 = `${student.class}-${student.section}`;
    label4 = "Blood Grp"; val4 = student.bloodGroup || "N/A";
    footerContact = student.parentPhone;
    roleText = "STUDENT";
    
    badgeColor = "var(--primary-light)";
    badgeText = "var(--primary)";
  }

  // Set card texts
  document.getElementById("id-card-photo-img").src = photo;
  document.getElementById("id-card-name-txt").innerText = name;
  document.getElementById("id-card-reg-txt").innerText = val1;
  document.getElementById("id-card-roll-txt").innerText = val2;
  document.getElementById("id-card-class-txt").innerText = val3;
  document.getElementById("id-card-blood-txt").innerText = val4;
  document.getElementById("id-card-phone-txt").innerText = footerContact;

  // Set Labels dynamically
  document.getElementById("card-label-1").innerText = label1;
  document.getElementById("card-label-2").innerText = label2;
  document.getElementById("card-label-3").innerText = label3;
  document.getElementById("card-label-4").innerText = label4;

  // Set Role Badge
  const roleBadge = document.querySelector(".id-card-role-badge");
  roleBadge.innerText = roleText;
  roleBadge.style.backgroundColor = badgeColor;
  roleBadge.style.color = badgeText;

  // Initialize/Refresh canvas QR code containing ONLY ID number
  const canvas = document.getElementById("id-card-qr-canvas");
  if (qrInstance) {
    qrInstance.value = idNumber;
  } else {
    qrInstance = new QRious({
      element: canvas,
      value: idNumber,
      size: 150
    });
  }

  // Display modal
  document.getElementById("modal-id-card").classList.add("active");
  if (window.lucide) window.lucide.createIcons();
}

async function downloadIdCardSideAsPng(elementId, sideName) {
  const cardElement = document.getElementById(elementId);
  const studentName = document.getElementById("id-card-name-txt").innerText.replace(/\s+/g, '_');
  
  showToast("Rendering Card", `Compiling ID card ${sideName} graphic...`, "info");

  // Wait for all image tags in the card to be fully loaded and decoded in browser layout before capture
  const imgTags = cardElement.querySelectorAll("img");
  for (const img of imgTags) {
    if (img.src) {
      try {
        await img.decode();
      } catch (decodeErr) {
        console.warn("Image decode wait failed for:", img.src, decodeErr);
      }
    }
  }

  // Call HTML2canvas to draw element
  html2canvas(cardElement, {
    useCORS: true, // Allow cross-origin images
    scale: 2 // Boost resolution
  }).then(canvas => {
    const link = document.createElement("a");
    link.download = `ID_Card_${studentName}_${sideName}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    showToast("Downloaded", `Student ID card ${sideName} downloaded.`, "success");
  }).catch(err => {
    console.error("ID card render failed:", err);
    showToast("Render Error", "Could not generate download file.", "danger");
  });
}

// 8. Reports Log Generation
async function loadReportsList() {
  const tbody = document.getElementById("reports-tbody");
  const dateVal = document.getElementById("report-date-filter").value;
  const roleVal = document.getElementById("report-role-filter").value;
  const classVal = document.getElementById("report-class-filter").value;
  const secVal = document.getElementById("report-section-filter").value;

  if (!dateVal) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center" style="color: var(--text-light); padding: 2rem;">Please pick a valid date.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = `
    <tr>
      <td colspan="8" class="text-center" style="color: var(--text-light); padding: 2rem;">Loading log records...</td>
    </tr>
  `;

  try {
    const attendCol = collection(db, "attendance");
    // Standardize query by Date
    const q = query(attendCol, where("date", "==", dateVal));
    const querySnapshot = await getDocs(q);

    let filteredRecords = [];
    querySnapshot.forEach(docSnap => {
      filteredRecords.push(docSnap.data());
    });

    // Apply Client side filtering for role, class & section to run indexes-free!
    if (roleVal) {
      filteredRecords = filteredRecords.filter(r => {
        const isTeacher = r.role === "teacher" || r.registrationNumber?.startsWith("TCH");
        return roleVal === "teacher" ? isTeacher : !isTeacher;
      });
    }
    if (classVal) {
      filteredRecords = filteredRecords.filter(r => r.class === classVal);
    }
    if (secVal) {
      filteredRecords = filteredRecords.filter(r => r.section === secVal);
    }

    // Render results
    tbody.innerHTML = "";
    if (filteredRecords.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="text-center" style="color: var(--text-light); padding: 2rem;">No logs matched filtering criteria.</td>
        </tr>
      `;
      return;
    }

    // Sort logs
    filteredRecords.sort((a,b) => a.entryTime.localeCompare(b.entryTime));

    filteredRecords.forEach(record => {
      const isTeacher = record.role === "teacher" || record.registrationNumber?.startsWith("TCH");
      const roleBadge = isTeacher 
        ? `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: rgb(16, 185, 129); font-weight:700;">Teacher</span>`
        : `<span class="badge" style="background: rgba(59, 130, 246, 0.15); color: var(--primary); font-weight:700;">Student</span>`;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="font-weight: 600;">${record.studentName}</td>
        <td><span style="font-family: monospace; font-weight:700;">${record.registrationNumber}</span></td>
        <td>${roleBadge}</td>
        <td>Class ${record.class}</td>
        <td>Section ${record.section}</td>
        <td style="font-family: monospace;">${record.date}</td>
        <td style="font-family: monospace;">${record.entryTime}</td>
        <td><span class="badge badge-${record.status.toLowerCase()}">${record.status}</span></td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    console.error(err);
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center" style="color: var(--danger); padding: 2rem;">Failed to fetch logs: ${err.message}</td>
      </tr>
    `;
  }
}

function triggerCsvDownload() {
  const dateVal = document.getElementById("report-date-filter").value;
  const classVal = document.getElementById("report-class-filter").value;
  const secVal = document.getElementById("report-section-filter").value;

  const rows = document.querySelectorAll("#reports-tbody tr");
  
  if (rows.length === 0 || rows[0].innerText.includes("No logs") || rows[0].innerText.includes("Please pick") || rows[0].innerText.includes("Loading")) {
    showToast("Export Failed", "There are no records to export.", "warning");
    return;
  }

  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "Full Name,ID Number,Role,Class,Section,Date,Entry Time,Status\n";

  rows.forEach(tr => {
    const cols = tr.querySelectorAll("td");
    const name = cols[0].innerText;
    const reg = cols[1].innerText;
    const role = cols[2].innerText;
    const cls = cols[3].innerText.replace("Class ", "");
    const sec = cols[4].innerText.replace("Section ", "");
    const date = cols[5].innerText;
    const time = cols[6].innerText;
    const status = cols[7].innerText;

    csvContent += `"${name}","${reg}","${role}","${cls}","${sec}","${date}","${time}","${status}"\n`;
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  
  let filename = `Attendance_Report_${dateVal}`;
  if (classVal) filename += `_Class_${classVal}`;
  if (secVal) filename += `_Sec_${secVal}`;
  
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  showToast("CSV Downloaded", "Log reports exported successfully.", "success");
}

// Onload Trigger
document.addEventListener("DOMContentLoaded", initAdminPanel);
