/* ============================================================================
   宇宙奶龙大学 —— 学院作品列表的读取

   难点：静态站点没有后端，**没法列出目录**（没有 readdir 这种东西）。
   所以只能靠约定，两种来源**混合使用**：

     来源一 list.txt（优先展示）：在学院目录里放一个 list.txt，一行一个文件名，
                     例如：
                         奶龙在图书馆.webp
                         奶龙打篮球.webp
                     写在**下面**的更新 → 显示在上面。

     来源二 数字命名（补充展示）：1.webp、2.webp、3.webp……
                     页面从 1 开始并行探测，探测到断档就停。
                     编号**大**的更新 → 显示在上面。

   最终顺序：**先列 list.txt 里的，再接数字命名的**。
   两边都有的（比如清单里写了 1.webp）只显示一次，以清单的位置为准 ——
   这样「精心排序的放前面，随手丢进来的垫后面」。
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

  // 用来判重的键：大小写不敏感，且忽略 .webp 后缀
  // —— 清单里写「1」还是「1.webp」都算同一个文件
  function key(file) {
    return String(file).replace(/\.webp$/i, '').toLowerCase();
  }

  // ---- 来源一：读 list.txt。没有就返回空数组（不是 null，方便直接拼）----
  function fromList(base) {
    return grab(base + '/list.txt').then(function (txt) {
      if (txt === null) return [];
      var names = txt.replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .map(function (s) { return s.trim(); })
        .filter(function (s) { return s && s.charAt(0) !== '#'; });   // # 开头当注释
      // 写在后面的更新 → 倒序，新的在上面
      names.reverse();
      return names.map(function (n) {
        // 清单里没写后缀的，自动补 .webp（少打字，也不容易打错）
        var name = /\.webp$/i.test(n) ? n : n + '.webp';
        return { file: name, url: base + '/' + encodeURIComponent(name) };
      });
    });
  }

  // ---- 来源二：并行探测 1.webp、2.webp…… ----
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

    return runBatch(1);
  }

  /**
   * 读一个学院的全部作品：list.txt 里的在前，数字命名的在后。
   * @param {string} collegeFile 学院名（用作目录名，和 src/ 的命名规则一致）
   * @returns {Promise<Array<{file:string, url:string}>>} 已排好序
   */
  function loadWorks(collegeFile) {
    var base = 'works/' + encodeURIComponent(collegeFile);

    // 两个来源并行发，别串行等 —— 少一个往返
    return Promise.all([fromList(base), fromNumbers(base)])
      .then(function (both) {
        var listed = both[0];
        var numbered = both[1];

        var seen = {};
        var out = [];

        // 先放清单里的（已按「新的在前」倒序）
        listed.forEach(function (w) {
          var k = key(w.file);
          if (seen[k]) return;              // 清单自己写重了，去重
          seen[k] = 1;
          out.push(w);
        });

        // 再接编号文件里没被清单提到的，编号大的在前
        numbered.sort(function (a, b) { return b.n - a.n; })
          .forEach(function (w) {
            var k = key(w.file);
            if (seen[k]) return;            // 清单里已经有了，跳过
            seen[k] = 1;
            out.push(w);
          });

        return out;
      });
  }

  global.NailongWorks = { loadWorks: loadWorks };
})(window);
