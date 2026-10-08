/* Paste the web app config from Firebase console → Project settings → General → Your apps.
   These values only identify the Firebase project; they aren't secrets and are safe in a
   public repo. What actually protects the data is firestore.rules. */
export const firebaseConfig = {
  apiKey: "AIzaSyBsIFWHv00wRshqUpSDBylZj7EATVmUyJo",
  authDomain: "lemonly-marketing-planner.firebaseapp.com",
  projectId: "lemonly-marketing-planner",
  storageBucket: "lemonly-marketing-planner.firebasestorage.app",
  messagingSenderId: "989126397565",
  appId: "1:989126397565:web:c332a05c7fc6ac3cc16b14"
};

/* Who can view and who can edit. These drive the UI only; keep them in sync with
   firestore.rules, which is what the server actually enforces. */
export const ALLOWED_DOMAINS = ['lemonly.com', 'clickrain.com'];
export const EDITOR_EMAILS = ['nick@lemonly.com'];
