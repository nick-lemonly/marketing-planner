/* Planner UI: the Monthly Calendar and Timeline views, sidebar, and item modal.
   Shared data (categories, items, blackout dates) is owned by the caller, which loads
   it from Firestore and receives every change through onDataChange. Per-viewer
   preferences (active view, year, sidebar, hidden categories) stay in localStorage. */
export function initPlanner(opts){
  opts = opts || {};
  var canEdit = !!opts.canEdit;
  var onDataChange = opts.onDataChange || function(){};

  /* ================= Date helpers ================= */
  function pad(n){ return String(n).padStart(2,'0'); }
  function iso(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function parseISO(s){ var p=s.split('-').map(Number); return new Date(p[0], p[1]-1, p[2]); }
  function addDays(d,n){ var r=new Date(d); r.setDate(r.getDate()+n); return r; }
  function startOfWeek(d){ var r=new Date(d); r.setHours(0,0,0,0); r.setDate(r.getDate()-r.getDay()); return r; }
  function startOfDay(d){ var r=new Date(d); r.setHours(0,0,0,0); return r; }
  function diffDays(a,b){ return Math.round((startOfDay(b)-startOfDay(a))/86400000); }
  function sameISO(a,b){ return iso(a)===iso(b); }
  var MONTH_NAMES=['January','February','March','April','May','June','July','August','September','October','November','December'];
  var MONTH_SHORT=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var WEEKDAY_NAMES=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var TODAY = startOfDay(new Date());
  /* This is a forward-looking planning tool for calendar year 2027 -- it always
     opens on 2027 regardless of the device's actual current date. */
  var PLANNER_YEAR = 2027;
  /* Rotating month colors, matching the source spreadsheet's own cycle:
     Jan/May/Sep = yellow, Feb/Jun/Oct = teal, Mar/Jul/Nov = amber, Apr/Aug/Dec = coral.
     (Teal here is the darker, white-text-safe shade -- see --teal-contrast.) */
  var MONTH_COLORS = ['#F6D72C','#41A2A2','#F5B02B','#F06445'];
  function monthColor(monthIdx){ return MONTH_COLORS[((monthIdx%4)+4)%4]; }

  function getYearWeeks(year){
    var jan1=new Date(year,0,1), dec31=new Date(year,11,31);
    var cur=startOfWeek(jan1), weeks=[];
    while(cur<=dec31){ weeks.push(new Date(cur)); cur=addDays(cur,7); }
    return weeks;
  }

  /* ================= Color helpers ================= */
  function normalizeHex(hex){
    hex = (hex||'').trim().replace(/^#/,'');
    if(/^[0-9a-fA-F]{3}$/.test(hex)) hex = hex.split('').map(function(c){return c+c;}).join('');
    if(!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
    return '#'+hex.toLowerCase();
  }
  function hexToRgb(hex){
    var n = parseInt(hex.replace('#',''),16);
    return {r:(n>>16)&255, g:(n>>8)&255, b:n&255};
  }
  function textColorFor(hex){
    var c = hexToRgb(hex);
    var lum = (0.299*c.r + 0.587*c.g + 0.114*c.b)/255;
    return lum > 0.62 ? '#241f18' : '#ffffff';
  }
  var PALETTE = ['#F06445','#41A2A2','#F5B02B','#F6D72C','#1E8583','#B9481F','#B9821E','#6B6B6B','#3A3A3A'];

  /* ================= State ================= */
  var PREFS_KEY = 'lemonlyPlannerPrefsV1';
  var UNCATEGORIZED_ID = 'uncategorized';

  function uid(prefix){ return (prefix||'id')+'_'+Math.random().toString(36).slice(2,9)+Date.now().toString(36).slice(-4); }

  function defaultState(){
    var cats = [
      {id:'cat_blog', name:'Blog', color:'#F06445'},
      {id:'cat_client', name:'Client Project', color:'#41A2A2'},
      {id:'cat_paid', name:'Paid Media', color:'#F5B02B'},
      {id:'cat_video', name:'Video / YouTube', color:'#1E8583'},
      {id:'cat_internal', name:'Internal / Culture', color:'#B9481F'},
      {id:'cat_holiday', name:'Holiday / PTO', color:'#6B6B6B'},
      {id:UNCATEGORIZED_ID, name:'Uncategorized', color:'#9B9B9B', locked:true}
    ];
    var t = new Date(PLANNER_YEAR, 8, 23); // anchor for spreading sample items across the planning year
    var y = t.getFullYear(), m = t.getMonth(), d = t.getDate();
    function dt(mOff,day){ var dd=new Date(y,m+mOff,day); return iso(dd); }
    var items = [
      {id:uid('it'), title:'Q4 Blog: Infographic Trends', categoryId:'cat_blog', start:dt(0,d+5), end:dt(0,d+5), notes:'', isSample:true},
      {id:uid('it'), title:'DistributeRx Web Sprint', categoryId:'cat_client', start:dt(0,Math.max(1,d-2)), end:dt(0,d+9), notes:'Coordinate with Michael on dev timeline.', isSample:true},
      {id:uid('it'), title:'Paid Search Refresh', categoryId:'cat_paid', start:dt(0,d+12), end:dt(0,d+12), notes:'', isSample:true},
      {id:uid('it'), title:'YouTube Ep. 12 Shoot', categoryId:'cat_video', start:dt(0,d+15), end:dt(0,d+15), notes:'', isSample:true},
      {id:uid('it'), title:'Epsolay Site Content Review', categoryId:'cat_client', start:dt(0,d+19), end:dt(0,d+30), notes:'', isSample:true},
      {id:uid('it'), title:'Fall Culture Day', categoryId:'cat_internal', start:dt(0,d+23), end:dt(0,d+23), notes:'', isSample:true},
      {id:uid('it'), title:'Blog: SEO Schema Update', categoryId:'cat_blog', start:dt(0,d+28), end:dt(0,d+28), notes:'', isSample:true},
      {id:uid('it'), title:'Twyneo Copy Revisions', categoryId:'cat_client', start:dt(1,3), end:dt(1,7), notes:'', isSample:true},
      {id:uid('it'), title:'Thanksgiving Break', categoryId:'cat_holiday', start:dt(2,26), end:dt(2,27), notes:'', isSample:true},
      {id:uid('it'), title:'Ep. 13 Promo Push', categoryId:'cat_paid', start:dt(3,1), end:dt(3,5), notes:'', isSample:true},
      {id:uid('it'), title:'Blog: Year in Review', categoryId:'cat_blog', start:dt(3,15), end:dt(3,15), notes:'', isSample:true},
      {id:uid('it'), title:'Holiday Office Closure', categoryId:'cat_holiday', start:dt(3,24), end:dt(3,25), notes:'', isSample:true},
      {id:uid('it'), title:'Rhofade Landing Page Copy', categoryId:'cat_client', start:null, end:null, notes:'', isSample:true},
      {id:uid('it'), title:'Spring Campaign Brainstorm', categoryId:'cat_blog', start:null, end:null, notes:'', isSample:true}
    ];
    // A couple of sample blackout dates to illustrate the feature -- edit or remove freely.
    var blackoutDates = [
      {id:uid('bo'), start:iso(new Date(PLANNER_YEAR,0,1)), end:iso(new Date(PLANNER_YEAR,0,1)), label:"New Year's Day"},
      {id:uid('bo'), start:iso(new Date(PLANNER_YEAR,6,4)), end:iso(new Date(PLANNER_YEAR,6,4)), label:'Independence Day'}
    ];
    return { categories: cats, items: items, blackoutDates: blackoutDates };
  }

  /* Shared data arrives from Firestore (or older localStorage saves), so fill in
     anything missing rather than trusting its shape. */
  function normalizeData(d){
    d = d || {};
    var out = {
      categories: Array.isArray(d.categories) ? d.categories : [],
      items: Array.isArray(d.items) ? d.items : [],
      // Migrate the old format (a plain array of ISO date strings) to {id,start,end,label} objects.
      blackoutDates: (Array.isArray(d.blackoutDates) ? d.blackoutDates : []).map(function(b){
        return (typeof b === 'string') ? {id:uid('bo'), start:b, end:b, label:''} : b;
      })
    };
    if(!out.categories.some(function(c){return c.id===UNCATEGORIZED_ID;})){
      out.categories.push({id:UNCATEGORIZED_ID, name:'Uncategorized', color:'#9B9B9B', locked:true});
    }
    return out;
  }

  function initialData(){
    if(opts.data) return normalizeData(opts.data);
    if(!canEdit) return normalizeData(null);
    // No shared planner yet: the editor seeds it with the example items.
    return normalizeData(defaultState());
  }

  function loadPrefs(){
    var prefs = {activeView:'month', monthYear:PLANNER_YEAR, timelineYear:PLANNER_YEAR, sidebarOpen:true, hiddenCats:{}, tlLabelW:null, tlGroupBy:'category', lastCategoryId:null};
    try{
      var saved = JSON.parse(localStorage.getItem(PREFS_KEY));
      if(saved) Object.keys(prefs).forEach(function(k){ if(saved[k]!=null) prefs[k] = saved[k]; });
    }catch(e){ /* storage unavailable */ }
    return prefs;
  }

  var state = initialData();
  state.settings = loadPrefs();

  function saveState(){
    try{ localStorage.setItem(PREFS_KEY, JSON.stringify(state.settings)); }catch(e){ /* storage unavailable */ }
    if(canEdit) onDataChange({categories:state.categories, items:state.items, blackoutDates:state.blackoutDates});
  }

  /* Replace shared data with a newer copy from the server. */
  function setData(data){
    var d = normalizeData(data);
    state.categories = d.categories;
    state.items = d.items;
    state.blackoutDates = d.blackoutDates;
    // Mid-gesture renders are driven by the gesture itself; the next one picks this up.
    if(dragState || createDrag || tlCreateDrag || sortDrag || colResize) return;
    render();
  }

  function isCatHidden(id){ return !!state.settings.hiddenCats[id]; }
  function displayedYear(){ return state.settings.activeView==='month' ? state.settings.monthYear : state.settings.timelineYear; }

  function getCategory(id){
    for(var i=0;i<state.categories.length;i++){ if(state.categories[i].id===id) return state.categories[i]; }
    return state.categories[state.categories.length-1];
  }
  function findBlackout(id){
    var list = state.blackoutDates||[];
    for(var i=0;i<list.length;i++){ if(list[i].id===id) return list[i]; }
    return null;
  }
  function blackoutForDate(dISO){
    var list = state.blackoutDates||[];
    for(var i=0;i<list.length;i++){ if(dISO>=list[i].start && dISO<=(list[i].end||list[i].start)) return list[i]; }
    return null;
  }
  function formatDateRange(s,e){
    var sd=parseISO(s), ed=parseISO(e||s);
    var sLabel = MONTH_SHORT[sd.getMonth()]+' '+sd.getDate();
    if(sameISO(sd,ed)) return sLabel+', '+sd.getFullYear();
    if(sd.getMonth()===ed.getMonth() && sd.getFullYear()===ed.getFullYear()) return sLabel+'–'+ed.getDate()+', '+sd.getFullYear();
    return sLabel+' – '+MONTH_SHORT[ed.getMonth()]+' '+ed.getDate()+', '+ed.getFullYear();
  }
  function visibleItems(){
    var q = (searchEl.value||'').trim().toLowerCase();
    return state.items.filter(function(it){
      if(isCatHidden(it.categoryId)) return false;
      if(q && it.title.toLowerCase().indexOf(q)===-1) return false;
      return true;
    });
  }

  /* ================= DOM refs ================= */
  var el = function(id){ return document.getElementById(id); };
  var sidebar = el('sidebar');
  var searchEl = el('searchInput');
  var categoryListEl = el('categoryList');
  var unscheduledListEl = el('unscheduledList');
  var blackoutListEl = el('blackoutList');
  var blackoutDateInput = el('blackoutDateInput');
  var sampleDataPanel = el('sampleDataPanel');
  var monthView = el('monthView');
  var timelineView = el('timelineView');
  var weekdayRow = el('weekdayRow');
  var monthGrid = el('monthGrid');
  var timelineGrid = el('timelineGrid');
  var timelineScroll = el('timelineScroll');
  var tlGroupToggle = el('tlGroupToggle');
  var periodLabel = el('periodLabel');
  var modalWrap = el('modalWrap');
  var backdrop = el('backdrop');
  var itemForm = el('itemForm');
  var titleFieldLabel = el('titleFieldLabel');
  var fieldTitle = el('fieldTitle');
  var fieldIsBlackout = el('fieldIsBlackout');
  var categoryFieldWrap = el('categoryFieldWrap');
  var fieldCategory = el('fieldCategory');
  var fieldCategorySwatch = el('fieldCategorySwatch');
  var unscheduledFieldWrap = el('unscheduledFieldWrap');
  var fieldUnscheduled = el('fieldUnscheduled');
  var dateFields = el('dateFields');
  var fieldStart = el('fieldStart');
  var fieldEnd = el('fieldEnd');
  var notesFieldWrap = el('notesFieldWrap');
  var fieldNotes = el('fieldNotes');
  var deleteItemBtn = el('deleteItemBtn');

  /* ================= Rendering: weekday row ================= */
  WEEKDAY_NAMES.forEach(function(name){
    var d = document.createElement('div');
    d.className='weekday-cell';
    d.textContent = name.slice(0,3);
    weekdayRow.appendChild(d);
  });

  /* ================= Rendering: sidebar ================= */
  function renderCategoryList(){
    categoryListEl.innerHTML = state.categories.map(function(c){
      var hidden = isCatHidden(c.id);
      var lockAttrs = (c.locked || !canEdit) ? 'disabled' : '';
      var sortable = canEdit && !c.locked;
      return '' +
        '<div class="category-row'+(hidden?' hidden-cat':'')+'" data-cat-id="'+c.id+'"'+(sortable ? ' data-sort-id="'+c.id+'"' : '')+'>' +
          (sortable ? '<span class="drag-grip" data-role="cat-grip" title="Drag to reorder">'+GRIP_SVG+'</span>' : '') +
          '<div class="cat-row-top">' +
            '<input type="checkbox" class="cat-toggle" title="Show/hide on calendar" '+(hidden?'':'checked')+' data-action="toggle-cat">' +
            '<button type="button" class="cat-color-btn" style="background:'+c.color+'" data-action="pick-color" title="Choose color"></button>' +
            '<input type="color" class="color-native" value="'+c.color+'" data-action="color-input" '+lockAttrs+'>' +
            '<input type="text" class="cat-name-input" value="'+escapeAttr(c.name)+'" data-action="rename-cat" '+lockAttrs+' maxlength="40" title="'+escapeAttr(c.name)+'">' +
          '</div>' +
          '<div class="cat-row-bottom">' +
            '<input type="text" class="cat-hex" value="'+c.color+'" data-action="hex-input" '+lockAttrs+' maxlength="7" placeholder="#RRGGBB">' +
            ((c.locked || !canEdit) ? '' : '<button type="button" class="cat-del" data-action="del-cat" title="Delete category">Delete</button>') +
          '</div>' +
        '</div>';
    }).join('');
  }

  function renderUnscheduled(){
    var un = state.items.filter(function(it){ return !it.start; });
    if(!un.length){
      unscheduledListEl.innerHTML = '<div class="un-empty">Nothing unscheduled.</div>';
    } else {
      unscheduledListEl.innerHTML = un.map(function(it){
        var cat = getCategory(it.categoryId);
        return '<div class="un-chip" data-item-id="'+it.id+'" title="'+(canEdit ? 'Drag onto a view, or click to edit' : 'Click to view')+'">' +
          '<span class="dot" style="background:'+cat.color+'"></span>' +
          '<span class="un-title">'+escapeHtml(it.title)+'</span>' +
        '</div>';
      }).join('');
    }
    var anySample = state.items.some(function(it){ return it.isSample; });
    sampleDataPanel.hidden = !anySample;
  }

  function renderBlackoutList(){
    var year = displayedYear(), yearStart = year+'-01-01', yearEnd = year+'-12-31';
    var list = (state.blackoutDates||[]).filter(function(b){
      return b.start <= yearEnd && (b.end||b.start) >= yearStart;
    }).sort(function(a,b){ return (a.start||'').localeCompare(b.start||''); });
    if(!list.length){
      blackoutListEl.innerHTML = '<div class="un-empty">No blackout dates in '+year+'.</div>';
      return;
    }
    blackoutListEl.innerHTML = list.map(function(b){
      var range = formatDateRange(b.start, b.end);
      var text = b.label ? (escapeHtml(b.label)+' — '+range) : range;
      return '<div class="un-chip" data-blackout-id="'+b.id+'" style="cursor:pointer;" title="'+(canEdit ? 'Click to edit' : 'Click to view')+'">' +
        '<span class="un-title">'+text+'</span>' +
        (canEdit ? '<button type="button" class="cat-del" data-action="del-blackout" data-blackout-id="'+b.id+'" style="margin-left:auto;">Remove</button>' : '') +
      '</div>';
    }).join('');
  }

  function escapeHtml(s){
    return String(s==null?'':s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function escapeAttr(s){ return escapeHtml(s); }
  var GRIP_SVG = '<svg width="8" height="12" viewBox="0 0 8 12" aria-hidden="true"><g fill="currentColor">' +
    '<circle cx="2" cy="2" r="1.1"/><circle cx="6" cy="2" r="1.1"/><circle cx="2" cy="6" r="1.1"/>' +
    '<circle cx="6" cy="6" r="1.1"/><circle cx="2" cy="10" r="1.1"/><circle cx="6" cy="10" r="1.1"/></g></svg>';

  /* ================= Month view render (continuous full-year scroll) ================= */
  function createDragRange(){
    if(!createDrag) return null;
    var a = parseISO(createDrag.anchor), c = parseISO(createDrag.current);
    return a<=c ? {start:a, end:c} : {start:c, end:a};
  }

  function renderMonth(){
    var year = state.settings.monthYear;
    periodLabel.textContent = String(year);
    var weekStarts = getYearWeeks(year);
    var items = visibleItems();
    var overrides = dragPreviewOverrides();
    var selRange = createDragRange();

    function effRange(it){
      var o = overrides[it.id];
      var s = o ? o.start : it.start, e = o ? o.end : it.end;
      if(!s) return null;
      return {start:parseISO(s), end:parseISO(e||s)};
    }

    var announced = {};
    var parts = [];

    weekStarts.forEach(function(weekStart){
      var week = [];
      for(var i=0;i<7;i++){ week.push(addDays(weekStart,i)); }

      week.forEach(function(day){
        if(day.getDate()===1){
          var key = day.getFullYear()+'-'+day.getMonth();
          if(!announced[key]){
            announced[key] = true;
            var mc = monthColor(day.getMonth());
            var tc = textColorFor(mc);
            parts.push('<div class="month-header" style="background:'+mc+'; color:'+tc+';">'+MONTH_NAMES[day.getMonth()]+'<span class="yr">'+day.getFullYear()+'</span></div>');
          }
        }
      });

      var weekEnd = week[6];
      var multi = [];
      items.forEach(function(it){
        var r = effRange(it);
        if(!r) return;
        if(r.end < r.start) return;
        if(sameISO(r.start,r.end)) return; // single-day handled per-cell
        if(r.end < weekStart || r.start > weekEnd) return;
        var clipStart = r.start < weekStart ? weekStart : r.start;
        var clipEnd = r.end > weekEnd ? weekEnd : r.end;
        multi.push({item:it, colStart:diffDays(weekStart, clipStart), colEnd:diffDays(weekStart, clipEnd),
          openStart: r.start < weekStart, openEnd: r.end > weekEnd});
      });
      multi.sort(function(a,b){ return a.colStart-b.colStart || (b.colEnd-b.colStart)-(a.colEnd-a.colStart); });
      var lanes = [];
      multi.forEach(function(seg){
        var laneIdx = -1;
        for(var i=0;i<lanes.length;i++){ if(lanes[i] <= seg.colStart){ laneIdx=i; break; } }
        if(laneIdx===-1){ laneIdx = lanes.length; lanes.push(0); }
        lanes[laneIdx] = seg.colEnd+1;
        seg.lane = laneIdx;
      });
      var laneCount = lanes.length;
      var laneAreaH = 'calc(var(--lane-pitch) * '+laneCount+')';

      var dayCellsHtml = week.map(function(day){
        var isToday = sameISO(day, TODAY);
        var isSelecting = selRange && day>=selRange.start && day<=selRange.end;
        var isWeekend = day.getDay()===0 || day.getDay()===6;
        var blackoutEntry = blackoutForDate(iso(day));
        var isBlackout = !!blackoutEntry;
        var mc = monthColor(day.getMonth());
        var dtc = textColorFor(mc);
        var singles = items.filter(function(it){
          var r = effRange(it);
          return r && sameISO(r.start, day) && sameISO(r.end, day);
        });
        var chipsHtml = singles.map(function(it){
          var cat = getCategory(it.categoryId);
          var tc = textColorFor(cat.color);
          var dragging = dragState && dragState.itemId===it.id ? ' is-dragging' : '';
          return '<div class="chip'+dragging+'" data-item-id="'+it.id+'" data-role="chip" data-tip style="background:'+cat.color+';color:'+tc+'">'+
            '<div class="bar-handle" data-role="handle-start"></div>' +
            '<div class="bar-body">'+escapeHtml(it.title) + (it.notes ? '<span class="note-dot"></span>' : '')+'</div>' +
            '<div class="bar-handle" data-role="handle-end"></div>' +
          '</div>';
        }).join('');
        return '<div class="day-cell'+(isToday?' is-today':'')+(isWeekend?' is-weekend':'')+(isBlackout?' is-blackout':'')+(isSelecting?' is-selecting':'')+'" data-date="'+iso(day)+'">' +
          '<div class="day-num-row"><span class="day-num" style="background:'+mc+';color:'+dtc+'">'+day.getDate()+'</span>' +
            (blackoutEntry && blackoutEntry.label ? '<span class="blackout-label">'+escapeHtml(blackoutEntry.label)+'</span>' : '') +
          '</div>' +
          '<div class="lane-spacer" style="height:'+laneAreaH+'"></div>' +
          '<div class="chips">'+chipsHtml+'</div>' +
        '</div>';
      }).join('');

      var barsHtml = multi.map(function(seg){
        var cat = getCategory(seg.item.categoryId);
        var tc = textColorFor(cat.color);
        // Match the day cells' geometry (7 columns, 2px gaps, --cell-inset padding) so a bar
        // lines up with single-day chips; a segment continuing into the next/previous week
        // runs to the cell's outer edge instead.
        var span = seg.colEnd-seg.colStart+1;
        var insetL = seg.openStart ? '0px' : 'var(--cell-inset)';
        var insetR = seg.openEnd ? '0px' : 'var(--cell-inset)';
        var leftCss = 'calc((100% - 12px) * '+seg.colStart+' / 7 + '+(seg.colStart*2)+'px + '+insetL+')';
        var widthCss = 'calc((100% - 12px) * '+span+' / 7 + '+((span-1)*2)+'px - '+insetL+' - '+insetR+')';
        var dragging = dragState && dragState.itemId===seg.item.id ? ' is-dragging' : '';
        var radius = 'border-radius:5px;';
        if(seg.openStart && seg.openEnd) radius='border-radius:0;';
        else if(seg.openStart) radius='border-radius:0 5px 5px 0;';
        else if(seg.openEnd) radius='border-radius:5px 0 0 5px;';
        return '<div class="bar'+dragging+'" data-item-id="'+seg.item.id+'" data-role="bar" data-tip style="left:'+leftCss+'; width:'+widthCss+'; top:calc(var(--lane-pitch) * '+seg.lane+'); background:'+cat.color+'; color:'+tc+'; '+radius+'">' +
          (seg.openStart ? '' : '<div class="bar-handle" data-role="handle-start"></div>') +
          '<div class="bar-body" data-role="bar-body">'+escapeHtml(seg.item.title)+(seg.item.notes?'<span class="note-dot"></span>':'')+'</div>' +
          (seg.openEnd ? '' : '<div class="bar-handle" data-role="handle-end"></div>') +
        '</div>';
      }).join('');

      parts.push('<div class="week-row" data-week-start="'+iso(weekStart)+'">' + dayCellsHtml +
        '<div class="lanes-overlay" style="height:'+laneAreaH+'">'+barsHtml+'</div>' +
      '</div>');
    });

    monthGrid.innerHTML = parts.join('');

    if(!renderMonth._scrolledOnce){
      renderMonth._scrolledOnce = true;
      scrollMonthToToday(false);
    }
  }
  function scrollMonthToToday(smooth){
    var cell = monthGrid.querySelector('[data-date="'+iso(TODAY)+'"]');
    if(cell) cell.scrollIntoView({behavior: smooth?'smooth':'auto', block:'center'});
  }

  /* ================= Timeline view render ================= */
  var TL_COLW = 34, TL_LABELW_DEFAULT = 168, TL_LABELW_MIN = 120, TL_LABELW_MAX = 520;
  var TL_LABELW = TL_LABELW_DEFAULT; // per-viewer, resizable; synced from prefs on each render
  var TL_LANE_PITCH = 28; // category rows stack overlapping bars in lanes this far apart
  var COL_RESIZE_HTML = '<div class="tl-col-resize" data-role="tl-col-resize" title="Drag to resize"></div>';
  /* Manual row order for the Timeline: any item missing a tlOrder (new items, or
     items saved before this feature existed) gets one appended, ranked by start date
     the first time it's seen, so the list starts sensible but stays freely reorderable. */
  function ensureTimelineOrder(itemsList){
    var maxOrder = itemsList.reduce(function(m,it){ return typeof it.tlOrder==='number' ? Math.max(m,it.tlOrder) : m; }, -1);
    var missing = itemsList.filter(function(it){ return typeof it.tlOrder !== 'number'; });
    missing.sort(function(a,b){ return (a.start||'').localeCompare(b.start||''); });
    missing.forEach(function(it){ maxOrder++; it.tlOrder = maxOrder; });
  }
  /* ids: the displayed rows in their new order. They trade tlOrder slots among
     themselves, so rows from other years or hidden categories keep their place. */
  /* ids: the sortable categories in their new order. Locked ones (Uncategorized)
     aren't draggable and stay pinned at the end. Hidden categories aren't shown on the
     Timeline, so any left out of ids keep their place after the ones that were. */
  function reorderCategories(ids){
    var moved = ids.map(getCategory);
    state.categories = moved.concat(state.categories.filter(function(c){ return ids.indexOf(c.id)===-1; }));
    saveState(); render();
  }
  function reorderTimelineRows(ids){
    var rows = ids.map(findItem);
    var slots = rows.map(function(it){ return it.tlOrder; }).sort(function(a,b){ return a-b; });
    rows.forEach(function(it, i){ it.tlOrder = slots[i]; });
    saveState();
    render();
  }
  function renderTimeline(){
    TL_LABELW = state.settings.tlLabelW || TL_LABELW_DEFAULT;
    var year = state.settings.timelineYear;
    periodLabel.textContent = String(year);
    var weeks = getYearWeeks(year);
    var N = weeks.length;
    var items = visibleItems();
    var overrides = dragPreviewOverrides();

    function colForDate(d){
      var idx = Math.floor(diffDays(weeks[0], d)/7);
      if(idx<0) idx=0; if(idx>N-1) idx=N-1;
      return idx;
    }
    function effRange(it){
      var o = overrides[it.id];
      var s = o ? o.start : it.start, e = o ? o.end : it.end;
      if(!s) return null;
      var sd=parseISO(s), ed=parseISO(e||s);
      if(ed<sd) ed=sd;
      return {start:sd, end:ed};
    }

    var byCategory = state.settings.tlGroupBy==='category';
    var gridTemplate = TL_LABELW+'px repeat('+N+', '+TL_COLW+'px)';
    timelineGrid.style.gridTemplateColumns = gridTemplate;

    // month band row
    var bands = [];
    weeks.forEach(function(w, i){
      var key = w.getFullYear()+'-'+w.getMonth();
      if(bands.length && bands[bands.length-1].key===key){ bands[bands.length-1].count++; }
      else bands.push({key:key, month:w.getMonth(), start:i, count:1});
    });
    var bandHtml = '<div class="tl-cell tl-corner" style="grid-row:1; grid-column:1;">'+COL_RESIZE_HTML+'</div>';
    bands.forEach(function(b){
      var mc = monthColor(b.month), tc = textColorFor(mc);
      bandHtml += '<div class="tl-cell tl-month-band" style="grid-row:1; grid-column:'+(2+b.start)+' / '+(2+b.start+b.count)+'; background:'+mc+'; color:'+tc+';">'+MONTH_SHORT[b.month]+'</div>';
    });

    // gridlines: thin per-week, medium at each month boundary, dashed accent at each
    // trimester boundary (Jan/May/Sep) -- mirrors Lemonly's trimesterly review cadence.
    var gridlineHtml = '';
    for(var gi=0; gi<=N; gi++){
      var b2 = bands.find(function(bb){ return bb.start===gi; });
      var cls = 'tl-gridline';
      if(b2) cls += (b2.month%4===0) ? ' gl-trimester' : ' gl-month';
      gridlineHtml += '<div class="'+cls+'" style="left:'+(TL_LABELW+gi*TL_COLW)+'px;"></div>';
    }

    // live highlight band for an in-progress click-and-drag create gesture
    var selectHtml = '';
    if(tlCreateDrag){
      var selStart = Math.min(tlCreateDrag.anchorCol, tlCreateDrag.currentCol);
      var selEnd = Math.max(tlCreateDrag.anchorCol, tlCreateDrag.currentCol);
      selectHtml = '<div class="tl-select-band" style="left:'+(TL_LABELW+selStart*TL_COLW)+'px; width:'+((selEnd-selStart+1)*TL_COLW)+'px;"></div>';
    }

    // week label row
    var weekLabelHtml = '<div class="tl-cell tl-corner tl-week-label" style="grid-row:2; grid-column:1; font-weight:700;">'+(byCategory ? 'Category' : 'Item')+COL_RESIZE_HTML+'</div>';
    weeks.forEach(function(w,i){
      weekLabelHtml += '<div class="tl-cell tl-week-label" style="grid-row:2; grid-column:'+(2+i)+';">'+(w.getMonth()+1)+'/'+w.getDate()+'</div>';
    });

    var todayCol = (TODAY.getFullYear()===year || (TODAY >= weeks[0] && TODAY <= addDays(weeks[N-1],6))) ? colForDate(TODAY) : -1;

    var rowsHtml = '';
    ensureTimelineOrder(state.items);
    var rangeStart = weeks[0], rangeEnd = addDays(weeks[N-1], 6);
    // Only items that actually overlap the visible year -- otherwise an item from a
    // different year would get clamped onto the near edge, which reads as if it belongs here.
    var scheduled = items.filter(function(it){
      if(!it.start) return false;
      var r = effRange(it);
      return r && r.end >= rangeStart && r.start <= rangeEnd;
    }).sort(function(a,b){ return (a.tlOrder||0)-(b.tlOrder||0); });

    var todayStripHtml = todayCol>=0 ? '<div class="tl-today-strip" style="left:'+(todayCol*TL_COLW)+'px; width:'+TL_COLW+'px;"></div>' : '';
    function barHtml(it, r, top, allowOverflowLabel){
      var cat = getCategory(it.categoryId);
      var tc = textColorFor(cat.color);
      var startCol = colForDate(r.start), endCol = colForDate(r.end);
      // 1px inset each side so bars in back-to-back weeks don't read as one.
      var left = startCol*TL_COLW + 1, width = (endCol-startCol+1)*TL_COLW - 2;
      var dragging = dragState && dragState.itemId===it.id ? ' is-dragging' : '';
      var compact = width < 66;
      return '<div class="tl-bar'+dragging+(compact?' is-compact':'')+'" data-item-id="'+it.id+'" data-role="tl-bar" data-tip style="left:'+left+'px; width:'+width+'px; top:'+top+'px; background:'+cat.color+'; color:'+tc+';">' +
          '<div class="bar-handle" data-role="handle-start"></div>' +
          (compact ? '' : '<div class="bar-body" data-role="bar-body">'+escapeHtml(it.title)+'</div>') +
          '<div class="bar-handle" data-role="handle-end"></div>' +
        '</div>' +
        (compact && allowOverflowLabel ? '<div class="tl-overflow-label" style="left:'+(left+width+6)+'px;">'+escapeHtml(it.title)+'</div>' : '');
    }

    var rowCount;
    if(byCategory){
      // One row per visible category, in sidebar order. Items that overlap in time
      // (at week granularity) stack into extra lanes so none hide each other.
      var cats = state.categories.filter(function(c){ return !isCatHidden(c.id); });
      cats.forEach(function(cat, rowIdx){
        var entries = scheduled.filter(function(it){ return getCategory(it.categoryId).id===cat.id; }).map(function(it){
          var r = effRange(it);
          return {it:it, r:r, sc:colForDate(r.start), ec:colForDate(r.end)};
        }).sort(function(a,b){ return a.sc-b.sc || (b.ec-b.sc)-(a.ec-a.sc); });
        var laneEnds = [];
        entries.forEach(function(en){
          var lane = laneEnds.findIndex(function(endCol){ return endCol < en.sc; });
          if(lane===-1){ lane = laneEnds.length; laneEnds.push(0); }
          laneEnds[lane] = en.ec;
          en.lane = lane;
        });
        var lanes = Math.max(1, laneEnds.length);
        var rowN = rowIdx+3;
        var sortable = canEdit && !cat.locked;
        rowsHtml += '<div class="tl-cell tl-label tl-cat-label" style="grid-row:'+rowN+'; grid-column:1;" data-role="tl-cat-label"'+(sortable ? ' data-sort-id="'+cat.id+'" title="Drag to reorder"' : '')+'>' +
            (sortable ? '<span class="drag-grip">'+GRIP_SVG+'</span>' : (canEdit ? '<span class="drag-grip-spacer"></span>' : '')) +
            '<span class="dot" style="background:'+cat.color+'"></span>' +
            '<span class="tl-title">'+escapeHtml(cat.name)+'</span>' +
            '<span class="tl-count">'+(entries.length || '')+'</span>' +
            COL_RESIZE_HTML +
          '</div>';
        rowsHtml += '<div class="tl-track tl-track-row" style="grid-row:'+rowN+'; grid-column:2 / -1; height:'+(34 + (lanes-1)*TL_LANE_PITCH)+'px;" data-cat-id="'+cat.id+'">' +
            todayStripHtml +
            entries.map(function(en){ return barHtml(en.it, en.r, 5 + en.lane*TL_LANE_PITCH, false); }).join('') +
          '</div>';
      });
      rowCount = cats.length;
    } else {
      scheduled.forEach(function(it, rowIdx){
        var r = effRange(it);
        var cat = getCategory(it.categoryId);
        var rowN = rowIdx+3;
        rowsHtml += '<div class="tl-cell tl-label" style="grid-row:'+rowN+'; grid-column:1;" data-item-id="'+it.id+'" data-sort-id="'+it.id+'" data-role="tl-label"'+(canEdit ? ' title="Drag to reorder, or click to edit"' : '')+'>' +
          (canEdit ? '<span class="drag-grip">'+GRIP_SVG+'</span>' : '') +
          '<span class="dot" style="background:'+cat.color+'"></span>' +
          '<span class="tl-title">'+escapeHtml(it.title)+(it.notes?'<span class="note-dot" style="color:var(--ink-faint)"></span>':'')+'</span>' +
          COL_RESIZE_HTML +
        '</div>';
        rowsHtml += '<div class="tl-track tl-track-row" style="grid-row:'+rowN+'; grid-column:2 / -1;">' +
          todayStripHtml + barHtml(it, r, 5, true) +
        '</div>';
      });
      rowCount = scheduled.length;
    }

    // Trailing row: always present, even with zero items, so there's a click/drag target
    // for creating new items anywhere on the timeline, not just on top of existing rows.
    var addRowN = rowCount + 3;
    rowsHtml += '<div class="tl-cell tl-label tl-add-label" style="grid-row:'+addRowN+'; grid-column:1;">' +
      (rowCount ? '' : (byCategory ? 'All categories are hidden.' : 'No scheduled items yet.')) + COL_RESIZE_HTML +
    '</div>';
    rowsHtml += '<div class="tl-track tl-add-row" style="grid-row:'+addRowN+'; grid-column:2 / -1;" data-role="tl-add-row"></div>';

    timelineGrid.innerHTML = gridlineHtml + selectHtml + bandHtml + weekLabelHtml + rowsHtml;

    if(!renderTimeline._scrolledOnce){
      renderTimeline._scrolledOnce = true;
      scrollTimelineToToday(false);
    }
  }
  function scrollTimelineToToday(smooth){
    var year = state.settings.timelineYear;
    var weeks = getYearWeeks(year);
    if(TODAY < weeks[0] || TODAY > addDays(weeks[weeks.length-1],6)) return;
    var idx = Math.floor(diffDays(weeks[0], TODAY)/7);
    var target = Math.max(0, idx*TL_COLW - timelineScroll.clientWidth/2);
    timelineScroll.scrollTo({left:target, behavior: smooth?'smooth':'auto'});
  }

  /* ================= Category select in modal ================= */
  function renderCategorySelect(selectedId){
    fieldCategory.innerHTML = state.categories.map(function(c){
      return '<option value="'+c.id+'"'+(c.id===selectedId?' selected':'')+'>'+escapeHtml(c.name)+'</option>';
    }).join('');
    updateSwatch();
  }
  function updateSwatch(){
    var cat = getCategory(fieldCategory.value);
    fieldCategorySwatch.style.background = cat.color;
  }

  /* ================= Master render ================= */
  function render(){
    var view = state.settings.activeView;
    document.querySelectorAll('.tab-btn').forEach(function(b){
      b.classList.toggle('active', b.dataset.view===view);
    });
    monthView.hidden = view!=='month';
    timelineView.hidden = view!=='timeline';
    weekdayRow.hidden = view!=='month';
    tlGroupToggle.hidden = view!=='timeline';
    tlGroupToggle.querySelectorAll('[data-group]').forEach(function(b){
      b.classList.toggle('active', b.dataset.group===state.settings.tlGroupBy);
    });
    sidebar.hidden = !state.settings.sidebarOpen;
    renderCategoryList();
    renderUnscheduled();
    renderBlackoutList();
    if(view==='month') renderMonth(); else renderTimeline();
    updateTopbarHeight();
  }

  /* ================= Drag & drop logic ================= */
  var dragState = null; // {itemId, mode, view, moved, pointerId, downX, downY, anchorDate/anchorCol, originStart, originEnd, previewStart, previewEnd, lastUnitKey}

  function dragPreviewOverrides(){
    var o = {};
    if(dragState && dragState.moved && dragState.previewStart){
      o[dragState.itemId] = {start: dragState.previewStart, end: dragState.previewEnd};
    }
    return o;
  }

  function findItem(id){
    for(var i=0;i<state.items.length;i++){ if(state.items[i].id===id) return state.items[i]; }
    return null;
  }

  function beginDrag(e, itemId, mode){
    var item = findItem(itemId);
    if(!item) return;
    dragState = {
      itemId:itemId, mode:mode, view: state.settings.activeView, moved:false,
      pointerId: e.pointerId, downX: e.clientX, downY: e.clientY,
      originStart: item.start, originEnd: item.end || item.start,
      previewStart: item.start, previewEnd: item.end || item.start,
      lastUnitKey: null, anchorSet:false
    };
    // Anchor on the day/week under the press itself, so a fast first move can't shift it.
    var unit = unitUnderPointer(e);
    if(unit){
      dragState.anchorDate = unit.date; dragState.anchorCol = unit.colIdx;
      dragState.anchorSet = true; dragState.lastUnitKey = unit.key;
    }
    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragEnd);
    document.addEventListener('pointercancel', onDragEnd);
  }

  function unitUnderPointer(e){
    var target = document.elementFromPoint(e.clientX, e.clientY);
    if(!target) return null;
    if(dragState.view==='month'){
      // Bars float above the day cells, so look through every layer under the pointer.
      var cell = null;
      document.elementsFromPoint(e.clientX, e.clientY).some(function(node){ return (cell = node.closest('[data-date]')); });
      if(!cell) return null;
      return {key:cell.dataset.date, date: parseISO(cell.dataset.date)};
    } else {
      var lbl = target.closest('.tl-label'); if(lbl) return null;
      var track = target.closest('.tl-track');
      if(!track) return null;
      var rect = track.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var year = state.settings.timelineYear;
      var weeks = getYearWeeks(year);
      var colIdx = Math.floor(x/TL_COLW);
      if(colIdx<0) colIdx=0; if(colIdx>weeks.length-1) colIdx=weeks.length-1;
      return {key:'col'+colIdx, colIdx:colIdx, weekStart: weeks[colIdx]};
    }
  }

  function onDragMove(e){
    if(!dragState || !canEdit) return;
    var dx = e.clientX-dragState.downX, dy=e.clientY-dragState.downY;
    if(!dragState.moved && (Math.abs(dx)+Math.abs(dy) < 4)) return;
    if(!dragState.moved){
      dragState.moved = true;
      document.body.classList.add('dragging');
    }
    var unit = unitUnderPointer(e);
    if(!unit) return;
    if(unit.key===dragState.lastUnitKey) return;
    dragState.lastUnitKey = unit.key;

    if(dragState.view==='month'){
      if(!dragState.anchorSet){ dragState.anchorDate = unit.date; dragState.anchorSet=true; }
      if(dragState.mode==='schedule-new'){
        dragState.previewStart = iso(unit.date); dragState.previewEnd = iso(unit.date);
      } else if(dragState.mode==='move'){
        var delta = diffDays(dragState.anchorDate, unit.date);
        dragState.previewStart = iso(addDays(parseISO(dragState.originStart), delta));
        dragState.previewEnd = iso(addDays(parseISO(dragState.originEnd), delta));
      } else if(dragState.mode==='resize-start'){
        var ns = unit.date, oe = parseISO(dragState.originEnd);
        if(ns>oe) ns=oe;
        dragState.previewStart = iso(ns); dragState.previewEnd = iso(oe);
      } else if(dragState.mode==='resize-end'){
        var ne = unit.date, os = parseISO(dragState.originStart);
        if(ne<os) ne=os;
        dragState.previewStart = iso(os); dragState.previewEnd = iso(ne);
      }
    } else {
      var weeks = getYearWeeks(state.settings.timelineYear);
      function colOf(dstr){
        var idx = Math.floor(diffDays(weeks[0], parseISO(dstr))/7);
        if(idx<0) idx=0; if(idx>weeks.length-1) idx=weeks.length-1;
        return idx;
      }
      if(!dragState.anchorSet){ dragState.anchorCol = unit.colIdx; dragState.anchorSet=true; }
      if(dragState.mode==='schedule-new'){
        dragState.previewStart = iso(weeks[unit.colIdx]);
        dragState.previewEnd = iso(addDays(weeks[unit.colIdx],6));
      } else if(dragState.mode==='move'){
        var oSC = colOf(dragState.originStart), oEC = colOf(dragState.originEnd);
        var d2 = unit.colIdx - dragState.anchorCol;
        var nSC = oSC+d2, nEC = oEC+d2;
        if(nSC<0){ nEC += -nSC; nSC=0; }
        if(nEC>weeks.length-1){ nSC -= (nEC-(weeks.length-1)); nEC=weeks.length-1; }
        dragState.previewStart = iso(weeks[nSC]);
        dragState.previewEnd = iso(addDays(weeks[nEC],6));
      } else if(dragState.mode==='resize-start'){
        var oEC2 = colOf(dragState.originEnd);
        var nSC2 = unit.colIdx; if(nSC2>oEC2) nSC2=oEC2;
        dragState.previewStart = iso(weeks[nSC2]);
        dragState.previewEnd = iso(addDays(weeks[oEC2],6));
      } else if(dragState.mode==='resize-end'){
        var oSC2 = colOf(dragState.originStart);
        var nEC2 = unit.colIdx; if(nEC2<oSC2) nEC2=oSC2;
        dragState.previewStart = iso(weeks[oSC2]);
        dragState.previewEnd = iso(addDays(weeks[nEC2],6));
      }
    }
    render();
  }

  function onDragEnd(e){
    if(!dragState) return;
    var ds = dragState;
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', onDragEnd);
    document.removeEventListener('pointercancel', onDragEnd);
    document.body.classList.remove('dragging');
    dragState = null;

    if(ds.moved){
      var item = findItem(ds.itemId);
      if(item){
        item.start = ds.previewStart;
        item.end = ds.previewEnd;
      }
      saveState();
      render();
    } else {
      openItemModal(ds.itemId);
    }
  }

  /* Pointerdown delegation */
  function attachDragSource(container){
    container.addEventListener('pointerdown', function(e){
      var chip = e.target.closest('[data-role="chip"]');
      var handleStart = e.target.closest('[data-role="handle-start"]');
      var handleEnd = e.target.closest('[data-role="handle-end"]');
      var barBody = e.target.closest('[data-role="bar-body"]');
      var bar = e.target.closest('[data-role="bar"], [data-role="tl-bar"]');
      var tlLabel = e.target.closest('[data-role="tl-label"]');
      if(handleStart){ e.preventDefault(); beginDrag(e, handleStart.closest('[data-item-id]').dataset.itemId, 'resize-start'); return; }
      if(handleEnd){ e.preventDefault(); beginDrag(e, handleEnd.closest('[data-item-id]').dataset.itemId, 'resize-end'); return; }
      if(chip){ e.preventDefault(); beginDrag(e, chip.dataset.itemId, 'move'); return; }
      if(barBody || bar){ e.preventDefault(); beginDrag(e, (bar||barBody.closest('[data-item-id]')).dataset.itemId, 'move'); return; }
      if(tlLabel){ /* click only, handled on pointerup via click listener below */ return; }
    });
  }
  attachDragSource(monthGrid);
  attachDragSource(timelineGrid);

  /* Timeline label column: drag a row to reorder it, or drag the column's edge to resize.
     Registered before the create-drag listener below so it can claim the press first. */
  timelineGrid.addEventListener('pointerdown', function(e){
    if(e.target.closest('[data-role="tl-col-resize"]')){ e.preventDefault(); beginColResize(e); return; }
    var lbl = e.target.closest('[data-role="tl-label"]');
    if(lbl && canEdit){ e.preventDefault(); beginSortDrag(e, lbl, timelineGrid, '[data-role="tl-label"]', reorderTimelineRows); return; }
    var catLbl = e.target.closest('[data-role="tl-cat-label"][data-sort-id]');
    if(catLbl && canEdit){ e.preventDefault(); beginSortDrag(e, catLbl, timelineGrid, '[data-role="tl-cat-label"][data-sort-id]', reorderCategories); }
  });

  timelineGrid.addEventListener('click', function(e){
    // A press that ended a reorder or resize isn't a click on the label.
    if(Date.now() < suppressClickUntil || e.target.closest('[data-role="tl-col-resize"]')) return;
    var lbl = e.target.closest('[data-role="tl-label"]');
    if(lbl && !dragState) openItemModal(lbl.dataset.itemId);
  });

  /* Click-and-drag on empty calendar days to create a new item across a date range. */
  var createDrag = null; // {anchor:'YYYY-MM-DD', current:'YYYY-MM-DD', moved, downX, downY}

  monthGrid.addEventListener('pointerdown', function(e){
    if(e.defaultPrevented || !canEdit) return; // an existing chip/bar/handle already claimed this
    var cell = e.target.closest('.day-cell');
    if(!cell) return;
    createDrag = {anchor:cell.dataset.date, current:cell.dataset.date, moved:false, downX:e.clientX, downY:e.clientY};
    document.addEventListener('pointermove', onCreateDragMove);
    document.addEventListener('pointerup', onCreateDragEnd);
    document.addEventListener('pointercancel', onCreateDragEnd);
  });
  function onCreateDragMove(e){
    if(!createDrag) return;
    var dx=e.clientX-createDrag.downX, dy=e.clientY-createDrag.downY;
    if(!createDrag.moved && (Math.abs(dx)+Math.abs(dy) < 4)) return;
    createDrag.moved = true;
    document.body.classList.add('dragging');
    var target = document.elementFromPoint(e.clientX, e.clientY);
    var cell = target && target.closest('[data-date]');
    if(!cell || cell.dataset.date===createDrag.current) return;
    createDrag.current = cell.dataset.date;
    render();
  }
  function onCreateDragEnd(e){
    if(!createDrag) return;
    var cd = createDrag;
    document.removeEventListener('pointermove', onCreateDragMove);
    document.removeEventListener('pointerup', onCreateDragEnd);
    document.removeEventListener('pointercancel', onCreateDragEnd);
    document.body.classList.remove('dragging');
    createDrag = null;
    var start = cd.anchor <= cd.current ? cd.anchor : cd.current;
    var end = cd.anchor <= cd.current ? cd.current : cd.anchor;
    render();
    openNewItemModal({start:start, end:end});
  }

  /* Click-and-drag on the Timeline's empty track area to create a new item across weeks. */
  var tlCreateDrag = null; // {anchorCol, currentCol, moved, downX, downY}

  function tlColFromClientX(clientX){
    var rect = timelineGrid.getBoundingClientRect();
    return Math.floor((clientX - rect.left - TL_LABELW) / TL_COLW);
  }
  function tlClampCol(col){
    var weeks = getYearWeeks(state.settings.timelineYear);
    if(col<0) col=0; if(col>weeks.length-1) col=weeks.length-1;
    return col;
  }

  timelineGrid.addEventListener('pointerdown', function(e){
    if(e.defaultPrevented || !canEdit) return; // an existing bar/handle/label already claimed this
    // Only start a create-drag on the actual date grid -- not the sticky label column,
    // the corner cells, or the month-band/week-label header rows.
    if(e.target.closest('.tl-label, .tl-corner, .tl-week-label, .tl-month-band')) return;
    var col = tlClampCol(tlColFromClientX(e.clientX));
    var track = e.target.closest('[data-cat-id]');
    tlCreateDrag = {anchorCol:col, currentCol:col, moved:false, downX:e.clientX, downY:e.clientY, categoryId: track ? track.dataset.catId : null};
    document.addEventListener('pointermove', onTlCreateDragMove);
    document.addEventListener('pointerup', onTlCreateDragEnd);
    document.addEventListener('pointercancel', onTlCreateDragEnd);
  });
  function onTlCreateDragMove(e){
    if(!tlCreateDrag) return;
    var dx=e.clientX-tlCreateDrag.downX, dy=e.clientY-tlCreateDrag.downY;
    if(!tlCreateDrag.moved && (Math.abs(dx)+Math.abs(dy) < 4)) return;
    tlCreateDrag.moved = true;
    document.body.classList.add('dragging');
    var col = tlClampCol(tlColFromClientX(e.clientX));
    if(col===tlCreateDrag.currentCol) return;
    tlCreateDrag.currentCol = col;
    render();
  }
  function onTlCreateDragEnd(e){
    if(!tlCreateDrag) return;
    var cd = tlCreateDrag;
    document.removeEventListener('pointermove', onTlCreateDragMove);
    document.removeEventListener('pointerup', onTlCreateDragEnd);
    document.removeEventListener('pointercancel', onTlCreateDragEnd);
    document.body.classList.remove('dragging');
    tlCreateDrag = null;
    var weeks = getYearWeeks(state.settings.timelineYear);
    var startCol = Math.min(cd.anchorCol, cd.currentCol), endCol = Math.max(cd.anchorCol, cd.currentCol);
    var start = iso(weeks[startCol]), end = iso(addDays(weeks[endCol],6));
    render();
    openNewItemModal({start:start, end:end, categoryId:cd.categoryId});
  }

  unscheduledListEl.addEventListener('pointerdown', function(e){
    var chip = e.target.closest('.un-chip');
    if(!chip) return;
    e.preventDefault();
    beginDrag(e, chip.dataset.itemId, 'schedule-new');
  });

  /* ================= Drag-to-reorder (categories, Timeline rows) ================= */
  /* Rows carry data-sort-id. A press that doesn't move stays a click; once it moves,
     a line marks the drop spot and onDrop gets every row's id in the new order. */
  var sortDrag = null; // {root, rowSel, row, id, downX, downY, moved, target, after, onDrop}
  var suppressClickUntil = 0;

  function beginSortDrag(e, row, root, rowSel, onDrop){
    sortDrag = {root:root, rowSel:rowSel, row:row, id:row.dataset.sortId, downX:e.clientX, downY:e.clientY,
      moved:false, target:null, after:false, onDrop:onDrop};
    document.addEventListener('pointermove', onSortMove);
    document.addEventListener('pointerup', onSortEnd);
    document.addEventListener('pointercancel', onSortEnd);
  }
  function sortRows(){ return Array.prototype.slice.call(sortDrag.root.querySelectorAll(sortDrag.rowSel)); }
  function clearDropMark(){ if(sortDrag.target) sortDrag.target.classList.remove('is-drop-before','is-drop-after'); }
  function onSortMove(e){
    var sd = sortDrag;
    if(!sd) return;
    if(!sd.moved){
      if(Math.abs(e.clientX-sd.downX)+Math.abs(e.clientY-sd.downY) < 4) return;
      sd.moved = true;
      document.body.classList.add('dragging');
      sd.row.classList.add('is-sorting');
    }
    var rows = sortRows();
    var target = rows[rows.length-1], after = true;
    for(var i=0;i<rows.length;i++){
      var r = rows[i].getBoundingClientRect();
      if(e.clientY < r.bottom){ target = rows[i]; after = e.clientY > r.top + r.height/2; break; }
    }
    clearDropMark();
    sd.target = target; sd.after = after;
    target.classList.add(after ? 'is-drop-after' : 'is-drop-before');
  }
  function onSortEnd(){
    var sd = sortDrag;
    if(!sd) return;
    document.removeEventListener('pointermove', onSortMove);
    document.removeEventListener('pointerup', onSortEnd);
    document.removeEventListener('pointercancel', onSortEnd);
    document.body.classList.remove('dragging');
    sd.row.classList.remove('is-sorting');
    clearDropMark();
    var ids = sortRows().map(function(r){ return r.dataset.sortId; });
    sortDrag = null;
    if(!sd.moved || !sd.target) return;
    suppressClickUntil = Date.now() + 300;
    ids = ids.filter(function(id){ return id!==sd.id; });
    var idx = ids.indexOf(sd.target.dataset.sortId);
    if(idx===-1) return; // dropped on itself
    ids.splice(idx + (sd.after ? 1 : 0), 0, sd.id);
    sd.onDrop(ids);
  }

  /* ================= Timeline label column resize ================= */
  var colResize = null; // {downX, startW}
  function beginColResize(e){
    colResize = {downX:e.clientX, startW:TL_LABELW};
    document.body.classList.add('col-resizing');
    document.addEventListener('pointermove', onColResizeMove);
    document.addEventListener('pointerup', onColResizeEnd);
    document.addEventListener('pointercancel', onColResizeEnd);
  }
  function onColResizeMove(e){
    if(!colResize) return;
    var w = Math.round(Math.min(TL_LABELW_MAX, Math.max(TL_LABELW_MIN, colResize.startW + e.clientX - colResize.downX)));
    if(w===state.settings.tlLabelW) return;
    state.settings.tlLabelW = w;
    renderTimeline();
  }
  function onColResizeEnd(){
    if(!colResize) return;
    document.removeEventListener('pointermove', onColResizeMove);
    document.removeEventListener('pointerup', onColResizeEnd);
    document.removeEventListener('pointercancel', onColResizeEnd);
    document.body.classList.remove('col-resizing');
    colResize = null;
    suppressClickUntil = Date.now() + 300;
    saveState();
  }

  /* ================= Typed date fields ================= */
  /* Date fields are text inputs so a date can be typed (10/15/2027, 10/15/27, 10/15,
     Oct 15, 15 Oct 2027, 2027-10-15), with a button that opens the browser's native
     calendar picker. A date typed without a year lands in the year on screen. */
  var MONTH_LOOKUP = {};
  MONTH_SHORT.forEach(function(m,i){ MONTH_LOOKUP[m.toLowerCase()] = i; });

  /* Returns 'YYYY-MM-DD', '' for an empty field, or null if it can't be read as a date. */
  function parseDateText(text){
    var s = String(text||'').trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g,'$1').replace(/,/g,' ').replace(/\s+/g,' ');
    if(!s) return '';
    var y, m, d, match;
    if((match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))){ y=match[1]; m=+match[2]-1; d=+match[3]; }
    else if((match = s.match(/^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2}|\d{4}))?$/))){ m=+match[1]-1; d=+match[2]; y=match[3]; }
    else if((match = s.match(/^([a-z]{3})[a-z]*\.? (\d{1,2})(?: (\d{2}|\d{4}))?$/))){ m=MONTH_LOOKUP[match[1]]; d=+match[2]; y=match[3]; }
    else if((match = s.match(/^(\d{1,2}) ([a-z]{3})[a-z]*\.?(?: (\d{2}|\d{4}))?$/))){ d=+match[1]; m=MONTH_LOOKUP[match[2]]; y=match[3]; }
    else return null;
    if(m==null) return null;
    y = (y==null) ? displayedYear() : (y.length===2 ? 2000 + +y : +y);
    var dt = new Date(y, m, d);
    if(dt.getFullYear()!==y || dt.getMonth()!==m || dt.getDate()!==d) return null; // e.g. 2/30
    return iso(dt);
  }
  function formatDateText(isoStr){ var p = isoStr.split('-'); return p[1]+'/'+p[2]+'/'+p[0]; }
  function getDateField(input){ return parseDateText(input.value); }
  function setDateField(input, isoStr){
    input.value = isoStr ? formatDateText(isoStr) : '';
    input.classList.remove('is-invalid');
  }

  document.querySelectorAll('.date-field').forEach(function(wrap){
    var text = wrap.querySelector('.date-text');
    var native = wrap.querySelector('.date-native');
    text.addEventListener('change', function(){
      var v = parseDateText(text.value);
      if(v) setDateField(text, v);
      else text.classList.toggle('is-invalid', v===null);
    });
    text.addEventListener('input', function(){ text.classList.remove('is-invalid'); });
    wrap.querySelector('.date-picker-btn').addEventListener('click', function(){
      native.value = getDateField(text) || '';
      try{ native.showPicker(); }catch(err){ native.focus(); native.click(); }
    });
    native.addEventListener('change', function(){
      if(native.value) setDateField(text, native.value);
    });
  });

  /* ================= Hover tooltips for items ================= */
  /* Bars and chips marked data-tip show the item's full title, category and dates,
     since their own text is often cut off. Mouse/pen only; hidden during any drag. */
  var tipEl = document.createElement('div');
  tipEl.className = 'tooltip';
  tipEl.setAttribute('role', 'tooltip');
  tipEl.hidden = true;
  document.body.appendChild(tipEl);
  var tipTarget = null;

  function hideTip(){ tipTarget = null; tipEl.hidden = true; }
  function placeTip(e){
    var r = tipTarget.getBoundingClientRect();
    var w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    var below = r.top - h - 10 < 8;
    tipEl.classList.toggle('below', below);
    tipEl.style.left = Math.max(w/2 + 8, Math.min(window.innerWidth - w/2 - 8, e.clientX)) + 'px';
    tipEl.style.top = (below ? r.bottom : r.top) + 'px';
  }
  document.addEventListener('pointermove', function(e){
    var busy = dragState || createDrag || tlCreateDrag || sortDrag || colResize;
    var t = (e.pointerType==='touch' || busy) ? null : e.target.closest('[data-tip]');
    var it = t && findItem(t.dataset.itemId);
    if(!it){ if(tipTarget) hideTip(); return; }
    if(t!==tipTarget){
      tipTarget = t;
      tipEl.innerHTML = '<strong>'+escapeHtml(it.title)+'</strong>' +
        '<span class="tip-meta">'+escapeHtml(getCategory(it.categoryId).name)+(it.start ? ' · '+formatDateRange(it.start, it.end) : '')+'</span>';
      tipEl.hidden = false;
    }
    placeTip(e);
  });
  document.addEventListener('pointerdown', hideTip);
  document.documentElement.addEventListener('mouseleave', hideTip);
  window.addEventListener('scroll', hideTip, true);

  /* ================= Modal logic ================= */
  var editingId = null;
  var editingKind = null; // 'item' | 'blackout' | null (new)
  function openItemModal(id){
    var item = findItem(id);
    if(!item) return;
    editingId = id; editingKind = 'item';
    el('modalTitle').textContent = 'Edit Item';
    fieldIsBlackout.checked = false;
    toggleItemMode();
    fieldTitle.value = item.title;
    renderCategorySelect(item.categoryId);
    fieldUnscheduled.checked = !item.start;
    setDateField(fieldStart, item.start || '');
    setDateField(fieldEnd, item.end || item.start || '');
    fieldNotes.value = item.notes || '';
    deleteItemBtn.hidden = false;
    deleteItemBtn.classList.remove('confirming');
    deleteItemBtn.textContent = 'Delete';
    toggleDateFields();
    showModal();
  }
  function openBlackoutModal(id){
    var b = findBlackout(id);
    if(!b) return;
    editingId = id; editingKind = 'blackout';
    el('modalTitle').textContent = 'Edit Blackout Date';
    fieldIsBlackout.checked = true;
    toggleItemMode();
    fieldTitle.value = b.label || '';
    setDateField(fieldStart, b.start);
    setDateField(fieldEnd, b.end || b.start);
    deleteItemBtn.hidden = false;
    deleteItemBtn.classList.remove('confirming');
    deleteItemBtn.textContent = 'Delete';
    showModal();
  }
  function openNewItemModal(prefill){
    editingId = null; editingKind = null;
    el('modalTitle').textContent = 'New Item';
    fieldIsBlackout.checked = false;
    toggleItemMode();
    fieldTitle.value = '';
    // Preset category: the Timeline row it was drawn on, else the last one used, else the first.
    var catId = (prefill && prefill.categoryId) || state.settings.lastCategoryId;
    if(!state.categories.some(function(c){ return c.id===catId; })){
      catId = (state.categories.find(function(c){return !c.locked;}) || state.categories[0]).id;
    }
    renderCategorySelect(catId);
    var hasDate = prefill && prefill.start;
    fieldUnscheduled.checked = false;
    setDateField(fieldStart, hasDate ? prefill.start : iso(TODAY));
    setDateField(fieldEnd, hasDate ? (prefill.end||prefill.start) : iso(TODAY));
    fieldNotes.value = '';
    deleteItemBtn.hidden = true;
    toggleDateFields();
    showModal();
  }
  function toggleItemMode(){
    var isBO = fieldIsBlackout.checked;
    categoryFieldWrap.hidden = isBO;
    unscheduledFieldWrap.hidden = isBO;
    notesFieldWrap.hidden = isBO;
    titleFieldLabel.textContent = isBO ? 'Label (optional)' : 'Title';
    fieldTitle.placeholder = isBO ? 'e.g. Company Holiday' : 'e.g. Q4 client blog post';
    fieldTitle.required = !isBO;
    toggleDateFields();
  }
  function toggleDateFields(){
    dateFields.style.display = (fieldIsBlackout.checked || !fieldUnscheduled.checked) ? 'flex' : 'none';
  }
  fieldIsBlackout.addEventListener('change', toggleItemMode);
  fieldUnscheduled.addEventListener('change', toggleDateFields);
  fieldCategory.addEventListener('change', updateSwatch);

  function showModal(){
    if(!canEdit){
      el('modalTitle').textContent = editingKind==='blackout' ? 'Blackout Date' : 'Item Details';
      deleteItemBtn.hidden = true;
    }
    modalWrap.hidden=false; backdrop.hidden=false;
    setTimeout(function(){ (canEdit ? fieldTitle : el('cancelItemBtn')).focus(); },10);
  }
  if(!canEdit){
    [fieldTitle, fieldIsBlackout, fieldCategory, fieldUnscheduled, fieldStart, fieldEnd, fieldNotes].forEach(function(f){ f.disabled = true; });
    el('saveItemBtn').hidden = true;
    el('cancelItemBtn').textContent = 'Close';
  }
  function hideModal(){ modalWrap.hidden=true; backdrop.hidden=true; editingId=null; editingKind=null; }

  el('newItemBtn').addEventListener('click', function(){ openNewItemModal(null); });
  el('addUnscheduledBtn').addEventListener('click', function(){ openNewItemModal({start:null}); fieldUnscheduled.checked=true; toggleDateFields(); });
  el('modalCloseBtn').addEventListener('click', hideModal);
  el('cancelItemBtn').addEventListener('click', hideModal);
  backdrop.addEventListener('click', hideModal);
  document.addEventListener('keydown', function(e){ if(e.key==='Escape' && !modalWrap.hidden) hideModal(); });

  itemForm.addEventListener('submit', function(e){
    e.preventDefault();
    if(!canEdit) return;
    var startVal = getDateField(fieldStart), endVal = getDateField(fieldEnd);
    if(fieldIsBlackout.checked || !fieldUnscheduled.checked){
      var badField = startVal===null ? fieldStart : endVal===null ? fieldEnd : null;
      if(badField){ badField.classList.add('is-invalid'); badField.focus(); badField.select(); return; }
    }
    if(fieldIsBlackout.checked){
      var label = fieldTitle.value.trim();
      var boStart = startVal || iso(TODAY);
      var boEnd = endVal || boStart;
      if(boEnd < boStart) boEnd = boStart;
      if(editingKind==='blackout' && editingId){
        var b = findBlackout(editingId);
        if(b){ b.start = boStart; b.end = boEnd; b.label = label; }
      } else {
        state.blackoutDates = state.blackoutDates || [];
        state.blackoutDates.push({id:uid('bo'), start:boStart, end:boEnd, label:label});
      }
      saveState();
      hideModal();
      render();
      return;
    }
    var title = fieldTitle.value.trim();
    if(!title) return;
    var scheduled = !fieldUnscheduled.checked;
    var start = scheduled ? (startVal || iso(TODAY)) : null;
    var end = scheduled ? (endVal || start) : null;
    if(scheduled && end < start){ end = start; }
    state.settings.lastCategoryId = fieldCategory.value;
    if(editingKind==='item' && editingId){
      var item = findItem(editingId);
      if(!item){ hideModal(); render(); return; } // deleted elsewhere while the modal was open
      item.title = title; item.categoryId = fieldCategory.value;
      item.start = start; item.end = end; item.notes = fieldNotes.value.trim();
      delete item.isSample;
    } else {
      state.items.push({
        id: uid('it'), title:title, categoryId: fieldCategory.value,
        start:start, end:end, notes: fieldNotes.value.trim()
      });
    }
    saveState();
    hideModal();
    render();
  });

  deleteItemBtn.addEventListener('click', function(){
    if(!canEdit) return;
    if(!deleteItemBtn.classList.contains('confirming')){
      deleteItemBtn.classList.add('confirming');
      deleteItemBtn.textContent = 'Confirm delete?';
      setTimeout(function(){
        if(deleteItemBtn.classList.contains('confirming')){
          deleteItemBtn.classList.remove('confirming'); deleteItemBtn.textContent='Delete';
        }
      }, 3000);
      return;
    }
    if(editingKind==='blackout'){
      state.blackoutDates = (state.blackoutDates||[]).filter(function(b){ return b.id!==editingId; });
    } else {
      state.items = state.items.filter(function(it){ return it.id!==editingId; });
    }
    saveState();
    hideModal();
    render();
  });

  /* ================= Sidebar interactions ================= */
  categoryListEl.addEventListener('click', function(e){
    var row = e.target.closest('.category-row');
    if(!row) return;
    var id = row.dataset.catId;
    var cat = getCategory(id);
    var action = e.target.dataset.action;
    if(action==='pick-color'){
      var native = row.querySelector('[data-action="color-input"]');
      if(native && !native.disabled) native.click();
    } else if(action==='del-cat'){
      if(!e.target.classList.contains('confirming')){
        e.target.classList.add('confirming'); e.target.textContent='Confirm?';
        setTimeout(function(){ if(e.target.classList.contains('confirming')){ e.target.classList.remove('confirming'); e.target.textContent='Delete'; } }, 3000);
        return;
      }
      state.items.forEach(function(it){ if(it.categoryId===id) it.categoryId=UNCATEGORIZED_ID; });
      state.categories = state.categories.filter(function(c){ return c.id!==id; });
      saveState(); render();
    }
  });
  categoryListEl.addEventListener('change', function(e){
    var row = e.target.closest('.category-row');
    if(!row) return;
    var id = row.dataset.catId;
    var cat = getCategory(id);
    var action = e.target.dataset.action;
    if(action==='toggle-cat'){
      if(e.target.checked) delete state.settings.hiddenCats[id]; else state.settings.hiddenCats[id] = true;
      saveState(); render();
    }
    else if(action==='color-input'){
      var hex = normalizeHex(e.target.value);
      if(hex){ cat.color = hex; saveState(); render(); }
    } else if(action==='hex-input'){
      var hex2 = normalizeHex(e.target.value);
      if(hex2){ cat.color = hex2; saveState(); render(); }
      else { e.target.value = cat.color; }
    }
  });
  categoryListEl.addEventListener('input', function(e){
    var row = e.target.closest('.category-row');
    if(!row) return;
    var action = e.target.dataset.action;
    if(action==='rename-cat'){
      var cat = getCategory(row.dataset.catId);
      cat.name = e.target.value;
      saveState();
      renderUnscheduled();
      if(state.settings.activeView==='timeline') renderTimeline();
    }
  });

  categoryListEl.addEventListener('pointerdown', function(e){
    var grip = e.target.closest('[data-role="cat-grip"]');
    if(!grip || !canEdit) return;
    e.preventDefault();
    beginSortDrag(e, grip.closest('.category-row'), categoryListEl, '.category-row[data-sort-id]', reorderCategories);
  });

  el('addCategoryBtn').addEventListener('click', function(){
    var used = state.categories.map(function(c){return c.color;});
    var color = PALETTE.find(function(p){ return used.indexOf(p)===-1; }) || PALETTE[state.categories.length % PALETTE.length];
    var newCat = {id:uid('cat'), name:'New Category', color:color};
    state.categories.splice(state.categories.length-1, 0, newCat);
    saveState(); render();
    var input = categoryListEl.querySelector('[data-cat-id="'+newCat.id+'"] .cat-name-input');
    if(input){ input.focus(); input.select(); }
  });

  function addSidebarBlackout(){
    var v = getDateField(blackoutDateInput);
    if(!v){ if(v===null){ blackoutDateInput.classList.add('is-invalid'); blackoutDateInput.focus(); } return; }
    state.blackoutDates = state.blackoutDates || [];
    state.blackoutDates.push({id:uid('bo'), start:v, end:v, label:''});
    saveState(); render();
    setDateField(blackoutDateInput, '');
  }
  el('addBlackoutBtn').addEventListener('click', addSidebarBlackout);
  blackoutDateInput.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); addSidebarBlackout(); } });
  blackoutListEl.addEventListener('click', function(e){
    var delBtn = e.target.closest('[data-action="del-blackout"]');
    if(delBtn){
      var id = delBtn.dataset.blackoutId;
      state.blackoutDates = (state.blackoutDates||[]).filter(function(x){ return x.id!==id; });
      saveState(); render();
      return;
    }
    var row = e.target.closest('[data-blackout-id]');
    if(row) openBlackoutModal(row.dataset.blackoutId);
  });

  el('clearSampleBtn').addEventListener('click', function(){
    state.items = state.items.filter(function(it){ return !it.isSample; });
    saveState(); render();
  });

  searchEl.addEventListener('input', function(){ render(); });

  /* ================= Top bar interactions ================= */
  document.querySelectorAll('.tab-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      state.settings.activeView = btn.dataset.view;
      saveState(); render();
    });
  });
  tlGroupToggle.addEventListener('click', function(e){
    var btn = e.target.closest('[data-group]');
    if(!btn) return;
    state.settings.tlGroupBy = btn.dataset.group;
    saveState(); render();
  });
  el('sidebarToggleBtn').addEventListener('click', function(){
    state.settings.sidebarOpen = !state.settings.sidebarOpen;
    saveState(); render();
  });
  el('prevBtn').addEventListener('click', function(){ step(-1); });
  el('nextBtn').addEventListener('click', function(){ step(1); });

  function step(dir){
    if(state.settings.activeView==='month'){
      state.settings.monthYear += dir;
    } else {
      state.settings.timelineYear += dir;
    }
    saveState(); render();
  }

  /* ================= Topbar height (for sticky offsets) ================= */
  var topbarEl = document.querySelector('.topbar');
  function updateTopbarHeight(){
    document.documentElement.style.setProperty('--topbar-h', topbarEl.offsetHeight+'px');
    var wdH = (!weekdayRow.hidden) ? weekdayRow.offsetHeight : 0;
    document.documentElement.style.setProperty('--weekday-h', wdH+'px');
  }
  window.addEventListener('resize', updateTopbarHeight);
  // The topbar's height can shift slightly once the Montserrat webfont finishes
  // loading (swapping in from the fallback), so re-measure once that settles.
  if(document.fonts && document.fonts.ready){ document.fonts.ready.then(updateTopbarHeight); }

  /* ================= Init ================= */
  if(!opts.data && canEdit) saveState(); // first run: write the seeded planner
  render();

  return { setData: setData };
}
