/* ============================================================================
   宇宙奶龙大学 —— 学院作品列表的读取

   难点：静态站点没有后端，**没法列出目录**（没有 readdir 这种东西）。
   所以只能靠约定，两种方式：

     方式一（省事）：把作品命名成 1.webp、2.webp、3.webp……
                     页面从 1 开始并行探测，探测到断档就停。
                     编号大的（新的）显示在上面。

     方式二（想保留原文件名）：在学院目录里放一个 list.txt，
                     一行一个文件名，例如：
                         奶龙在图书馆.webp
                         奶龙打篮球.webp
                     页面按清单里的**倒序**显示（写在最后的在最上面 = 最新）。

   有 list.txt 就以它为准，没有才退回数字探测。
   ============================================================================ */
(function (global) {
  'use strict';

  var BATCH = 12;      // 每批并行探测几个（并行 = 省往返，GitHub Pages 上约 0.25s/RTT）
  var TAIL_MISS = 3;   // 一批末尾连着缺几个就认定到底了
  var HARD_CAP = 500;  // 兜底上限

  // 取一个文件；不存在就 resolve(null)，不抛错
  function grab(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      return r.ok ? r.text() : null;
    }).catch(function () { return null; });
  }

  // 探测一个文件在不在。
  // 优先 HEAD（没有响应体，最省）；要是服务器不认 HEAD（少数静态托管会返回
  // 405/501），或者 HEAD 报错，就退回 GET。
  // 会不会重复请求：只有 HEAD 失败时才多发一次，正常情况下零浪费。
  function exists(url) {
    return fetch(url, { method: 'HEAD', cache: 'no-cache' }).then(function (r) {
      if (r.ok) return true;
      // 405 Method Not Allowed / 501 Not Implemented → 这个服务器不支持 HEAD
      if (r.status === 405 || r.status === 501) return existsViaGet(url);
      return false;
    }).catch(function () {
      // 网络层就失败了（有些托管直接断开 HEAD），也试一次 GET
      return existsViaGet(url);
    });
  }

  function existsViaGet(url) {
    return fetch(url, { method: 'GET', cache: 'no-cache' }).then(function (r) {
      return r.ok;
    }).catch(function () { return false; });
  }

  // ---- 方式二：读 list.txt ----
  function fromList(base) {
    return grab(base + '/list.txt').then(function (txt) {
      if (txt === null) return null;
      var names = txt.replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .map(function (s) { return s.trim(); })
        .filter(function (s) { return s && s.charAt(0) !== '#'; });   // # 开头当注释
      if (!names.length) return null;
      // 清单里写在后面的更新 → 倒序，新的在上面
      return names.reverse().map(function (n) {
        return { file: n, url: base + '/' + encodeURIComponent(n) };
      });
    });
  }

  // ---- 方式一：并行探测 1.webp、2.webp…… ----
  function fromNumbers(base) {
    var hits = [];

    function runBatch(start) {
      if (start > HARD_CAP) return hits;

      var nums = [];
      for (var k = 0; k < BATCH && start + k <= HARD_CAP; k++) nums.push(start + k);

      return Promise.all(nums.map(function (n) {
        var name = n + '.webp';
        return exists(base + '/' + name).then(function (ok) {
          return { n: n, name: name, ok: ok };
        });
      })).then(function (res) {
        res.forEach(function (r) {
          if (r.ok) hits.push({ n: r.n, file: r.name, url: base + '/' + r.name });
        });

        // 这一批末尾连着缺 TAIL_MISS 个 → 后面没有了
        var tail = res.slice(-TAIL_MISS);
        var done = tail.length >= TAIL_MISS && tail.every(function (r) { return !r.ok; });
        return done ? hits : runBatch(start + BATCH);
      });
    }

    return runBatch(1).then(function (list) {
      // 编号大的（新的）在上面
      list.sort(function (a, b) { return b.n - a.n; });
      return list;
    });
  }

  /**
   * 读一个学院的全部作品。
   * @param {string} collegeFile 学院名（用作目录名，和 src/ 的命名规则一致）
   * @returns {Promise<Array<{file:string, url:string}>>} 已排好序，新的在前
   */
  function loadWorks(collegeFile) {
    var base = 'works/' + encodeURIComponent(collegeFile);
    return fromList(base).then(function (list) {
      if (list && list.length) return list;
      return fromNumbers(base);
    });
  }

  global.NailongWorks = { loadWorks: loadWorks };
})(window);
