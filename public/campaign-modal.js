function _addCMStyles(){var s=document.createElement('style');s.id='cm-modal-styles';if(document.getElementById('cm-modal-styles')) return;s.innerHTML=['.list-banner{display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:10px;margin-bottom:16px;border:1px solid #e5e5e5;background:#fafafa}','.list-banner-attached{background:#f0fdf8;border-color:#bbf0dd}','.list-banner-empty{background:#fffbf0;border-color:#fde68a}','.list-banner-icon{font-size:22px;flex-shrink:0}','.list-banner-text{flex:1}','.list-banner-label{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px}','.list-banner-name{font-size:14px;font-weight:600;color:#1a1a1a}','.list-banner-sub{font-size:13px;color:#888;margin-top:2px}','.list-change-btn{flex-shrink:0;padding:7px 14px;border-radius:7px;border:1px solid #d1d5db;background:white;font-size:13px;font-weight:500;cursor:pointer;color:#374151}','.list-change-btn.primary{background:#1D9E75;color:white;border-color:#1D9E75}','.list-picker-title{font-size:13px;font-weight:600;color:#374151;margin-bottom:10px}','.list-picker-grid{display:flex;flex-wrap:wrap;gap:10px}','.list-picker-card{display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:8px;border:1px solid #e5e5e5;background:white;cursor:pointer;min-width:200px}','.list-picker-card:hover,.list-picker-card.selected{border-color:#1D9E75;background:#f0fdf8}','.lpc-icon{font-size:18px}.lpc-info{flex:1}.lpc-name{font-size:13px;font-weight:500;color:#1a1a1a}.lpc-count{font-size:12px;color:#888}.lpc-check{color:#1D9E75;font-weight:700;font-size:16px}'].join('');document.head.appendChild(s);}


// Campaign Edit Modal ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ loaded by campaigns.html
// ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
// CAMPAIGN EDIT MODAL
// ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ

// State vars declared as globals in campaigns.html (var cmId, cmData, etc.)
// Initialized here:
cmId = null; cmData = null; cmTab = null; cmLoaded = {}; cmSettings = null; cmCtPage = 1;
msgEditCanvas = null;
CKEY.new = 'new'; CKEY.existingNo = 'existing_no_history'; CKEY.existingYes = 'existing_with_history';

async function openCampaignModal(id) { _addCMStyles();
  cmId = id; cmData = null; cmLoaded = {}; cmSettings = null; cmCtPage = 1;
  document.getElementById('cm-name').textContent = 'Loading...';
  document.getElementById('cm-meta').textContent = '';
  document.getElementById('cm-st-btn').textContent = '';
  document.getElementById('cm-back').style.display = 'flex';
  ['analytics','enrollments','companies','audience','settings'].forEach(t => document.getElementById('cmb-'+t).innerHTML = '');
  try {
    const d = await fetch('/api/campaigns/'+id+'?workspace_id='+workspaceId).then(r=>r.json());
    if (d.error) throw new Error(d.error);
    cmData = d;
    // Prefetch ab-analytics to get sequence_name and enriched_count for overview
    fetch('/api/campaigns/'+id+'/ab-analytics?workspace_id='+workspaceId)
      .then(r=>r.json()).then(an => { if(an.sequence_name) cmData.sequence_name=an.sequence_name; })
      .catch(()=>{});
    const s = typeof d.settings==='string' ? JSON.parse(d.settings) : (d.settings||{});
    cmSettings = JSON.parse(JSON.stringify(s));
    document.getElementById('cm-name').textContent = d.name;
    document.getElementById('cm-meta').textContent =
      (d.audience_type==='company'?'Company targeting':'People targeting') +
      ' \u00b7 ' + (d.account_id||'\u2014') +
      ' \u00b7 ' + (parseInt(d.contact_count)||0) + ' contacts';
    const sb = document.getElementById('cm-st-btn');
    sb.textContent = d.status==='active' ? '\u23f8 Pause' : '\u25b6 Resume';
    sb.style.color  = d.status==='active' ? '#DC2626' : '#1D9E75';
  } catch(e) { document.getElementById('cm-name').textContent='Error: '+e.message; }
  switchCMTab('analytics');
}

function closeCM() {
  document.getElementById('cm-back').style.display = 'none';
  cmId = cmData = null;
}

