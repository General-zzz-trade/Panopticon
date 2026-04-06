// Agent Orchestrator UI v11 — 20 features
// P0: persistence, streaming md, multi-turn, suggestions, edit/resend
// P1: branch, artifacts preview, task progress, browser controls, workflow
// P2: feedback, shortcuts, drag-sort, sounds, i18n, mobile
// P3: virtual scroll, lazy images, PWA, tests
const API = '/api/v1';

// ═══ i18n ════════════════════════════════════════════════════════
const I18N = {
  en: { new_chat:'New chat', welcome:'How can I help today?', welcome_sub:'Browse websites, run commands, call APIs, and automate tasks.', dashboard:'Dashboard', settings:'Settings', shortcuts:'Keyboard Shortcuts', save:'Save Settings', dark_mode:'Dark mode', notify:'Notify on complete', sound:'Sound on complete', exec_mode:'Execution mode', live_label:'Live browser view', live_hint:'Screencast appears when agent opens a browser', sug_read:'Read a webpage', sug_analyze:'Analyze a project', sug_api:'Call an API', sug_browse:'Browse the web' },
  zh: { new_chat:'新对话', welcome:'有什么可以帮你？', welcome_sub:'浏览网页、运行命令、调用API、自动化任务', dashboard:'仪表盘', settings:'设置', shortcuts:'快捷键', save:'保存设置', dark_mode:'深色模式', notify:'完成时通知', sound:'完成时声音', exec_mode:'执行模式', live_label:'浏览器实时画面', live_hint:'Agent 打开浏览器时显示', sug_read:'阅读网页', sug_analyze:'分析项目', sug_api:'调用API', sug_browse:'浏览网页' }
};
function applyI18n(lang) {
  const dict = I18N[lang] || I18N.en;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (dict[key]) el.textContent = dict[key];
  });
  $('lang-toggle').textContent = lang.toUpperCase();
}

// ═══ State ═══════════════════════════════════════════════════════
const state = {
  convoId:null, runId:null, eventSource:null,
  agentMsgEl:null, toolsEl:null, inlineSlot:null, dialogueSlot:null,
  lastEventSeq:0, events:[],
  attachments:[], history:JSON.parse(localStorage.getItem('goalHistory')||'[]'), historyIdx:-1,
  settings:loadSettings(),
  stageStartTime:null, currentStage:null, stageTimer:null,
  allConvos:[], sending:false,
  jwtToken:null, jwtUser:null,
  tasksDone:0, tasksTotal:0,
};
function loadSettings() {
  try { return {dark:false,notify:false,sound:false,mode:'',apiKey:'',agentName:'Agent',sidebarOpen:true,panelOpen:true,lang:'en',...JSON.parse(localStorage.getItem('agentSettings')||'{}')}; }
  catch { return {dark:false,notify:false,sound:false,mode:'',apiKey:'',agentName:'Agent',sidebarOpen:true,panelOpen:true,lang:'en'}; }
}
function saveSettings() { localStorage.setItem('agentSettings', JSON.stringify(state.settings)); }
function saveAndToast() { saveSettings(); toast('Saved',1000); }

// ═══ Utils ═══════════════════════════════════════════════════════
function el(t,a,x){const e=document.createElement(t);if(a)for(const k in a)e.setAttribute(k,a[k]);if(x!=null)e.textContent=x;return e}
function $(id){return document.getElementById(id)}
function toast(m,ms=2500){const t=$('toast');t.textContent=m;t.classList.remove('hidden');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.add('hidden'),ms)}
async function apiFetch(url,opts={}){const h={...(opts.headers||{})};if(state.settings.apiKey)h['X-API-Key']=state.settings.apiKey;if(state.jwtToken)h['Authorization']='Bearer '+state.jwtToken;return fetch(url,{...opts,headers:h})}
function scrollChat(){const c=$('chat');c.scrollTop=c.scrollHeight}
function fmtTime(ts){try{return new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}catch{return ''}}

// ═══ Markdown + copy ═════════════════════════════════════════════
if(window.marked)marked.setOptions({breaks:true,gfm:true,highlight:(c,l)=>{if(window.hljs&&l&&hljs.getLanguage(l)){try{return hljs.highlight(c,{language:l}).value}catch{}}return window.hljs?hljs.highlightAuto(c).value:c}});
function renderMd(el,text){
  if(!text){el.textContent='';return}
  if(!window.marked||!window.DOMPurify){el.textContent=String(text);return}
  try{
    el.innerHTML=DOMPurify.sanitize(marked.parse(String(text)),{USE_PROFILES:{html:true}});
    if(window.hljs)el.querySelectorAll('pre code').forEach(b=>hljs.highlightElement(b));
    // Copy buttons
    el.querySelectorAll('pre').forEach(pre=>{if(pre.querySelector('.copy-btn'))return;const btn=document.createElement('button');btn.className='copy-btn';btn.textContent='Copy';btn.onclick=async(e)=>{e.stopPropagation();try{await navigator.clipboard.writeText(pre.querySelector('code')?.textContent||pre.textContent);btn.textContent='Copied!';btn.classList.add('copied');setTimeout(()=>{btn.textContent='Copy';btn.classList.remove('copied')},1500)}catch{btn.textContent='Failed'}};pre.appendChild(btn)});
    // Lazy images
    el.querySelectorAll('img').forEach(img=>{img.loading='lazy';img.style.cursor='pointer';img.onclick=()=>openLightbox(img.src)});
  }catch{el.textContent=String(text)}
}
// Streaming markdown: render incrementally
function renderStreamingMd(el,text){
  if(!text){el.textContent='';return}
  if(!window.marked||!window.DOMPurify){el.textContent=text+'\u2588';return}
  try{
    // Parse what we have so far + cursor
    const html=DOMPurify.sanitize(marked.parse(text+' \u2588'),{USE_PROFILES:{html:true}});
    el.innerHTML=html;
    if(window.hljs)el.querySelectorAll('pre code').forEach(b=>hljs.highlightElement(b));
  }catch{el.textContent=text+'\u2588'}
}

// ═══ Theme ═══════════════════════════════════════════════════════
function applyTheme(){document.documentElement.classList.toggle('dark',state.settings.dark)}

// ═══ Health ══════════════════════════════════════════════════════
async function checkHealth(){const dot=document.querySelector('#health-info .dot'),txt=document.querySelector('#health-info span:last-child');try{const d=await(await fetch('/health')).json();if(d.status==='ok'){dot.className='dot bg-green-500';txt.textContent='Online \u00b7 '+((d.memoryMB?.heapUsed??0))+'MB'}else{dot.className='dot bg-red-500';txt.textContent='Unhealthy'}}catch{dot.className='dot bg-red-500';txt.textContent='Offline'}}

