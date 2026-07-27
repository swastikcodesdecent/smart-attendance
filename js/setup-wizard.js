// js/setup-wizard.js
import { isConfigured, saveConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

/**
 * Checks if the system is configured. If not, blocks the page and displays
 * the step-by-step Glassmorphic setup wizard to bootstrap the application.
 */
export function checkAndShowSetup() {
  if (isConfigured()) return;

  // Render Setup Wizard
  document.body.innerHTML = `
    <div class="setup-wizard-container" style="background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 50%, #eff6ff 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; width: 100%;">
      <div class="glass-card setup-wizard-card" style="max-width: 550px; width: 90%; margin: 2rem auto; padding: 2.5rem;">
        <div style="text-align: center; margin-bottom: 2rem;">
          <img src="depaul-school-logo.png" alt="DPS Logo" style="height: 60px; margin-bottom: 0.5rem;" onerror="this.style.display='none'">
          <h2 class="font-outfit" style="font-size: 1.5rem; color: #1e3a8a;">De Paul School</h2>
          <p style="color: var(--text-muted); font-size: 0.9rem;">Smart Attendance System Initial Setup</p>
        </div>

        <div class="setup-wizard-steps">
          <div class="setup-step active" id="step-dot-1">1</div>
          <div class="setup-step" id="step-dot-2">2</div>
          <div class="setup-step" id="step-dot-3">3</div>
        </div>

        <!-- STEP 1: Firebase Configuration -->
        <div class="setup-tab active" id="step-tab-1">
          <h3 class="mb-2 font-outfit" style="font-size: 1.2rem; color: var(--primary);">Step 1: Firebase Configuration</h3>
          <p style="color: var(--text-muted); font-size: 0.85rem; line-height: 1.5; margin-bottom: 1.5rem;">
            Create a blank Firebase project at <a href="https://console.firebase.google.com" target="_blank" style="color: var(--primary); font-weight: 600; text-decoration: underline;">console.firebase.google.com</a>. Enable <b>Email/Password Auth</b>, <b>Cloud Firestore</b>, and <b>Firebase Storage</b>. Then, copy and paste the <code>firebaseConfig</code> object from your project settings below.
          </p>
          
          <div class="form-group">
            <label class="form-label">Firebase Config JSON or Object</label>
            <textarea class="form-control" id="firebase-paste-area" rows="7" placeholder="const firebaseConfig = {&#10;  apiKey: &quot;AIzaSy...&quot;,&#10;  authDomain: &quot;...&quot;,&#10;  projectId: &quot;...&quot;,&#10;  storageBucket: &quot;...&quot;,&#10;  messagingSenderId: &quot;...&quot;,&#10;  appId: &quot;...&quot;&#10;};" style="font-family: monospace; font-size: 0.8rem;"></textarea>
            <span id="step1-error" style="color: var(--danger); font-size: 0.8rem; margin-top: 0.5rem; display: none;">Invalid Firebase Configuration format detected. Please make sure to includeapiKey and projectId.</span>
          </div>
          
          <div style="text-align: right; margin-top: 1.5rem;">
            <button class="btn btn-primary" id="btn-next-1">Next: Telegram Settings <i data-lucide="arrow-right" style="width: 16px; height: 16px;"></i></button>
          </div>
        </div>

        <!-- STEP 2: Telegram Bot Settings -->
        <div class="setup-tab" id="step-tab-2" style="display: none;">
          <h3 class="mb-2 font-outfit" style="font-size: 1.2rem; color: var(--primary);">Step 2: Parent Telegram Bot (Alerts)</h3>
          <p style="color: var(--text-muted); font-size: 0.85rem; line-height: 1.5; margin-bottom: 1.5rem;">
            To send notifications to parents, search for <b>@BotFather</b> on Telegram, create a new bot (using <code>/newbot</code>), name it, and paste its API Bot Token below. You can also skip this and configure it later.
          </p>
          
          <div class="form-group">
            <label class="form-label">Telegram Bot Token (Optional)</label>
            <input type="text" class="form-control" id="telegram-token-input" placeholder="123456789:ABCdefGhIJKlmNoPQRsTuvwxyz123...">
          </div>
          
          <div style="display: flex; justify-content: space-between; margin-top: 1.5rem;">
            <button class="btn btn-secondary" id="btn-prev-2"><i data-lucide="arrow-left" style="width: 16px; height: 16px;"></i> Back</button>
            <button class="btn btn-primary" id="btn-next-2">Next: Create Admin <i data-lucide="arrow-right" style="width: 16px; height: 16px;"></i></button>
          </div>
        </div>

        <!-- STEP 3: Create Admin Account -->
        <div class="setup-tab" id="step-tab-3" style="display: none;">
          <h3 class="mb-2 font-outfit" style="font-size: 1.2rem; color: var(--primary);">Step 3: Create Administrator Account</h3>
          <p style="color: var(--text-muted); font-size: 0.85rem; line-height: 1.5; margin-bottom: 1.5rem;">
            Establish your login credentials. This account will be created directly in your Firebase Auth and registered in the database as the School Super Administrator.
          </p>
          
          <div class="form-group">
            <label class="form-label">Admin Full Name</label>
            <input type="text" class="form-control" id="admin-name" placeholder="E.g. Father Superior">
          </div>
          <div class="form-group">
            <label class="form-label">Admin Email</label>
            <input type="email" class="form-control" id="admin-email" placeholder="admin@depaulschool.com">
          </div>
          <div class="form-group">
            <label class="form-label">Admin Password (min 6 characters)</label>
            <input type="password" class="form-control" id="admin-password" placeholder="••••••••">
            <span id="step3-error" style="color: var(--danger); font-size: 0.8rem; margin-top: 0.5rem; display: none;"></span>
          </div>
          
          <div style="display: flex; justify-content: space-between; margin-top: 1.5rem;">
            <button class="btn btn-secondary" id="btn-prev-3"><i data-lucide="arrow-left" style="width: 16px; height: 16px;"></i> Back</button>
            <button class="btn btn-primary" id="btn-finish">Complete Setup <i data-lucide="check" style="width: 16px; height: 16px;"></i></button>
          </div>
        </div>

      </div>
    </div>
    
    <div class="loader-overlay" id="setup-loader">
      <div class="spinner"></div>
      <p id="setup-loader-text" class="font-outfit" style="color: var(--primary); font-weight:600; margin-top:1rem;"></p>
    </div>
  `;

  // Dynamic Lucide SVG Injection
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // State
  let config = {};
  let telegramToken = "";

  const pasteArea = document.getElementById("firebase-paste-area");
  const step1Err = document.getElementById("step1-error");
  const tgInput = document.getElementById("telegram-token-input");
  const loader = document.getElementById("setup-loader");
  const loaderText = document.getElementById("setup-loader-text");
  
  // Navigation elements
  const next1 = document.getElementById("btn-next-1");
  const next2 = document.getElementById("btn-next-2");
  const prev2 = document.getElementById("btn-prev-2");
  const prev3 = document.getElementById("btn-prev-3");
  const finish = document.getElementById("btn-finish");
  
  const dot1 = document.getElementById("step-dot-1");
  const dot2 = document.getElementById("step-dot-2");
  const dot3 = document.getElementById("step-dot-3");
  
  const tab1 = document.getElementById("step-tab-1");
  const tab2 = document.getElementById("step-tab-2");
  const tab3 = document.getElementById("step-tab-3");

  // Step 1 -> Step 2
  next1.addEventListener("click", () => {
    const rawVal = pasteArea.value;
    const parsed = parseFirebaseConfig(rawVal);
    if (!parsed) {
      step1Err.style.display = "block";
      return;
    }
    step1Err.style.display = "none";
    config = parsed;
    
    tab1.style.display = "none";
    tab2.style.display = "block";
    dot1.classList.remove("active");
    dot2.classList.add("active");
  });

  // Step 2 Back -> Step 1
  prev2.addEventListener("click", () => {
    tab2.style.display = "none";
    tab1.style.display = "block";
    dot2.classList.remove("active");
    dot1.classList.add("active");
  });

  // Step 2 -> Step 3
  next2.addEventListener("click", () => {
    telegramToken = tgInput.value.trim();
    tab2.style.display = "none";
    tab3.style.display = "block";
    dot2.classList.remove("active");
    dot3.classList.add("active");
  });

  // Step 3 Back -> Step 2
  prev3.addEventListener("click", () => {
    tab3.style.display = "none";
    tab2.style.display = "block";
    dot3.classList.remove("active");
    dot2.classList.add("active");
  });

  // Complete Setup
  finish.addEventListener("click", async () => {
    const name = document.getElementById("admin-name").value.trim();
    const email = document.getElementById("admin-email").value.trim();
    const password = document.getElementById("admin-password").value;
    const step3Err = document.getElementById("step3-error");
    
    if (!name || !email || !password) {
      step3Err.innerText = "Please fill in all administrator credentials.";
      step3Err.style.display = "block";
      return;
    }
    
    if (password.length < 6) {
      step3Err.innerText = "Password must be at least 6 characters long.";
      step3Err.style.display = "block";
      return;
    }
    
    step3Err.style.display = "none";
    
    // Trigger loader
    loader.classList.add("active");
    loaderText.innerText = "Connecting to Firebase...";

    try {
      // 1. Initialize temporary app to check configuration & create administrator auth account
      const tempApp = initializeApp(config, "tempSetupApp");
      const tempAuth = getAuth(tempApp);
      const tempDb = getFirestore(tempApp);
      
      loaderText.innerText = "Creating administrator account...";
      const credentials = await createUserWithEmailAndPassword(tempAuth, email, password);
      const uid = credentials.user.uid;
      
      loaderText.innerText = "Configuring Firestore documents...";
      // 2. Create the admin document in 'admins' collection
      await setDoc(doc(tempDb, "admins", uid), {
        name: name,
        email: email,
        role: "admin",
        createdAt: new Date()
      });

      // 3. Create system settings
      await setDoc(doc(tempDb, "settings", "system"), {
        schoolName: "De Paul School",
        telegramBotToken: telegramToken || "",
        lateTime: "08:30"
      });

      loaderText.innerText = "Saving configuration...";
      // 4. Save and restart
      const tgConfigObj = { botToken: telegramToken || "YOUR_TELEGRAM_BOT_TOKEN" };
      saveConfig(config, tgConfigObj);

    } catch (err) {
      console.error(err);
      loader.classList.remove("active");
      step3Err.innerText = `Setup failed: ${err.message}`;
      step3Err.style.display = "block";
    }
  });
}

/**
 * Parses pasted text string trying to extract key Firebase Configuration attributes.
 * Looks for Javascript properties and JSON keys.
 */
function parseFirebaseConfig(str) {
  try {
    const apiKey = str.match(/apiKey\s*:\s*["']([^"']+)["']/)?.[1];
    const authDomain = str.match(/authDomain\s*:\s*["']([^"']+)["']/)?.[1];
    const projectId = str.match(/projectId\s*:\s*["']([^"']+)["']/)?.[1];
    const storageBucket = str.match(/storageBucket\s*:\s*["']([^"']+)["']/)?.[1];
    const messagingSenderId = str.match(/messagingSenderId\s*:\s*["']([^"']+)["']/)?.[1];
    const appId = str.match(/appId\s*:\s*["']([^"']+)["']/)?.[1];
    
    if (apiKey && projectId) {
      return {
        apiKey,
        authDomain: authDomain || "",
        projectId,
        storageBucket: storageBucket || "",
        messagingSenderId: messagingSenderId || "",
        appId: appId || ""
      };
    }
    
    // Fallback: try parsing JSON
    const cleaned = str.replace(/const\s+firebaseConfig\s*=\s*/g, '').replace(/;/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (parsed.apiKey && parsed.projectId) {
      return {
        apiKey: parsed.apiKey,
        authDomain: parsed.authDomain || "",
        projectId: parsed.projectId,
        storageBucket: parsed.storageBucket || "",
        messagingSenderId: parsed.messagingSenderId || "",
        appId: parsed.appId || ""
      };
    }
  } catch (e) {
    // Return null if all parse attempts fail
  }
  return null;
}