async function switchCMTab(tab) {
  cmTab = tab;
  document.querySelectorAll('.cm-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  document.querySelectorAll('.cm-body').forEach(el=>el.style.display=el.id==='cmb-'+tab?'block':'none');
  document.getElementById('cm-foot').style.display = tab==='settings'?'flex':'none';
  if (!cmLoaded[tab]) { cmLoaded[tab]=true; await loadCMTab(tab); }
}

async function loadCMTab(tab) {
  const el = document.getElementById('cmb-'+tab);
  el.innerHTML = '<div class="tab-spin">Loading...</div>';
  try {
    if (tab==='analytics') {
      const d = await fetch('/api/campaigns/'+cmId+'/ab-analytics?workspace_id='+workspaceId).then(r=>r.json());
      el.innerHTML = buildAnalyticsHTML(d);
    } else if (tab==='enrollments') {
      await loadCMEnrollments(el);
    } else if (tab==='companies') {
      const d = await fetch('/api/campaigns/'+cmId+'/companies?workspace_id='+workspaceId).then(r=>r.json());
      el.innerHTML = buildCompaniesHTML(d.items||[]);
    } else if (tab==='audience') {
      await loadCMAudience();
    } else if (tab==='settings') {
      el.innerHTML = buildSettingsHTML();
    }
  } catch(e) { el.innerHTML = '<div class="tab-err">Error: '+esc(e.message)+'</div>'; }
}

// ── Enrollments tab ───────────────────────────────────────────────────────────
let _enrollPage = 1, _enrollStatus = '';

async function loadCMEnrollments(el, page, status) {
  if (!el) el = document.getElementById('cmb-enrollments');
  if (page !== undefined) _enrollPage = page;
  if (status !== undefined) _enrollStatus = status;

  const limit = 50;
  let url = `/api/campaigns/${cmId}/enrollments?workspace_id=${workspaceId}&limit=${limit}&page=${_enrollPage}`;
  if (_enrollStatus) url += `&status=${_enrollStatus}`;

  const [data, stats] = await Promise.all([
    fetch(url).then(r=>r.json()),
    fetch(`/api/admin/enrollment-stats?workspace_id=${workspaceId}`).then(r=>r.json()),
  ]);

  const campStats = (stats.by_campaign||[]).find(c=>c.name===cmData?.name)||{};
  const byStatus = campStats.statuses || {};
  const totalEnrolled = Object.values(byStatus).reduce((s,c)=>s+c,0);

  const STATUS_COLORS = {
    pending:'#94a3b8', invite_sent:'#34d399', approved:'#60a5fa',
    messaged:'#fbbf24', replied:'#a78bfa', positive_reply:'#10b981',
    done:'#475569', withdrawn:'#f87171', error:'#ef4444',
  };

  const statusBar = Object.entries(byStatus).filter(([,n])=>n>0).map(([s,n])=>
    `<button onclick="loadCMEnrollments(null,1,'${s==='all'?'':s}')"
       style="padding:3px 10px;border-radius:10px;font-size:11px;font-weight:600;cursor:pointer;
              background:${STATUS_COLORS[s]||'#94a3b8'}22;color:${STATUS_COLORS[s]||'#94a3b8'};
              border:1px solid ${STATUS_COLORS[s]||'#94a3b8'}44;
              ${_enrollStatus===s?'outline:2px solid '+STATUS_COLORS[s]:''}"
     >${s.replace(/_/g,' ')} <b>${n}</b></button>`
  ).join('');

  const items = data.items || [];
  const rows = items.map(e => {
    const name = [e.first_name,e.last_name].filter(Boolean).join(' ') || '—';
    const link = e.li_profile_url ? `<a href="${e.li_profile_url}" target="_blank" style="color:#1D9E75;text-decoration:none">↗</a>` : '';
    const next = e.next_action_at ? (() => {
      const ms = new Date(e.next_action_at)-Date.now();
      if (ms < 0) return '<span style="color:#fbbf24">due</span>';
      if (ms < 3600000) return `${Math.round(ms/60000)}m`;
      if (ms < 86400000) return `${Math.round(ms/3600000)}h`;
      return `${Math.round(ms/86400000)}d`;
    })() : '';
    return `<tr>
      <td><strong style="color:#f1f5f9">${name}</strong> ${link}
        <div style="font-size:11px;color:#64748b">${e.title||''}${e.company?' · '+e.company:''}</div></td>
      <td><span style="padding:2px 8px;border-radius:8px;font-size:11px;font-weight:600;
          background:${STATUS_COLORS[e.status]||'#94a3b8'}22;color:${STATUS_COLORS[e.status]||'#94a3b8'}"
        >${e.status.replace(/_/g,' ')}</span></td>
      <td style="color:#64748b;font-size:12px">${next}</td>
      <td style="color:#64748b;font-size:12px">${e.current_step||0}</td>
      <td>
        ${e.status==='error'?`<button onclick="patchEnrollment(${e.id},'pending')" style="font-size:11px;color:#1D9E75;background:none;border:none;cursor:pointer">Retry</button>`:''}
        ${['pending','invite_sent'].includes(e.status)?`<button onclick="patchEnrollment(${e.id},'skipped')" style="font-size:11px;color:#f87171;background:none;border:none;cursor:pointer">Skip</button>`:''}
      </td>
    </tr>`;
  }).join('');

  const pages = data.pages || 1;
  const pager = pages > 1 ? `<div style="display:flex;gap:6px;justify-content:center;padding:12px">
    ${_enrollPage>1?`<button onclick="loadCMEnrollments(null,${_enrollPage-1})" style="padding:4px 12px;border:1px solid #2d3748;border-radius:5px;background:#1e2333;color:#94a3b8;cursor:pointer">← Prev</button>`:''}
    <span style="font-size:12px;color:#64748b;align-self:center">Page ${_enrollPage}/${pages} · ${data.total} enrollments</span>
    ${_enrollPage<pages?`<button onclick="loadCMEnrollments(null,${_enrollPage+1})" style="padding:4px 12px;border:1px solid #2d3748;border-radius:5px;background:#1e2333;color:#94a3b8;cursor:pointer">Next →</button>`:''}
  </div>` : '';

  const enroll_btn = totalEnrolled === 0
    ? `<button onclick="enrollCampaign()" style="padding:6px 14px;background:#1D9E75;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer">⚡ Enroll contacts</button>`
    : '';

  el.innerHTML = `
    <div style="padding:16px;border-bottom:1px solid #1e2a3a;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span style="font-size:12px;color:#64748b">${totalEnrolled} enrolled</span>
      ${enroll_btn}
      <button onclick="loadCMEnrollments(null,1,'')" style="padding:3px 10px;border-radius:10px;font-size:11px;background:${!_enrollStatus?'#1D9E75':'#1e2333'};color:${!_enrollStatus?'#fff':'#94a3b8'};border:1px solid #2d3748;cursor:pointer">All</button>
      ${statusBar}
    </div>
    ${items.length ? `
      <div style="overflow-x:auto">
        <table class="cm-table" style="background:#0f1117">
          <thead><tr style="background:#161b2e">
            <th>Contact</th><th>Status</th><th>Next</th><th>Step</th><th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>${pager}
    ` : `<div style="text-align:center;padding:40px;color:#475569">
      ${totalEnrolled === 0 ? 'No enrollments yet. Click "Enroll contacts" to start.' : `No enrollments with status "${_enrollStatus}"`}
    </div>`}
  `;
}

async function enrollCampaign() {
  try {
    const r = await fetch(`/api/campaigns/${cmId}/enroll`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ workspace_id: workspaceId }),
    }).then(r=>r.json());
    if (r.error) throw new Error(r.error);
    alert(`Enrolled ${r.enrolled} contacts (${r.skipped} already enrolled)`);
    cmLoaded.enrollments = false;
    await loadCMTab('enrollments');
  } catch(e) { alert('Error: ' + e.message); }
}

async function patchEnrollment(id, status) {
  await fetch(`/api/enrollments/${id}`, {
    method: 'PATCH', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ workspace_id: workspaceId, status, next_action_at: new Date().toISOString() }),
  });
  cmLoaded.enrollments = false;
  await loadCMTab('enrollments');
}