// ═══ Stage bar ═══════════════════════════════════════════════════
const STAGE_PROG={planning:15,executing:55,verifying:85,done:100};
function showStageBar(){$('stage-bar').classList.remove('hidden');state.stageStartTime=Date.now();state.currentStage=null;state.tasksDone=0;state.tasksTotal=0;updateStageTimer();state.stageTimer=setInterval(updateStageTimer,1000)}
function hideStageBar(){clearInterval(state.stageTimer);state.stageTimer=null;$('stage-bar').classList.add('hidden');$('task-progress').classList.add('hidden')}
function setStage(s){if(state.currentStage===s)return;state.currentStage=s;$('stage-bar').querySelectorAll('[data-stage]').forEach(p=>{const i=['planning','executing','verifying','done'].indexOf(p.dataset.stage),c=['planning','executing','verifying','done'].indexOf(s);p.className='stage-pill '+(i<c?'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400':i===c?'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-semibold':'bg-gray-100 dark:bg-gray-800 text-gray-500')});$('progress-bar').style.width=(STAGE_PROG[s]||0)+'%'}
function updateStageTimer(){if(!state.stageStartTime)return;const s=Math.floor((Date.now()-state.stageStartTime)/1000);const m=Math.floor(s/60);$('stage-timer').textContent=(m>0?m+':':'')+String(s%60).padStart(m>0?2:1,'0')+'s'}
function eventToStage(t){if(t==='planning')return'planning';if('task_start observation hypothesis replan'.includes(t))return'executing';if('task_done task_failed decision'.includes(t))return'verifying';if(t==='run_complete')return'done';return null}
// Task progress counter (#8)
function updateTaskProgress(event){
  if(event.type==='task_start')state.tasksTotal++;
  if(event.type==='task_done'||event.type==='task_failed')state.tasksDone++;
  if(state.tasksTotal>0){const tp=$('task-progress');tp.classList.remove('hidden');tp.textContent=state.tasksDone+'/'+state.tasksTotal+' tasks'}
}

// ═══ Textarea + keyboard ════════════════════════════════════════
const textarea=$('user-input'),sendBtn=$('send-btn');
function adjustTextarea(){textarea.style.height='auto';textarea.style.height=Math.min(textarea.scrollHeight,160)+'px';sendBtn.disabled=(textarea.value.trim().length===0&&state.attachments.length===0)||state.sending}
textarea.addEventListener('input',()=>{adjustTextarea();handleSlashMenu();handleSuggestions()});
textarea.addEventListener('keydown',(e)=>{
  const menu=$('slash-menu');
  if(!menu.classList.contains('hidden')){if(e.key==='Escape'){menu.classList.add('hidden');return}if(e.key==='Enter'){e.preventDefault();const it=menu.querySelector('[data-sel="1"]');if(it){textarea.value=it.dataset.cmd;adjustTextarea();menu.classList.add('hidden');textarea.focus()}return}if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();navSlashMenu(e.key==='ArrowDown'?1:-1);return}}
  if(e.key==='Enter'&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey){e.preventDefault();if(!sendBtn.disabled&&!state.sending)sendMessage()}
  else if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();if(!sendBtn.disabled&&!state.sending)sendMessage()}
  else if(e.key==='ArrowUp'&&textarea.value===''&&state.history.length>0){e.preventDefault();state.historyIdx=Math.min(state.historyIdx+1,state.history.length-1);textarea.value=state.history[state.historyIdx];adjustTextarea()}
  else if(e.key==='ArrowDown'&&state.historyIdx>=0){e.preventDefault();state.historyIdx-=1;textarea.value=state.historyIdx<0?'':state.history[state.historyIdx];adjustTextarea()}
});
document.addEventListener('keydown',(e)=>{
  if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();textarea.focus()}
  if((e.metaKey||e.ctrlKey)&&e.key===','){e.preventDefault();openSettings()}
  if((e.metaKey||e.ctrlKey)&&e.key==='b'){e.preventDefault();toggleSidebar()}
  if((e.metaKey||e.ctrlKey)&&e.key==='.'){e.preventDefault();toggleRightPanel()}
  if((e.metaKey||e.ctrlKey)&&e.key==='/'){e.preventDefault();openModal('shortcuts-modal')}
  if((e.metaKey||e.ctrlKey)&&e.key==='n'){e.preventDefault();newChat()}
  if(e.key==='Escape'){closeLightbox();closeDrawer();closeModal('settings-modal');closeModal('dashboard-modal');closeModal('shortcuts-modal');$('slash-menu').classList.add('hidden');$('suggest-dropdown').classList.add('hidden')}
});

// ═══ Slash menu ═════════════════════════════════════════════════
const CMDS=[{cmd:'Go to ',desc:'Open URL'},{cmd:'Fetch ',desc:'HTTP request'},{cmd:'Search for ',desc:'Web search'},{cmd:'Read file ',desc:'Read file'},{cmd:'Take a screenshot of ',desc:'Screenshot'},{cmd:'Run command ',desc:'Shell'}];
function handleSlashMenu(){const v=textarea.value,m=$('slash-menu');if(v.startsWith('/')&&!v.includes(' ')){const q=v.slice(1).toLowerCase();const matches=CMDS.filter(c=>c.cmd.toLowerCase().includes(q)||c.desc.toLowerCase().includes(q));if(!matches.length){m.classList.add('hidden');return}m.textContent='';matches.slice(0,6).forEach((c,i)=>{const it=el('div',{class:'px-3 py-2 text-sm cursor-pointer '+(i===0?'bg-gray-100 dark:bg-gray-800':'hover:bg-gray-100 dark:hover:bg-gray-800'),'data-cmd':c.cmd,'data-sel':i===0?'1':'0',role:'option'});it.appendChild(el('div',{class:'mono text-xs'},c.cmd));it.appendChild(el('div',{class:'text-xs text-gray-500'},c.desc));it.onclick=()=>{textarea.value=c.cmd;adjustTextarea();m.classList.add('hidden');textarea.focus()};m.appendChild(it)});m._sel=0;m.classList.remove('hidden')}else{m.classList.add('hidden')}}
function navSlashMenu(d){const m=$('slash-menu'),items=[...m.children];if(!items.length)return;const n=((m._sel??0)+d+items.length)%items.length;items.forEach((it,i)=>{it.dataset.sel=i===n?'1':'0';it.className='px-3 py-2 text-sm cursor-pointer '+(i===n?'bg-gray-100 dark:bg-gray-800':'hover:bg-gray-100 dark:hover:bg-gray-800')});m._sel=n}

// ═══ Typeahead suggestions (#4) ═════════════════════════════════
function handleSuggestions(){
  const v=textarea.value.trim(),dd=$('suggest-dropdown');
  if(v.length<3||v.startsWith('/')){dd.classList.add('hidden');return}
  const matches=state.history.filter(h=>h.toLowerCase().includes(v.toLowerCase())&&h!==v).slice(0,4);
  if(!matches.length){dd.classList.add('hidden');return}
  dd.textContent='';
  matches.forEach(m=>{const it=el('div',{class:'px-3 py-2 text-xs cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 truncate'},m);it.onclick=()=>{textarea.value=m;adjustTextarea();dd.classList.add('hidden');textarea.focus()};dd.appendChild(it)});
  dd.classList.remove('hidden');
}

// ═══ Attachments ═════════════════════════════════════════════════
$('attach-btn').onclick=()=>$('file-input').click();
$('file-input').onchange=(e)=>{for(const f of e.target.files)addAtt(f);e.target.value=''};
textarea.addEventListener('paste',(e)=>{for(const it of e.clipboardData?.items||[])if(it.type.startsWith('image/')){const b=it.getAsFile();if(b){addAtt(b);e.preventDefault()}}});
textarea.addEventListener('dragover',(e)=>{e.preventDefault();textarea.classList.add('border-blue-500')});
textarea.addEventListener('dragleave',()=>textarea.classList.remove('border-blue-500'));
textarea.addEventListener('drop',(e)=>{e.preventDefault();textarea.classList.remove('border-blue-500');for(const f of e.dataTransfer.files)addAtt(f)});
function addAtt(f){const r=new FileReader;r.onload=()=>{state.attachments.push({name:f.name,type:f.type,size:f.size,dataUrl:r.result});renderAtts();adjustTextarea()};r.readAsDataURL(f)}
function renderAtts(){const b=$('attachments');b.textContent='';state.attachments.forEach((a,i)=>{const c=el('div',{class:'flex items-center gap-1.5 bg-gray-100 dark:bg-gray-800 rounded-lg px-2 py-1 text-xs'});c.appendChild(el('span',{},a.type.startsWith('image/')?'\ud83d\uddbc':'\ud83d\udcc4'));c.appendChild(el('span',{},a.name.slice(0,30)));const x=el('button',{type:'button',class:'text-gray-500 hover:text-red-600 ml-1'},'\u00d7');x.onclick=()=>{state.attachments.splice(i,1);renderAtts();adjustTextarea()};c.appendChild(x);b.appendChild(c)})}

