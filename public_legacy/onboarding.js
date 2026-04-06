// Onboarding guided tour — lightweight, no dependencies
(function() {
  if (localStorage.getItem('onboarded')) return;

  const steps = [
    { target: '#user-input', title: 'Welcome!', desc: 'Type a message here to chat with the agent or give it a task.', pos: 'top' },
    { target: '#mode-select', title: 'Execution Mode', desc: 'Choose Auto, Fast (rules), Deep (LLM), or Shell mode.', pos: 'bottom' },
    { target: '#convo-list', title: 'Conversations', desc: 'Your chat history appears here. Click to resume.', pos: 'right' },
    { target: '#right-panel', title: 'Live View', desc: 'Watch the agent work in real-time. Screenshots and traces show here.', pos: 'left' },
    { target: '#open-settings', title: 'Settings', desc: 'Configure theme, notifications, API keys, and login.', pos: 'top' }
  ];

  let current = 0;
  let overlay, tooltip;

  function create() {
    overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.4);transition:opacity .2s';
    document.body.appendChild(overlay);

    tooltip = document.createElement('div');
    tooltip.style.cssText = 'position:fixed;z-index:9999;background:white;border-radius:12px;padding:16px 20px;max-width:300px;box-shadow:0 20px 60px rgba(0,0,0,.3);font-size:14px;color:#111;transition:all .2s';
    document.body.appendChild(tooltip);
  }

  function show(idx) {
    if (idx >= steps.length) { finish(); return; }
    current = idx;
    const step = steps[idx];
    const el = document.querySelector(step.target);
    if (!el) { show(idx + 1); return; }

    // Highlight target
    el.style.position = el.style.position || 'relative';
    el.style.zIndex = '9999';
    el.style.boxShadow = '0 0 0 4px rgba(59,130,246,.5)';
    el.style.borderRadius = '8px';

    const rect = el.getBoundingClientRect();
    tooltip.innerHTML = '<div style="font-weight:600;margin-bottom:4px">' + step.title + '</div>' +
      '<div style="color:#666;font-size:13px;margin-bottom:12px">' + step.desc + '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center">' +
      '<span style="color:#999;font-size:11px">' + (idx + 1) + '/' + steps.length + '</span>' +
      '<div><button id="tour-skip" style="padding:4px 12px;font-size:12px;color:#999;background:none;border:none;cursor:pointer">Skip</button>' +
      '<button id="tour-next" style="padding:4px 16px;font-size:12px;color:white;background:#3b82f6;border:none;border-radius:6px;cursor:pointer">' +
      (idx === steps.length - 1 ? 'Done' : 'Next') + '</button></div></div>';

    // Position tooltip
    const gap = 12;
    if (step.pos === 'top') {
      tooltip.style.left = Math.max(8, rect.left) + 'px';
      tooltip.style.top = Math.max(8, rect.top - tooltip.offsetHeight - gap) + 'px';
    } else if (step.pos === 'bottom') {
      tooltip.style.left = Math.max(8, rect.left) + 'px';
      tooltip.style.top = (rect.bottom + gap) + 'px';
    } else if (step.pos === 'right') {
      tooltip.style.left = (rect.right + gap) + 'px';
      tooltip.style.top = Math.max(8, rect.top) + 'px';
    } else {
      tooltip.style.left = Math.max(8, rect.left - 320) + 'px';
      tooltip.style.top = Math.max(8, rect.top) + 'px';
    }

    document.getElementById('tour-next').onclick = () => { cleanup(el); show(idx + 1); };
    document.getElementById('tour-skip').onclick = finish;
  }

  function cleanup(el) {
    if (el) { el.style.zIndex = ''; el.style.boxShadow = ''; }
  }

  function finish() {
    steps.forEach(s => { const el = document.querySelector(s.target); if (el) cleanup(el); });
    if (overlay) overlay.remove();
    if (tooltip) tooltip.remove();
    localStorage.setItem('onboarded', 'true');
  }

  window.startOnboarding = function() {
    localStorage.removeItem('onboarded');
    create();
    show(0);
  };

  // Auto-start after short delay on first visit
  setTimeout(() => { create(); show(0); }, 1500);
})();