function buildAnalyticsHTML(data) {
  const o = data.overall||{};
  const iap = parseInt(o.invites_sent)>0 ? Math.round(parseInt(o.invites_approved)/parseInt(o.invites_sent)*100) : 0;
  const rr  = parseInt(o.messages_sent)>0? Math.round(parseInt(o.messages_replied)/parseInt(o.messages_sent)*100): 0;
  const total   = parseInt(o.total_contacts)||0;
  const acoCount= parseInt(o.enriched_count||0);
  const pct     = total>0 ? Math.round(acoCount/total*100) : 0;
  const seqName = cmData?.sequence_name||(cmData?.sequence_id?`Seq #${cmData.sequence_id}`:null);
  let html = `<div class="analytics-section-label">Overview</div>
    <div class="overview-grid">
      <div class="overview-card kpi-btn" onclick="cmKpiClick(this,'all')" title="Show all contacts">
        <div class="overview-card-num">${parseInt(o.total_contacts)||0}</div>
        <div class="overview-card-label">Contacts</div>
      </div>
      <div class="overview-card kpi-btn" onclick="cmKpiClick(this,'invite_sent')" title="Contacts with invite sent">
        <div class="overview-card-num">${parseInt(o.invites_sent)||0}</div>
        <div class="overview-card-label">Invites sent</div>
      </div>
      <div class="overview-card kpi-btn" onclick="cmKpiClick(this,'invite_approved')" title="Contacts who approved">
        <div class="overview-card-num">${parseInt(o.invites_approved)||0}</div>
        <div class="overview-card-rate">${iap}%</div>
        <div class="overview-card-label">Approved</div>
      </div>
      <div class="overview-card kpi-btn" onclick="cmKpiClick(this,'msg_sent')" title="Contacts messaged">
        <div class="overview-card-num">${parseInt(o.messages_sent)||0}</div>
        <div class="overview-card-label">Msgs sent</div>
      </div>
      <div class="overview-card kpi-btn" onclick="cmKpiClick(this,'msg_replied')" title="Contacts who replied">
        <div class="overview-card-num">${parseInt(o.messages_replied)||0}</div>
        <div class="overview-card-rate">${rr}%</div>
        <div class="overview-card-label">Replied</div>
      </div>
      <div class="overview-card kpi-btn" onclick="cmKpiClick(this,'positive_reply')" title="Positive replies">
        <div class="overview-card-num">${parseInt(o.positive_replies)||0}</div>
        <div class="overview-card-label">Positive</div>
      </div>
      <div class="overview-card kpi-btn" onclick="cmKpiClick(this,'total_msgs')" title="Total messages sent">
        <div class="overview-card-num">${parseInt(o.total_msgs_sent)||0}</div>
        <div class="overview-card-label">Total msgs</div>
      </div>
      ${total>0?`<div class="overview-card" title="Contacts with real ACoXXX LinkedIn ID — ready to invite">
        <div class="overview-card-num" style="color:${pct>=80?'#10b981':pct>=40?'#f59e0b':'#f87171'}">${acoCount}</div>
        <div class="overview-card-rate">${pct}% enriched</div>
        <div class="overview-card-label">ACoXXX IDs</div>
      </div>`:''}
      <div class="overview-card" title="Attached sequence">
        <div class="overview-card-num" style="font-size:12px;color:${seqName?'#1D9E75':'#94a3b8'}">${seqName||'None'}</div>
        <div class="overview-card-label">Sequence</div>
      </div>
    </div>
    <div id="cm-kpi-drill" style="display:none;margin-top:14px;"></div>    </div><div class="analytics-section-label">A/B/C message performance</div>`;
  const steps = data.steps||[];
  if (!steps.length) return html+'<div class="no-ab-msg">No messages sent yet.</div>';
  const VC={A:'variant-a',B:'variant-b',C:'variant-c'};
  return html + steps.map(step=>{
    const vs=step.variants||[]; if(!vs.length)return '';
    const mx=Math.max(...vs.map(v=>v.rate)); const isAB=vs.length>1;
    const rows=vs.map(v=>{
      const best=isAB&&v.rate===mx&&mx>0; const bw=mx>0?Math.round(v.rate/mx*80):0;
      return `<tr class="${best?'best-row':''}"><td><span class="variant-pill ${VC[v.label]||'variant-a'}">${v.label}</span>${best?'<span class="best-badge">&#10003; Best</span>':''}</td><td style="font-weight:600;">${v.sent}</td><td>${v.replied}</td><td><div class="rate-bar-wrap"><div class="rate-bar" style="width:${bw}px;"></div><span class="rate-text">${v.rate}%</span></div></td></tr>`;
    }).join('');
    const di=step.delay?` \u2014 wait ${step.delay} ${step.unit}`:'';
    return `<div class="ab-step-block"><div class="ab-step-title">Message ${step.step}${di}</div><table class="ab-table"><thead><tr><th>Variant</th><th>Sent</th><th>Replied</th><th>Reply rate</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }).join('');
}

function buildCompaniesHTML(companies) {
  const sc = cmData?.settings?.searchConfig;
  const auto = cmData?.audience_type==='company' && sc?.titles?.length;
  let tbl = '';
  if (!companies.length) {
    tbl = '<div style="text-align:center;color:#aaa;padding:40px;background:#fafafa;border-radius:10px;">No companies in this campaign yet.</div>';
  } else {
    const rows = companies.map(co=>{
      const li = co.li_company_url ? `<a class="cell-link" href="${esc(safeUrl(co.li_company_url))}" target="_blank" rel="noopener">LinkedIn &#8599;</a>` : '<span style="color:#ccc;">\u2014</span>';
      const dt = co.created_at ? new Date(co.created_at).toLocaleDateString() : '\u2014';
      return `<tr><td style="font-weight:500;">${esc(co.company_name||'\u2014')}</td><td>${li}</td><td style="text-align:center;color:#888;">${co.contact_count||0}</td><td style="color:#aaa;font-size:12px;">${dt}</td></tr>`;
    }).join('');
    tbl = `<div class="tbl-wrap"><table class="cm-table"><thead>
  <tr class="cm-th-row">
    <th class="cm-th-sort" onclick="cmSortComp('company_name')">Company <span class="cm-sort-icon" id="comp-sort-name">ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ</span></th>
    <th>LinkedIn</th>
    <th class="cm-th-sort" onclick="cmSortComp('contact_count')">Contacts <span class="cm-sort-icon" id="comp-sort-count">ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ</span></th>
    <th class="cm-th-sort" onclick="cmSortComp('created_at')">Added <span class="cm-sort-icon" id="comp-sort-added">ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ</span></th>
  </tr>
  <tr class="cm-filter-row">
    <td><select class="cm-fi" id="comp-fi-name" onchange="cmFilterComp()"><option value="">All companies</option></select></td>
    <td></td><td></td><td></td>
  </tr>
</thead><tbody>${rows}</tbody></table></div>`;
  }
  const autoInfo = auto
    ? `<div class="auto-box">&#10003; Auto-search: will find <strong>${esc(sc.titles.join(', '))}</strong> &middot; Max <strong>${sc.maxPerCompany||10}</strong> per company</div>`
    : `<p style="font-size:12px;color:#888;margin-bottom:10px;">Enter job titles to search for at each company.</p><div style="display:flex;gap:10px;margin-bottom:10px;"><div style="flex:1;"><label class="fsl">Job titles</label><input type="text" id="add-co-titles" style="width:100%;padding:8px 10px;border:1px solid #e0e0e0;border-radius:6px;font-size:13px;font-family:inherit;" placeholder="VP R&D, CTO"></div><div><label class="fsl">Max/co.</label><input type="number" id="add-co-lim" style="width:64px;padding:8px 10px;border:1px solid #e0e0e0;border-radius:6px;font-size:13px;text-align:center;" value="10" min="1" max="50"></div></div>`;
  return `<div style="font-size:14px;font-weight:500;margin-bottom:14px;">${companies.length} compan${companies.length!==1?'ies':'y'} in this campaign</div>
    ${tbl}
    <div class="add-card"><div class="add-card-title">+ Add more companies</div>${autoInfo}
      <textarea id="add-co-ta" class="add-ta" rows="4" placeholder="Paste LinkedIn company URLs (one per line)&#10;https://www.linkedin.com/company/example"></textarea>
      <div id="add-co-res" class="add-res"></div>
      <div style="display:flex;justify-content:flex-end;margin-top:10px;"><button class="primary-btn" id="add-co-btn" onclick="addCMCompanies()">&#128269; Search &amp; Add</button></div>
    </div>`;
}