// ═══ Avatar ═════════════════════════════════════════════════════
function mkAvatar(){const a=el('div',{class:'w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center flex-shrink-0',title:state.settings.agentName});a.innerHTML='<svg class="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>';return a}

// ═══ Messages ════════════════════════════════════════════════════
function addUserMsg(text,atts=[]){
  const wrap=el('div',{class:'msg-in flex justify-end gap-2','data-text':text});
  const col=el('div',{class:'max-w-[75%] text-right'});
  const bubble=el('div',{class:'inline-block text-left bg-gray-100 dark:bg-gray-800 rounded-2xl px-4 py-3 text-sm prose-msg'});
  renderMd(bubble,text);
  if(atts.length){const ab=el('div',{class:'flex flex-wrap gap-2 mt-2'});atts.forEach(a=>{if(a.type.startsWith('image/')){const img=el('img',{src:a.dataUrl,class:'max-w-32 rounded cursor-pointer',loading:'lazy'});img.onclick=()=>openLightbox(a.dataUrl);ab.appendChild(img)}else ab.appendChild(el('div',{class:'text-xs text-gray-500'},'\ud83d\udcc4 '+a.name))});bubble.appendChild(ab)}
  col.appendChild(bubble);
  // Actions: edit + resend (#5)
  const acts=el('div',{class:'msg-actions flex justify-end gap-1 mt-0.5 mr-1'});
  const editBtn=el('button',{class:'text-gray-400 hover:text-blue-600',title:'Edit & resend'},'\u270e');
  editBtn.onclick=()=>{textarea.value=text;adjustTextarea();textarea.focus();wrap.remove()};
  acts.appendChild(editBtn);
  // Fork button (#6)
  if(state.convoId){
    const forkBtn=el('button',{class:'text-gray-400 hover:text-purple-600',title:'Branch from here'},'\u2442');
    forkBtn.onclick=()=>forkConversation(wrap);
    acts.appendChild(forkBtn);
  }
  const timeEl=el('span',{class:'msg-time text-gray-400'},fmtTime(new Date().toISOString()));
  acts.appendChild(timeEl);
  col.appendChild(acts);
  wrap.appendChild(col);$('messages').appendChild(wrap);scrollChat();
}

function startAgentMsg(){
  state.events=[];state.tasksDone=0;state.tasksTotal=0;
  const wrap=el('div',{class:'msg-in flex gap-3'});
  wrap.appendChild(mkAvatar());
  const content=el('div',{class:'flex-1 min-w-0'});
  const det=el('details',{class:'mb-2',open:''});
  const sum=el('summary',{class:'inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-1'});
  sum.appendChild(el('span',{class:'summary-label'},'Thinking...'));
  sum.appendChild(el('span',{class:'text-gray-400'},'\u25be'));
  det.appendChild(sum);
  const tools=el('div',{class:'tool-call space-y-0.5 py-2 px-3 bg-gray-50 dark:bg-gray-900/50 border-l-2 border-gray-200 dark:border-gray-700 rounded-r ml-1'});
  det.appendChild(tools);content.appendChild(det);
  const inl=el('div',{class:'space-y-1 mb-2'});content.appendChild(inl);
  const dlg=el('div',{});content.appendChild(dlg);
  const resp=el('div',{class:'prose-msg text-sm response-text'});
  const typ=el('div',{class:'flex gap-1 items-center typing-indicator'});
  for(let i=0;i<3;i++)typ.appendChild(el('span',{class:'typing-dot w-1.5 h-1.5 bg-gray-400 rounded-full'}));
  resp.appendChild(typ);content.appendChild(resp);
  content.appendChild(el('div',{class:'msg-time text-gray-400 mt-0.5'},fmtTime(new Date().toISOString())));
  wrap.appendChild(content);$('messages').appendChild(wrap);
  state.agentMsgEl=resp;state.toolsEl=tools;state.inlineSlot=inl;state.dialogueSlot=dlg;
  showStageBar();setStage('planning');scrollChat();
}

// ═══ Events ═════════════════════════════════════════════════════
const EVT={planning:{i:'\u25c7',l:'Planning',c:'text-indigo-600 dark:text-indigo-400',k:1},task_start:{i:'\u25b6',l:'Start',c:'text-blue-600 dark:text-blue-400',k:1},task_done:{i:'\u2713',l:'Done',c:'text-green-600 dark:text-green-400',k:1},task_failed:{i:'\u2717',l:'Failed',c:'text-red-600 dark:text-red-400',k:1},observation:{i:'\u25c9',l:'Observe',c:'text-gray-500',k:0},hypothesis:{i:'?',l:'Hypothesis',c:'text-amber-600 dark:text-amber-400',k:1},replan:{i:'\u21bb',l:'Replan',c:'text-purple-600 dark:text-purple-400',k:1},screenshot:{i:'\ud83d\udcf7',l:'Screen',c:'text-gray-500',k:0},decision:{i:'\u25cf',l:'Decide',c:'text-gray-600 dark:text-gray-400',k:0},help_requested:{i:'!',l:'Help',c:'text-orange-600 dark:text-orange-400',k:1},approval_required:{i:'\ud83d\udd12',l:'Approval',c:'text-orange-600',k:1},dialogue_requested:{i:'\ud83d\udcac',l:'Q',c:'text-blue-600',k:1},log:{i:'\u00b7',l:'Log',c:'text-gray-400',k:0},thinking:{i:'~',l:'Think',c:'text-gray-500',k:0}};

function addEvent(event){
  if(!state.toolsEl)return;
  if(event.seq)state.lastEventSeq=Math.max(state.lastEventSeq,event.seq);
  state.events.push(event);
  const t=event.type||'log';
  const stg=eventToStage(t);if(stg)setStage(stg);
  updateTaskProgress(event);
  if(t==='approval_required'||t==='dialogue_requested'){renderApproval(event);return}
  if(t==='screenshot'&&event.screenshotDataUrl){showLive(event.screenshotDataUrl);return}
  const s=EVT[t]||{i:'\u25cf',l:t,c:'text-gray-500',k:0};
  const msg=event.summary||event.message||event.taskType||t;
  if(s.k&&state.inlineSlot){
    const card=el('div',{class:'inline-event flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-800 cursor-pointer'});
    card.appendChild(el('span',{class:'mono '+s.c},s.i));
    card.appendChild(el('span',{class:'font-medium text-gray-600 dark:text-gray-300'},s.l));
    card.appendChild(el('span',{class:'text-gray-500 dark:text-gray-400 truncate flex-1'},String(msg).slice(0,120)));
    if(event.durationMs)card.appendChild(el('span',{class:'text-gray-400 flex-shrink-0'},(event.durationMs/1000).toFixed(1)+'s'));
    card.onclick=()=>openInspector(event);
    state.inlineSlot.appendChild(card);
    while(state.inlineSlot.children.length>6)state.inlineSlot.removeChild(state.inlineSlot.firstChild);
  }else{
    const line=el('div',{class:'event-row flex gap-2 items-start text-xs'});
    line.appendChild(el('span',{class:'mono w-4 flex-shrink-0 '+s.c},s.i));
    line.appendChild(el('span',{class:'text-gray-400 w-14 flex-shrink-0'},s.l));
    line.appendChild(el('span',{class:'text-gray-700 dark:text-gray-300 break-words flex-1'},String(msg).slice(0,200)));
    line.onclick=()=>openInspector(event);
    state.toolsEl.appendChild(line);
  }
  updStepCount();appendTrace(event,state.events.length-1);scrollChat();
}
function updStepCount(){const d=state.toolsEl?.parentElement;if(!d||d.tagName!=='DETAILS')return;const n=(state.toolsEl?.children.length??0)+(state.inlineSlot?.children.length??0);const s=d.querySelector('.summary-label');if(s)s.textContent='Working \u00b7 '+n+' step'+(n!==1?'s':'')}

