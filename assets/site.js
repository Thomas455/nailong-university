/* ============================================================================
   宇宙奶龙大学 —— 子页面共用脚本

   两件事：
     1. 往 body 里插背景三层（.flow / .frost），省得每个页面都写一遍；
        星星层是 body::before，CSS 里已经有了，不用管。
     2. 生成左上角返回按钮 —— 只有 home.html 不需要（它是根页面），
        靠 <body data-home> 标记区分。
   ============================================================================ */
(function () {
  // ---- 背景 ----
  var flow = document.createElement('div');
  flow.className = 'flow';
  flow.setAttribute('aria-hidden', 'true');
  flow.innerHTML = '<i></i><i></i><i></i><i></i><i></i>';

  var frost = document.createElement('div');
  frost.className = 'frost';
  frost.setAttribute('aria-hidden', 'true');

  document.body.insertBefore(frost, document.body.firstChild);
  document.body.insertBefore(flow, frost);

  // ---- 返回按钮（home 页不需要）----
  if (document.body.hasAttribute('data-home')) return;

  var back = document.createElement('a');
  back.className = 'back-btn';
  back.href = 'home.html';
  back.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M15 18l-6-6 6-6"/></svg><span>返回</span>';
  back.setAttribute('aria-label', '返回上一页');
  document.body.appendChild(back);

  // 有浏览历史就回退（保留用户原来的滚动位置），否则去 home.html
  back.addEventListener('click', function (e) {
    if (history.length > 1 && document.referrer) {
      e.preventDefault();
      history.back();
    }
  });
})();
