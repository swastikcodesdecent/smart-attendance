// js/auth.js
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

/**
 * Route Guard for Admin/Teacher pages.
 * Ensures the user is logged in and has one of the allowed roles.
 * Redirects if unauthorized.
 * 
 * @param {string[]} allowedRoles - List of roles allowed on this page (e.g. ['admin', 'teacher'])
 * @returns {Promise<{user: Object, profile: Object, role: string}>}
 */
export function guardPage(allowedRoles) {
  return new Promise((resolve, reject) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        console.log("No user session found. Redirecting to login.");
        window.location.href = `login.html?redirect=${encodeURIComponent(window.location.pathname)}`;
        reject("Not authenticated");
        return;
      }

      try {
        // 1. Check if user is an Admin
        const adminRef = doc(db, "admins", user.uid);
        const adminDoc = await getDoc(adminRef);
        if (adminDoc.exists()) {
          const profile = adminDoc.data();
          if (allowedRoles.includes("admin")) {
            resolve({ user, profile, role: "admin" });
          } else {
            console.warn("Admin attempted to access teacher page. Redirecting to admin panel.");
            window.location.href = "admin.html";
            reject("Unauthorized: Admin accessing teacher page");
          }
          return;
        }

        // 2. Check if user is a Teacher
        const teacherRef = doc(db, "teachers", user.uid);
        const teacherDoc = await getDoc(teacherRef);
        if (teacherDoc.exists()) {
          const profile = teacherDoc.data();
          if (allowedRoles.includes("teacher")) {
            resolve({ user, profile, role: "teacher" });
          } else {
            console.warn("Teacher attempted to access admin page. Redirecting to teacher panel.");
            window.location.href = "teacher.html";
            reject("Unauthorized: Teacher accessing admin page");
          }
          return;
        }

        // 3. Authenticated but role document not found
        console.error("Authenticated user has no database role profile.");
        await signOut(auth);
        window.location.href = "login.html?error=unauthorized";
        reject("Unauthorized: Database profile missing");
      } catch (error) {
        console.error("Auth routing guard error:", error);
        window.location.href = "login.html?error=check_failed";
        reject(error);
      }
    });
  });
}

/**
 * Check session role and redirect logged-in users to their respective dashboards.
 * Useful on the landing page or login page to prevent re-login.
 */
export function checkSessionAndRedirect() {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      try {
        // Check admin status
        const adminDoc = await getDoc(doc(db, "admins", user.uid));
        if (adminDoc.exists()) {
          window.location.href = "admin.html";
          return;
        }

        // Check teacher status
        const teacherDoc = await getDoc(doc(db, "teachers", user.uid));
        if (teacherDoc.exists()) {
          window.location.href = "teacher.html";
          return;
        }
      } catch (err) {
        console.error("Session redirection error:", err);
      }
    }
  });
}

/**
 * Log out current authenticated session.
 */
export async function logoutUser() {
  try {
    await signOut(auth);
    window.location.href = "login.html";
  } catch (error) {
    console.error("Sign out failed:", error);
    alert("Sign out failed. Please try again.");
  }
}