// ═══ Inspector ══════════════════════════════════════════════════
function openInspector(ev){$('drawer-title').textContent=(EVT[ev.type]?.l||ev.type)+' #'+(ev.seq??'?');const b=$('drawer-body');b.textContent='';const r=(k,v)=>{const d=el('div',{class:'mb-3'});d.appendChild(el('div',{class:'text-[10px] uppercase text-gray-400 font-medium tracking-wide mb-1'},k));d.appendChild(el('pre',{class:'mono text-xs whitespace-pre-wrap break-words bg-gray-50 dark:bg-gray-900 p-2 rounded'},typeof v==='object'?JSON.stringify(v,null,2):String(v)));b.appendChild(d)};if(ev.summary)r('Summary',ev.summary);if(ev.message&&ev.message!==ev.summary)r('Message',ev.message);if(ev.taskType)r('Task',ev.taskType);if(ev.durationMs!=null)r('Duration',(ev.durationMs/1000).toFixed(3)+'s');if(ev.error)r('Error',ev.error);if(ev.payload)r('Payload',ev.payload);r('Timestamp',ev.timestamp);$('drawer').classList.add('open');$('drawer-backdrop').classList.remove('hidden')}
function closeDrawer(){$('drawer').classList.remove('open');$('drawer-backdrop').classList.add('hidden')}
window.closeDrawer=closeDrawer;

// ═══ Approval ════════════════════════════════════════════════════
function renderApproval(ev){if(!state.dialogueSlot)return;const aid=ev.payload?.approvalId;if(!aid)return;const dt=ev.payload?.taskPayload?.dialogueType||'approval';const q=ev.payload?.taskPayload?.question||ev.payload?.reason||'Input needed';const opts=ev.payload?.taskPayload?.options;const p=el('div',{class:'my-3 p-3 border-2 border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950/30 rounded-lg',role:'alert'});p.appendChild(el('div',{class:'text-xs font-semibold text-orange-800 dark:text-orange-300 mb-2'},dt==='clarification'?'Agent asks:':dt==='choice'?'Choose:':'Approval:'));p.appendChild(el('div',{class:'text-sm mb-3'},q));const br=el('div',{class:'flex gap-2 flex-wrap'});if(dt==='clarification'){const inp=el('input',{type:'text',class:'flex-1 min-w-0 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-700 dark:bg-gray-900 rounded-lg focus:outline-none focus:border-blue-500',placeholder:'Answer...'});const sub=el('button',{class:'px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg'},'Send');sub.onclick=()=>respondApproval(aid,true,p,inp.value);inp.onkeydown=e=>{if(e.key==='Enter')sub.click()};br.appendChild(inp);br.appendChild(sub);setTimeout(()=>inp.focus(),50)}else if(dt==='choice'&&Array.isArray(opts)){opts.forEach((o,i)=>{const b=el('button',{class:'px-3 py-1.5 border border-gray-300 dark:border-gray-700 hover:bg-blue-600 hover:text-white hover:border-blue-600 text-sm rounded-lg transition'},o);b.onclick=()=>respondApproval(aid,true,p,null,i);br.appendChild(b)})}else{const ap=el('button',{class:'px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg'},'Approve');const rj=el('button',{class:'px-4 py-1.5 border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-sm rounded-lg'},'Reject');ap.onclick=()=>respondApproval(aid,true,p);rj.onclick=()=>respondApproval(aid,false,p);br.appendChild(ap);br.appendChild(rj)}p.appendChild(br);state.dialogueSlot.appendChild(p);scrollChat()}
async function respondApproval(id,ok,panel,ans,sel){try{const b={approved:ok};if(ans!=null)b.answer=ans;if(sel!=null)b.selectedOption=sel;await apiFetch(API+'/approvals/'+id+'/respond',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});panel.textContent='';panel.className='my-2 text-xs text-gray-500 italic';panel.textContent=ok?(ans||(sel!=null?'Option '+(sel+1):'Approved')):'Rejected'}catch(e){panel.appendChild(el('div',{class:'text-xs text-red-600 mt-2'},'Failed: '+e.message))}}

