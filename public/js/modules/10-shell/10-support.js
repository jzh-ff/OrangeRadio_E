// ============================================================
// 赞赏支持弹窗：标题栏心形入口与 fx 控制台「系统 → 赞赏支持」共用
// ============================================================
function openSupportModal() {
  var mask = document.getElementById('support-modal');
  if (mask) openGsapModal(mask);
}

function closeSupportModal() {
  var mask = document.getElementById('support-modal');
  if (mask) closeGsapModal(mask);
}