async function addCMCompanies() {
  const ta=document.getElementById('add-co-ta');
  const urls=(ta?.value||'').split('\n').map(s=>s.trim()).filter(s=>s.includes('linkedin.com/company/'));
  if (!urls.length) { alert('Please paste at least one LinkedIn company URL.'); return; }
  const sc=cmData?.settings?.searchConfig;
  const auto=cmData?.audience_type==='company'&&sc?.titles?.length;
  let titles,limit;
  if(auto){titles=sc.titles;limit=sc.maxPerCompany||10;}
  else{titles=(document.getElementById('add-co-titles')?.value||'').split(',').map(s=>s.trim()).filter(Boolean);limit=parseInt(document.getElementById('add-co-lim')?.value)||10;if(!titles.length){alert('Please enter job titles.');return;}}
  const res=document.getElementById('add-co-res'),btn=document.getElementById('add-co-btn');
  res.innerHTML='<span style="color:#888;">&#8987; Searching... this may take a few minutes</span>';btn.disabled=true;btn.textContent='Searching...';
  const cos=urls.map(u=>{const sl=(u.match(/linkedin\.com\/company\/([^/?&#\s]+)/i)||[])[1]||'';return{name:sl.split('-').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' '),url:u};});
  try{
    const r=await fetch('/api/opportunities/attach-to-campaign',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workspace_id:cmData.workspace_id,campaign_id:cmId,companies:cos,titles,limit})});
    const d=await r.json();if(!r.ok)throw new Error(d.error);
    res.innerHTML=`<span style="color:#0F6E56;">&#10003; ${d.contacts_added} contacts added &middot; ${d.companies_searched} searched &middot; ${d.contacts_found} found</span>`;
    ta.value='';cmLoaded.companies=false;cmLoaded.audience=false;
    if(cmTab==='companies'){cmLoaded.companies=true;const d2=await fetch('/api/campaigns/'+cmId+'/companies?workspace_id='+workspaceId).then(r=>r.json());document.getElementById('cmb-companies').innerHTML=buildCompaniesHTML(d2.items||[]);}
    load();
  }catch(e){res.innerHTML=`<span style="color:#DC2626;">&#10007; ${esc(e.message)}</span>`;}
  finally{btn.disabled=false;btn.innerHTML='&#128269; Search &amp; Add';}
}

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ List banner + contacts loader ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
async function loadCMAudience() {
  const el = document.getElementById('cmb-audience');
  el.innerHTML = '<div class="tab-spin">Loading...</div>';
  try {
    const [listsRes, contactsRes] = await Promise.all([
      fetch('/api/lists?workspace_id='+workspaceId).then(r=>r.json()),
      fetch('/api/campaigns/'+cmId+'/contacts?workspace_id='+workspaceId+'&page=1&limit=50').then(r=>r.json())
    ]);
    const lists = (listsRes.items||[]).filter(function(l){ return l.type==='contacts'; });
    const attached = cmData ? (cmData.list_id || null) : null;
    const attachedName = cmData ? (cmData.list_name || null) : null;

    // Banner
    var bannerHtml;
    if (attached) {
      bannerHtml = '<div class="list-banner list-banner-attached">'
        + '<span class="list-banner-icon">Ã°ÂÂÂ¥</span>'
        + '<div class="list-banner-text">'
        + '<div class="list-banner-label">Linked list</div>'
        + '<div class="list-banner-name">'+esc(attachedName || 'List #'+attached)+'</div>'
        + '</div>'
        + '<button class="list-change-btn" onclick="cmShowListPicker()">Change list</button>'
        + '</div>';
    } else {
      bannerHtml = '<div class="list-banner list-banner-empty">'
        + '<span class="list-banner-icon">Ã°ÂÂÂ</span>'
        + '<div class="list-banner-text">'
        + '<div class="list-banner-label">No list attached</div>'
        + '<div class="list-banner-sub">Attach a contact list to populate this campaign automatically</div>'
        + '</div>'
        + '<button class="list-change-btn primary" onclick="cmShowListPicker()">+ Attach list</button>'
        + '</div>';
    }

    // Picker cards
    var cardsHtml = lists.length
      ? lists.map(function(l) {
          return '<div class="list-picker-card'+(l.id==attached?' selected':'')+'" data-lid="'+l.id+'" data-lname="'+esc(l.name)+'" onclick="cmAttachList(+this.dataset.lid,this.dataset.lname)">'
            + '<div class="lpc-icon">Ã°ÂÂÂ¥</div>'
            + '<div class="lpc-info">'
            + '<div class="lpc-name">'+esc(l.name)+'</div>'
            + '<div class="lpc-count">'+(l.contact_count||0)+' contacts</div>'
            + '</div>'
            + (l.id==attached ? '<div class="lpc-check">Ã¢ÂÂ</div>' : '')
            + '</div>';
        }).join('')
      : '<div style="color:#999;font-size:13px;">No contact lists found</div>';

    var pickerHtml = '<div id="cm-list-picker" style="display:none;margin-bottom:16px;">'
      + '<div class="list-picker-title">Select a list</div>'
      + '<div class="list-picker-grid">'+cardsHtml+'</div>'
      + '<div style="margin-top:10px;">'
      + '<button class="ghost-btn" onclick="cmHideListPicker()">Cancel</button>'
      + '</div></div>';

    el.innerHTML = bannerHtml + pickerHtml + '<div id="cm-contacts-body"></div>';
    document.getElementById('cm-contacts-body').innerHTML = buildAudienceHTML(contactsRes);
  } catch(e) { el.innerHTML = '<div class="tab-err">Error: '+esc(e.message)+'</div>'; }
}

function cmHideListPicker() {
  var p = document.getElementById('cm-list-picker');
  if(p) p.style.display = 'none';
}

function cmShowListPicker() {
  const p = document.getElementById('cm-list-picker');
  if(p) p.style.display = p.style.display==='none' ? 'block' : 'none';
}

async function cmAttachList(listId, listName) {
  try {
    const r = await fetch('/api/campaigns/'+cmId+'/list', {
      method: 'PATCH',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({workspace_id: parseInt(workspaceId), list_id: listId})
    });
    const d = await r.json();
    if(d.error) throw new Error(d.error);
    // Update local cmData
    if(cmData) { cmData.list_id = listId; cmData.list_name = listName; }
    // Show success toast
    showToast('List attached ÃÂ¢ÃÂÃÂ ' + d.contacts_added + ' contacts added');
    // Reload audience tab
    cmLoaded['audience'] = false;
    await loadCMAudience();
    // Reload campaigns list in background
    load();
  } catch(e) { showToast('Error: '+e.message, true); }
}

function showToast(msg, isError) {
  let t = document.getElementById('cm-toast');
  if(!t) { t = document.createElement('div'); t.id='cm-toast'; t.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1D9E75;color:#fff;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:500;z-index:9999;opacity:0;transition:opacity 0.3s'; document.body.appendChild(t); }
  t.style.background = isError ? '#e53e3e' : '#1D9E75';
  t.textContent = msg;
  t.style.opacity = '1';
  setTimeout(()=>{ t.style.opacity='0'; }, 3000);
}

async function loadCMContacts(page){
  cmCtPage=page;
  const el=document.getElementById('cmb-audience');
  if(!el.innerHTML.includes('cm-table'))el.innerHTML='<div class="tab-spin">Loading...</div>';
  try{const d=await fetch(`/api/campaigns/${cmId}/contacts?workspace_id=${workspaceId}&page=${page}&limit=50`).then(r=>r.json());el.innerHTML=buildAudienceHTML(d);}
  catch(e){el.innerHTML=`<div class="tab-err">Error: ${esc(e.message)}</div>`;}
}

function buildAudienceHTML(data){
  const{items=[],total=0,page=1,pages=1}=data;
  let tbl='';
  if(!items.length){tbl='<div style="text-align:center;color:#aaa;padding:40px;background:#fafafa;border-radius:10px;">No contacts yet.</div>';}
  else{
    const rows=items.map(c=>{const name=[c.first_name,c.last_name].filter(Boolean).join(' ')||'(unknown)';const nameEl=c.li_profile_url?`<a class="cell-link" href="${esc(safeUrl(c.li_profile_url))}" target="_blank" rel="noopener" style="font-weight:500;">${esc(name)}</a>`:`<span style="font-weight:500;">${esc(name)}</span>`;return`<tr><td>${nameEl}</td><td style="font-size:12px;color:#666;">${esc(c.title||'\u2014')}</td><td style="font-size:12px;color:#888;">${esc(c.company||'\u2014')}</td><td>${buildChips(c)}</td><td><button class="rm-btn" onclick="removeCMContact(${c.id})" title="Remove">&times;</button></td></tr>`;}).join('');
    tbl=`<div class="tbl-wrap"><table class="cm-table"><thead>
  <tr class="cm-th-row">
    <th class="cm-th-sort" onclick="cmSortAud('name')">Name <span class="cm-sort-icon" id="aud-sort-name">ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ</span></th>
    <th class="cm-th-sort" onclick="cmSortAud('title')">Title <span class="cm-sort-icon" id="aud-sort-title">ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ</span></th>
    <th class="cm-th-sort" onclick="cmSortAud('company')">Company <span class="cm-sort-icon" id="aud-sort-company">ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ</span></th>
    <th class="cm-th-sort" onclick="cmSortAud('status')">Status <span class="cm-sort-icon" id="aud-sort-status">ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ</span></th>
    <th></th>
  </tr>
  <tr class="cm-filter-row">
    <td><input class="cm-fi" id="aud-fi-name" placeholder="Search nameÃÂÃÂ¢ÃÂÃÂÃÂÃÂ¦" oninput="cmFilterAud()"></td>
    <td><input class="cm-fi" id="aud-fi-title" placeholder="Search titleÃÂÃÂ¢ÃÂÃÂÃÂÃÂ¦" oninput="cmFilterAud()"></td>
    <td><select class="cm-fi" id="aud-fi-company" onchange="cmFilterAud()"><option value="">All companies</option></select></td>
    <td>
      <select class="cm-fi" id="aud-fi-status" onchange="cmFilterAud()">
        <option value="">All</option>
        <option value="new">New</option>
        <option value="invite_sent">Invite sent</option>
        <option value="invite_approved">Approved</option>
        <option value="msg_sent">Msg sent</option>
        <option value="msg_replied">Replied</option>
        <option value="positive_reply">Positive</option>
      </select>
    </td>
    <td></td>
  </tr>
</thead><tbody>${rows}</tbody></table></div>`;
  }
  let pager='';
  if(pages>1){const b=[`<button class="pg" onclick="loadCMContacts(${page-1})" ${page<=1?'disabled':''}>&#8249; Prev</button>`];for(let p=Math.max(1,page-2);p<=Math.min(pages,page+2);p++)b.push(`<button class="pg${p===page?' on':''}" onclick="loadCMContacts(${p})">${p}</button>`);b.push(`<button class="pg" onclick="loadCMContacts(${page+1})" ${page>=pages?'disabled':''}>Next &#8250;</button>`);pager=`<div class="pager">${b.join('')}</div>`;}
  return`<div style="font-size:14px;font-weight:500;margin-bottom:14px;">${total} contact${total!==1?'s':''}</div>
    ${tbl}${pager}
    <div class="add-card"><div class="add-card-title">+ Add contacts</div>
      <p style="font-size:12px;color:#888;margin-bottom:10px;">Paste LinkedIn profile URLs (one per line). Contacts will be enriched automatically.</p>
      <textarea id="add-ct-ta" class="add-ta" rows="4" placeholder="https://www.linkedin.com/in/johndoe&#10;https://www.linkedin.com/in/janedoe"></textarea>
      <div id="add-ct-res" class="add-res"></div>
      <div style="display:flex;justify-content:flex-end;margin-top:10px;"><button class="primary-btn" id="add-ct-btn" onclick="addCMContacts()">+ Add contacts</button></div>
    </div>`;
}

function buildChips(c){
  const ch=[];
  if(c.positive_reply)ch.push('<span class="sc sc-g">&#10003; Replied</span>');
  else if(c.msg_replied)ch.push('<span class="sc sc-t">Replied</span>');
  else if(c.msg_sent)ch.push('<span class="sc sc-x">Messaged</span>');
  if(c.already_connected)ch.push('<span class="sc sc-g">Connected</span>');
  else if(c.invite_approved)ch.push('<span class="sc sc-g">Approved</span>');
  else if(c.invite_sent)ch.push('<span class="sc sc-b">Invited</span>');
  return ch.length?ch.join(''):'<span class="sc sc-x">New</span>';
}

async function addCMContacts(){
  const ta=document.getElementById('add-ct-ta');
  const urls=(ta?.value||'').split('\n').map(s=>s.trim()).filter(s=>s.includes('linkedin.com/in/'));
  if(!urls.length){alert('Please paste at least one LinkedIn profile URL (linkedin.com/in/...).');return;}
  const res=document.getElementById('add-ct-res'),btn=document.getElementById('add-ct-btn');
  res.innerHTML='<span style="color:#888;">&#8987; Adding...</span>';btn.disabled=true;btn.textContent='Adding...';
  try{
    const r=await fetch(`/api/campaigns/${cmId}/contacts`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workspace_id:workspaceId,contacts:urls.map(li_profile_url=>({li_profile_url}))})});
    const d=await r.json();if(!r.ok)throw new Error(d.error);
    res.innerHTML=`<span style="color:#0F6E56;">&#10003; ${d.added} added &middot; ${d.skipped} skipped &middot; ${d.enrichment_queued} enrichment queued</span>`;
    ta.value='';await loadCMContacts(1);load();
  }catch(e){res.innerHTML=`<span style="color:#DC2626;">&#10007; ${esc(e.message)}</span>`;}
  finally{btn.disabled=false;btn.textContent='+ Add contacts';}
}

async function removeCMContact(cid){
  if(!confirm('Remove this contact from the campaign?'))return;
  try{const r=await fetch(`/api/campaigns/${cmId}/contacts/${cid}?workspace_id=${workspaceId}`,{method:'DELETE'});if(!r.ok)throw new Error((await r.json()).error);await loadCMContacts(cmCtPage);load();}
  catch(e){alert('Failed: '+e.message);}
}

function buildSettingsHTML(){
  if(!cmSettings)return'<div class="tab-spin">Settings not available.</div>';
  const s=cmSettings,conn=s.connection||{},eng=s.engagement||{},hrs=s.hours||{};
  const ce=conn.enabled!==false,wo=!!conn.withdraw_after_days,wd=conn.withdraw_after_days||14,re=!!conn.resend;
  const dh=DAYS.map(d=>{const h=hrs[d.key]||{on:parseInt(d.key)<=5,from:'09:00',to:'18:00'};
    return`<div class="day-card${h.on?'':' off'}" id="edc-${d.key}"><div class="day-head"><span class="day-name">${d.label}</span><button class="day-toggle${h.on?' on':''}" id="edt-${d.key}" onclick="teDay('${d.key}')"></button></div><div id="ets-${d.key}"${h.on?'':' style="display:none;"'}><div class="time-inputs"><div class="time-row"><span class="time-lbl">from</span><input class="time-input" type="time" value="${h.from}" onchange="uh('${d.key}','from',this.value)"></div><div class="time-row"><span class="time-lbl">to</span><input class="time-input" type="time" value="${h.to}" onchange="uh('${d.key}','to',this.value)"></div></div></div><div id="eoff-${d.key}" class="day-off-label"${h.on?' style="display:none;"':''}>off</div></div>`;}).join('');
  const eh=ENGAGEMENT_ACTIONS.map(a=>`<div class="engagement-item"><div><div class="eng-label">${a.label}</div>${a.sub?`<div class="eng-sub">${a.sub}</div>`:''}</div><button class="toggle${eng[a.key]?' on':''}" id="ee-${a.key}" onclick="teEng('${a.key}')"></button></div>`).join('');
  return`
    <div class="section-label">Connection requests</div>
    <div class="conn-section">
      <div class="conn-row"><div><div class="conn-label">Send connection requests</div><div class="conn-sub">Automatically send LinkedIn invites to all prospects</div></div><button class="toggle${ce?' on':''}" id="ect" onclick="teConn()"></button></div>
      <div id="eco" class="conn-options" style="display:${ce?'':'none'};">
        <div class="conn-opt-row"><div class="conn-opt-label">Withdraw if not accepted after</div><div style="display:flex;align-items:center;gap:8px;"><input class="num-input" type="number" value="${wd}" min="1" id="ewd" oninput="if(cmSettings.connection)cmSettings.connection.withdraw_after_days=parseInt(this.value)||14"> days<button class="toggle${wo?' on':''}" id="ewt" onclick="teWd()"></button></div></div>
        <div id="ert" class="conn-opt-row" style="display:${wo?'':'none'};"><div class="conn-opt-label">Resend request after 21+ days</div><button class="toggle${re?' on':''}" id="ert-btn" onclick="teRes()"></button></div>
      </div>
    </div>
    <div class="section-label" style="margin-top:24px;">Message sequences</div>
    <div class="sequence-grid" id="cm-msgs">${buildCMSeqHTML()}</div>
    <div class="section-label" style="margin-top:24px;">Engagement actions</div>
    <div class="engagement-list">${eh}</div>
    <div class="section-label" style="margin-top:24px;">Working hours</div>
    <div style="font-size:12px;color:#888;margin-bottom:10px;">Campaign only runs during these hours (server timezone).</div>
    <div class="hours-grid">${dh}</div><div style="height:20px;"></div>`;
}

function buildCMSeqHTML(){
  const msgs=cmSettings?.messages||{};
  function cards(arr,canvas){return(arr||[]).map((m,i)=>{const v0=(m.variants||[])[0]||(m.text?{text:m.text}:{text:''});const preview=v0.text||'';const bgs=(m.variants||[]).length>1?`<span class="variant-badge">${(m.variants||[]).map(v=>`<span class="vbadge vbadge-${v.label.toLowerCase()}">${v.label}</span>`).join('')}</span>`:'';return`<div class="seq-msg"><button class="seq-msg-remove" onclick="removeCMMsg('${canvas}',${i})">&times;</button><div class="seq-msg-delay">Wait ${m.delay} ${m.unit} ${bgs}</div><div class="seq-msg-text">${esc(preview.slice(0,80))}${preview.length>80?'...':''}</div></div>`;}).join('')+`<button class="add-msg-btn" onclick="openCMMsg('${canvas}')">+ Add message</button>`;}
  return`<div class="sequence-canvas"><div class="seq-head"><div class="seq-head-title">New contacts</div><div class="seq-head-sub">Not yet connected</div></div><div class="seq-body">${cards(msgs.new,'new')}</div></div><div style="display:flex;flex-direction:column;gap:10px;"><div class="sequence-canvas"><div class="seq-head"><div class="seq-head-title">Existing \u2014 no history</div><div class="seq-head-sub">Connected, never messaged</div></div><div class="seq-body">${cards(msgs.existing_no_history,'existingNo')}</div></div><div class="sequence-canvas"><div class="seq-head"><div class="seq-head-title">Existing \u2014 with history</div><div class="seq-head-sub">Connected, previous conversation</div></div><div class="seq-body">${cards(msgs.existing_with_history,'existingYes')}</div></div></div>`;
}

function refreshCMSeq(){const e=document.getElementById('cm-msgs');if(e)e.innerHTML=buildCMSeqHTML();}
function removeCMMsg(canvas,i){const key=CKEY[canvas];if(cmSettings?.messages?.[key]){cmSettings.messages[key].splice(i,1);refreshCMSeq();}}

function openCMMsg(canvas){
  msgEditCanvas=canvas;
  const titles={new:'New contacts',existingNo:'Existing \u2014 no history',existingYes:'Existing \u2014 with history'};
  document.getElementById('msg-dialog-title').textContent='Add message \u2014 '+titles[canvas];
  document.getElementById('msg-delay-val').value=3;
  document.getElementById('msg-delay-unit').value='days';
  dlgVariants=[{label:'A',text:''}];
  renderDlgVariants();
  document.getElementById('msg-dialog').style.display='flex';
}

function teConn(){if(!cmSettings.connection)cmSettings.connection={};cmSettings.connection.enabled=!(cmSettings.connection.enabled!==false);document.getElementById('ect')?.classList.toggle('on',!!cmSettings.connection.enabled);const o=document.getElementById('eco');if(o)o.style.display=cmSettings.connection.enabled?'':'none';}
function teWd(){if(!cmSettings.connection)cmSettings.connection={};const curr=!!cmSettings.connection.withdraw_after_days;cmSettings.connection.withdraw_after_days=curr?0:(parseInt(document.getElementById('ewd')?.value)||14);document.getElementById('ewt')?.classList.toggle('on',!!cmSettings.connection.withdraw_after_days);const r=document.getElementById('ert');if(r)r.style.display=cmSettings.connection.withdraw_after_days?'':'none';}
function teRes(){if(!cmSettings.connection)cmSettings.connection={};cmSettings.connection.resend=!cmSettings.connection.resend;document.getElementById('ert-btn')?.classList.toggle('on',!!cmSettings.connection.resend);}
function teEng(key){if(!cmSettings.engagement)cmSettings.engagement={};cmSettings.engagement[key]=!cmSettings.engagement[key];document.getElementById('ee-'+key)?.classList.toggle('on',!!cmSettings.engagement[key]);}
function teDay(key){if(!cmSettings.hours)cmSettings.hours={};if(!cmSettings.hours[key])cmSettings.hours[key]={on:false,from:'09:00',to:'18:00'};cmSettings.hours[key].on=!cmSettings.hours[key].on;const on=cmSettings.hours[key].on;document.getElementById('edc-'+key)?.classList.toggle('off',!on);document.getElementById('edt-'+key)?.classList.toggle('on',on);const ts=document.getElementById('ets-'+key),of=document.getElementById('eoff-'+key);if(ts)ts.style.display=on?'':'none';if(of)of.style.display=on?'none':'';}
function uh(key,field,val){if(!cmSettings.hours)cmSettings.hours={};if(!cmSettings.hours[key])cmSettings.hours[key]={on:true,from:'09:00',to:'18:00'};cmSettings.hours[key][field]=val;}

async function toggleCMStatus(){
  if(!cmData)return;
  const ns=cmData.status==='active'?'paused':'active';
  try{const r=await fetch(`/api/campaigns/${cmId}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({workspace_id:workspaceId,status:ns})});if(!r.ok)throw new Error((await r.json()).error);cmData.status=ns;const btn=document.getElementById('cm-st-btn');btn.textContent=ns==='active'?'\u23f8 Pause':'\u25b6 Resume';btn.style.color=ns==='active'?'#DC2626':'#1D9E75';load();}
  catch(e){alert('Failed: '+e.message);}
}

async function saveCMSettings(){
  const btn=document.getElementById('cm-save-btn');
  btn.disabled=true;btn.textContent='Saving...';
  try{const r=await fetch(`/api/campaigns/${cmId}/settings`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({workspace_id:workspaceId,settings:cmSettings})});if(!r.ok)throw new Error((await r.json()).error);if(cmData)cmData.settings=JSON.parse(JSON.stringify(cmSettings));btn.textContent='\u2713 Saved!';setTimeout(()=>{btn.disabled=false;btn.textContent='Save settings';},2000);load();}
  catch(e){alert('Failed: '+e.message);btn.disabled=false;btn.textContent='Save settings';}
}

function safeUrl(u){u=(u||'').trim();return /^https?:\/\//i.test(u)?u:'https://'+u;}



/* ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
   KPI DRILL-DOWN ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ click a KPI tile to see matching contacts below
   ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ */

window._cmKpiState = { key: null, contacts: [] };
window._cmAudSort  = { col: null, dir: 1 };
window._cmCompSort = { col: null, dir: 1 };

function cmKpiClick(el, key) {
  const drill = document.getElementById('cm-kpi-drill');
  if (!drill) return;

  // toggle off if same tile clicked twice
  if (window._cmKpiState.key === key) {
    window._cmKpiState.key = null;
    drill.style.display = 'none';
    document.querySelectorAll('.kpi-btn').forEach(b => b.classList.remove('kpi-active'));
    return;
  }

  // highlight selected tile
  document.querySelectorAll('.kpi-btn').forEach(b => b.classList.remove('kpi-active'));
  el.classList.add('kpi-active');
  window._cmKpiState.key = key;

  // get contacts from the audience body table rows
  const tbody = document.querySelector('#cmb-audience tbody');
  const allRows = tbody ? [...tbody.querySelectorAll('tr')] : [];
  if (!allRows.length) {
    drill.innerHTML = '<div class="kpi-drill-empty">Open the Audience tab first, then click a KPI tile.</div>';
    drill.style.display = 'block';
    return;
  }

  // filter rows by KPI key ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ uses data attributes on each row
  const filtered = key === 'all' ? allRows : allRows.filter(row => {
    const flags = {
      invite_sent:     row.dataset.inviteSent     === '1',
      invite_approved: row.dataset.inviteApproved === '1',
      msg_sent:        row.dataset.msgSent        === '1',
      msg_replied:     row.dataset.msgReplied     === '1',
      positive_reply:  row.dataset.positiveReply  === '1',
      total_msgs:      (parseInt(row.dataset.msgsCount)||0) > 0,
    };
    return flags[key];
  });

  const label = el.querySelector('.overview-card-label')?.textContent || key;
  const count = filtered.length;

  if (!count) {
    drill.innerHTML = `<div class="kpi-drill-empty">No contacts match "${label}" yet.</div>`;
    drill.style.display = 'block';
    return;
  }

  // build mini-table
  const rows = filtered.map(row => {
    const tds = [...row.querySelectorAll('td')];
    const name    = tds[0]?.textContent.trim() || 'ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ';
    const title   = tds[1]?.textContent.trim() || 'ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ';
    const company = tds[2]?.textContent.trim() || 'ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ';
    const status  = tds[3]?.textContent.trim() || 'ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ';
    const href    = row.querySelector('a')?.href || '#';
    return `<tr>
      <td><a href="${href}" target="_blank" rel="noopener" style="color:#0A66C2;text-decoration:none">${esc(name)}</a></td>
      <td>${esc(title)}</td>
      <td>${esc(company)}</td>
      <td><span class="status-pill status-${esc(status.toLowerCase().replace(' ','_'))}">${esc(status)}</span></td>
    </tr>`;
  }).join('');

  drill.innerHTML = `
    <div class="kpi-drill-header">
      <span class="kpi-drill-title">${esc(label)}</span>
      <span class="kpi-drill-count">${count} contact${count!==1?'s':''}</span>
      <span class="kpi-drill-close" onclick="cmKpiClick(document.querySelector('.kpi-btn.kpi-active'),window._cmKpiState.key)" title="Close">&times;</span>
    </div>
    <div class="kpi-drill-table-wrap">
      <table class="kpi-drill-table">
        <thead><tr><th>Name</th><th>Title</th><th>Company</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  drill.style.display = 'block';
}

/* ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
   AUDIENCE TABLE ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ sort + filter
   ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ */

function cmSortAud(col) {
  const s = window._cmAudSort;
  s.dir = (s.col === col) ? -s.dir : 1;
  s.col = col;
  // update sort icons
  document.querySelectorAll('[id^="aud-sort-"]').forEach(el => el.textContent = 'ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ');
  const icon = document.getElementById('aud-sort-' + col);
  if (icon) icon.textContent = s.dir === 1 ? 'ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ' : 'ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ';
  _cmSortTable('cmb-audience', col, s.dir);
}

function cmFilterAud() {
  const name    = (document.getElementById('aud-fi-name')?.value    || '').toLowerCase();
  const title   = (document.getElementById('aud-fi-title')?.value   || '').toLowerCase();
  const company = (document.getElementById('aud-fi-company')?.value || '').toLowerCase();
  const status  = (document.getElementById('aud-fi-status')?.value  || '').toLowerCase();
  const tbody   = document.querySelector('#cmb-audience tbody');
  if (!tbody) return;
  [...tbody.querySelectorAll('tr')].forEach(row => {
    const tds  = [...row.querySelectorAll('td')];
    const rName    = (tds[0]?.textContent||'').toLowerCase();
    const rTitle   = (tds[1]?.textContent||'').toLowerCase();
    const rCompany = (tds[2]?.textContent||'').toLowerCase();
    const rStatus  = (tds[3]?.textContent||'').toLowerCase();
    const visible  =
      (!name    || rName.includes(name))    &&
      (!title   || rTitle.includes(title))  &&
      (!company || rCompany === company)    &&
      (!status  || rStatus.includes(status) || row.dataset[status.replace('_','')]?.toString() === '1');
    row.style.display = visible ? '' : 'none';
  });
  _cmPopulateCompanyDropdown('aud-fi-company', 'cmb-audience', 2);
}

// Populate company dropdown from table rows (col index)
function _cmPopulateCompanyDropdown(selectId, tbodyId, colIdx) {
  const sel = document.getElementById(selectId);
  if (!sel || sel.dataset.populated) return;
  sel.dataset.populated = '1';
  const tbody = document.querySelector('#' + tbodyId + ' tbody');
  if (!tbody) return;
  const companies = [...new Set(
    [...tbody.querySelectorAll('tr')].map(r => r.querySelectorAll('td')[colIdx]?.textContent.trim()).filter(Boolean)
  )].sort();
  companies.forEach(c => {
    const o = document.createElement('option');
    o.value = c.toLowerCase(); o.textContent = c;
    sel.appendChild(o);
  });
}

/* ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
   COMPANIES TABLE ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ sort + filter
   ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ */

function cmSortComp(col) {
  const s = window._cmCompSort;
  s.dir = (s.col === col) ? -s.dir : 1;
  s.col = col;
  document.querySelectorAll('[id^="comp-sort-"]').forEach(el => el.textContent = 'ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ');
  const icons = { company_name: 'comp-sort-name', contact_count: 'comp-sort-count', created_at: 'comp-sort-added' };
  const icon = document.getElementById(icons[col]);
  if (icon) icon.textContent = s.dir === 1 ? 'ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ' : 'ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ';
  _cmSortTable('cmb-companies', col, s.dir, col === 'contact_count');
}

function cmFilterComp() {
  const name  = (document.getElementById('comp-fi-name')?.value || '').toLowerCase();
  const tbody = document.querySelector('#cmb-companies tbody');
  if (!tbody) return;
  [...tbody.querySelectorAll('tr')].forEach(row => {
    const rName = (row.querySelectorAll('td')[0]?.textContent||'').toLowerCase();
    row.style.display = (!name || rName.includes(name)) ? '' : 'none';
  });
}

// Populate companies dropdown on tab open
function _cmPopulateCompDropdown() {
  const sel = document.getElementById('comp-fi-name');
  if (!sel || sel.dataset.populated) return;
  sel.dataset.populated = '1';
  const tbody = document.querySelector('#cmb-companies tbody');
  if (!tbody) return;
  const companies = [...new Set(
    [...tbody.querySelectorAll('tr')].map(r => r.querySelectorAll('td')[0]?.textContent.trim()).filter(Boolean)
  )].sort();
  companies.forEach(c => {
    const o = document.createElement('option');
    o.value = c.toLowerCase(); o.textContent = c;
    sel.appendChild(o);
  });
}

/* ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
   SHARED SORT UTILITY
   ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ */

function _cmSortTable(bodyId, col, dir, numeric) {
  const tbody  = document.querySelector('#' + bodyId + ' tbody');
  if (!tbody) return;
  const rows   = [...tbody.querySelectorAll('tr')];
  const colMap = {
    // audience
    name: 0, title: 1, company: 2, status: 3,
    // companies
    company_name: 0, contact_count: 2, created_at: 3
  };
  const idx = colMap[col] ?? 0;
  rows.sort((a, b) => {
    const av = a.querySelectorAll('td')[idx]?.textContent.trim() || '';
    const bv = b.querySelectorAll('td')[idx]?.textContent.trim() || '';
    if (numeric) return (parseFloat(av)||0) > (parseFloat(bv)||0) ? dir : -dir;
    return av.localeCompare(bv) * dir;
  });
  rows.forEach(r => tbody.appendChild(r));
}

/* ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
   AUTO-INIT: populate dropdowns when tabs load
   ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ */

(function patchSwitchCMTab() {
  const orig = window.switchCMTab;
  if (!orig) return;
  window.switchCMTab = function(tab) {
    orig(tab);
    setTimeout(() => {
      if (tab === 'audience') {
        _cmPopulateCompanyDropdown('aud-fi-company', 'cmb-audience', 2);
      } else if (tab === 'companies') {
        _cmPopulateCompDropdown();
      }
    }, 400);
  };
})();