// ═══ Finish turn + feedback ═════════════════════════════════════
function finishAgentMsg(text,success){
  if(!state.agentMsgEl)return;
  const typ=state.agentMsgEl.querySelector('.typing-indicator');if(typ)typ.remove();
  setStage('done');hideStageBar();setSending(false);
  renderMd(state.agentMsgEl,text||'(no output)');
  // Error banner
  if(!success&&text){const b=el('div',{class:'mt-2 flex items-center gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 px-3 py-2 rounded-lg',role:'alert'});b.appendChild(el('span',{},'\u26a0'));b.appendChild(el('span',{class:'flex-1'},'Task failed'));const rb=el('button',{class:'px-2 py-0.5 border border-red-300 dark:border-red-800 rounded hover:bg-red-100 dark:hover:bg-red-900 transition'},'Retry');rb.onclick=()=>{const g=state.history[0];if(g){textarea.value=g;adjustTextarea();sendMessage()}};b.appendChild(rb);state.agentMsgEl.parentElement?.appendChild(b)}
  // Feedback buttons (#11)
  const fb=el('div',{class:'msg-actions flex gap-1 mt-1'});
  const up=el('button',{class:'text-gray-400 hover:text-green-600',title:'Good response'},'\ud83d\udc4d');
  const dn=el('button',{class:'text-gray-400 hover:text-red-600',title:'Bad response'},'\ud83d\udc4e');
  const savedRunId=state.runId;
  up.onclick=()=>{sendFeedback(savedRunId,'up');up.classList.add('text-green-600');up.classList.remove('text-gray-400')};
  dn.onclick=()=>{sendFeedback(savedRunId,'down');dn.classList.add('text-red-600');dn.classList.remove('text-gray-400')};
  fb.appendChild(up);fb.appendChild(dn);
  // Fork button
  if(state.convoId){const fk=el('button',{class:'text-gray-400 hover:text-purple-600',title:'Branch from here'},'\u2442');fk.onclick=()=>forkConversation(state.agentMsgEl.closest('.msg-in'));fb.appendChild(fk)}
  fb.appendChild(el('span',{class:'msg-time text-gray-400'},fmtTime(new Date().toISOString())));
  state.agentMsgEl.parentElement?.appendChild(fb);
  // Collapse details
  const wrap=state.agentMsgEl.closest('.msg-in');const det=wrap?.querySelector('details');
  if(det){det.open=false;const s=det.querySelector('.summary-label');const n=(state.toolsEl?.children.length??0)+(state.inlineSlot?.children.length??0);if(s)s.textContent=(success?'\u2713':'\u2717')+' '+n+' step'+(n!==1?'s':'')}
  if(savedRunId)loadArtifacts(savedRunId);
  // Sound (#14)
  if(state.settings.sound){try{$('notify-sound').play()}catch{}}
  if(state.settings.notify&&document.hidden&&'Notification'in window&&Notification.permission==='granted'){try{new Notification(state.settings.agentName+' '+(success?'done':'failed'),{body:(text||'').slice(0,100)})}catch{}}
  state.agentMsgEl=null;state.toolsEl=null;state.inlineSlot=null;state.runId=null;state.dialogueSlot=null;setCancelBtn(false);scrollChat();
}
function setCancelBtn(a){const b=$('cancel-btn');if(b)b.style.display=a?'inline-flex':'none'}
function setSending(s){state.sending=s;$('send-icon').classList.toggle('hidden',s);$('send-spinner').classList.toggle('hidden',!s);sendBtn.disabled=s;textarea.readOnly=s}
// Feedback API (#11)
async function sendFeedback(runId,rating){try{await apiFetch(API+'/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId,messageIndex:0,rating})})}catch{}}

// ═══ Send message ═══════════════════════════════════════════════
async function sendMessage(){
  if(state.sending)return;
  const text=textarea.value.trim();if(!text&&!state.attachments.length)return;
  $('empty-chat').classList.add('hidden');$('suggest-dropdown').classList.add('hidden');
  state.history.unshift(text);state.history=state.history.slice(0,50);state.historyIdx=-1;
  localStorage.setItem('goalHistory',JSON.stringify(state.history));
  const atts=state.attachments.slice();
  textarea.value='';state.attachments=[];renderAtts();adjustTextarea();setSending(true);
  addUserMsg(text,atts);
  let goal=text;if(atts.length)goal+='\n[Attached: '+atts.map(a=>a.name).join(', ')+']';
  // Ensure conversation
  if(!state.convoId){try{const r=await apiFetch(API+'/conversations',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(r.ok){const d=await r.json();state.convoId=d.id||null}}catch{}}
  if(state.convoId)$('chat-title').textContent=text.slice(0,40)+(text.length>40?'...':'');
  startAgentMsg();state.lastEventSeq=0;clearLive();
  const mode=$('mode-select').value||state.settings.mode;
  try{
    const opts={};if(mode)opts.executionMode=mode;if(state.convoId)opts.conversationId=state.convoId;
    const res=await apiFetch(API+'/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:goal,conversationId:state.convoId,options:opts})});
    const ct=res.headers.get('content-type')||'';
    if(ct.includes('text/event-stream'))handleChatStream(res);
    else{const d=await res.json();if(d.type==='task'&&d.runId){state.runId=d.runId;setCancelBtn(true);connectStream(d.runId)}else if(d.type==='chat'&&d.message)finishAgentMsg(d.message,true);else if(d.error==='dangerous_goal')finishAgentMsg('**Dangerous goal**\n\n'+(d.reason||'')+'\n\n> '+(d.hint||''),false);else if(d.error)finishAgentMsg('Error: '+(d.reason||d.error),false);else finishAgentMsg(d.message||JSON.stringify(d).slice(0,300),true)}
  }catch(e){toast('Network error');finishAgentMsg('Network error: '+e.message,false)}
  loadConvoList();
}

// ═══ Chat stream (streaming markdown #2) ════════════════════════
function handleChatStream(response){
  const reader=response.body.getReader();const dec=new TextDecoder;let full='',buf='';
  if(state.agentMsgEl){const t=state.agentMsgEl.querySelector('.typing-indicator');if(t)t.remove()}
  setStage('executing');
  function read(){reader.read().then(({done,value})=>{
    if(done){if(full&&state.agentMsgEl)finishAgentMsg(full,true);return}
    buf+=dec.decode(value,{stream:true});const lines=buf.split('\n');buf=lines.pop()||'';
    for(const line of lines){if(!line.startsWith('data: '))continue;const raw=line.slice(6).trim();if(!raw)continue;
      try{const ev=JSON.parse(raw);
        if(ev.type==='chat_chunk'&&ev.content){full+=ev.content;if(state.agentMsgEl)renderStreamingMd(state.agentMsgEl,full);scrollChat()}
        else if(ev.type==='chat_done'){full=ev.content||full;finishAgentMsg(full,ev.success!==false);return}
      }catch{}}
    read()}).catch(()=>{if(full)finishAgentMsg(full,true);else finishAgentMsg('Stream error',false)})}
  read();
}

// ═══ SSE stream + polling ═══════════════════════════════════════
function connectStream(id,retry=0){if(state.eventSource)state.eventSource.close();let got=false;const url=API+'/runs/'+id+'/stream'+(state.lastEventSeq?'?lastEventId='+state.lastEventSeq:'');state.eventSource=new EventSource(url);state.eventSource.onmessage=(msg)=>{try{const ev=JSON.parse(msg.data);if(msg.lastEventId)state.lastEventSeq=Number(msg.lastEventId)||state.lastEventSeq;got=true;if(ev.type==='run_complete'){fetchResult(id,ev);state.eventSource.close()}else if(ev.type==='run_not_found_or_complete'){state.eventSource.close();if(retry<3)setTimeout(()=>connectStream(id,retry+1),1500);else pollResult(id)}else addEvent(ev)}catch(e){console.error('SSE:',e)}};state.eventSource.onerror=()=>{state.eventSource.close();if(got&&retry<5)setTimeout(()=>connectStream(id,retry+1),1000);else pollResult(id)}}
async function fetchResult(id,ev){try{const r=await apiFetch(API+'/runs/'+id,{cache:'no-store'});if(r.ok){const d=await r.json();if(d.result?.message){finishAgentMsg(d.result.message,d.result.success!==false);return}}}catch{};finishAgentMsg(ev.message||ev.summary||'Done',ev.success!==false)}
async function pollResult(id,n=0){if(n>120){finishAgentMsg('Timeout',false);return}try{if(n>0&&n%10===0){connectStream(id);return}const r=await apiFetch(API+'/runs/'+id+'/status',{cache:'no-store'});if(r.status===404){setTimeout(()=>pollResult(id,n+1),2000);return}const d=await r.json();if(d.status==='running'||d.status==='pending'){connectStream(id);return}if(d.status==='success'||d.status==='failed'){const fr=await apiFetch(API+'/runs/'+id,{cache:'no-store'});if(fr.ok){const f=await fr.json();if(f.result){finishAgentMsg(f.result.message||'Done',f.result.success!==false);return}}}setTimeout(()=>pollResult(id,n+1),2000)}catch{setTimeout(()=>pollResult(id,n+1),2000)}}
async function cancelRun(){if(!state.runId)return;try{await apiFetch(API+'/runs/'+state.runId+'/cancel',{method:'POST'});toast('Cancel requested')}catch{toast('Cancel failed')}}

// ═══ Live + lightbox + browser controls (#9) ════════════════════
function showLive(url){$('live-image').src=url;$('live-image').classList.remove('hidden');$('live-empty').classList.add('hidden');$('browser-controls').classList.remove('hidden');switchTab('live')}
function clearLive(){$('live-image').classList.add('hidden');$('live-empty').classList.remove('hidden');$('browser-controls').classList.add('hidden')}
function openLightbox(s){$('lightbox-img').src=s;$('lightbox').classList.remove('hidden');$('lightbox').classList.add('flex')}
function closeLightbox(){$('lightbox').classList.add('hidden');$('lightbox').classList.remove('flex')}
window.openLightbox=openLightbox;window.closeLightbox=closeLightbox;
// Browser controls (#9) - send commands via chat
window.browserCmd=function(cmd){
  const url=$('browser-url')?.value||'';
  let goal='';
  if(cmd==='goto'&&url)goal='go to '+url;
  else if(cmd==='back')goal='press browser back button';
  else if(cmd==='forward')goal='press browser forward button';
  else if(cmd==='refresh')goal='refresh the current page';
  else if(cmd==='screenshot')goal='take a screenshot of the current page';
  if(goal){textarea.value=goal;adjustTextarea();sendMessage()}
};

// ═══ Tabs ═══════════════════════════════════════════════════════
document.querySelectorAll('.tab-btn').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
function switchTab(t){document.querySelectorAll('.tab-btn').forEach(b=>{const a=b.dataset.tab===t;b.className='tab-btn flex-1 px-3 py-2 text-xs font-medium border-b-2 '+(a?'border-blue-500 text-gray-900 dark:text-gray-100':'border-transparent text-gray-500 hover:text-gray-900 dark:hover:text-gray-100');b.setAttribute('aria-selected',a)});document.querySelectorAll('.tab-content').forEach(c=>c.classList.add('hidden'));$('tab-'+t)?.classList.remove('hidden')}

// ═══ Artifacts preview (#7) ═════════════════════════════════════
async function loadArtifacts(id){try{const r=await apiFetch(API+'/runs/'+id+'/artifacts');if(!r.ok)return;const d=await r.json();const list=$('artifacts-list');list.textContent='';const arts=d.artifacts||[];if(!arts.length){list.appendChild(el('p',{class:'text-xs text-gray-400 text-center py-8'},'No artifacts'));return}
  arts.forEach(a=>{
    const card=el('div',{class:'border border-gray-200 dark:border-gray-800 rounded-lg p-2 bg-white dark:bg-gray-950 cursor-pointer hover:border-blue-300 transition'});
    card.appendChild(el('div',{class:'text-xs font-medium'},a.type||'file'));
    if(a.path)card.appendChild(el('div',{class:'text-[10px] text-gray-400 truncate mono'},a.path));
    if(a.description)card.appendChild(el('div',{class:'text-xs text-gray-500 mt-1'},a.description));
    // Preview for images
    if(a.type==='screenshot'&&a.path){const img=el('img',{src:a.path,class:'mt-2 rounded max-h-32 cursor-pointer',loading:'lazy'});img.onclick=(e)=>{e.stopPropagation();openLightbox(a.path)};img.onerror=()=>img.remove();card.appendChild(img)}
    // Preview for code/json
    if(a.type==='code'||a.type==='json'){const pre=el('pre',{class:'mt-2 text-[10px] mono bg-gray-50 dark:bg-gray-900 p-2 rounded max-h-24 overflow-hidden'},a.description||'');card.appendChild(pre)}
    card.onclick=()=>{openInspector({type:'artifact',summary:a.description||a.path,payload:a,timestamp:new Date().toISOString()})};
    list.appendChild(card);
  });
  if(arts.length)switchTab('artifacts')}catch{}}

// ═══ Trace (incremental) ════════════════════════════════════════
function appendTrace(ev,i){const b=$('trace-content');if(!b)return;const ph=b.querySelector('p.text-gray-400');if(ph)ph.remove();const s=EVT[ev.type]||{i:'\u25cf',c:'text-gray-500'};const r=el('div',{class:'event-row flex gap-2 items-start py-1 border-b border-gray-100 dark:border-gray-800'});r.appendChild(el('span',{class:'mono w-4 '+s.c},s.i));r.appendChild(el('span',{class:'text-[10px] text-gray-400 w-10'},'#'+(ev.seq??i)));r.appendChild(el('span',{class:'flex-1 break-words'},ev.summary||ev.message||ev.type));r.onclick=()=>openInspector(ev);b.appendChild(r)}
function resetTrace(){const b=$('trace-content');if(b){b.textContent='';b.appendChild(el('p',{class:'text-xs text-gray-400 text-center py-8'},'Run trace will appear here'))}}

// ═══ Conversations (search + delete + drag-sort #13) ════════════
async function loadConvoList(){
  const list=$('convo-list');list.textContent='';
  for(let i=0;i<2;i++)list.appendChild(el('div',{class:'skeleton rounded-lg h-8 mb-1'}));
  try{const d=await(await apiFetch(API+'/conversations')).json();state.allConvos=d.conversations||[];renderConvoList(state.allConvos)}
  catch{list.textContent='';list.appendChild(el('p',{class:'text-xs text-red-500 px-3 py-2'},'Failed'))}
}
function renderConvoList(convos){
  const list=$('convo-list');list.textContent='';
  if(!convos.length){list.appendChild(el('p',{class:'text-xs text-gray-400 px-3 py-2'},'No conversations'));return}
  convos.forEach((c,idx)=>{
    const row=el('div',{class:'flex items-center group','draggable':'true','data-idx':String(idx)});
    // Drag handle (#13)
    const handle=el('span',{class:'drag-handle text-gray-400 px-1 text-xs'},'\u2261');
    row.appendChild(handle);
    const btn=el('button',{class:'flex-1 text-left px-2 py-2 text-sm rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800 truncate '+(c.id===state.convoId?'bg-gray-200 dark:bg-gray-800 font-medium':'')},String(c.summary||c.id||'Untitled').slice(0,28));
    btn.onclick=()=>loadConvo(c.id);
    const del=el('button',{class:'hidden group-hover:block px-1.5 py-1 text-gray-400 hover:text-red-500 text-xs flex-shrink-0',title:'Delete'},'\u00d7');
    del.onclick=(e)=>{e.stopPropagation();if(confirm('Delete?'))deleteConvo(c.id)};
    row.appendChild(btn);row.appendChild(del);
    // Drag events
    row.ondragstart=(e)=>{e.dataTransfer.setData('text/plain',String(idx));row.style.opacity='0.5'};
    row.ondragend=()=>{row.style.opacity='1'};
    row.ondragover=(e)=>{e.preventDefault();row.classList.add('drag-over')};
    row.ondragleave=()=>row.classList.remove('drag-over');
    row.ondrop=(e)=>{e.preventDefault();row.classList.remove('drag-over');const from=Number(e.dataTransfer.getData('text/plain'));const to=idx;if(from!==to){const item=state.allConvos.splice(from,1)[0];state.allConvos.splice(to,0,item);renderConvoList(state.allConvos)}};
    list.appendChild(row);
  });
}
async function deleteConvo(id){try{await apiFetch(API+'/conversations/'+id,{method:'DELETE'});if(state.convoId===id)newChat();toast('Deleted');loadConvoList()}catch{toast('Failed')}}
$('convo-search').oninput=(e)=>{const q=e.target.value.toLowerCase().trim();renderConvoList(q?state.allConvos.filter(c=>((c.summary||c.id||'')).toLowerCase().includes(q)):state.allConvos)};

async function loadConvo(id){
  try{const d=await(await apiFetch(API+'/conversations/'+id)).json();state.convoId=id;$('messages').textContent='';$('empty-chat').classList.add('hidden');
  const turns=d.turns||[];if(turns.length)$('chat-title').textContent=(turns[0].goal||'').slice(0,40);
  for(const t of turns){addUserMsg(t.goal||'');const w=el('div',{class:'msg-in flex gap-3'});w.appendChild(mkAvatar());const c=el('div',{class:'flex-1 min-w-0'});const m=el('div',{class:'prose-msg text-sm'});renderMd(m,t.summary||'');c.appendChild(m);
    const meta=el('div',{class:'msg-actions flex gap-1 mt-1'});meta.appendChild(el('span',{class:'msg-time text-gray-400'},fmtTime(t.startedAt||t.timestamp)));
    const ib=el('button',{class:'text-gray-400 hover:text-blue-600 text-[10px]'},'\u2197 inspect');ib.onclick=()=>openRunInspector(t.runId);meta.appendChild(ib);
    c.appendChild(meta);w.appendChild(c);$('messages').appendChild(w)}
  loadConvoList();scrollChat()}catch{toast('Load failed')}
}

// Conversation persistence on reload (#1)
function restoreLastConvo(){
  const lastId=localStorage.getItem('lastConvoId');
  if(lastId){state.convoId=lastId;loadConvo(lastId)}
}

// Fork conversation (#6)
async function forkConversation(msgEl){
  if(!state.convoId)return;
  const msgs=[...$('messages').children];const idx=msgs.indexOf(msgEl);
  const turnIdx=Math.floor(idx/2); // rough: user+agent = 1 turn
  try{
    const r=await apiFetch(API+'/conversations/'+state.convoId+'/fork',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fromTurnIndex:turnIdx})});
    if(r.ok){const d=await r.json();toast('Forked! Loading new branch...');loadConvo(d.id||d.newId)}else toast('Fork failed')
  }catch{toast('Fork failed')}
}

// ═══ Run inspector ══════════════════════════════════════════════
async function openRunInspector(id){if(!id)return;try{const[rr,cr]=await Promise.all([apiFetch(API+'/runs/'+id).then(r=>r.json()).catch(()=>null),apiFetch(API+'/runs/'+id+'/cognition').then(r=>r.ok?r.json():null).catch(()=>null)]);$('drawer-title').textContent='Run '+id.slice(0,25);const b=$('drawer-body');b.textContent='';if(rr){b.appendChild(el('div',{class:'mb-3 text-xs'},(rr.result?.success?'\u2713':'\u2717')+' '+(rr.tasks?.length??0)+' tasks \u00b7 '+(rr.plannerUsed||'?')));if(rr.result?.message)b.appendChild(el('pre',{class:'mono whitespace-pre-wrap break-words bg-gray-50 dark:bg-gray-900 p-2 rounded mb-3 text-xs'},rr.result.message));if(rr.tasks?.length){b.appendChild(el('div',{class:'text-[10px] uppercase text-gray-400 font-medium mb-1'},'Tasks'));rr.tasks.forEach(t=>{const r=el('div',{class:'flex gap-2 text-xs py-1 border-b border-gray-100 dark:border-gray-800'});r.appendChild(el('span',{},t.status==='done'?'\u2713':t.status==='failed'?'\u2717':'\u25cb'));r.appendChild(el('span',{class:'mono flex-1'},t.type+(t.error?' \u2014 '+t.error.slice(0,60):'')));b.appendChild(r)})}}if(cr?.hypotheses?.length){b.appendChild(el('div',{class:'text-[10px] uppercase text-gray-400 font-medium mt-3 mb-1'},'Hypotheses'));cr.hypotheses.forEach(h=>b.appendChild(el('div',{class:'text-xs py-1'},h.kind+' \u00b7 '+(h.confidence||0).toFixed(2))))}$('drawer').classList.add('open');$('drawer-backdrop').classList.remove('hidden')}catch{toast('Load failed')}}

// ═══ Modals ═════════════════════════════════════════════════════
function openModal(id){$(id).classList.remove('hidden');$(id).classList.add('flex')}
function closeModal(id){$(id).classList.add('hidden');$(id).classList.remove('flex')}
window.closeModal=closeModal;

// ═══ Dashboard (with usage #4e) ═════════════════════════════════
async function openDashboard(){openModal('dashboard-modal');const b=$('dashboard-body');b.textContent='';for(let i=0;i<3;i++)b.appendChild(el('div',{class:'skeleton rounded-lg h-16 mb-3'}));try{const[qR,runsR,hR,uR]=await Promise.all([apiFetch(API+'/queue/stats').then(r=>r.json()).catch(()=>null),apiFetch(API+'/runs?limit=20').then(r=>r.json()).catch(()=>null),fetch('/health').then(r=>r.json()).catch(()=>null),state.jwtToken?apiFetch(API+'/billing/usage').then(r=>r.ok?r.json():null).catch(()=>null):null]);b.textContent='';const sec=(t,c)=>{const d=el('div',{class:'mb-4'});d.appendChild(el('div',{class:'text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2'},t));d.appendChild(c);b.appendChild(d)};if(hR){const g=el('div',{class:'grid grid-cols-3 gap-2'});g.appendChild(mc('Status',hR.status,hR.status==='ok'?'text-green-600':'text-red-600'));g.appendChild(mc('Heap',(hR.memoryMB?.heapUsed??0)+'MB'));g.appendChild(mc('Uptime',fmtUp(hR.uptimeMs||0)));sec('Health',g)}if(uR){const g=el('div',{class:'grid grid-cols-3 gap-2'});g.appendChild(mc('Runs',uR.runs+'/'+uR.limitRuns));g.appendChild(mc('Tokens',uR.tokens+'/'+uR.limitTokens));g.appendChild(mc('Plan',uR.plan||'free'));sec('Usage',g)}if(qR){const g=el('div',{class:'grid grid-cols-3 gap-2'});g.appendChild(mc('Pending',qR.pending));g.appendChild(mc('Running',qR.running));g.appendChild(mc('Workers',qR.concurrency));sec('Queue',g)}if(runsR?.runs){const l=el('div',{});const runs=runsR.runs;const succ=runs.filter(r=>r.status==='success').length;l.appendChild(el('div',{class:'text-xs text-gray-500 mb-2'},runs.length+' recent \u00b7 '+succ+' success \u00b7 '+(runs.length?(succ*100/runs.length).toFixed(0):0)+'%'));runs.slice(0,8).forEach(r=>{const row=el('div',{class:'flex gap-2 items-center text-xs py-1 border-b border-gray-100 dark:border-gray-800'});row.appendChild(el('span',{},r.status==='success'?'\u2713':r.status==='failed'?'\u2717':'\u25cb'));row.appendChild(el('span',{class:'flex-1 truncate'},r.goal||''));row.appendChild(el('span',{class:'text-gray-400'},(r.taskCount||0)+'t'));l.appendChild(row)});sec('Runs',l)}}catch(e){b.textContent='Error: '+e.message}}
function mc(l,v,c){const d=el('div',{class:'border border-gray-200 dark:border-gray-800 rounded-lg p-2'});d.appendChild(el('div',{class:'text-[10px] text-gray-500 uppercase'},l));d.appendChild(el('div',{class:'text-lg font-semibold '+(c||'')},String(v)));return d}
function fmtUp(ms){const s=Math.floor(ms/1000);if(s<60)return s+'s';if(s<3600)return Math.floor(s/60)+'m';return Math.floor(s/3600)+'h'}

// ═══ Export ═════════════════════════════════════════════════════
function exportConvo(){const msgs=$('messages').querySelectorAll('.msg-in');let md='# Conversation\n\n';msgs.forEach(m=>{const isU=m.classList.contains('justify-end');const t=m.querySelector('.prose-msg')?.textContent||m.querySelector('[data-text]')?.dataset?.text||'';md+=(isU?'**You:**\n\n':'**'+state.settings.agentName+':**\n\n')+t+'\n\n---\n\n'});const a=el('a',{href:URL.createObjectURL(new Blob([md],{type:'text/markdown'})),download:'chat-'+Date.now()+'.md'});a.click();URL.revokeObjectURL(a.href);toast('Exported')}

// ═══ New chat ═══════════════════════════════════════════════════
function newChat(){if(state.eventSource)state.eventSource.close();state.convoId=null;state.runId=null;state.events=[];state.sending=false;setSending(false);$('messages').textContent='';$('empty-chat').classList.remove('hidden');$('chat-title').textContent='New chat';hideStageBar();textarea.value='';textarea.readOnly=false;textarea.focus();clearLive();setCancelBtn(false);resetTrace();localStorage.removeItem('lastConvoId');loadConvoList()}

// ═══ Sidebar/panel toggle ═══════════════════════════════════════
function toggleSidebar(){if(window.innerWidth<1024){$('sidebar').classList.toggle('open')}else{state.settings.sidebarOpen=!state.settings.sidebarOpen;saveSettings();applySidebar()}}
function toggleRightPanel(){if(window.innerWidth<1024){$('right-panel').classList.toggle('open')}else{state.settings.panelOpen=!state.settings.panelOpen;saveSettings();applyPanel()}}
function applySidebar(){const s=$('sidebar');s.classList.toggle('collapsed',!state.settings.sidebarOpen);$('sidebar-icon').style.opacity=state.settings.sidebarOpen?'1':'0.5'}
function applyPanel(){const p=$('right-panel'),h=$('resize-handle');p.classList.toggle('collapsed',!state.settings.panelOpen);if(!state.settings.panelOpen){if(h)h.classList.add('panel-hidden')}else{p.classList.remove('hidden');p.classList.add('lg:flex');p.style.width='';if(h)h.classList.remove('panel-hidden')}$('right-icon').style.opacity=state.settings.panelOpen?'1':'0.5'}

// ═══ Resize handle ══════════════════════════════════════════════
(function(){const h=$('resize-handle'),p=$('right-panel');if(!h||!p)return;h.onmousedown=(e)=>{e.preventDefault();const sx=e.clientX,sw=p.offsetWidth;h.classList.add('active');const mv=(e)=>{p.style.width=Math.max(240,Math.min(600,sw+sx-e.clientX))+'px'};const up=()=>{h.classList.remove('active');document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up)};document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up)}})();

