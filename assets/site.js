/* ============================================================================
   宇宙奶龙大学 —— 子页面共用脚本

   三件事：
     1. 百度统计。站点 ID 和 index.html 里那个是同一个 —— 百度统计按**域名**
        建站点，三个子页面挂同一段代码就归到「宇宙奶龙大学.com」这一个站点下，
        后台能按页面路径分别看到 /home.html、/show.html 各自的访问量。
     2. 往 body 里插背景三层（.flow / .frost），省得每个页面都写一遍；
        星星层是 body::before，CSS 里已经有了，不用管。
     3. 生成左上角返回按钮。目标页由 <body data-back="xxx.html"> 指定：
          · show.html / notice.html → data-back="home.html"（默认值）
          · home.html               → data-back="index.html"
        不写 data-back 就用默认的 home.html。
   ============================================================================ */
(function () {
  // ---- 百度统计 ----
  // 和 index.html 里同一套官方 loader，只是这里不需要抢时间（子页面不跳转），
  // 所以没有 dns-prefetch / preconnect 那两道预热。
  var _hmt = window._hmt = window._hmt || [];
  (function () {
    var hm = document.createElement('script');
    hm.src = 'https://hm.baidu.com/hm.js?c6a7e5d19abc2b50696c43f0cbf78d4b';
    hm.async = true;
    var s = document.getElementsByTagName('script')[0];
    s.parentNode.insertBefore(hm, s);
  })();

  // 顺手记一下访问的是哪个页面，后台的「事件」里能直接看出来
  _hmt.push(['_trackEvent', 'page', 'view',
             location.pathname.replace(/^\//, '') || 'index.html']);

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

  // ---- 返回按钮 ----
  // 404 页面自己已经放了两个按钮（回首页 / 奶龙主页），不需要再插一个
  // 固定在左上角的「返回」——那会和它的布局打架。用 data-no-back 退出。
  if (document.body.hasAttribute('data-no-back')) return;

  var target = document.body.getAttribute('data-back') || 'home.html';
  var label = document.body.getAttribute('data-back-label') || '返回';

  var back = document.createElement('a');
  back.className = 'back-btn';
  back.href = target;
  back.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M15 18l-6-6 6-6"/></svg><span></span>';
  back.querySelector('span').textContent = label;
  back.setAttribute('aria-label', label.indexOf('返回') === 0 ? label : '返回' + label);
  document.body.appendChild(back);

  // 站内跳过来的（referrer 是同站）就 history.back()，保留用户原来的滚动位置；
  // 其余情况一律用 <a> 的 href 正常跳转。
  //
  // 注意 referrer 一定要判同源：早期版本只看有没有 referrer，
  // 结果从搜索引擎 / 书签直接进 home.html 时，点「返回首页」会退回站外，
  // 而不是去 index.html。
  function fromSameSite() {
    if (!document.referrer) return false;
    try {
      return new URL(document.referrer).origin === location.origin;
    } catch (e) {
      return false;   // referrer 不是合法 URL，当站外处理
    }
  }

  back.addEventListener('click', function (e) {
    if (history.length > 1 && fromSameSite()) {
      e.preventDefault();
      history.back();
    }
  });
})();
