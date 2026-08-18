// ============================================================
// 问题反馈弹窗：标题栏气泡入口与 fx 控制台「系统 → 问题反馈」共用。
// 提交经本地服务 /api/feedback 转发至自建反馈服务器（与卸载器共用
// 端点，app 字段 .inapp 区分来源），诊断信息由服务端组装。
// ============================================================
var feedbackSubmitting = false;

function openFeedbackModal() {
  var mask = document.getElementById('feedback-modal');
  if (!mask) return;
  resetFeedbackForm();
  openGsapModal(mask);
}

function closeFeedbackModal() {
  var mask = document.getElementById('feedback-modal');
  if (mask) closeGsapModal(mask);
}

function resetFeedbackForm() {
  var area = document.getElementById('feedback-textarea');
  if (area) area.value = '';
  var contact = document.getElementById('feedback-contact');
  if (contact) contact.value = '';
  var check = document.getElementById('feedback-diag-check');
  if (check) check.checked = true;
  setFeedbackType('问题报告');
  setFeedbackStatus('');
  var submit = document.getElementById('feedback-submit');
  if (submit) { submit.disabled = false; submit.textContent = '发送反馈'; }
  var fallback = document.getElementById('feedback-web-fallback');
  if (fallback) fallback.hidden = true;
}

function setFeedbackType(type) {
  var pills = document.querySelectorAll('#feedback-type-row .feedback-type-pill');
  Array.prototype.forEach.call(pills, function (pill) {
    pill.classList.toggle('active', pill.getAttribute('data-type') === type);
  });
}

function currentFeedbackType() {
  var active = document.querySelector('#feedback-type-row .feedback-type-pill.active');
  return active ? active.getAttribute('data-type') : '问题报告';
}

function setFeedbackStatus(text, kind) {
  var el = document.getElementById('feedback-status');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'feedback-status' + (kind ? ' ' + kind : '');
}

function flyFeedbackPlane() {
  var plane = document.querySelector('#feedback-modal .feedback-plane');
  if (!plane || !window.gsap) return;
  window.gsap.fromTo(plane,
    { autoAlpha: 1, x: 0, y: 0, rotate: 0 },
    {
      autoAlpha: 0, x: 46, y: -34, rotate: 14, duration: 0.6, ease: 'power2.out',
      onComplete: function () { window.gsap.set(plane, { clearProps: 'opacity,visibility,transform' }); }
    });
}

function submitFeedback() {
  if (feedbackSubmitting) return;
  var area = document.getElementById('feedback-textarea');
  var text = area ? area.value.trim() : '';
  if (!text) {
    setFeedbackStatus('先写两句要反馈的内容吧', 'fail');
    if (area) area.focus();
    return;
  }
  var contactEl = document.getElementById('feedback-contact');
  var check = document.getElementById('feedback-diag-check');
  var submit = document.getElementById('feedback-submit');
  var fallback = document.getElementById('feedback-web-fallback');
  feedbackSubmitting = true;
  if (submit) { submit.disabled = true; submit.textContent = '发送中…'; }
  if (fallback) fallback.hidden = true;
  setFeedbackStatus('正在发送…', 'busy');
  fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: currentFeedbackType(),
      feedback: text,
      contact: contactEl ? contactEl.value.trim() : '',
      includeDiagnostics: !!(check && check.checked),
      userAgent: navigator.userAgent
    })
  }).then(function (res) {
    return res.json().then(function (data) { return { status: res.status, data: data }; });
  }).then(function (out) {
    if (out.status === 200 && out.data && out.data.ok) {
      flyFeedbackPlane();
      setFeedbackStatus('已送达，谢谢你', 'good');
      if (area) area.value = '';
      if (contactEl) contactEl.value = '';
      if (submit) submit.textContent = '已发送';
      setTimeout(closeFeedbackModal, 1400);
    } else {
      throw new Error(out.data && out.data.error || ('HTTP ' + out.status));
    }
  }).catch(function (err) {
    setFeedbackStatus('发送失败：' + (err && err.message || '网络异常'), 'fail');
    if (fallback) fallback.hidden = false;
    if (submit) { submit.disabled = false; submit.textContent = '重新发送'; }
  }).then(function () {
    feedbackSubmitting = false;
  });
}

function bindFeedbackModalEvents() {
  var row = document.getElementById('feedback-type-row');
  if (row && !row.__feedbackBound) {
    row.__feedbackBound = true;
    row.addEventListener('click', function (e) {
      var pill = e.target && e.target.closest ? e.target.closest('.feedback-type-pill') : null;
      if (!pill) return;
      setFeedbackType(pill.getAttribute('data-type'));
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindFeedbackModalEvents);
} else {
  bindFeedbackModalEvents();
}