// ═══ JWT Auth ═══════════════════════════════════════════════════
function initAuth(){const t=localStorage.getItem('jwtToken');if(t){state.jwtToken=t;try{state.jwtUser=JSON.parse(atob(t.split('.')[1]))}catch{};updateAuthUI()}}
function updateAuthUI(){const info=$('auth-info');if(state.jwtUser){info.classList.remove('hidden');info.textContent='User: '+(state.jwtUser.email||'');$('auth-logged-in').classList.remove('hidden');$('auth-logged-out').classList.add('hidden');$('auth-email').textContent=state.jwtUser.email||''}else{info.classList.add('hidden');$('auth-logged-in').classList.add('hidden');$('auth-logged-out').classList.remove('hidden')}}
async function jwtLogin(email,pw){$('auth-error').classList.add('hidden');try{const r=await fetch(API+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:pw})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Failed');state.jwtToken=d.token;state.jwtUser=d.user;localStorage.setItem('jwtToken',d.token);updateAuthUI();toast('Logged in')}catch(e){$('auth-error').textContent=e.message;$('auth-error').classList.remove('hidden')}}
async function jwtRegister(email,pw){$('auth-error').classList.add('hidden');try{const r=await fetch(API+'/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:pw,name:email.split('@')[0]})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Failed');state.jwtToken=d.token;state.jwtUser=d.user;localStorage.setItem('jwtToken',d.token);updateAuthUI();toast('Registered')}catch(e){$('auth-error').textContent=e.message;$('auth-error').classList.remove('hidden')}}
function jwtLogout(){state.jwtToken=null;state.jwtUser=null;localStorage.removeItem('jwtToken');updateAuthUI();toast('Logged out')}

// ═══ Settings ═══════════════════════════════════════════════════
function openSettings(){$('set-dark').checked=state.settings.dark;$('set-notify').checked=state.settings.notify;$('set-sound').checked=state.settings.sound;$('set-mode').value=state.settings.mode;$('set-agent-name').value=state.settings.agentName||'';$('set-apikey').value=state.settings.apiKey;openModal('settings-modal')}

// ═══ Wiring ═════════════════════════════════════════════════════
$('input-form').onsubmit=(e)=>{e.preventDefault();if(!sendBtn.disabled&&!state.sending)sendMessage()};
$('new-chat').onclick=newChat;
$('cancel-btn').onclick=cancelRun;
$('export-btn').onclick=exportConvo;
$('open-settings').onclick=openSettings;
$('open-dashboard').onclick=openDashboard;
$('theme-toggle').onclick=()=>{state.settings.dark=!state.settings.dark;saveSettings();applyTheme()};
$('lang-toggle').onclick=()=>{state.settings.lang=state.settings.lang==='en'?'zh':'en';saveSettings();applyI18n(state.settings.lang)};
$('sidebar-toggle').onclick=toggleSidebar;
$('right-toggle').onclick=toggleRightPanel;
$('right-close')?.addEventListener('click',()=>{state.settings.panelOpen=false;saveSettings();applyPanel()});
document.querySelectorAll('.suggest-btn').forEach(b=>b.onclick=()=>{textarea.value=b.dataset.prompt;adjustTextarea();textarea.focus()});
$('settings-save-btn').onclick=()=>{state.settings.dark=$('set-dark').checked;state.settings.notify=$('set-notify').checked;state.settings.sound=$('set-sound').checked;state.settings.mode=$('set-mode').value;state.settings.agentName=$('set-agent-name').value||'Agent';state.settings.apiKey=$('set-apikey').value;saveAndToast();applyTheme();if(state.settings.notify&&'Notification'in window&&Notification.permission==='default')Notification.requestPermission();closeModal('settings-modal')};
$('auth-login-btn').onclick=()=>jwtLogin($('auth-email-input').value,$('auth-pass-input').value);
$('auth-register-btn').onclick=()=>jwtRegister($('auth-email-input').value,$('auth-pass-input').value);
$('auth-logout').onclick=jwtLogout;
$('auth-pass-input').onkeydown=(e)=>{if(e.key==='Enter')$('auth-login-btn').click()};
document.addEventListener('click',(e)=>{if(!e.target.closest('#slash-menu')&&e.target!==textarea)$('slash-menu').classList.add('hidden');if(!e.target.closest('#suggest-dropdown')&&e.target!==textarea)$('suggest-dropdown').classList.add('hidden')});

// ═══ Init ═══════════════════════════════════════════════════════
applyTheme();applySidebar();applyPanel();applyI18n(state.settings.lang);initAuth();checkHealth();setInterval(checkHealth,10000);loadConvoList();
// Restore last conversation (#1)
setTimeout(restoreLastConvo,500);
// Save convoId on change for persistence
const _origLoadConvo=loadConvo;
window._saveConvo=()=>{if(state.convoId)localStorage.setItem('lastConvoId',state.convoId)};
setInterval(()=>{if(state.convoId)localStorage.setItem('lastConvoId',state.convoId)},3000);
textarea.focus();
