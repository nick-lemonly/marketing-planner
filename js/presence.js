/* Who's viewing, like Google Docs. Each open tab registers itself in the Realtime
   Database at presence/{uid}/{connectionId}. The server removes that entry the moment
   the connection drops (tab closed, laptop asleep, network lost), so avatars come and
   go within seconds. Presence is a nice-to-have: any failure here is logged and the
   planner carries on without it. */
import { getDatabase, ref, push, set, update, remove, onValue, onDisconnect, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';

var MAX_SHOWN = 5;
// Brand colors dark enough for white initials.
var AVATAR_COLORS = ['#41A2A2', '#F06445', '#B9481F', '#1E8583', '#B9821E', '#6B6B6B'];

function warn(err){ console.warn('[presence]', err && err.message || err); }

export function startPresence(app, user, container){
  var db = getDatabase(app);
  var mine = push(ref(db, 'presence/' + user.uid)); // one entry per tab
  var me = {
    name: user.displayName || user.email,
    email: user.email,
    photoURL: user.photoURL || ''
  };
  function tabState(){ return document.hidden ? 'away' : 'active'; }

  // Runs on every (re)connect. The removal is queued on the server before we announce
  // ourselves, so a connection that drops in between can't leave a ghost avatar.
  onValue(ref(db, '.info/connected'), function(snap){
    if(snap.val() !== true) return;
    onDisconnect(mine).remove().then(function(){
      return set(mine, { name: me.name, email: me.email, photoURL: me.photoURL, state: tabState(), since: serverTimestamp() });
    }).catch(warn);
  });

  document.addEventListener('visibilitychange', function(){
    update(mine, { state: tabState() }).catch(warn);
  });

  onValue(ref(db, 'presence'), function(snap){
    var people = [];
    snap.forEach(function(person){
      if(person.key === user.uid) return; // like Google Docs, you don't see yourself
      var tabs = [];
      person.forEach(function(tab){ tabs.push(tab.val()); });
      if(!tabs.length) return;
      people.push({
        name: tabs[0].name,
        email: tabs[0].email,
        photoURL: tabs[0].photoURL,
        active: tabs.some(function(t){ return t.state === 'active'; }) // any tab in front counts
      });
    });
    people.sort(function(a, b){ return (b.active - a.active) || a.name.localeCompare(b.name); });
    renderPresence(container, people);
  }, warn);

  return {
    /* Called on sign-out, so others see us leave right away. */
    leave: function(){ return remove(mine).catch(warn); }
  };
}

/* people: [{name, email, photoURL, active}], active first. */
export function renderPresence(container, people){
  var shown = people.length > MAX_SHOWN ? people.slice(0, MAX_SHOWN - 1) : people;
  var extra = people.slice(shown.length);
  container.textContent = '';
  container.hidden = !people.length;
  shown.forEach(function(p){ container.appendChild(avatarEl(p)); });
  if(extra.length){
    var more = document.createElement('span');
    more.className = 'avatar avatar-more';
    more.innerHTML = '<span class="avatar-face">+' + extra.length + '</span>';
    more.dataset.label = extra.map(function(p){ return p.name + (p.active ? '' : ' (away)'); }).join('\n');
    more.setAttribute('aria-label', extra.length + ' more viewing');
    container.appendChild(more);
  }
}

function avatarEl(p){
  // The outer element carries the hover card; the face inside is what fades when away.
  var a = document.createElement('span');
  a.className = 'avatar' + (p.active ? '' : ' is-away');
  a.dataset.label = p.name + '\n' + p.email + (p.active ? '' : '\nAway');
  a.setAttribute('aria-label', p.name + (p.active ? ' is viewing' : ' is away'));
  var face = document.createElement('span');
  face.className = 'avatar-face';
  face.style.background = colorFor(p.email);
  face.textContent = initials(p.name);
  // The photo sits over the initials; if it fails to load, the initials show through.
  if(p.photoURL){
    var img = document.createElement('img');
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.src = p.photoURL;
    img.addEventListener('error', function(){ img.remove(); });
    face.appendChild(img);
  }
  a.appendChild(face);
  return a;
}

function initials(name){
  var parts = String(name || '?').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function colorFor(email){
  var h = 0;
  for(var i = 0; i < email.length; i++){ h = (h * 31 + email.charCodeAt(i)) >>> 0; }
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
