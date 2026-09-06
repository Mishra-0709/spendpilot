const $ = s => document.querySelector(s);
const app = $("#app");
let state = { user:null, settings:null, dashboard:null, expenses:[], credits:[], page:"dashboard" };
const money = n => "₹" + Number(n||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
const today = () => new Date().toISOString().slice(0,10);
const toast = msg => { const t=$("#toast"); t.textContent=msg; t.classList.add("show"); setTimeout(()=>t.classList.remove("show"),2600); };
async function api(url, opts={}) {
  const r = await fetch(url,{headers:{"Content-Type":"application/json",...(opts.headers||{})},...opts});
  if(!r.ok){let x={};try{x=await r.json()}catch{};throw new Error(x.error||"Request failed");}
  return r;
}
async function json(url,opts){return (await api(url,opts)).json();}
function layout(content){
  return `<div class="shell">
    <aside class="sidebar"><div class="logo">Spend<span>Pilot</span></div><div class="nav">
      ${nav("dashboard","Dashboard")} ${nav("expenses","Expenses")} ${nav("credits","Credits")}
      ${nav("statistics","Statistics")} ${nav("calendar","Calendar")} ${nav("settings","Settings")}
    </div></aside>
    <main class="main"><div class="topbar"><div><h1>${titleFor(state.page)}</h1><div class="muted">${new Date().toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</div></div>
      <div class="actions"><button class="btn" onclick="downloadExcel()">Download Excel</button><div class="avatar">${(state.user.name||"U")[0].toUpperCase()}</div></div></div>${content}</main>
    <div class="mobile-nav">${nav("dashboard","⌂")} ${nav("expenses","₹")} ${nav("statistics","▥")} ${nav("settings","⚙")}</div>
  </div>`;
}
function nav(page,label){return `<button class="${state.page===page?"active":""}" onclick="go('${page}')">${label}</button>`}
function titleFor(p){return ({dashboard:"Financial Dashboard",expenses:"Expense History",credits:"Credits & Income",statistics:"Statistics",calendar:"Spending Calendar",settings:"Settings"})[p]||"Dashboard"}
async function go(page){state.page=page;await loadData();render();}
async function loadData(){
  state.user=await json("/api/auth/me");
  state.dashboard=await json("/api/dashboard");
  state.settings=await json("/api/settings");
  if(state.page==="expenses") state.expenses=await json("/api/expenses");
  if(state.page==="credits") state.credits=await json("/api/credits");
}
function render(){
  if(!state.user){renderLogin();return;}
  let body="";
  if(state.page==="dashboard") body=dashboard();
  if(state.page==="expenses") body=expensesPage();
  if(state.page==="credits") body=creditsPage();
  if(state.page==="statistics") body=statisticsPage();
  if(state.page==="calendar") body=calendarPage();
  if(state.page==="settings") body=settingsPage();
  app.innerHTML=layout(body);
  registerSW();
}
function dashboard(){
 const d=state.dashboard,s=d.settings, pct=s.monthly_expense_limit?Math.min(100,(d.month.expenses/s.monthly_expense_limit)*100):0;
 const change=d.prevMonth.expenses?((d.month.expenses-d.prevMonth.expenses)/d.prevMonth.expenses*100):0;
 return `<div class="grid cards">
 <div class="card"><h3>Current Balance</h3><div class="big">${money(s.current_balance)}</div></div>
 <div class="card"><h3>Monthly Credits</h3><div class="big green">${money(d.month.credits)}</div></div>
 <div class="card"><h3>Monthly Debits</h3><div class="big">${money(d.month.expenses)}</div></div>
 <div class="card"><h3>Expense Limit</h3><div class="big">${money(s.monthly_expense_limit)}</div></div>
 <div class="card"><h3>Remaining Limit</h3><div class="big ${d.remaining<0?"red":"green"}">${money(d.remaining)}</div></div></div>
 <div class="grid two" style="margin-top:16px">
  <div class="card"><div style="display:flex;justify-content:space-between"><div><h3>Monthly Budget</h3><div class="big">${money(d.month.expenses)} / ${money(s.monthly_expense_limit)}</div></div><div class="${d.limitCrossed?"red":"green"}" style="font-weight:800">${Math.round(pct)}%</div></div>
  <div class="progress"><div class="bar" style="width:${pct}%"></div></div>
  <div class="muted">${d.limitCrossed?`Limit exceeded by ${money(Math.abs(d.remaining))}`:`You can spend ${money(d.remaining)} more this month.`}</div>
  <div class="muted" style="margin-top:8px">Recommended daily spending: <b>${money(d.dailyRecommended)}</b> · ${d.daysLeft} day(s) remaining</div></div>
  <div class="card"><h3>Today's Expense</h3><div class="big">${money(d.today.expenses)}</div><div class="muted" style="margin:8px 0 15px">${d.today.count?`✓ ${d.today.count} transaction(s) recorded`:"⚠ Today's expenses have not been entered."}</div><button class="btn primary" onclick="openExpense()">+ Add Expense</button></div>
 </div>
 <div class="grid two" style="margin-top:16px">
  <div class="card"><h3>This Week</h3><div class="big">${money(d.week.expenses)}</div><div class="muted">${d.prevWeek.expenses?`${((d.week.expenses-d.prevWeek.expenses)/d.prevWeek.expenses*100).toFixed(1)}% vs last week`:"No previous-week data"}</div><div id="miniWeek" class="chart"></div></div>
  <div class="card"><h3>Category Breakdown</h3>${categoryBars(d.category)}</div>
 </div>
 <div class="card" style="margin-top:16px"><div style="display:flex;justify-content:space-between;align-items:center"><h3>Recent Transactions</h3><button class="btn" onclick="go('expenses')">View all</button></div>${transactionTable(d.recent)}</div>`;
}
function categoryBars(rows){if(!rows.length)return `<div class="muted">No expenses this month.</div>`;const max=Math.max(...rows.map(x=>x.total));return rows.slice(0,6).map(x=>`<div style="margin:12px 0"><div style="display:flex;justify-content:space-between;font-size:13px"><span>${x.category}</span><b>${money(x.total)}</b></div><div class="progress"><div class="bar" style="width:${Math.max(4,x.total/max*100)}%"></div></div></div>`).join("")}
function transactionTable(rows){if(!rows.length)return `<div class="muted" style="padding:20px 0">No transactions yet.</div>`;return `<div class="tablewrap"><table class="table"><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Payment</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${x.expense_date}</td><td>${x.category}</td><td>${x.description||"—"}</td><td class="red">-${money(x.amount)}</td><td>${x.payment_method}</td></tr>`).join("")}</tbody></table></div>`}
function expensesPage(){return `<div class="card"><div class="actions" style="justify-content:space-between"><div class="muted">All your expense records are stored securely in the database.</div><button class="btn primary" onclick="openExpense()">+ Add Expense</button></div><div class="tablewrap" style="margin-top:16px"><table class="table"><thead><tr><th>Date</th><th>Time</th><th>Category</th><th>Description</th><th>Amount</th><th>Payment</th><th></th></tr></thead><tbody>${state.expenses.map(x=>`<tr><td>${x.expense_date}</td><td>${String(x.expense_time||"").slice(0,5)}</td><td>${x.category}</td><td>${x.description||"—"}</td><td class="red">${money(x.amount)}</td><td>${x.payment_method}</td><td><button class="btn" onclick='editExpense(${JSON.stringify(x)})'>Edit</button> <button class="btn danger" onclick="deleteExpense(${x.id})">Delete</button></td></tr>`).join("")}</tbody></table></div></div>`}
function creditsPage(){return `<div class="grid two"><div class="card"><h3>Add Credit</h3><form onsubmit="saveCredit(event)" class="formgrid"><div class="field"><label>Date</label><input name="date" type="date" value="${today()}" required></div><div class="field"><label>Amount</label><input name="amount" type="number" step="0.01" min="0.01" required></div><div class="field"><label>Source</label><input name="source" placeholder="Salary, refund..." required></div><div class="field"><label>Description</label><input name="description"></div><button class="btn primary" type="submit">Save Credit</button></form></div><div class="card"><h3>Credit History</h3><div class="tablewrap"><table class="table"><thead><tr><th>Date</th><th>Source</th><th>Amount</th><th></th></tr></thead><tbody>${state.credits.map(x=>`<tr><td>${x.credit_date}</td><td>${x.source}</td><td class="green">${money(x.amount)}</td><td><button class="btn danger" onclick="deleteCredit(${x.id})">Delete</button></td></tr>`).join("")}</tbody></table></div></div></div>`}
async function statisticsPage(){setTimeout(async()=>{const [w,m]=await Promise.all([json("/api/statistics/weekly"),json("/api/statistics/monthly")]);const wc=$("#weekChart"),mc=$("#monthChart");if(wc)wc.innerHTML=bars(w.map(x=>({label:new Date(x.date).toLocaleDateString("en-IN",{weekday:"short"}),value:x.total})));if(mc)mc.innerHTML=bars(m.map(x=>({label:x.month,value:x.expenses})));},0);return `<div class="grid two"><div class="card"><h3>Weekly Spending</h3><div id="weekChart" class="chart"></div></div><div class="card"><h3>6-Month Expense Trend</h3><div id="monthChart" class="chart"></div></div></div><div class="card" style="margin-top:16px"><h3>Insights</h3><div class="grid three"><div><div class="muted">This month</div><div class="big">${money(state.dashboard.month.expenses)}</div></div><div><div class="muted">Average per day</div><div class="big">${money(state.dashboard.month.expenses/new Date().getDate())}</div></div><div><div class="muted">Top category</div><div class="big">${state.dashboard.category[0]?.category||"—"}</div></div></div></div>`}
function bars(rows){const max=Math.max(1,...rows.map(x=>x.value));return rows.map(x=>`<div class="col"><div class="muted">${money(x.value)}</div><div class="barcol" style="height:${Math.max(5,x.value/max*175)}px"></div><div class="label">${x.label}</div></div>`).join("")}
function calendarPage(){const y=new Date().getFullYear(),m=new Date().getMonth();const days=new Date(y,m+1,0).getDate();const map={};state.dashboard.recent.forEach(x=>map[x.expense_date]=(map[x.expense_date]||0)+Number(x.amount));let cells="";for(let i=1;i<=days;i++){const ds=`${y}-${String(m+1).padStart(2,"0")}-${String(i).padStart(2,"0")}`;cells+=`<div class="card" style="padding:12px;min-height:82px"><b>${i}</b><div class="${map[ds]?"red":"muted"}" style="margin-top:12px">${map[ds]?money(map[ds]):"—"}</div></div>`}return `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(120px,1fr))">${cells}</div>`}
function settingsPage(){const s=state.settings;return `<div class="grid two"><div class="card"><h3>Financial Settings</h3><form onsubmit="saveSettings(event)" class="formgrid">
<div class="field"><label>Current Balance</label><input name="current_balance" type="number" step="0.01" value="${s.current_balance}"></div>
<div class="field"><label>Monthly Credit Target</label><input name="monthly_credit_target" type="number" step="0.01" value="${s.monthly_credit_target}"></div>
<div class="field"><label>Monthly Expense Limit</label><input name="monthly_expense_limit" type="number" step="0.01" value="${s.monthly_expense_limit}"></div>
<div class="field"><label>Savings Target</label><input name="savings_target" type="number" step="0.01" value="${s.savings_target}"></div>
<div class="field"><label>Reminder Time</label><input name="reminder_time" type="time" value="${s.reminder_time}"></div>
<div class="field"><label>Theme</label><select name="theme"><option value="dark" ${s.theme==="dark"?"selected":""}>Dark</option><option value="light" ${s.theme==="light"?"selected":""}>Light</option></select></div>
<label><input name="reminder_enabled" type="checkbox" ${s.reminder_enabled?"checked":""}> Daily reminder</label>
<label><input name="sound_enabled" type="checkbox" ${s.sound_enabled?"checked":""}> Warning sound</label>
<label><input name="browser_notifications" type="checkbox" ${s.browser_notifications?"checked":""}> Browser notifications</label>
<div><button class="btn primary" type="submit">Save Settings</button></div></form></div>
<div class="card"><h3>Account & Security</h3><p class="muted">${state.user.name}<br>${state.user.email}</p><form onsubmit="changePassword(event)"><div class="field"><label>Current password</label><input name="current" type="password" required></div><div class="field" style="margin-top:10px"><label>New password</label><input name="new" type="password" minlength="10" required></div><button class="btn" style="margin-top:12px">Change password</button></form><hr style="border-color:var(--line);margin:24px 0"><button class="btn" onclick="requestNotifications()">Enable browser notifications</button> <button class="btn danger" onclick="logout()">Logout</button></div></div>`}
function renderLogin(){app.innerHTML=`<div class="login"><div class="loginbox"><div class="logo">Spend<span>Pilot</span></div><h1>Welcome back</h1><div class="muted">Your private personal finance dashboard.</div><form onsubmit="login(event)" style="margin-top:22px"><div class="field"><label>Email</label><input name="email" type="email" required autocomplete="username"></div><div class="field" style="margin-top:12px"><label>Password</label><input name="password" type="password" required autocomplete="current-password"></div><button class="btn primary" style="width:100%;margin-top:16px">Sign in</button></form><div id="setupLink" class="muted" style="margin-top:18px"></div></div></div>`;json("/api/setup/status").then(x=>{if(x.needsSetup)$("#setupLink").innerHTML=`No account exists. <button class="btn" onclick="setup()">Create your account</button>`})}
async function setup(){app.innerHTML=`<div class="login"><div class="loginbox"><div class="logo">Spend<span>Pilot</span></div><h1>First-time setup</h1><div class="setup-note">Create your account and set your starting financial values.</div><form onsubmit="doSetup(event)"><div class="formgrid"><div class="field"><label>Name</label><input name="name" required></div><div class="field"><label>Email</label><input name="email" type="email" required></div><div class="field"><label>Password (10+ characters)</label><input name="password" type="password" minlength="10" required></div><div class="field"><label>Current Balance</label><input name="currentBalance" type="number" step="0.01" value="0"></div><div class="field"><label>Monthly Credit Target</label><input name="monthlyCreditTarget" type="number" step="0.01" value="0"></div><div class="field"><label>Monthly Expense Limit</label><input name="monthlyExpenseLimit" type="number" step="0.01" value="30000"></div><div class="field"><label>Savings Target</label><input name="savingsTarget" type="number" step="0.01" value="0"></div></div><button class="btn primary" style="margin-top:16px;width:100%">Create account</button></form></div></div>`}
async function login(e){e.preventDefault();try{const f=new FormData(e.target);await json("/api/auth/login",{method:"POST",body:JSON.stringify({email:f.get("email"),password:f.get("password")})});state.page="dashboard";await loadData();render();}catch(x){toast(x.message)}}
async function doSetup(e){e.preventDefault();try{const f=new FormData(e.target);await json("/api/setup",{method:"POST",body:JSON.stringify(Object.fromEntries(f))});await loadData();render();}catch(x){toast(x.message)}}
function openExpense(data={}){const m=document.createElement("div");m.className="modal";m.innerHTML=`<div class="modalbox"><h2>${data.id?"Edit":"Add"} Expense</h2><form onsubmit="saveExpense(event,${data.id||0})" class="formgrid"><div class="field"><label>Date</label><input name="date" type="date" value="${data.expense_date||today()}" required></div><div class="field"><label>Time</label><input name="time" type="time" value="${String(data.expense_time||new Date().toTimeString().slice(0,5)).slice(0,5)}"></div><div class="field"><label>Amount</label><input name="amount" type="number" step="0.01" min="0.01" value="${data.amount||""}" required></div><div class="field"><label>Category</label><select name="category">${["Food","Travel","Shopping","Bills","Rent","Entertainment","Healthcare","Education","Groceries","Subscriptions","Personal","Other"].map(x=>`<option ${data.category===x?"selected":""}>${x}</option>`).join("")}</select></div><div class="field"><label>Description</label><input name="description" value="${data.description||""}"></div><div class="field"><label>Payment Method</label><select name="paymentMethod">${["UPI","Cash","Credit Card","Debit Card","Bank Transfer","Other"].map(x=>`<option ${data.payment_method===x?"selected":""}>${x}</option>`).join("")}</select></div><div class="field" style="grid-column:1/-1"><label>Notes</label><textarea name="notes">${data.notes||""}</textarea></div><div class="actions"><button type="button" class="btn" onclick="this.closest('.modal').remove()">Cancel</button><button class="btn primary">Save Expense</button></div></form></div>`;document.body.appendChild(m)}
window.openExpense=openExpense; window.editExpense=openExpense;
async function saveExpense(e,id){e.preventDefault();try{const f=new FormData(e.target);const body=JSON.stringify(Object.fromEntries(f));await json(id?`/api/expenses/${id}`:"/api/expenses",{method:id?"PUT":"POST",body});e.target.closest(".modal").remove();await loadData();render();toast("Expense saved");if(state.dashboard.limitCrossed && state.settings.sound_enabled) showWarning();}catch(x){toast(x.message)}}
async function deleteExpense(id){if(!confirm("Delete this expense?"))return;try{await api(`/api/expenses/${id}`,{method:"DELETE"});await loadData();render();toast("Expense deleted")}catch(x){toast(x.message)}}
async function saveCredit(e){e.preventDefault();try{const f=new FormData(e.target);await json("/api/credits",{method:"POST",body:JSON.stringify(Object.fromEntries(f))});await loadData();render();toast("Credit saved")}catch(x){toast(x.message)}}
async function deleteCredit(id){if(!confirm("Delete this credit?"))return;try{await api(`/api/credits/${id}`,{method:"DELETE"});await loadData();render();toast("Credit deleted")}catch(x){toast(x.message)}}
async function saveSettings(e){e.preventDefault();try{const f=new FormData(e.target);const x=Object.fromEntries(f);x.reminder_enabled=f.has("reminder_enabled");x.sound_enabled=f.has("sound_enabled");x.browser_notifications=f.has("browser_notifications");await json("/api/settings",{method:"PUT",body:JSON.stringify(x)});await loadData();render();toast("Settings saved")}catch(x){toast(x.message)}}
async function changePassword(e){e.preventDefault();const f=new FormData(e.target);try{await json("/api/change-password",{method:"POST",body:JSON.stringify({currentPassword:f.get("current"),newPassword:f.get("new")})});e.target.reset();toast("Password changed")}catch(x){toast(x.message)}}
async function logout(){await json("/api/auth/logout",{method:"POST"});state.user=null;render()}
async function downloadExcel(){const r=await fetch("/api/export.xlsx");if(!r.ok)return toast("Export failed");const b=await r.blob();const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=`expense-tracker-${today()}.xlsx`;a.click();URL.revokeObjectURL(a.href)}
async function requestNotifications(){if(!("Notification"in window))return toast("Browser notifications are not supported.");const p=await Notification.requestPermission();toast(p==="granted"?"Notifications enabled":"Notifications not enabled")}
function beep(){try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;const c=new C(),o=c.createOscillator(),g=c.createGain();o.frequency.value=880;o.type="sine";g.gain.value=.08;o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+.35)}catch{}}
function showWarning(){const m=document.createElement("div");m.className="modal";m.innerHTML=`<div class="modalbox warning"><h2>⚠ Expense limit exceeded</h2><p>Your monthly expense limit has been crossed.</p><p><b>Spent:</b> ${money(state.dashboard.month.expenses)}<br><b>Limit:</b> ${money(state.settings.monthly_expense_limit)}<br><b>Exceeded by:</b> ${money(Math.abs(state.dashboard.remaining))}</p><button class="btn danger" onclick="this.closest('.modal').remove()">Dismiss</button></div>`;document.body.appendChild(m);if(state.settings.sound_enabled)beep()}
function reminderCheck(){if(!state.settings?.reminder_enabled)return;const now=new Date(), hm=now.toTimeString().slice(0,5), key=`reminded-${today()}`;if(hm===state.settings.reminder_time && localStorage.getItem(key)!=="1"){localStorage.setItem(key,"1");toast("Don't forget to enter today's expenses.");if(Notification.permission==="granted")new Notification("SpendPilot reminder",{body:"Don't forget to enter today's expenses."});}}
async function registerSW(){if("serviceWorker"in navigator)navigator.serviceWorker.register("/sw.js").catch(()=>{});setInterval(reminderCheck,30000)}
setInterval(()=>{if(state.user)fetch("/api/presence",{method:"POST",headers:{"Content-Type":"application/json"}}).catch(()=>{})},60000);
async function boot(){try{await loadData();render();}catch{renderLogin()}}
boot();
window.go=go;window.login=login;window.setup=setup;window.doSetup=doSetup;window.saveExpense=saveExpense;window.deleteExpense=deleteExpense;window.saveCredit=saveCredit;window.deleteCredit=deleteCredit;window.saveSettings=saveSettings;window.changePassword=changePassword;window.logout=logout;window.downloadExcel=downloadExcel;window.requestNotifications=requestNotifications;
