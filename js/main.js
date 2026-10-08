/* Sign-in gate and Firestore sync. Nothing from the planner is rendered until a
   company Google account is signed in and the shared planner document has loaded. */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, doc, onSnapshot, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig, ALLOWED_DOMAINS, EDITOR_EMAILS } from './firebase-config.js';
import { initPlanner } from './planner.js';

var SAVE_DELAY_MS = 600;
var DOMAIN_HINT = 'Please sign in with your ' + ALLOWED_DOMAINS.map(function(d){ return '@' + d; }).join(' or ') + ' Google account.';

var el = function(id){ return document.getElementById(id); };
var loginScreen = el('loginScreen');
var loginError = el('loginError');
var signInBtn = el('signInBtn');
var appEl = el('app');
var toastEl = el('toast');

if(firebaseConfig.apiKey === 'REPLACE_ME'){
  showLogin('Firebase isn\'t configured yet. Paste your project\'s config into js/firebase-config.js.');
  signInBtn.disabled = true;
  throw new Error('Firebase config missing');
}

var auth = getAuth(initializeApp(firebaseConfig));
var db = getFirestore();
var plannerRef = doc(db, 'planners', 'main');
var provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

var planner = null;
var userEmail = null;
var pendingError = null; // shown on the sign-in screen after a forced sign-out

/* ================= Sign-in screen ================= */
function showLogin(message){
  appEl.hidden = true;
  loginScreen.hidden = false;
  loginError.textContent = message || '';
  loginError.hidden = !message;
}

function isAllowed(user){
  if(!user.email || !user.emailVerified) return false;
  var domain = user.email.toLowerCase().split('@')[1];
  return ALLOWED_DOMAINS.indexOf(domain) !== -1;
}

signInBtn.addEventListener('click', function(){
  loginError.hidden = true;
  signInWithPopup(auth, provider).catch(function(err){
    if(err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') return;
    showLogin(err.code === 'auth/popup-blocked'
      ? 'Your browser blocked the sign-in popup. Allow popups for this site and try again.'
      : 'Sign-in failed (' + err.code + ').');
  });
});

el('signOutBtn').addEventListener('click', function(){ flushSave(); signOut(auth); });

onAuthStateChanged(auth, function(user){
  if(!user){
    // The planner registers page-level listeners, so a full reload is the clean way to tear it down.
    if(planner){ location.reload(); return; }
    showLogin(pendingError);
    pendingError = null;
    return;
  }
  if(!isAllowed(user)){
    pendingError = DOMAIN_HINT;
    signOut(auth);
    return;
  }
  startSession(user);
});

/* ================= Planner session ================= */
function startSession(user){
  userEmail = user.email.toLowerCase();
  var canEdit = EDITOR_EMAILS.indexOf(userEmail) !== -1;
  document.body.classList.toggle('read-only', !canEdit);
  el('userBadge').textContent = canEdit ? userEmail : userEmail + ' · View only';

  onSnapshot(plannerRef, function(snap){
    if(!planner){
      loginScreen.hidden = true;
      appEl.hidden = false; // visible before init so the planner can measure its layout
      planner = initPlanner({ data: snap.exists() ? snap.data() : null, canEdit: canEdit, onDataChange: queueSave });
      return;
    }
    // Skip our own writes echoing back, and don't clobber local edits that are about to save.
    if(snap.metadata.hasPendingWrites || saveTimer) return;
    planner.setData(snap.exists() ? snap.data() : null);
  }, function(err){
    pendingError = err.code === 'permission-denied'
      ? 'This account doesn\'t have access to the planner. ' + DOMAIN_HINT
      : 'Couldn\'t load the planner (' + err.code + ').';
    signOut(auth);
  });
}

/* ================= Saving ================= */
/* The whole planner lives in one document and only the editor writes it, so a
   debounced full overwrite is simple and safe. Firestore's limit is 1 MiB per doc. */
var saveTimer = null;
var pendingData = null;
var lastSavedJson = null;

function queueSave(data){
  pendingData = data;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, SAVE_DELAY_MS);
}

function flushSave(){
  clearTimeout(saveTimer);
  saveTimer = null;
  if(!pendingData) return;
  // JSON round-trip snapshots the live state and drops undefined fields, which Firestore rejects.
  var json = JSON.stringify(pendingData);
  pendingData = null;
  if(json === lastSavedJson) return; // e.g. only a view preference changed
  lastSavedJson = json;
  var payload = JSON.parse(json);
  payload.updatedAt = serverTimestamp();
  payload.updatedBy = userEmail;
  setDoc(plannerRef, payload).then(hideToast, function(err){
    lastSavedJson = null;
    showToast('Couldn\'t save changes (' + err.code + '). Keep this tab open and try again.');
  });
}

window.addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', function(){ if(document.hidden) flushSave(); });

function showToast(message){ toastEl.textContent = message; toastEl.hidden = false; }
function hideToast(){ toastEl.hidden = true; }
