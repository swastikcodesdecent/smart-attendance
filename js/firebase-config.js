// js/firebase-config.js
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// =========================================================================
// FIREBASE CONFIGURATION
// =========================================================================
export const firebaseConfig = {
  apiKey: "AIzaSyCE3lIY4nXi7fqAKmypcydLmFME7bF_SZE",
  authDomain: "depaul-exhibtion.firebaseapp.com",
  projectId: "depaul-exhibtion",
  storageBucket: "depaul-exhibtion.firebasestorage.app",
  messagingSenderId: "908833005976",
  appId: "1:908833005976:web:b48889877862245dba0bed",
  measurementId: "G-SCB23Y6XR8",
  databaseURL: "https://depaul-exhibtion-default-rtdb.firebaseio.com"
};

// Initialize Firebase App
export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Initialize Firebase Services
export const auth = getAuth(app);
export const db = getFirestore(app);    // Cloud Firestore
export const rtdb = getDatabase(app);  // Realtime Database
