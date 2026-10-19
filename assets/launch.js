/* ============================================================================
   宇宙奶龙大学 · 首页 3D 发射场景

   「奶龙号」从发射台升空 → 冲出大气层 → 太空巡航（沿途展示校史）
   → 点击悬浮按钮 → 抵达「广州大学星」→ 跳转。

   ---- 依赖 ----
   assets/three.min.js（Three.js r149，本地 vendor，不走 CDN）
   为什么不走 CDN：中文网络下 jsdelivr / unpkg 经常连不上，
   而这页是网站入口，白屏比多 600KB 严重得多。

   ---- 设计要点 ----
   · 全部程序化几何体（锥/柱/球/环），不加载模型文件；
   · 纹理用 Canvas 现画，零额外请求；
   · 时间轴驱动：所有动作都是 elapsed 的函数，好调也好测；
   · 不做 scene.fog —— 太空里没有雾，而且 FogExp2 会在几百单位外
     把星空和终点星球全部吃掉（踩过这个坑）；
   · 用 ACES 色调映射：高光滚降，不会像直出那样一片死白。
   ============================================================================ */

(function () {
  'use strict';

  if (!window.THREE) {
    window.__launchFailed = true;
    return;
  }

  var THREE = window.THREE;

  /* ============================================================
     时序（毫秒）
     ============================================================ */
  var T = {
    PRE: 2000,         // 发射台待机：点火预热（要求「2 秒后升天」）
    ASCEND: 7000,      // 升空到大气层外
    PITCH: 2400,       // 太空中侧倾转向
    HISTORY_GAP: 3800, // 校史卡片自动切换间隔
    GLIDE: 4600        // 点击后冲向星球
  };

  var SPACE_Y = 200;      // 太空巡航高度
  var CRUISE = 30;        // 太空中每秒前进多少单位

  /* ============================================================
     小工具
     ============================================================ */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function easeIn(t) { t = clamp(t, 0, 1); return t * t; }
  function easeOut(t) { t = clamp(t, 0, 1); return 1 - (1 - t) * (1 - t); }

  function makeTexture(w, h, draw, opt) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    var tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 4;
    if (opt && opt.repeat) {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(opt.repeat[0], opt.repeat[1]);
    }
    return tex;
  }

  /* ============================================================
     渲染器
     ============================================================ */
  var canvas = document.getElementById('scene');
  if (!canvas) return;

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: canvas, antialias: true, alpha: false,
      powerPreference: 'high-performance'
    });
  } catch (e) {
    window.__launchFailed = true;
    return;
  }

  renderer.setClearColor(0x05070f, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  // ACES 让高光平滑滚降 —— 不做的话白箭体 + 强光会糊成一片死白
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  var scene = new THREE.Scene();
  // ⚠️ 不加 scene.fog：太空没雾，而且 FogExp2 会在 900 单位外
  //    把星空（900~3300）和终点星球（1500）全吃掉
  var camera = new THREE.PerspectiveCamera(50, 1, 0.5, 12000);
  camera.position.set(11, 5, 17);

  /* ---------- 灯光 ----------
     深空场景的关键：环境光要低，靠主光 + 轮廓光拉开层次。
     环境光一高，什么材质都是一片平灰。 */
  // ⚠️ 强度参考：r149 默认 physicallyCorrectLights=false，
  //    DirectionalLight.intensity 直接当「倍数」用，不是物理单位。
  //    几盏灯加起来超过 1 就会开始过曝 —— 第一版写了 3.1+1.9+0.45，
  //    整个场景糊成一片死白，这是修回来的值。
  scene.add(new THREE.HemisphereLight(0x2c3f6b, 0x05070f, 0.30));

  var sun = new THREE.DirectionalLight(0xfff3dc, 1.35);
  sun.position.set(-45, 95, 70);
  scene.add(sun);

  var rim = new THREE.DirectionalLight(0x5f8dff, 0.75);
  rim.position.set(65, -25, -75);
  scene.add(rim);

  var fill = new THREE.DirectionalLight(0xffffff, 0.22);
  fill.position.set(40, 15, 45);
  scene.add(fill);

  var engineLight = new THREE.PointLight(0xffb45c, 0, 70, 2);
  scene.add(engineLight);

  /* ============================================================
     星空
     一个大球壳，每帧跟着相机走（星空本来就「无限远」，
     跟着相机才不会在飞行时穿帮）。 */
  var starField = (function () {
    var COUNT = 3400;
    var pos = new Float32Array(COUNT * 3);
    var col = new Float32Array(COUNT * 3);
    var c = new THREE.Color();

    for (var i = 0; i < COUNT; i++) {
      var u = Math.random(), v = Math.random();
      var theta = 2 * Math.PI * u;
      var phi = Math.acos(2 * v - 1);
      var r = 1400 + Math.random() * 2600;
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi);
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

      // 冷白为主，掺一点暖黄 / 淡蓝 / 淡粉，避免一片死白
      var t = Math.random();
      if (t < 0.70) c.setHex(0xffffff);
      else if (t < 0.87) c.setHex(0x9fc4ff);
      else if (t < 0.96) c.setHex(0xffe6b0);
      else c.setHex(0xffc4d8);
      var dim = 0.5 + Math.random() * 0.5;
      col[i * 3] = c.r * dim;
      col[i * 3 + 1] = c.g * dim;
      col[i * 3 + 2] = c.b * dim;
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

    // 圆形点精灵：默认的方形点在深色背景上很扎眼
    var tex = makeTexture(64, 64, function (g) {
      var grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.4, 'rgba(255,255,255,.7)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    });

    var mat = new THREE.PointsMaterial({
      size: 13, map: tex, vertexColors: true,
      transparent: true, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true
    });

    var pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    scene.add(pts);
    return pts;
  })();

  /* ============================================================
     星云
     几团大面积、极低透明度、加法混合的云，压在星空后面当背景。
     做法：用 Canvas 画一张「多层柔和光斑」的云图，再拉到很大的尺寸。

     ⚠️ 尺度和透明度都要克制：
        · 太亮会把星星糊掉，整个背景变成一块脏色；
        · sprite 必须跟着相机走，否则飞着飞着就穿出去了。
     ============================================================ */
  var nebulaGroup = new THREE.Group();
  nebulaGroup.frustumCulled = false;
  scene.add(nebulaGroup);

  (function buildNebula() {
    // 一张「云」：若干半径/透明度随机的柔和光斑叠在一起，
    // 边缘用 radial gradient 收到 0，避免出现硬边。
    function makeCloud(seed, tint) {
      return makeTexture(512, 512, function (g, w, h) {
        g.clearRect(0, 0, w, h);
        var rnd = seed;
        function rand() { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; }

        // 底层：一大团很淡的底光
        var base = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        base.addColorStop(0, 'rgba(' + tint + ',0.34)');
        base.addColorStop(0.42, 'rgba(' + tint + ',0.14)');
        base.addColorStop(0.72, 'rgba(' + tint + ',0.04)');
        base.addColorStop(1, 'rgba(' + tint + ',0)');
        g.fillStyle = base;
        g.fillRect(0, 0, w, h);

        // 上层：40 团大小不一的亮斑，让云的内部有明暗层次
        for (var i = 0; i < 40; i++) {
          var cx = w * (0.18 + rand() * 0.64);
          var cy = h * (0.18 + rand() * 0.64);
          var r = 26 + rand() * 120;
          var a = 0.05 + rand() * 0.14;
          var gg = g.createRadialGradient(cx, cy, 0, cx, cy, r);
          gg.addColorStop(0, 'rgba(255,255,255,' + a.toFixed(3) + ')');
          gg.addColorStop(0.45, 'rgba(' + tint + ',' + (a * 0.55).toFixed(3) + ')');
          gg.addColorStop(1, 'rgba(' + tint + ',0)');
          g.fillStyle = gg;
          g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
        }

        // 几道暗纹，像尘埃带
        g.globalCompositeOperation = 'destination-out';
        for (var k = 0; k < 7; k++) {
          var dx = w * (0.1 + rand() * 0.8);
          var dy = h * (0.1 + rand() * 0.8);
          var dr = 40 + rand() * 110;
          var dg = g.createRadialGradient(dx, dy, 0, dx, dy, dr);
          dg.addColorStop(0, 'rgba(0,0,0,' + (0.10 + rand() * 0.22).toFixed(3) + ')');
          dg.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = dg;
          g.beginPath(); g.arc(dx, dy, dr, 0, Math.PI * 2); g.fill();
        }
        g.globalCompositeOperation = 'source-over';
      });
    }

    // 冷色调为主，掺一点紫和青 —— 和站点的深蓝底、金色主色能搭上
    var clouds = [
      { tint: '90,130,255', seed: 7331, pos: [-1500, 300, -2400], size: 6200, op: 0.40 },
      { tint: '150,110,255', seed: 9127, pos: [1900, -500, -2900], size: 7200, op: 0.34 },
      { tint: '60,190,220', seed: 4451, pos: [-2200, -700, 1500], size: 5600, op: 0.30 },
      { tint: '255,150,190', seed: 2237, pos: [2400, 900, 1600], size: 5200, op: 0.22 },
      { tint: '120,160,255', seed: 8803, pos: [600, 1800, 2600], size: 6600, op: 0.26 }
    ];

    for (var i = 0; i < clouds.length; i++) {
      var c = clouds[i];
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeCloud(c.seed, c.tint),
        transparent: true,
        opacity: c.op,
        depthWrite: false,
        depthTest: false,            // 永远在最后面，不和火箭/星球抢深度
        blending: THREE.AdditiveBlending,
        fog: false
      }));
      sp.position.set(c.pos[0], c.pos[1], c.pos[2]);
      sp.scale.set(c.size, c.size, 1);
      sp.renderOrder = -100;         // 最先画，当背景
      nebulaGroup.add(sp);
    }
  })();

  /* ============================================================
     发射台
     ============================================================ */
  var padGroup = new THREE.Group();
  scene.add(padGroup);

  (function buildPad() {
    // 发射场地面：绿色陆地。
    // 不是纯绿平涂 —— 加了斑块、暗斑和细噪点，远看是草地、
    // 近看有起伏，否则一大片纯绿在 3D 里会像一块塑料板。
    var groundTex = makeTexture(1024, 1024, function (g, w, h) {
      // 底色：中心稍亮（被发射台照到），边缘暗下去
      var grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grd.addColorStop(0, '#39733f');
      grd.addColorStop(0.34, '#2c5c33');
      grd.addColorStop(0.66, '#1d4025');
      grd.addColorStop(1, '#0e2115');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);

      var rnd = 4711;
      function rand() { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; }

      // 深浅斑块，模拟草地/林地的不均匀
      for (var i = 0; i < 260; i++) {
        var cx = rand() * w, cy = rand() * h;
        var r = 24 + rand() * 120;
        var dark = rand() > 0.5;
        var gg = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        if (dark) {
          gg.addColorStop(0, 'rgba(12,34,18,.35)');
          gg.addColorStop(1, 'rgba(12,34,18,0)');
        } else {
          gg.addColorStop(0, 'rgba(104,168,96,.26)');
          gg.addColorStop(1, 'rgba(104,168,96,0)');
        }
        g.fillStyle = gg;
        g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
      }

      // 细噪点：近看时的草皮颗粒感
      var img = g.getImageData(0, 0, w, h);
      var d = img.data;
      for (var k = 0; k < d.length; k += 4) {
        var n = (rand() - 0.5) * 26;
        d[k]     = Math.max(0, Math.min(255, d[k] + n));
        d[k + 1] = Math.max(0, Math.min(255, d[k + 1] + n * 1.15));
        d[k + 2] = Math.max(0, Math.min(255, d[k + 2] + n * 0.7));
      }
      g.putImageData(img, 0, 0);

      // 发射场感：几道很淡的同心圆 + 放射线（压在白线以下）
      g.strokeStyle = 'rgba(226,240,200,.10)';
      g.lineWidth = 3;
      for (var r2 = 96; r2 < w / 2; r2 += 92) {
        g.beginPath(); g.arc(w / 2, h / 2, r2, 0, Math.PI * 2); g.stroke();
      }
      g.strokeStyle = 'rgba(226,240,200,.055)';
      g.lineWidth = 2;
      for (var a = 0; a < 24; a++) {
        var ang = (a / 24) * Math.PI * 2;
        g.beginPath();
        g.moveTo(w / 2 + Math.cos(ang) * 150, h / 2 + Math.sin(ang) * 150);
        g.lineTo(w / 2 + Math.cos(ang) * (w / 2 - 12), h / 2 + Math.sin(ang) * (w / 2 - 12));
        g.stroke();
      }
    });

    // 远处淡出用的 alpha 图：中心不透明白，越往外越透。
    // 不加这层的话，直径 1000+ 的圆盘会在远处切出一道笔直的硬地平线，
    // 竖屏手机上尤其难看（下半屏是一整块暗色平板）。
    var fadeTex = makeTexture(512, 512, function (g, w, h) {
      var grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grd.addColorStop(0, '#ffffff');
      grd.addColorStop(0.40, '#ffffff');
      grd.addColorStop(0.60, '#a0a0a0');
      grd.addColorStop(0.80, '#303030');
      grd.addColorStop(1, '#000000');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
    });

    var ground = new THREE.Mesh(
      new THREE.CircleGeometry(520, 96),
      new THREE.MeshStandardMaterial({
        map: groundTex, roughness: 0.94, metalness: 0.05,
        color: 0x9fbf98,
        alphaMap: fadeTex, transparent: true, depthWrite: false
      })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.02;
    padGroup.add(ground);

    // 发射台圆台
    var baseMat = new THREE.MeshStandardMaterial({
      color: 0x1b2338, roughness: 0.62, metalness: 0.55
    });
    var base = new THREE.Mesh(new THREE.CylinderGeometry(7.6, 9.0, 1.3, 48), baseMat);
    base.position.y = 0.65;
    padGroup.add(base);

    // 台面上一圈黄灯
    var ring = new THREE.Mesh(
      new THREE.TorusGeometry(7.3, 0.11, 8, 80),
      new THREE.MeshBasicMaterial({
        color: 0xfece0e, transparent: true, opacity: 0.5, fog: false
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 1.32;
    padGroup.add(ring);
    padGroup.userData.ring = ring;

    // 台面边缘一圈冷光灯带，和暖黄形成冷暖对比
    var cool = new THREE.Mesh(
      new THREE.TorusGeometry(8.6, 0.07, 8, 80),
      new THREE.MeshBasicMaterial({
        color: 0x5f8dff, transparent: true, opacity: 0.4, fog: false
      })
    );
    cool.rotation.x = -Math.PI / 2;
    cool.position.y = 0.35;
    padGroup.add(cool);

    // 四根支腿
    var legMat = new THREE.MeshStandardMaterial({
      color: 0x18203a, roughness: 0.62, metalness: 0.55
    });
    for (var i = 0; i < 4; i++) {
      var a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      var leg = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.52, 2.8, 12), legMat);
      leg.position.set(Math.cos(a) * 7.0, 1.4, Math.sin(a) * 7.0);
      leg.rotation.z = Math.cos(a) * 0.14;
      leg.rotation.x = -Math.sin(a) * 0.14;
      padGroup.add(leg);
    }
  })();

  /* ============================================================
     奶龙号
     程序化拼装。原点在箭体底部，所以 group.y = 1.3 正正好立在台面上。
     ============================================================ */
  var rocket = new THREE.Group();
  rocket.position.set(0, 1.3, 0);
  scene.add(rocket);

  (function buildRocket() {
    /* ============================================================
       奶龙号的尺寸全部由下面这几个常量推出来。
       想整体拉长/变胖只改这里，各部分位置会自动跟着走 ——
       之前是满篇硬编码数字，改一个高度要连带改十几处，很容易漏。
       ============================================================ */
    var Y0 = 0.75;        // 箭体底面高度（下面接喷管）
    var BH = 7.2;         // 箭体高度（原 5.6，拉长 29%）
    var RT = 1.38;        // 箭体顶部半径
    var RB = 1.74;        // 箭体底部半径
    var NOSE_H = 3.0;     // 头锥高度
    // 圆周分段数。72 段完全看不出棱；16 段每个面约 22°，
    // 配合 flatShading 就能读出明确的切面 —— 这是「棱角」的关键。
    var SEG = 16;
    var NOSE_SEG = 24;    // 头锥给多一点面：16 段太像宝石，24 段刚好有棱但不碎
    var YTOP = Y0 + BH;   // 箭体顶面

    // 任意高度处的箭体半径（圆柱是锥形的，贴花半径得按这个算）
    function radiusAt(y) {
      return RB + (RT - RB) * (y - Y0) / BH;
    }

    // flatShading：每个三角面单独算法线，面与面之间出现明确的明暗断层 ——
    // 这就是「棱角」的来源。配合下面减少的面数，箭体变成有切面的硬表面，
    // 而不是一个塑料感的圆筒。
    var white = new THREE.MeshStandardMaterial({
      color: 0xdfe4f2, roughness: 0.34, metalness: 0.28, flatShading: true
    });
    var gold = new THREE.MeshStandardMaterial({
      color: 0xfece0e, roughness: 0.28, metalness: 0.62, flatShading: true,
      emissive: 0x3a2c00, emissiveIntensity: 0.35
    });
    var dark = new THREE.MeshStandardMaterial({
      color: 0x1c2236, roughness: 0.42, metalness: 0.85, flatShading: true
    });

    // ---- 箭体 ----
    // 不是纯色圆柱：蒙皮纹理上有横向板缝、纵向缝、铆钉和很淡的竖向脏污。
    // 纯白柱在深色太空里像塑料玩具，有板缝才有金属壳体的质感。
    var bodyTex = makeTexture(1024, 1024, function (g, w, h) {
      var grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, '#f2f5fc');
      grd.addColorStop(0.55, '#e6ebf6');
      grd.addColorStop(1, '#d6dcec');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);

      for (var y = 88; y < h; y += 112) {
        g.strokeStyle = 'rgba(132,146,176,.17)';
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,.55)';
        g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(0, y + 2.5); g.lineTo(w, y + 2.5); g.stroke();
      }

      g.strokeStyle = 'rgba(136,150,180,.11)';
      g.lineWidth = 1.5;
      for (var x = 0; x < w; x += w / 8) {
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
      }

      g.fillStyle = 'rgba(150,162,190,.20)';
      for (var yy = 88; yy < h; yy += 112) {
        for (var xx = 14; xx < w; xx += 34) {
          g.beginPath(); g.arc(xx, yy, 2, 0, Math.PI * 2); g.fill();
        }
      }

      for (var i2 = 0; i2 < 26; i2++) {
        g.fillStyle = 'rgba(108,120,150,' + (0.010 + Math.random() * 0.018).toFixed(3) + ')';
        g.fillRect(Math.random() * w, 0, 4 + Math.random() * 18, h);
      }
    });

    var bodyMat = new THREE.MeshStandardMaterial({
      map: bodyTex, color: 0xffffff, roughness: 0.38, metalness: 0.30,
      flatShading: true
    });
    var body = new THREE.Mesh(new THREE.CylinderGeometry(RT, RB, BH, SEG), bodyMat);
    body.position.y = Y0 + BH / 2;
    rocket.add(body);

    // ---- 头锥 ----
    var nose = new THREE.Mesh(new THREE.ConeGeometry(RT, NOSE_H, NOSE_SEG), gold);
    nose.position.y = YTOP + NOSE_H / 2;
    rocket.add(nose);

    // 头锥根的过渡环（收口，不然圆锥和圆柱直接撞在一起很生硬）
    var collar = new THREE.Mesh(
      new THREE.CylinderGeometry(RT + 0.05, RT + 0.05, 0.24, SEG), gold
    );
    collar.position.y = YTOP;
    rocket.add(collar);

    // 头锥底部的四片小导流片（细节，让头锥不那么单调）
    var vaneMat = new THREE.MeshStandardMaterial({
      color: 0xe8b400, roughness: 0.35, metalness: 0.55
    });
    for (var v = 0; v < 4; v++) {
      var va = (v / 4) * Math.PI * 2;
      var vane = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55, 0.42), vaneMat);
      vane.position.set(
        Math.cos(va) * (RT - 0.12), YTOP - 0.62, Math.sin(va) * (RT - 0.12)
      );
      vane.rotation.y = -va;
      rocket.add(vane);
    }

    // ---- 箭体上的装饰环 ----
    for (var b = 0; b < 2; b++) {
      var byy = Y0 + BH * (0.075 + b * 0.70);
      var band = new THREE.Mesh(
        new THREE.CylinderGeometry(radiusAt(byy) + 0.03, radiusAt(byy) + 0.03, 0.1, SEG), gold
      );
      band.position.y = byy;
      rocket.add(band);
    }

    // ---- 级间段（二级火箭的分段位置）----
    var yi = Y0 + BH * 0.855;
    var interstage = new THREE.Mesh(
      new THREE.CylinderGeometry(radiusAt(yi) + 0.05, radiusAt(yi) + 0.09, 0.34, SEG), dark
    );
    interstage.position.y = yi;
    rocket.add(interstage);

    var interstageRing = new THREE.Mesh(
      new THREE.TorusGeometry(radiusAt(yi) + 0.07, 0.055, 6, SEG), gold
    );
    interstageRing.rotation.x = Math.PI / 2;
    interstageRing.position.y = yi + 0.17;
    rocket.add(interstageRing);

    // ---- 顶端 4 个姿态控制喷口（RCS）----
    var rcsMat = new THREE.MeshStandardMaterial({
      color: 0x39405c, roughness: 0.45, metalness: 0.8
    });
    var yRCS = Y0 + BH * 0.945;
    for (var r = 0; r < 4; r++) {
      var ra = (r / 4) * Math.PI * 2 + Math.PI / 4;
      var rr2 = radiusAt(yRCS) - 0.02;
      var rcs = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.34, 8), rcsMat);
      rcs.position.set(Math.cos(ra) * rr2, yRCS, Math.sin(ra) * rr2);
      rcs.rotation.z = Math.cos(ra) * 0.5;
      rcs.rotation.x = -Math.sin(ra) * 0.5;
      rocket.add(rcs);
    }

    // ---- 沿箭体的一条外置导管 ----
    var yPipeA = Y0 + BH * 0.06;
    var yPipeB = Y0 + BH * 0.80;
    var pipeCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.60, yPipeA, radiusAt(yPipeA) - 0.20),
      new THREE.Vector3(0.66, Y0 + BH * 0.30, radiusAt(Y0 + BH * 0.30) - 0.22),
      new THREE.Vector3(0.70, Y0 + BH * 0.56, radiusAt(Y0 + BH * 0.56) - 0.22),
      new THREE.Vector3(0.70, yPipeB, radiusAt(yPipeB) - 0.20)
    ]);
    var pipe = new THREE.Mesh(
      new THREE.TubeGeometry(pipeCurve, 40, 0.045, 8, false),
      new THREE.MeshStandardMaterial({ color: 0xb9c2d8, roughness: 0.35, metalness: 0.85 })
    );
    rocket.add(pipe);

    // ---- 尾喷管 ----
    var bell = new THREE.Mesh(
      new THREE.CylinderGeometry(1.02, 1.62, 1.25, SEG, 1, true), dark
    );
    bell.position.y = 0.16;
    bell.material.side = THREE.DoubleSide;
    rocket.add(bell);

    var bellInner = new THREE.Mesh(
      new THREE.CylinderGeometry(0.72, 1.25, 1.2, SEG, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffb45c, transparent: true, opacity: 0, fog: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    bellInner.position.y = 0.18;
    rocket.add(bellInner);
    rocket.userData.bellInner = bellInner;

    // 尾段 4 根支撑斜撑
    var strutMat = new THREE.MeshStandardMaterial({
      color: 0x2b3350, roughness: 0.55, metalness: 0.7
    });
    for (var s2 = 0; s2 < 4; s2++) {
      var sa = (s2 / 4) * Math.PI * 2 + Math.PI / 4;
      var strut = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.9, 0.075), strutMat);
      strut.position.set(Math.cos(sa) * 1.16, 0.62, Math.sin(sa) * 1.16);
      strut.rotation.z = Math.cos(sa) * 0.22;
      strut.rotation.x = -Math.sin(sa) * 0.22;
      rocket.add(strut);
    }

    // ---- 发动机管线 ----
    // 真实火箭的喷管周围全是管路，一个光溜溜的锥形喷口会很假。
    // 这里做：一圈环形总管 + 4 根主燃料管（从箭体底部绕到喉部）+ 喷管加强筋。
    var plumbMat = new THREE.MeshStandardMaterial({
      color: 0xa9b3cc, roughness: 0.32, metalness: 0.92, flatShading: true
    });

    // 环形总管
    var manifold = new THREE.Mesh(
      new THREE.TorusGeometry(1.18, 0.075, 6, 24), plumbMat
    );
    manifold.rotation.x = Math.PI / 2;
    manifold.position.y = 1.02;
    rocket.add(manifold);

    // 4 根主燃料管：从箭体底部（半径大）向下绕到喷管喉部（半径小）
    for (var pi = 0; pi < 4; pi++) {
      var pa = (pi / 4) * Math.PI * 2 + Math.PI / 4;
      var px1 = Math.cos(pa), pz1 = Math.sin(pa);
      var curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(px1 * 0.86, 1.86, pz1 * 0.86),
        new THREE.Vector3(px1 * 1.26, 1.34, pz1 * 1.26),
        new THREE.Vector3(px1 * 1.20, 1.00, pz1 * 1.20),
        new THREE.Vector3(px1 * 0.99, 0.66, pz1 * 0.99)
      ]);
      var tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 20, 0.058, 6, false), plumbMat
      );
      rocket.add(tube);

      // 每根管子在总管附近加一个小法兰（一圈小圆盘）
      var flange = new THREE.Mesh(
        new THREE.CylinderGeometry(0.115, 0.115, 0.05, 8), plumbMat
      );
      flange.position.set(px1 * 1.22, 1.12, pz1 * 1.22);
      rocket.add(flange);
    }

    // 喷管加强筋：竖着贴在锥面上的细条，让喷口不再是光滑的喇叭
    var ribMat = new THREE.MeshStandardMaterial({
      color: 0x39415c, roughness: 0.5, metalness: 0.8, flatShading: true
    });
    for (var ri = 0; ri < 8; ri++) {
      var ra2 = (ri / 8) * Math.PI * 2;
      var rib = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.1, 0.1), ribMat);
      // 贴在喷管外壁：高度 0.16 处半径约 1.3，向下半径变大
      rib.position.set(Math.cos(ra2) * 1.32, 0.16, Math.sin(ra2) * 1.32);
      rib.rotation.y = -ra2;
      rib.rotation.z = Math.cos(ra2) * 0.12;
      rib.rotation.x = -Math.sin(ra2) * 0.12;
      rocket.add(rib);
    }

    // ---- 尾翼：3 片后掠梯形 ----
    var FIN_H = 3.7;
    var finShape = new THREE.Shape();
    finShape.moveTo(0, FIN_H);
    finShape.lineTo(0, 0.05);
    finShape.lineTo(1.88, 0.48);
    finShape.lineTo(1.64, 1.72);
    finShape.closePath();

    var finGeo = new THREE.ExtrudeGeometry(finShape, {
      depth: 0.15, bevelEnabled: true, bevelSize: 0.035,
      bevelThickness: 0.035, bevelSegments: 2
    });
    finGeo.translate(0, 0, -0.075);

    for (var i = 0; i < 3; i++) {
      var a = (i / 3) * Math.PI * 2;
      var holder = new THREE.Group();
      holder.rotation.y = a;
      var finMesh = new THREE.Mesh(finGeo, gold);
      finMesh.position.set(RB - 0.02, 0.55, 0);
      holder.add(finMesh);
      rocket.add(holder);
    }

    // ---- 舷窗：奶龙坐在里面 ----
    // 做成「凸出的圆形舷窗」：一段短筒从壳体伸出，玻璃嵌在筒口，外面套金环。
    // 直接把平面圆片贴在圆柱上，边缘会浮在壳体外面，很假。
    var yWin = Y0 + BH * 0.635;
    var rWin = radiusAt(yWin);
    var winGroup = new THREE.Group();
    winGroup.position.set(0, yWin, rWin);
    rocket.add(winGroup);

    var winBarrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.92, 0.86, 0.34, 40, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0xdfe4f2, roughness: 0.4, metalness: 0.35, side: THREE.DoubleSide
      })
    );
    winBarrel.rotation.x = Math.PI / 2;
    winBarrel.position.z = 0.15;
    winGroup.add(winBarrel);

    // 优先用内联的 data URI（见 assets/textures.js）。
    // 直接用 'core.webp' 的话，file:// 双击打开时 WebGL 会拒绝这张跨源贴图，
    // 舷窗就变成一片空白 —— 而程序画的「奶龙号」却正常，很容易误判成模型问题。
    var NAILONG_SRC = (window.__TEX && window.__TEX.naiLong) || 'core.webp';
    var winTex = new THREE.TextureLoader().load(NAILONG_SRC);
    winTex.encoding = THREE.sRGBEncoding;

    var winDisc = new THREE.Mesh(
      new THREE.CircleGeometry(0.85, 40),
      new THREE.MeshBasicMaterial({ map: winTex, transparent: true, fog: false })
    );
    winDisc.position.z = 0.24;
    winGroup.add(winDisc);

    var winRim = new THREE.Mesh(
      new THREE.TorusGeometry(0.9, 0.1, 14, 56),
      new THREE.MeshStandardMaterial({
        color: 0xfece0e, roughness: 0.42, metalness: 0.45,
        emissive: 0x2a1f00, emissiveIntensity: 0.6
      })
    );
    winRim.position.z = 0.31;
    winGroup.add(winRim);

    var winGlow = new THREE.Mesh(
      new THREE.CircleGeometry(1.45, 36),
      new THREE.MeshBasicMaterial({
        color: 0xffe9a8, transparent: true, opacity: 0.16, fog: false,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    winGlow.position.z = 0.33;
    winGroup.add(winGlow);

    // ---- 贴花：用圆柱的一段弧，紧贴曲面 ----
    // ⚠️ 半径必须大于该高度处的箭体半径，否则整块贴花会陷进壳体里看不见。
    function arcDecal(y, height, arcDeg, tex, extraR) {
      var theta = arcDeg * Math.PI / 180;
      var rad = radiusAt(y) + (extraR || 0.075);
      var geo = new THREE.CylinderGeometry(rad, rad, height, 44, 1, true, -theta / 2, theta);
      var mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, depthWrite: false,
        side: THREE.FrontSide, fog: false
      });
      var m = new THREE.Mesh(geo, mat);
      m.position.y = y;
      return m;
    }

    /* --- 「奶龙号」竖排字：贴在 +X 面（尾翼上方），并偏 30° 正对镜头 ---
       · 角度取 30°：三片尾翼在 0°/120°/240°，30° 正好在两片之间，
         且尾翼最高只到 y≈3.75，字贴在 4.1 上方完全不冲突；
       · 贴在 +X 附近而不是 +Z：火箭进入太空会侧倾 -90°，
         ±Z 面变成朝上/朝下，只有 ±X 附近始终是「侧面」，
         追尾镜头才看得见。
       竖排：三个字在 canvas 里纵向排列，贴到圆柱上仍然是竖着的。 */
    var nameTex2 = makeTexture(256, 1024, function (g, w, h) {
      g.clearRect(0, 0, w, h);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      var chars = ['奶', '龙', '号'];
      for (var k = 0; k < chars.length; k++) {
        g.save();
        g.font = '900 168px "PingFang SC","Microsoft YaHei",sans-serif';
        // 深金字 + 浅色外发光：白箭体上也能压得住
        g.shadowColor = 'rgba(255,255,255,.95)';
        g.shadowBlur = 22;
        g.fillStyle = '#8a6a00';
        g.fillText(chars[k], w / 2, 215 + k * 250);
        // 描一圈亮边，增强立体感
        g.shadowBlur = 0;
        g.lineWidth = 4;
        g.strokeStyle = 'rgba(255,255,255,.5)';
        g.strokeText(chars[k], w / 2, 215 + k * 250);
        g.restore();
      }
    });
    var yName = Y0 + BH * 0.395;
    var nameDecal2 = arcDecal(yName, 2.35, 44, nameTex2);
    nameDecal2.rotation.y = Math.PI * 0.167;   // 30°
    rocket.add(nameDecal2);

    // --- 广州大学校徽：贴在 +Z 面（舷窗下方）---
    var yLogo = Y0 + BH * 0.185;
    var logoDecal = arcDecal(yLogo, 1.5, 54, null);
    logoDecal.rotation.y = 0;                  // 朝向 +Z
    rocket.add(logoDecal);

    // 等图加载完画进 canvas，并加一圈金边 ——
    // ⚠️ 用原生 Image 而不用 THREE.TextureLoader：
    //    TextureLoader 的回调给的是 Texture 对象，不是 Image，
    //    直接 drawImage 会抛「provided value is not of type HTMLImageElement」。
    var logoImg = new Image();
    logoImg.onload = function () {
      var c = document.createElement('canvas');
      c.width = c.height = 512;
      var g = c.getContext('2d');
      g.clearRect(0, 0, 512, 512);

      g.strokeStyle = '#fece0e';
      g.lineWidth = 20;
      g.beginPath(); g.arc(256, 256, 232, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = 'rgba(140,106,0,.75)';
      g.lineWidth = 6;
      g.beginPath(); g.arc(256, 256, 243, 0, Math.PI * 2); g.stroke();

      g.drawImage(logoImg, 46, 46, 420, 420);

      var lt = new THREE.CanvasTexture(c);
      lt.encoding = THREE.sRGBEncoding;
      lt.anisotropy = 4;
      logoDecal.material.map = lt;
      logoDecal.material.needsUpdate = true;
    };
    logoImg.onerror = function () {
      console.error('[logo] 校徽加载失败，检查 assets/gzhu-logo.png 是否存在');
    };
    logoImg.src = (window.__TEX && window.__TEX.gzhuLogo) || 'assets/gzhu-logo.png';

    // ---- 天线 + 顶端飞行灯 ----
    var antenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 1.2, 8),
      new THREE.MeshStandardMaterial({ color: 0xbfc7dd, roughness: 0.3, metalness: 0.9 })
    );
    antenna.position.y = YTOP + NOSE_H + 0.55;
    rocket.add(antenna);

    var tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xff4d4d, fog: false })
    );
    tip.position.y = YTOP + NOSE_H + 1.18;
    rocket.add(tip);
    rocket.userData.tip = tip;

    var tipCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0x8f97b3, roughness: 0.25, metalness: 0.95 })
    );
    tipCap.position.y = YTOP + NOSE_H - 0.02;
    rocket.add(tipCap);
  })();

  /* ============================================================
     尾焰
     两层圆锥（内白外金）+ 一层火星粒子
     ============================================================ */
  var flameGroup = new THREE.Group();
  flameGroup.position.y = -0.45;
  rocket.add(flameGroup);

  // 尾焰用「顶点色 + 加法混合」做衰减：
  // 圆锥底部（喷口处）最亮，越到尖端越暗，最后融进黑色背景。
  // 只靠材质 opacity 的话，圆锥轮廓是一条硬边，看起来像一块实心白三角。
  function makePlume(radius, height, colorHex, opacity) {
    var geo = new THREE.ConeGeometry(radius, height, 28, 3, true);
    var pos = geo.attributes.position;
    var n = pos.count;
    var cols = new Float32Array(n * 3);
    var c = new THREE.Color(colorHex);
    for (var i = 0; i < n; i++) {
      // ConeGeometry 局部坐标：尖端在 +h/2，底面在 -h/2
      var y = pos.getY(i);
      var tv = (y + height / 2) / height;   // 0 = 底面, 1 = 尖端
      // 底面满亮，尖端归零；再开个平方让衰减更柔和
      var k = Math.pow(1 - tv, 1.9) * 0.58;
      cols[i * 3] = c.r * k;
      cols[i * 3 + 1] = c.g * k;
      cols[i * 3 + 2] = c.b * k;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    var mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: opacity,
      blending: THREE.AdditiveBlending, depthWrite: false,
      // ⚠️ FrontSide 而不是 DoubleSide：镜头绕到箭体后方时会「看进」锥体内壁，
      //    双面渲染会把内壁也画出来，叠加成一个白色圆饼。单面后从后面只看到喷口辉光。
      side: THREE.FrontSide, fog: false
    });
    return new THREE.Mesh(geo, mat);
  }

  // 内焰：窄而亮
  var flameInner = makePlume(0.48, 3.6, 0xfff0c8, 0.30);
  flameInner.rotation.x = Math.PI;
  flameInner.position.y = -1.9;
  flameGroup.add(flameInner);

  // 外焰：宽而淡，带橙
  var flameOuter = makePlume(1.15, 8.0, 0xff8a1e, 0.26);
  flameOuter.rotation.x = Math.PI;
  flameOuter.position.y = -4.1;
  flameGroup.add(flameOuter);

  // 喷口辉光：一张永远面向相机的精灵。
  // 上一版只靠圆锥表现火焰，一旦镜头绕到箭体后方，就会「看进锥体内壁」，
  // 糊成一个白色圆饼。加这层 billboard 辉光后，从任何角度看都是亮的火。
  var nozzleGlowTex = makeTexture(256, 256, function (g) {
    var grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,246,220,.95)');
    grd.addColorStop(0.14, 'rgba(255,214,130,.55)');
    grd.addColorStop(0.38, 'rgba(255,160,60,.18)');
    grd.addColorStop(1, 'rgba(255,130,30,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  });
  var nozzleGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: nozzleGlowTex, transparent: true, fog: false,
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0
  }));
  nozzleGlow.scale.set(1.4, 1.4, 1);
  nozzleGlow.position.y = -0.5;
  flameGroup.add(nozzleGlow);
  flameGroup.userData.glow = nozzleGlow;

  // 火星
  var embers = (function () {
    var N = 320;
    var pos = new Float32Array(N * 3);
    var vel = new Float32Array(N * 3);
    var life = new Float32Array(N);
    for (var i = 0; i < N; i++) life[i] = -1;

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    var tex = makeTexture(64, 64, function (g) {
      var grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(255,245,215,1)');
      grd.addColorStop(0.35, 'rgba(255,196,110,.85)');
      grd.addColorStop(1, 'rgba(255,120,40,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    });

    var mat = new THREE.PointsMaterial({
      size: 0.38, map: tex, transparent: true, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true, color: 0xffcf80
    });

    var pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    flameGroup.add(pts);
    return { points: pts, pos: pos, vel: vel, life: life, n: N, geo: geo };
  })();

  /* ============================================================
     尾迹
     上面那套 embers 是挂在 flameGroup 上的「火星」，跟着火箭走，
     只在喷口附近扑腾 —— 它形不成尾迹。

     真正的尾迹必须**留在世界坐标系里**：火箭飞走后，喷出来的东西
     原地留在后面，才看得出走过一条路。所以这套粒子直接挂在 scene 上。

     每个粒子有独立的大小 / 透明度 / 颜色：
       刚喷出 —— 小、亮白偏黄；
       0.6 秒  —— 变大、转橙；
       越往后  —— 继续膨胀、转暗红发灰、淡出。
     用自定义 ShaderMaterial 而不是 PointsMaterial：
     PointsMaterial 的 size 和 opacity 对所有点是一个值，
     做不出「一边膨胀一边淡出」的烟。

     ⚠️ 用环形缓冲，不新建对象 —— 每帧都要生成几十个粒子，
        频繁 new/GC 在手机上会掉帧。
     ============================================================ */
  var trail = (function () {
    var MAX = 1100;
    var pos = new Float32Array(MAX * 3);
    var col = new Float32Array(MAX * 3);
    var siz = new Float32Array(MAX);
    var alp = new Float32Array(MAX);

    // 每个粒子的内部状态
    var vel = new Float32Array(MAX * 3);
    var age = new Float32Array(MAX);
    var life = new Float32Array(MAX);
    var grow = new Float32Array(MAX);
    var seed = new Float32Array(MAX);

    for (var i = 0; i < MAX; i++) { age[i] = -1; life[i] = 1; }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alp, 1));
    geo.setDrawRange(0, MAX);

    var tex = makeTexture(128, 128, function (g) {
      var grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.30, 'rgba(255,255,255,.62)');
      grd.addColorStop(0.62, 'rgba(255,255,255,.18)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    });

    var mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: tex },
        // 由 resize() 更新：把世界单位换算成屏幕像素
        uProj: { value: 600 }
      },
      vertexShader: [
        'attribute float aSize;',
        'attribute float aAlpha;',
        'attribute vec3 aColor;',
        'uniform float uProj;',
        'varying float vA;',
        'varying vec3 vC;',
        'void main() {',
        '  vA = aAlpha;',
        '  vC = aColor;',
        '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
        '  gl_PointSize = aSize * uProj / max(0.001, -mv.z);',
        '  gl_Position = projectionMatrix * mv;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D uMap;',
        'varying float vA;',
        'varying vec3 vC;',
        'void main() {',
        '  vec4 t = texture2D(uMap, gl_PointCoord);',
        '  gl_FragColor = vec4(vC * t.rgb * vA, t.a * vA);',
        '}'
      ].join('\n'),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      fog: false
    });

    var points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 15;
    scene.add(points);

    return {
      points: points, mat: mat, n: MAX,
      pos: pos, col: col, siz: siz, alp: alp,
      vel: vel, age: age, life: life, grow: grow, seed: seed,
      cursor: 0, geo: geo
    };
  })();

  // 喷出 n 个粒子（从喷口的当前位置）
  function emitTrail(n, now) {
    var t = trail;
    var q = new THREE.Vector3();
    flameGroup.getWorldPosition(q);
    // 喷射方向 = 箭体局部 -Y 在世界里的方向
    var dir = new THREE.Vector3(0, -1, 0).applyQuaternion(rocket.quaternion);

    for (var k = 0; k < n; k++) {
      var i = t.cursor;
      t.cursor = (t.cursor + 1) % t.n;

      // 喷口附近做一个小圆盘抖动，避免所有粒子从同一个点出生
      var rr = Math.sqrt(Math.random()) * 0.7;
      var th = Math.random() * Math.PI * 2;
      var ox = Math.cos(th) * rr, oz = Math.sin(th) * rr;

      t.pos[i * 3] = q.x + ox;
      t.pos[i * 3 + 1] = q.y + (Math.random() - 0.5) * 0.5;
      t.pos[i * 3 + 2] = q.z + oz;

      // 初速：主方向顺着喷流，加一点横向散开
      var sp = 6 + Math.random() * 13;
      t.vel[i * 3] = dir.x * sp + (Math.random() - 0.5) * 3.2;
      t.vel[i * 3 + 1] = dir.y * sp + (Math.random() - 0.5) * 3.2;
      t.vel[i * 3 + 2] = dir.z * sp + (Math.random() - 0.5) * 3.2;

      t.age[i] = 0;
      t.life[i] = 1.6 + Math.random() * 1.9;          // 1.6~3.5 秒
      t.grow[i] = 3.6 + Math.random() * 4.6;          // 一生膨胀到多少倍
      t.seed[i] = Math.random();
    }
  }

  // 每帧推进
  function updateTrail(dt) {
    var t = trail;
    var alive = 0;

    for (var i = 0; i < t.n; i++) {
      if (t.age[i] < 0) { t.alp[i] = 0; t.siz[i] = 0; continue; }

      t.age[i] += dt;
      var u = t.age[i] / t.life[i];
      if (u >= 1) { t.age[i] = -1; t.alp[i] = 0; t.siz[i] = 0; continue; }

      // 位移 + 阻力（喷出后很快减速，像真的烟）
      var drag = Math.pow(0.055, dt);
      t.vel[i * 3] *= drag;
      t.vel[i * 3 + 1] *= drag;
      t.vel[i * 3 + 2] *= drag;

      t.pos[i * 3] += t.vel[i * 3] * dt;
      t.pos[i * 3 + 1] += t.vel[i * 3 + 1] * dt;
      t.pos[i * 3 + 2] += t.vel[i * 3 + 2] * dt;

      // 稍微向上飘（真空里其实不该有，但看起来更像烟，观感优先）
      t.pos[i * 3 + 1] += dt * 0.35;

      // 大小：随时间膨胀
      var base = 0.85 + t.seed[i] * 0.7;
      t.siz[i] = base * (1 + t.grow[i] * u * u);

      // 颜色：白热 → 橙 → 暗红
      var r, g, b;
      if (u < 0.18) {
        var k = u / 0.18;
        r = 1.0;
        g = 0.96 - 0.26 * k;
        b = 0.82 - 0.62 * k;
      } else if (u < 0.55) {
        var k2 = (u - 0.18) / 0.37;
        r = 1.0 - 0.28 * k2;
        g = 0.70 - 0.36 * k2;
        b = 0.20 - 0.14 * k2;
      } else {
        var k3 = (u - 0.55) / 0.45;
        r = 0.72 - 0.60 * k3;
        g = 0.34 - 0.28 * k3;
        b = 0.06 - 0.05 * k3;
      }
      t.col[i * 3] = Math.max(0, r);
      t.col[i * 3 + 1] = Math.max(0, g);
      t.col[i * 3 + 2] = Math.max(0, b);

      // 透明度：出生时快速淡入，中段保持，末段淡出
      var a;
      if (u < 0.06) a = u / 0.06;
      else if (u < 0.45) a = 1;
      else a = 1 - (u - 0.45) / 0.55;
      t.alp[i] = Math.max(0, a) * 0.46;

      alive++;
    }

    t.geo.attributes.position.needsUpdate = true;
    t.geo.attributes.aColor.needsUpdate = true;
    t.geo.attributes.aSize.needsUpdate = true;
    t.geo.attributes.aAlpha.needsUpdate = true;
    return alive;
  }

  /* ============================================================
     地球（升空后从下方看到）
     ============================================================ */
  var earth = new THREE.Group();
  earth.position.set(0, -430, -180);
  scene.add(earth);

  (function buildEarth() {
    var R = 430;
    var tex = makeTexture(2048, 1024, function (g, w, h) {
      var grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, '#0a254f');
      grd.addColorStop(0.5, '#0f4877');
      grd.addColorStop(1, '#0a254f');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);

      var rnd = 20240;
      function rand() { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; }

      // 大陆
      g.globalAlpha = 0.9;
      for (var i = 0; i < 130; i++) {
        var x = rand() * w, y = h * 0.1 + rand() * h * 0.8;
        var rx = 30 + rand() * 140, ry = 20 + rand() * 90;
        var gg = g.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
        gg.addColorStop(0, 'rgba(74,140,96,.95)');
        gg.addColorStop(0.55, 'rgba(52,108,78,.75)');
        gg.addColorStop(1, 'rgba(52,108,78,0)');
        g.fillStyle = gg;
        g.beginPath(); g.ellipse(x, y, rx, ry, rand() * 3, 0, Math.PI * 2); g.fill();
      }
      // 沙漠点缀
      g.globalAlpha = 0.5;
      for (var d = 0; d < 40; d++) {
        var dx = rand() * w, dy = h * 0.25 + rand() * h * 0.5;
        var dg = g.createRadialGradient(dx, dy, 0, dx, dy, 60);
        dg.addColorStop(0, 'rgba(196,166,96,.8)');
        dg.addColorStop(1, 'rgba(196,166,96,0)');
        g.fillStyle = dg;
        g.beginPath(); g.ellipse(dx, dy, 90, 46, 0, 0, Math.PI * 2); g.fill();
      }
      // 极冠
      g.globalAlpha = 0.95;
      g.fillStyle = 'rgba(235,245,255,.95)';
      g.fillRect(0, 0, w, h * 0.05);
      g.fillRect(0, h * 0.95, w, h * 0.05);
      // 云
      g.globalAlpha = 1;
      for (var k = 0; k < 110; k++) {
        var cx = rand() * w, cy = rand() * h;
        var cr = 30 + rand() * 110;
        var cg = g.createRadialGradient(cx, cy, 0, cx, cy, cr);
        cg.addColorStop(0, 'rgba(255,255,255,.26)');
        cg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = cg;
        g.beginPath(); g.ellipse(cx, cy, cr * 1.8, cr * 0.55, 0, 0, Math.PI * 2); g.fill();
      }
    });

    var globe = new THREE.Mesh(
      new THREE.SphereGeometry(R, 72, 54),
      new THREE.MeshStandardMaterial({
        map: tex, roughness: 0.92, metalness: 0.02,
        emissive: 0x0a1830, emissiveIntensity: 0.55
      })
    );
    earth.add(globe);

    // 大气边缘光：稍大的球、只渲染背面 + 加法混合
    var atmo = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.035, 56, 40),
      new THREE.MeshBasicMaterial({
        color: 0x6fa8ff, transparent: true, opacity: 0.42, fog: false,
        blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false
      })
    );
    earth.add(atmo);

    earth.userData.globe = globe;
  })();

  /* ============================================================
     广州大学星（终点）
     ============================================================ */
  var planetGroup = new THREE.Group();
  planetGroup.position.set(-70, 330, -2400);
  scene.add(planetGroup);

  (function buildPlanet() {
    var R = 140;

    var tex = makeTexture(2048, 1024, function (g, w, h) {
      var grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, '#f7d75a');
      grd.addColorStop(0.3, '#edb534');
      grd.addColorStop(0.58, '#c8841f');
      grd.addColorStop(0.82, '#e8b33c');
      grd.addColorStop(1, '#f2c74e');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);

      var rnd = 991;
      function rand() { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; }

      // 横向条带
      for (var i = 0; i < 110; i++) {
        var y = rand() * h;
        var hh = 4 + rand() * 26;
        g.globalAlpha = 0.08 + rand() * 0.18;
        g.fillStyle = rand() > 0.5 ? '#fff2c0' : '#8d530d';
        g.fillRect(0, y, w, hh);
      }
      // 风暴漩涡
      g.globalAlpha = 0.4;
      for (var k = 0; k < 20; k++) {
        var cx = rand() * w, cy = rand() * h;
        var cg = g.createRadialGradient(cx, cy, 0, cx, cy, 90);
        cg.addColorStop(0, 'rgba(255,244,200,.75)');
        cg.addColorStop(1, 'rgba(255,244,200,0)');
        g.fillStyle = cg;
        g.beginPath(); g.ellipse(cx, cy, 110, 34, 0, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
    });

    var globe = new THREE.Mesh(
      new THREE.SphereGeometry(R, 80, 60),
      new THREE.MeshStandardMaterial({
        map: tex, roughness: 0.66, metalness: 0.2, fog: false,
        emissive: 0x6b4708, emissiveIntensity: 0.5
      })
    );
    planetGroup.add(globe);

    // 光环
    var ringTex = makeTexture(1024, 32, function (g, w, h) {
      var grd = g.createLinearGradient(0, 0, w, 0);
      grd.addColorStop(0, 'rgba(255,190,80,0)');
      grd.addColorStop(0.12, 'rgba(255,186,74,.22)');
      grd.addColorStop(0.3, 'rgba(255,200,96,.52)');
      grd.addColorStop(0.5, 'rgba(255,214,124,.68)');
      grd.addColorStop(0.7, 'rgba(255,190,84,.42)');
      grd.addColorStop(0.88, 'rgba(255,176,64,.14)');
      grd.addColorStop(1, 'rgba(255,176,64,0)');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
    });
    var ring = new THREE.Mesh(
      new THREE.RingGeometry(R * 1.5, R * 2.45, 128),
      new THREE.MeshBasicMaterial({
        map: ringTex, transparent: true, opacity: 0.62, fog: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    ring.rotation.x = Math.PI / 2.35;
    ring.rotation.z = 0.18;
    planetGroup.add(ring);

    // 外发光
    var glowTex = makeTexture(512, 512, function (g) {
      var grd = g.createRadialGradient(256, 256, 0, 256, 256, 256);
      grd.addColorStop(0, 'rgba(255,224,130,.62)');
      grd.addColorStop(0.3, 'rgba(255,206,90,.26)');
      grd.addColorStop(0.62, 'rgba(255,190,70,.09)');
      grd.addColorStop(1, 'rgba(255,180,60,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 512, 512);
    });
    var glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, transparent: true, fog: false,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    glow.scale.set(R * 4.2, R * 4.2, 1);
    planetGroup.add(glow);

    // 远处的一层大气
    var atmo = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.06, 48, 36),
      new THREE.MeshBasicMaterial({
        color: 0xffd77a, transparent: true, opacity: 0.22, fog: false,
        blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false
      })
    );
    planetGroup.add(atmo);

    planetGroup.userData.globe = globe;
  })();

  /* ============================================================
     太空参照物

     火箭在无边的黑里匀速飞，画面其实「不动」—— 没有任何东西可以对比。
     要让前进感成立，必须有**留在世界坐标里**、被火箭甩到身后的东西：

       · 碎石：几十块低模岩石，散在航道上，火箭从它们旁边掠过；
       · 速度线：贴着相机的大量细长亮线，朝后飞，速度越快拉得越长。

     两者都用「回收」的方式维持密度：飞出身后就挪到前方去，
     不需要不停创建/销毁对象。
     ============================================================ */
  var CORRIDOR = 1100;      // 航道长度（回收时往后挪这么多）

  var debrisGroup = new THREE.Group();
  debrisGroup.frustumCulled = false;
  scene.add(debrisGroup);

  (function buildDebris() {
    var N = 46;
    var rockMat = new THREE.MeshStandardMaterial({
      color: 0x6b7390, roughness: 0.95, metalness: 0.12
    });
    // 几种不同面数的低模，混着用，不会看出是同一个模型
    var geos = [
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.DodecahedronGeometry(1, 0),
      new THREE.OctahedronGeometry(1, 1)
    ];

    for (var i = 0; i < N; i++) {
      var g = geos[i % geos.length];
      var m = new THREE.Mesh(g, rockMat);

      // 大小差很多，近处的小、远处的大，透视上更有层次
      var s = 0.7 + Math.random() * 4.2;
      m.scale.set(s, s * (0.65 + Math.random() * 0.7), s * (0.7 + Math.random() * 0.6));

      // 散布在航道周围：横向 160，纵向 120，避开正中（别糊在火箭脸上）
      var ang = Math.random() * Math.PI * 2;
      var rad = 26 + Math.random() * 150;
      m.position.set(
        Math.cos(ang) * rad,
        SPACE_Y + Math.sin(ang) * rad * 0.62,
        -Math.random() * CORRIDOR
      );

      m.rotation.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
      m.userData.spin = {
        x: (Math.random() - 0.5) * 0.5,
        y: (Math.random() - 0.5) * 0.5,
        z: (Math.random() - 0.5) * 0.5
      };
      debrisGroup.add(m);
    }
  })();

  // 速度线：一堆沿 Z 方向的细线段
  var speedLines = (function () {
    var N = 160;
    var pos = new Float32Array(N * 6);      // 每根线两个端点
    var base = new Float32Array(N * 3);     // 每根线的中心（用来回收）
    var len = new Float32Array(N);

    for (var i = 0; i < N; i++) {
      var ang = Math.random() * Math.PI * 2;
      var rad = 12 + Math.random() * 130;
      var cx = Math.cos(ang) * rad;
      var cy = SPACE_Y + Math.sin(ang) * rad * 0.7;
      var cz = -Math.random() * CORRIDOR;
      var L = 8 + Math.random() * 42;

      base[i * 3] = cx; base[i * 3 + 1] = cy; base[i * 3 + 2] = cz;
      len[i] = L;

      pos[i * 6]     = cx; pos[i * 6 + 1] = cy; pos[i * 6 + 2] = cz;
      pos[i * 6 + 3] = cx; pos[i * 6 + 4] = cy; pos[i * 6 + 5] = cz - L;
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    var mat = new THREE.LineBasicMaterial({
      color: 0x9fc4ff,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false
    });

    var lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    scene.add(lines);
    return { obj: lines, pos: pos, base: base, len: len, n: N, geo: geo };
  })();

  // 每帧回收：跑到火箭身后就挪回前方
  function updateSpaceField(now, st, speed) {
    var rz = rocket.position.z;

    // ---- 碎石 ----
    var kids = debrisGroup.children;
    for (var i = 0; i < kids.length; i++) {
      var d = kids[i];
      if (d.position.z > rz + 70) {
        d.position.z -= CORRIDOR;
        // 换一个横向位置，免得每次都在同一条线上重复
        var ang = Math.random() * Math.PI * 2;
        var rad = 26 + Math.random() * 150;
        d.position.x = Math.cos(ang) * rad;
        d.position.y = SPACE_Y + Math.sin(ang) * rad * 0.62;
      }
      d.rotation.x += d.userData.spin.x * 0.016;
      d.rotation.y += d.userData.spin.y * 0.016;
      d.rotation.z += d.userData.spin.z * 0.016;
      d.visible = st.asc >= 1;
    }

    // ---- 速度线 ----
    var sp = speedLines;
    var arr = sp.pos;
    // 速度越快，线拉得越长（最低 1 倍，巡航时约 2.2 倍）
    var stretch = 0.8 + speed * 0.045;

    for (var k = 0; k < sp.n; k++) {
      var cz = sp.base[k * 3 + 2];
      if (cz > rz + 60) {
        cz -= CORRIDOR;
        sp.base[k * 3 + 2] = cz;
        // 回收时也换个横向位置
        var a2 = Math.random() * Math.PI * 2;
        var r2 = 12 + Math.random() * 130;
        sp.base[k * 3] = Math.cos(a2) * r2;
        sp.base[k * 3 + 1] = SPACE_Y + Math.sin(a2) * r2 * 0.7;
      }
      var cx = sp.base[k * 3], cy = sp.base[k * 3 + 1];
      var L = sp.len[k] * stretch;
      arr[k * 6]     = cx; arr[k * 6 + 1] = cy; arr[k * 6 + 2] = cz;
      arr[k * 6 + 3] = cx; arr[k * 6 + 4] = cy; arr[k * 6 + 5] = cz - L;
    }
    sp.geo.attributes.position.needsUpdate = true;

    // 升空阶段还没进太空，藏起来
    sp.obj.visible = st.asc >= 1;
  }

  /* ============================================================
     状态
     ============================================================ */
  var state = {
    t0: 0,
    launched: false,
    arrived: false,
    arriveAt: 0,
    glideFrom: null,
    historyIdx: -1,
    historyShownAt: 0,
    done: false
  };

  /* ============================================================
     环视（拖动屏幕改变观察角度）

     只在太空段生效。用户按住拖动 → 相机绕箭体转；松手后停一会儿
     自动缓慢回到尾部跟随的默认机位。

     ⚠️ 必须限位：不限的话能转到箭体正前方，会看到「倒着飞」，
        而且镜头可能穿进模型里。
     ============================================================ */
  var orbit = {
    yaw: 0, pitch: 0,             // 当前角度（平滑后的）
    targetYaw: 0, targetPitch: 0, // 拖动直接改这个
    dragging: false,
    lastAt: 0,
    enabled: false                // 进入太空段才允许拖
  };

  // 限位：左右各 68°，上下 -20°~+46°
  var ORBIT_YAW_MAX = 1.19;
  var ORBIT_PITCH_MIN = -0.35;
  var ORBIT_PITCH_MAX = 0.80;
  // 松手后多久开始回正
  var ORBIT_IDLE_MS = 3200;

  (function bindOrbit() {
    var cv = canvas;
    var lastX = 0, lastY = 0, pid = null;

    function onDown(e) {
      if (!orbit.enabled || state.arrived) return;
      // 从按钮/弹窗上按下就别抢（它们在 canvas 之上，正常不会走到这里，
      // 但 pointerdown 的 target 检查一下更稳）
      if (e.target && e.target !== cv) return;
      orbit.dragging = true;
      pid = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      orbit.lastAt = performance.now();
      try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    }

    function onMove(e) {
      if (!orbit.dragging || e.pointerId !== pid) return;
      var dx = e.clientX - lastX;
      var dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      // 0.0042 rad/px ≈ 每 100 像素转 24°，手感比较跟手
      orbit.targetYaw = Math.max(-ORBIT_YAW_MAX,
        Math.min(ORBIT_YAW_MAX, orbit.targetYaw - dx * 0.0042));
      orbit.targetPitch = Math.max(ORBIT_PITCH_MIN,
        Math.min(ORBIT_PITCH_MAX, orbit.targetPitch + dy * 0.0035));
      orbit.lastAt = performance.now();
    }

    function onUp(e) {
      if (e.pointerId !== pid) return;
      orbit.dragging = false;
      pid = null;
      orbit.lastAt = performance.now();
      try { cv.releasePointerCapture(e.pointerId); } catch (err) {}
    }

    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    // 手指拖的时候别让浏览器拿去滚页
    cv.style.touchAction = 'none';
  })();

  // 每帧推进环视角度：跟手平滑 + 空闲后回正
  function updateOrbit(dt, now) {
    // 只有太空段能拖；升空/抵达到时候强制回正
    if (!orbit.enabled || state.arrived) {
      orbit.targetYaw += (0 - orbit.targetYaw) * Math.min(1, dt * 3);
      orbit.targetPitch += (0 - orbit.targetPitch) * Math.min(1, dt * 3);
    } else if (!orbit.dragging && now - orbit.lastAt > ORBIT_IDLE_MS) {
      // 松手一段时间没动 → 缓慢回到尾部跟随机位
      orbit.targetYaw += (0 - orbit.targetYaw) * Math.min(1, dt * 0.55);
      orbit.targetPitch += (0 - orbit.targetPitch) * Math.min(1, dt * 0.55);
    }
    // 二级平滑，避免拖动时抖动
    orbit.yaw += (orbit.targetYaw - orbit.yaw) * Math.min(1, dt * 9);
    orbit.pitch += (orbit.targetPitch - orbit.pitch) * Math.min(1, dt * 9);
  }

  var RAF = null;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ============================================================
     火箭位置 / 姿态
     ============================================================ */
  function rocketState(now) {
    var el = now - state.t0;
    var asc = clamp((el - T.PRE) / T.ASCEND, 0, 1);
    var spaceT = Math.max(0, el - T.PRE - T.ASCEND);
    var pitch = smooth(spaceT / T.PITCH);

    var y, z, rotX;
    if (el < T.PRE) {
      y = 1.3 + Math.sin(now * 0.045) * 0.03;
      z = 0;
      rotX = 0;
    } else if (asc < 1) {
      y = 1.3 + SPACE_Y * easeIn(asc);
      z = 0;
      rotX = 0;
    } else {
      rotX = -Math.PI / 2 * pitch;
      y = SPACE_Y + 1.3 + Math.sin(now * 0.0011) * 2.4;
      z = -CRUISE * Math.max(0, spaceT - T.PITCH) / 1000;
    }
    return { y: y, z: z, rotX: rotX, asc: asc, spaceT: spaceT, pitch: pitch };
  }

  function updateRocket(now) {
    var el = now - state.t0;
    var st = rocketState(now);

    rocket.position.y = st.y;
    rocket.position.z = st.z;
    rocket.rotation.x = st.rotX;

    // 垂直阶段微微摇摆（像真火箭的姿态修正）
    rocket.rotation.z = (st.asc < 1 && el >= T.PRE)
      ? Math.sin(now * 0.0021) * 0.012 : 0;

    // --- 尾焰 / 引擎 ---
    var ign, thrust;
    if (el < T.PRE) {
      ign = smooth((el / T.PRE - 0.32) / 0.68);
      thrust = 0.3 + ign * 0.7;
    } else {
      ign = 1;
      thrust = st.asc < 1 ? 1.0 : 0.68;
    }

    var flick = 0.9 + Math.sin(now * 0.045) * 0.07 + Math.sin(now * 0.13) * 0.03;
    flameGroup.visible = ign > 0.02;
    var w = (0.55 + ign * 0.45) * flick;
    flameGroup.scale.set(w, thrust * flick * (0.35 + ign * 0.65), w);


    // ---- 「镜头是否正对着喷口」的衰减 ----
    //
    // 火箭侧倾时喷口会扫向镜头。一旦正对，就会「看进」锥体内部：
    // 外壁的正面三角形叠加起来，糊成一个白色圆饼
    // （改 FrontSide、降透明度、缩小辉光都治不干净 —— 因为几何上确实在往喷管里看）。
    // 正确做法：按夹角把尾焰锥淡出，只留火星和喷口辉光。
    var nozDir = new THREE.Vector3(0, -1, 0).applyQuaternion(rocket.quaternion);
    var nozWorld = flameGroup.getWorldPosition(new THREE.Vector3());
    var toCam = camera.position.clone().sub(nozWorld).normalize();
    var facing = nozDir.dot(toCam);                      // 1 = 正对喷口
    var plumeFade = Math.max(0, Math.min(1, (0.6 - facing) / 0.5));

    flameInner.material.opacity = (0.10 + ign * 0.32) * plumeFade;
    flameOuter.material.opacity = ign * 0.30 * plumeFade;

    // 喷管内壁发光
    if (rocket.userData.bellInner) {
      rocket.userData.bellInner.material.opacity = ign * 0.14;
    }

    // 喷口辉光（billboard）跟着点火强度走
    if (flameGroup.userData.glow) {
      flameGroup.userData.glow.material.opacity = ign * (0.46 + 0.12 * flick) * (0.35 + 0.65 * plumeFade);
      var gs = (0.9 + ign * 1.35) * (0.9 + 0.1 * flick);
      flameGroup.userData.glow.scale.set(gs, gs, 1);
    }

    // 引擎点光源跟着喷口走
    var wp = flameGroup.getWorldPosition(new THREE.Vector3());
    engineLight.position.copy(wp);
    engineLight.intensity = ign * 2.6 * flick;

    // 顶尖红灯闪
    if (rocket.userData.tip) {
      rocket.userData.tip.material.color.setHex(
        (Math.sin(now * 0.005) > 0) ? 0xff4d4d : 0x551515
      );
    }

    updateEmbers(now, ign);

    // ---- 尾迹 ----
    // 用真实帧间隔（封顶 1/30 秒，避免切后台回来时一帧跳太远）
    var nowS = now / 1000;
    var tdt = trail._last ? Math.min(0.05, nowS - trail._last) : 0.016;
    trail._last = nowS;

    // 每秒喷多少：升空时最猛，太空里少一些（真空里本来就没烟，
    // 但完全没有又看不出「刚飞过」，所以留一点点）
    var rate = 0;
    if (ign > 0.15) rate = (st.asc < 1) ? 260 : 95;
    var emitN = Math.min(24, Math.round(rate * tdt));
    if (emitN > 0) emitTrail(emitN, nowS);

    updateTrail(tdt);
    return st;
  }

  /* ============================================================
     镜头
     思想：分三个机位，用混合系数平滑过渡，避免任何瞬移。
       A 发射台机位：斜前方仰视，能看到台子和星空
       B 上升机位：始终在箭体下方偏侧，跟着一起升高（保持固定距离，
         否则火箭会越升越小，看起来像在往远处跑）
       C 太空机位：追尾，在箭体后上方
     ============================================================ */
  var camLook = new THREE.Vector3(0, 4, 0);
  var tmpV = new THREE.Vector3();

  function updateCamera(now, st, snap) {
    var el = now - state.t0;
    // 进入太空段（侧倾开始）后才允许拖动环视
    orbit.enabled = !state.arrived && st.asc >= 1;
    var px, py, pz, lx, ly, lz;

    // --- 冲刺阶段：镜头冲向星球 ---
    if (state.arrived) {
      var g = clamp((now - state.arriveAt) / T.GLIDE, 0, 1);
      var e = easeIn(g);
      var from = state.glideFrom;
      var p = planetGroup.position;
      // 从点击那一帧的机位，插值到「星球正前方」
      px = lerp(from.x, p.x + 34, e);
      py = lerp(from.y, p.y + 58, e);
      pz = lerp(from.z, p.z + 430, e);
      lx = p.x; ly = p.y; lz = p.z;

      camera.position.set(px, py, pz);
      camLook.set(lx, ly, lz);
      camera.lookAt(camLook);
      return;
    }

    // --- A / B：发射台 → 上升 ---
    if (st.asc < 1) {
      var k = easeOut(st.asc);   // 用 easeOut：一开始就跟上，别让火箭跑出画面

      // 侧面 3/4 跟拍：能看到完整箭体轮廓和尾焰，
      // 而不是从正下方只看到一个喷口圆盘（第一版就是那样）。
      // 相机在箭体侧前方一点点，高度约在箭体底部上方 1.5，
      // 视线略微上抬看向箭体中段。
      py = st.y - 1.6 + (1 - k) * 1.2;
      px = lerp(12, 10, k);
      pz = lerp(19, 16, k);

      lx = 0;
      ly = st.y + 4.2;
      lz = 0;
    } else {
      // --- C：太空追尾 ---
      // 混合系数：侧倾过程中从 B 平滑挪到 C
      var m = smooth(st.pitch);

      // B 的收尾机位（asc = 1 时，和上面那组 lerp 的终值一致）
      var bX = 12, bY = SPACE_Y + 1.3 - 1.6, bZ = 16;

      // C：尾部跟随。基准机位在箭体正后方偏上，再用环视角度绕着箭体转。
      //
      // 基准 (0, 5, 22) 是「正后方」—— 用户要的是尾随视角。
      // 想从侧面看箭体（奶龙号那面）就拖动屏幕，由 orbit 决定转多少。
      // 轻微偏一点（约 12°），正对喷口的话画面里只有一个圆盘，很单调。
      var off = new THREE.Vector3(4.2, 6.0, 20);
      // 拖动产生的环视角度绕着箭体转这个偏移
      off.applyEuler(new THREE.Euler(orbit.pitch, orbit.yaw, 0, 'YXZ'));

      var cX = off.x;
      var cY = st.y + off.y;
      var cZ = st.z + off.z;

      px = lerp(bX, cX, m);
      py = lerp(bY, cY, m);
      pz = lerp(bZ, cZ, m);

      // 注视点：箭体略偏前方。拖动时让注视点也跟着偏一点，
      // 否则转到侧面后箭体会跑到画面边上。
      lx = off.x * 0.22;
      ly = lerp(SPACE_Y + 4.7, st.y + 2.6, m);
      lz = lerp(0, st.z - 7, m);
    }

    // 平滑跟随（snap = true 时直接落位，用于首帧和还原）
    // 升空时火箭在加速，跟随系数给大一点，否则相机会被甩在后面，
    // 火箭一路顶到画面上沿
    var f = snap ? 1 : (state.arrived ? 0.18 : (st.asc > 0 && st.asc < 1 ? 0.2 : 0.1));
    camera.position.x = lerp(camera.position.x, px, f);
    camera.position.y = lerp(camera.position.y, py, f);
    camera.position.z = lerp(camera.position.z, pz, f);

    // ⚠️ 注视点的插值速率分阶段：
    //    升空时火箭在加速（约 30 单位/秒），用 0.12 会让注视点落后好几个单位，
    //    结果火箭被顶到画面外。太空段速度稳定，慢一点反而更稳。
    var lookF = snap ? 1 : ((st.asc > 0 && st.asc < 1) ? 0.36 : 0.12);
    camLook.x = lerp(camLook.x, lx, lookF);
    camLook.y = lerp(camLook.y, ly, lookF);
    camLook.z = lerp(camLook.z, lz, lookF);
    camera.lookAt(camLook);
  }

  /* ============================================================
     世界更新
     ============================================================ */
  function updateWorld(now, st) {
    // 星空跟着相机 —— 无限远的感觉
    starField.position.copy(camera.position);
    nebulaGroup.position.copy(camera.position);

    // 发射台：升到一定高度后缩一下再隐藏
    var h = rocket.position.y;
    var padFade = 1 - clamp((h - 26) / 110, 0, 1);
    padGroup.visible = padFade > 0.02;
    padGroup.scale.setScalar(1 + (1 - padFade) * 0.18);

    if (padGroup.userData.ring) {
      padGroup.userData.ring.material.opacity = 0.32 + Math.sin(now * 0.003) * 0.18;
    }

    // 环视提示：进入太空段后出现，5 秒自动淡出
    if (els.hintOrbit && !state.arrived && st.asc >= 1) {
      if (!els.hintOrbit._shown) {
        els.hintOrbit._shown = true;
        els.hintOrbit.hidden = false;
        setTimeout(function () {
          if (els.hintOrbit) els.hintOrbit.classList.add('out');
        }, 5000);
      }
    }

    // 校史文字：定位 + 淡入淡出
    var dt = Math.min(0.05, (now - updateWorld._last) / 1000 || 0.016);
    updateWorld._last = now;
    placeHistorySprite(dt);
    var cur = histSprite.material.opacity;
    histSprite.material.opacity = cur + (histTargetOpacity - cur) * Math.min(1, dt * 5.5);
    histSprite.visible = histSprite.material.opacity > 0.01;

    // 地球：升到高空才露出来
    var earthVis = clamp((h - 55) / 130, 0, 1);
    earth.visible = earthVis > 0.01;
    earth.position.y = -430 - (1 - earthVis) * 120;
    earth.userData.globe.rotation.y = now * 0.000035;

    // 参照物：碎石 + 速度线（让前进感成立）
    updateSpaceField(now, st, CRUISE);

    // 星球自转
    planetGroup.userData.globe.rotation.y = now * 0.00005;

    // 冲刺时星球放大（模拟逼近）
    if (state.arrived) {
      var g = clamp((now - state.arriveAt) / T.GLIDE, 0, 1);
      planetGroup.scale.setScalar(1 + easeIn(g) * 0.9);

        // 火箭跟着镜头一起冲向星球，摆在右前方，机头始终指向星球。
        // 不这么做的话，镜头一飞走火箭就落到画面外 —— 最后一幕只剩一颗球。
        var dir = new THREE.Vector3().subVectors(planetGroup.position, camera.position).normalize();
        var right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
        var spot = camera.position.clone()
          .addScaledVector(dir, 52)
          .addScaledVector(right, 13)
          .addScaledVector(new THREE.Vector3(0, 1, 0), -5);
        rocket.position.copy(spot);
        // 箭体长轴是 +Y，把 +Y 转到「指向星球」的方向
        rocket.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    }
  }

  function updateEmbers(now, ign) {
    var e = embers;
    var arr = e.pos, vel = e.vel, life = e.life;
    var dt = 1 / 60;

    // 喷口的世界坐标 + 箭体「向下」方向
    var nozzle = flameGroup.getWorldPosition(tmpV.clone());
    var down = new THREE.Vector3(0, -1, 0).applyQuaternion(rocket.quaternion);

    for (var i = 0; i < e.n; i++) {
      if (life[i] <= 0) {
        if (ign < 0.05) continue;
        life[i] = 0.32 + Math.random() * 0.6;
        // 喷口处加一点抖动，不然是一整坨
        arr[i * 3] = nozzle.x + (Math.random() - 0.5) * 0.7;
        arr[i * 3 + 1] = nozzle.y + (Math.random() - 0.5) * 0.7;
        arr[i * 3 + 2] = nozzle.z + (Math.random() - 0.5) * 0.7;
        var sp = 5 + Math.random() * 9;
        vel[i * 3] = down.x * sp + (Math.random() - 0.5) * 2.6;
        vel[i * 3 + 1] = down.y * sp + (Math.random() - 0.5) * 2.6;
        vel[i * 3 + 2] = down.z * sp + (Math.random() - 0.5) * 2.6;
      } else {
        life[i] -= dt;
        arr[i * 3] += vel[i * 3] * dt;
        arr[i * 3 + 1] += vel[i * 3 + 1] * dt;
        arr[i * 3 + 2] += vel[i * 3 + 2] * dt;
        vel[i * 3] *= 0.982;
        vel[i * 3 + 1] *= 0.982;
        vel[i * 3 + 2] *= 0.982;
      }
    }
    e.geo.attributes.position.needsUpdate = true;
  }

  /* ============================================================
     主循环
     ============================================================ */
  function tick() {
    RAF = requestAnimationFrame(tick);
    var now = performance.now();
    // 帧间隔（封顶 1/20 秒：切后台回来时不会一帧跳太远）
    var dt = trail._last2 ? Math.min(0.05, now / 1000 - trail._last2) : 0.016;
    trail._last2 = now / 1000;
    updateOrbit(dt, now);

    var st = updateRocket(now);
    updateCamera(now, st, false);
    updateWorld(now, st);
    updateOverlay(now);
    renderer.render(scene, camera);
  }

  /* ============================================================
     DOM 覆盖层
     ============================================================ */
  var els = {
    history: document.getElementById('history'),
    year: document.getElementById('history-year'),
    title: document.getElementById('history-title'),
    text: document.getElementById('history-text'),
    dots: document.getElementById('history-dots'),
    goBtn: document.getElementById('go-btn'),
    hud: document.getElementById('hud'),
    countdown: document.getElementById('countdown'),
    hint: document.getElementById('hint'),
    hintOrbit: document.getElementById('hint-orbit')
  };

  var HISTORY = [
    { y: '1927', t: '私立广州大学创立', d: '陈炳权先生创办，定校训「博学笃行」' },
    { y: '1944', t: '弦歌不辍', d: '抗战期间几经迁徙；全校师生为抗日捐献战斗机' },
    { y: '1953–1985', t: '五校并起', d: '广州教育学院、广州师范学院等市属高校相继创办' },
    { y: '2000', t: '五校合并', d: '组建新的广州大学，校训合成「博学笃行、与时俱进」' },
    { y: '2005', t: '迁入大学城', d: '办学空间与硬件条件得到根本性改善' },
    { y: '2006', t: '博士授予权', d: '被增列为博士学位授予单位，办学层次跃升' },
    { y: '2017 至今', t: '高水平大学建设', d: '入选广东省「冲一流、补短板、强特色」提升计划' }
  ];

  /* ============================================================
     校史文字：直接画在 3D 星空里，而不是网页上的一张卡片

     做法：把文字画到 canvas → 当纹理 → 贴到一个 Sprite 上。
     Sprite 永远面向相机，所以文字始终可读；
     但它确实位于场景中（有透视、有前后遮挡关系、星星在它周围），
     读起来就是「星空里浮着的字」。

     只用一个 canvas + 一张纹理：每次换词重画一遍，
     比给 7 条校史各建一张纹理省 10MB 显存。
     ============================================================ */
  var histCanvas = document.createElement('canvas');
  histCanvas.width = 1024;
  histCanvas.height = 448;
  var histCtx = histCanvas.getContext('2d');
  var histTex = new THREE.CanvasTexture(histCanvas);
  histTex.encoding = THREE.sRGBEncoding;
  histTex.anisotropy = 4;

  var histSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: histTex,
    transparent: true,
    opacity: 0,          // 由 showHistory / 每帧动画控制
    depthWrite: false,   // 不和星星抢深度
    fog: false
  }));
  histSprite.renderOrder = 20;
  scene.add(histSprite);

  // 当前这张字的目标不透明度（淡入淡出用）
  var histTargetOpacity = 0;
  var histFloat = 0;     // 轻微漂移的相位

  var FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",sans-serif';

  // 按最大宽度折行，返回实际行数
  function wrapText(g, text, cx, y, maxW, lineH) {
    var chars = String(text).split('');
    var line = '';
    var n = 0;
    for (var i = 0; i < chars.length; i++) {
      var test = line + chars[i];
      if (g.measureText(test).width > maxW && line) {
        g.fillText(line, cx, y + n * lineH);
        line = chars[i];
        n++;
      } else {
        line = test;
      }
    }
    if (line) { g.fillText(line, cx, y + n * lineH); n++; }
    return n;
  }

  function drawHistoryTexture(item, idx, total) {
    var g = histCtx, W = histCanvas.width, H = histCanvas.height;
    g.clearRect(0, 0, W, H);
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    var CX = W / 2;

    // ---- 顶部：细金线 + 两端小菱形 ----
    function rule(y, halfW, alpha) {
      var lg = g.createLinearGradient(CX - halfW, 0, CX + halfW, 0);
      lg.addColorStop(0, 'rgba(254,206,14,0)');
      lg.addColorStop(0.5, 'rgba(254,206,14,' + alpha + ')');
      lg.addColorStop(1, 'rgba(254,206,14,0)');
      g.strokeStyle = lg;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(CX - halfW, y);
      g.lineTo(CX + halfW, y);
      g.stroke();
    }
    function diamond(x, y, r, col) {
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(x, y - r); g.lineTo(x + r, y);
      g.lineTo(x, y + r); g.lineTo(x - r, y);
      g.closePath(); g.fill();
    }

    rule(38, 250, 0.55);
    diamond(CX - 258, 38, 5, 'rgba(254,206,14,.8)');
    diamond(CX + 258, 38, 5, 'rgba(254,206,14,.8)');

    // ---- 小标签：广州大学校史 ----
    g.save();
    g.font = '600 26px ' + FONT;
    g.fillStyle = 'rgba(160,185,255,.75)';
    g.shadowColor = 'rgba(80,130,255,.8)';
    g.shadowBlur = 16;
    g.fillText('广 州 大 学 校 史', CX, 76);
    g.restore();

    // ---- 年份：竖向渐变金 + 双层辉光 ----
    g.save();
    var yGr = g.createLinearGradient(0, 118, 0, 236);
    yGr.addColorStop(0, '#fff3b0');
    yGr.addColorStop(0.45, '#fece0e');
    yGr.addColorStop(1, '#d99a00');
    g.font = '900 150px ' + FONT;
    // 外层柔光
    g.shadowColor = 'rgba(254,206,14,.85)';
    g.shadowBlur = 70;
    g.fillStyle = yGr;
    g.fillText(item.y, CX, 176);
    // 内层锐利一次，让字口清楚
    g.shadowBlur = 0;
    g.fillText(item.y, CX, 176);
    g.restore();

    // ---- 标题：白字 + 冷色辉光 ----
    g.save();
    g.font = '800 68px ' + FONT;
    g.shadowColor = 'rgba(110,160,255,.9)';
    g.shadowBlur = 34;
    g.fillStyle = '#eef1ff';
    g.fillText(item.t, CX, 276);
    g.restore();

    // ---- 描述：两行以内，淡蓝灰 ----
    g.save();
    g.font = '600 36px ' + FONT;
    g.shadowColor = 'rgba(0,0,0,.95)';
    g.shadowBlur = 20;
    g.fillStyle = 'rgba(214,224,255,.84)';
    wrapText(g, item.d, CX, 344, W - 160, 48);
    g.restore();

    // ---- 底部：进度菱形（第几条 / 共几条）----
    var n = total || 7;
    var gap = 26;
    var startX = CX - ((n - 1) * gap) / 2;
    for (var d = 0; d < n; d++) {
      var on = d <= (idx || 0);
      diamond(startX + d * gap, 418, on ? 6 : 4,
        on ? 'rgba(254,206,14,.95)' : 'rgba(150,170,220,.32)');
    }
    rule(444, 190, 0.3);

    histTex.needsUpdate = true;
  }

  /* 把精灵摆到「相机前方偏左上」的位置，并按屏幕尺寸换算大小。
     每帧调用 —— 这样它在透视里始终跟着画面，又不会飞出视野。 */
  function placeHistorySprite(dt) {
    var dist = 150;
    var vFov = camera.fov * Math.PI / 180;
    var visH = 2 * dist * Math.tan(vFov / 2);
    var visW = visH * camera.aspect;

    var narrow = camera.aspect < 0.85;
    var wFrac = narrow ? 0.80 : 0.50;
    var offXFrac = narrow ? 0 : -0.16;
    var offYFrac = narrow ? 0.15 : 0.17;

    var w = visW * wFrac;
    var h = w * (histCanvas.height / histCanvas.width);
    histSprite.scale.set(w, h, 1);

    // 相机局部坐标 → 世界坐标
    var fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    var right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    var up = new THREE.Vector3().crossVectors(right, fwd).normalize();

    histFloat += dt;
    // 很轻的上下漂浮，让它像悬在太空里
    var bob = Math.sin(histFloat * 0.9) * (visH * 0.008);

    var p = camera.position.clone()
      .addScaledVector(fwd, dist)
      .addScaledVector(right, visW * offXFrac)
      .addScaledVector(up, visH * offYFrac + bob);
    histSprite.position.copy(p);
  }

  // 校史等火箭进入太空、姿态转换完成后再开始放。
  // 升空阶段（0~9 秒）画面只有火箭和尾迹，干净利落；
  // 提前放的话文字会和箭体、尾迹撞在一起。
  function historyStartAt() {
    return T.PRE + T.ASCEND + 600;
  }

  // 最后一页校史放完的时刻 —— 到了就亮出「出发」按钮
  function goRevealAt() {
    return historyStartAt() + T.HISTORY_GAP * HISTORY.length + 1600;
  }

  var lastCd = null;

  function updateOverlay(now) {
    var el = now - state.t0;

    // --- 倒计时 ---
    if (el < T.PRE) {
      var left = Math.ceil((T.PRE - el) / 1000);
      if (els.countdown) {
        els.countdown.hidden = false;
        if (left !== lastCd) {
          lastCd = left;
          els.countdown.textContent = left > 0 ? String(left) : 'GO';
          els.countdown.classList.remove('pulse');
          void els.countdown.offsetWidth;
          els.countdown.classList.add('pulse');
        }
      }
      return;
    }
    if (els.countdown && !els.countdown.hidden) els.countdown.hidden = true;
    if (els.hint && els.hint.textContent.indexOf('飞往') < 0) {
      els.hint.textContent = '奶龙号正在飞往广州大学星…';
    }

    // --- 校史：到点换下一张 ---
    var started = el >= historyStartAt();
    if (started) {
      if (state.historyIdx < 0) {
        state.historyIdx = 0;
        state.historyShownAt = now;
        showHistory(0);
      } else if (now - state.historyShownAt > T.HISTORY_GAP) {
        var next = state.historyIdx + 1;
        if (next < HISTORY.length) {
          state.historyIdx = next;
          state.historyShownAt = now;
          showHistory(next);
        }
      }
    }

    // 校史全部放完就出按钮。
    // ⚠️ 用时间点判断，不要只在「翻到最后一张」那一刻触发 ——
    //    如果中途被快进/跳帧（比如 reduced-motion、调试钩子），
    //    那个事件就永远等不到，按钮也就不出现。
    if (el >= goRevealAt()) revealGoBtn();

    // --- 抵达收尾 ---
    if (state.arrived) {
      var g = (now - state.arriveAt) / T.GLIDE;
      if (g > 1.05) finishAndGo();
    }
  }

  function showHistory(i) {
    var h = HISTORY[i];
    // 画到 3D 精灵上（不再用网页卡片）
    drawHistoryTexture(h, i, HISTORY.length);
    histTargetOpacity = 1;
    histFloat = 0;
  }

  var goRevealed = false;
  function revealGoBtn() {
    if (goRevealed) return;
    goRevealed = true;
    if (els.goBtn) {
      els.goBtn.hidden = false;
      els.goBtn.classList.add('show');
    }
    if (els.hint) els.hint.textContent = '奶龙号已抵达广州大学星';
  }

  /* ---------- 点击「出发」 ---------- */
  function depart() {
    if (state.arrived) return;
    state.arrived = true;
    state.arriveAt = performance.now();
    // 记住点击瞬间的机位，冲刺插值从这里开始
    state.glideFrom = { x: camera.position.x, y: camera.position.y, z: camera.position.z };

    if (els.goBtn) els.goBtn.classList.add('gone');
    histTargetOpacity = 0;                 // 校史文字淡出
    if (els.hint) els.hint.classList.add('gone');
    if (els.hud) els.hud.classList.add('gone');
    if (els.countdown) els.countdown.hidden = true;

    if (window.__launchEvent) window.__launchEvent('depart');

    var veil = document.getElementById('veil');
    if (veil) setTimeout(function () { veil.classList.add('on'); }, T.GLIDE * 0.80);
  }

  function finishAndGo() {
    if (state.done) return;
    state.done = true;
    if (RAF) cancelAnimationFrame(RAF);
    redirect();
  }

  /* ============================================================
     跳转（给统计脚本留时间，和旧版逻辑一致）
     ============================================================ */
  var TARGET = 'https://www.gzhu.edu.cn/';
  var BUDGET = 1200;

  function redirect() {
    var a = window.__analytics;
    var elapsed = a ? Date.now() - a.start : Infinity;
    if (!a || a.ready || a.failed || elapsed >= BUDGET) {
      location.replace(TARGET);
      return;
    }
    var poll = setInterval(function () {
      var b = window.__analytics;
      if (b.ready || b.failed || Date.now() - b.start >= BUDGET) {
        clearInterval(poll);
        location.replace(TARGET);
      }
    }, 60);
  }

  /* ============================================================
     尺寸
     ============================================================ */
  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // 竖屏手机上把 FOV 拉大，否则箭体两侧会被切掉
    camera.fov = (w / h) < 0.85 ? 64 : 50;
    camera.updateProjectionMatrix();

    // 尾迹粒子的点尺寸换算：把世界单位换算成屏幕像素。
    // gl_PointSize 是像素单位，所以要用视口高度和 FOV 反推。
    if (trail && trail.mat) {
      var fovRad = camera.fov * Math.PI / 180;
      trail.mat.uniforms.uProj.value =
        (h * 0.5) / Math.tan(fovRad / 2) * renderer.getPixelRatio();
    }
  }
  window.addEventListener('resize', resize);

  /* ============================================================
     启动
     ============================================================ */
  function start() {
    resize();
    state.t0 = performance.now();
    lastCd = null;

    if (els.dots && !els.dots.children.length) {
      for (var i = 0; i < HISTORY.length; i++) {
        els.dots.appendChild(document.createElement('i'));
      }
    }

    // 先摆好相机与火箭，避免第一帧从默认位置弹过来
    var now = performance.now();
    var st = rocketState(now);
    updateCamera(now, st, true);
    updateRocket(now);

    if (els.goBtn) els.goBtn.addEventListener('click', depart);

    tick();
    window.__launchReady = true;
  }

  window.NailongLaunch = { depart: depart, start: start };

  // 调试用：把内部对象暴露出来，方便在浏览器里逐个隐藏定位问题
  window.__dbg = {
    scene: scene, camera: camera, rocket: rocket, flameGroup: flameGroup,
    embers: embers, planetGroup: planetGroup, earth: earth, padGroup: padGroup,
    trail: trail,
    trailAlive: function () {
      var n = 0;
      for (var i = 0; i < trail.n; i++) if (trail.age[i] >= 0) n++;
      return n;
    }
  };

  // 调试用：把动画时间跳到指定毫秒（截图验收时精确抓某一帧）。
  // 平时不会被调用，留着也不影响线上。
  window.__setLaunchTime = function (ms) {
    state.t0 = performance.now() - ms;
    // 校史也要跟着回到对应进度
    var started = ms >= (T.PRE + T.ASCEND * 0.45);
    if (started) {
      var idx = Math.min(HISTORY.length - 1,
        Math.floor((ms - (T.PRE + T.ASCEND * 0.45)) / T.HISTORY_GAP));
      state.historyIdx = idx;
      state.historyShownAt = performance.now();
      showHistory(idx);
    }
    // 相机与火箭立刻到位，避免插值残留
    var now = performance.now();
    var st = rocketState(now);
    updateCamera(now, st, true);
    updateRocket(now);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

})();
