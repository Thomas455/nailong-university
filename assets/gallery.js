/* ============================================================================
   宇宙奶龙大学 —— 学院卡片翻转 + 作品浏览

   交互：
     · 点学院卡片 → 卡片翻转放大、铺满页面大部分，露出该学院的作品列表
     · 作品列表可上下滚动；鼠标悬停显示文件名
     · 点某件作品 → 全屏放大；右上角 × 关闭；底部显示文件名
     · 作品列表右下角「关闭」→ 翻回去，回到最初的展览馆网格

   实现要点：
     · 翻转沿用 CSS 3D（rotateY + preserve-3d），不用库。
       卡片本身是网格里的一格，翻转后靠 .stage 挪到屏幕中央并放大 ——
       用 transform 而不是改 position，动画才能跑在 GPU 上。
     · 作品列表用 NailongWorks.loadWorks() 读（见 works.js）。
     · 灯箱用 <dialog>：自带 Esc 关闭、焦点陷阱和 ::backdrop，省一大截代码。
   ============================================================================ */
(function () {
  'use strict';

  var stage = document.getElementById('stage');
  var card = document.getElementById('flipcard');
  var worksBox = document.getElementById('works');
  var worksTitle = document.getElementById('worksTitle');
  var worksCount = document.getElementById('worksCount');
  var closeBtn = document.getElementById('closeWorks');
  var viewer = document.getElementById('viewer');
  var viewerImg = document.getElementById('viewerImg');
  var viewerName = document.getElementById('viewerName');

  var current = null;      // 当前打开的学院名
  var lastFocus = null;    // 关闭后把焦点还回去
  var loading = false;

  // ---------- 打开 / 关闭 ----------
  function open(item, fromEl) {
    if (loading || current) return;
    current = item.name;
    lastFocus = fromEl || null;
    loading = true;

    worksTitle.textContent = item.name;
    worksCount.textContent = '正在加载作品……';
    worksBox.innerHTML = '';

    // 锁住背景滚动，否则翻开的卡片会跟着页面一起滚
    document.documentElement.classList.add('flipping');
    stage.classList.add('open');
    card.classList.add('flipped');
    card.setAttribute('aria-hidden', 'false');
    closeBtn.focus();

    NailongWorks.loadWorks(item.file).then(function (list) {
      loading = false;
      if (current !== item.name) return;      // 期间被关掉了，别乱改 DOM
      renderWorks(list);
    }).catch(function () {
      loading = false;
      worksCount.textContent = '加载失败';
    });
  }

  function close() {
    if (!current) return;
    current = null;
    loading = false;
    stage.classList.remove('open');
    card.classList.remove('flipped');
    card.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('flipping');
    // 等翻转动画播完再清空，免得内容在翻转途中消失
    setTimeout(function () {
      if (!current) { worksBox.innerHTML = ''; worksTitle.textContent = ''; }
    }, 420);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  // ---------- 渲染作品列表 ----------
  function renderWorks(list) {
    worksBox.innerHTML = '';

    if (!list.length) {
      worksCount.textContent = '还没有作品';
      var empty = document.createElement('div');
      empty.className = 'works-empty';
      // 顺便告诉维护者怎么放作品 —— 这个页面只有作者会看到「空」状态
      empty.innerHTML = '这个学院还没有上传作品。<br><br>' +
        '把 webp 图片放进 <code>works/' +
        esc(worksTitle.textContent) + '/</code>，命名成 ' +
        '<code>1.webp</code>、<code>2.webp</code>…… 就会出现在这里。' +
        '<br>想保留自己的文件名，就在同目录放一个 <code>list.txt</code>，一行一个名字。';
      worksBox.appendChild(empty);
      return;
    }

    worksCount.textContent = '共 ' + list.length + ' 件作品';

    var frag = document.createDocumentFragment();
    list.forEach(function (w) {
      var fig = document.createElement('figure');
      fig.className = 'work';
      fig.tabIndex = 0;
      fig.setAttribute('role', 'button');

      var img = document.createElement('img');
      img.src = w.url;
      img.alt = w.file.replace(/\.webp$/i, '');
      img.loading = 'lazy';            // 作品可能很多，这个该懒加载
      img.decoding = 'async';

      // 悬停显示文件名（CSS 控制淡入，这里只放内容）
      var cap = document.createElement('figcaption');
      cap.textContent = w.file.replace(/\.webp$/i, '');

      fig.appendChild(img);
      fig.appendChild(cap);
      fig.setAttribute('aria-label', '查看 ' + cap.textContent);

      function openViewer() {
        viewerImg.src = w.url;
        viewerImg.alt = cap.textContent;
        viewerName.textContent = w.file;    // 底部显示完整文件名（含扩展名）
        viewer.showModal();
      }
      fig.addEventListener('click', openViewer);
      fig.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openViewer(); }
      });

      frag.appendChild(fig);
    });
    worksBox.appendChild(frag);
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  // ---------- 灯箱 ----------
  // 点背景（不是图片本身）关掉；<dialog> 自带 Esc
  viewer.addEventListener('click', function (e) {
    if (e.target === viewer) viewer.close();
  });
  document.getElementById('viewerClose').addEventListener('click', function () {
    viewer.close();
  });

  // ---------- 事件绑定 ----------
  closeBtn.addEventListener('click', close);

  // 作品列表内部滚动时，别让滚轮事件冒到外层把页面也滚了
  worksBox.addEventListener('wheel', function (e) {
    var atTop = worksBox.scrollTop <= 0;
    var atBottom = worksBox.scrollTop + worksBox.clientHeight >= worksBox.scrollHeight - 1;
    if ((atTop && e.deltaY < 0) || (atBottom && e.deltaY > 0)) return;   // 到头了就让页面滚
    e.stopPropagation();
  }, { passive: true });

  // 把 open/close 暴露给下面生成卡片的代码
  window.__boothOpen = open;
  window.__boothClose = close;
})();
