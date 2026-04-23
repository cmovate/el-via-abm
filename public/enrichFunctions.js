function startEnrichment(listId, wsId) {
  var resultEl = document.getElementById('save-result');
  var offset = 0, total = 0, enriched = 0, skipped = 0;
  if (!wsId && typeof workspaceId !== 'undefined') wsId = parseInt(workspaceId);

  function bar(pct, label) {
    return '<div class="progress-wrap">'
      + '<div class="progress-label">' + label + '</div>'
      + '<div class="progress-bar-bg"><div class="progress-bar-fill" style="width:' + pct + '%;background:#6366f1;transition:width 0.4s"></div></div>'
      + '</div>';
  }

  function next() {
    fetch('/api/enrich-list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list_id: listId, workspace_id: wsId, offset: offset })
    }).then(function(r){ return r.json(); })
    .then(function(d) {
      if (d.finished) {
        if (resultEl) resultEl.innerHTML = '<div class="progress-done" style="margin-top:8px">' + String.fromCharCode(10003) + ' Stage 2 done: ' + enriched + ' enriched, ' + skipped + ' skipped.</div>';
        if (typeof loadSavedLists === 'function') loadSavedLists();
        return;
      }
      total = d.total || total;
      offset = d.done || (offset + 1);
      if (d.skipped) { skipped++; } else { enriched++; }
      var pct = total > 0 ? Math.round((offset / total) * 100) : 0;
      if (resultEl) resultEl.innerHTML = bar(pct, 'Stage 2: ' + offset + ' / ' + total + ' (' + enriched + ' enriched)...');
      setTimeout(next, 400);
    }).catch(function() { offset++; setTimeout(next, 800); });
  }
  if (resultEl) resultEl.innerHTML = bar(0, 'Stage 2 starting enrichment...');
  next();
}
