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
    PITCH: 4500,       // 太空中侧倾转向（直飞 → 平飞，4.5 秒）
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
  /* ============================================================
     性能档位

     场景里的东西是按桌面机的余量堆的：3400 颗星、46 块碎石、
     160 根速度线、320 个火星、1100 个尾迹粒子、16 个飞字精灵。
     在中端手机上这是跑不动的 —— 而且 3 倍屏上 setPixelRatio(2)
     等于渲染 4 倍像素。

     这里按「屏幕宽度 + 是否触屏 + 硬件并发数」估一个档位。
     不追求精确识别机型（做不到也不该做），只要把移动端整体降一档，
     别让它卡成幻灯片。
     ============================================================ */
  var IS_MOBILE = (function () {
    var w = window.innerWidth || 999;
    var touch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    var cores = navigator.hardwareConcurrency || 4;
    return (w < 820 && touch) || cores <= 4;
  })();

  // 低配再降一档：窄屏 + 核心数少
  var IS_LOW = IS_MOBILE && ((window.innerWidth || 999) < 430 ||
    (navigator.hardwareConcurrency || 4) <= 4);

  // 统一用一个系数去缩规模：桌面 1、手机 0.55、低配 0.34
  var QUALITY = IS_LOW ? 0.34 : (IS_MOBILE ? 0.55 : 1);

  // 像素比：桌面上限 2，手机上 1.5 —— 这是最省算力的一项
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, IS_MOBILE ? 1.5 : 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  // ACES 让高光平滑滚降 —— 不做的话白箭体 + 强光会糊成一片死白
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  var scene = new THREE.Scene();
  // ⚠️ 不加 scene.fog：太空没雾，而且 FogExp2 会在 900 单位外
  //    把星空（900~3300）和终点星球（1500）全吃掉
  var camera = new THREE.PerspectiveCamera(50, 1, 0.5, 12000);
  camera.position.set(11, 5, 17);

  /* ============================================================
     色彩分级

     现在的画面是「渲染出来什么就是什么」，偏中性。
     电影感通常来自三件事，这里只做最轻的一种：
       · 暗部压向冷色（蓝紫），亮部推向暖色（金黄）—— 常见的好莱坞调色；
       · 整体轻微提高对比，让星空的黑色更实。

     实现方式是**屏幕空间的一层混合**，不去动材质：
     一个加法精灵负责给暗部上冷色，一个乘法层负责压对比。
     比改后处理管线便宜得多，移动端也扛得住。
     ============================================================ */
  var colorGrade = { liftSprite: null, gainSprite: null };

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
    var COUNT = Math.round(3400 * QUALITY);
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

    /* 闪烁用的两个属性：
         aPhase  每颗星一个随机相位，保证它们不同步；
         aBright 基础亮度 —— 暗星闪得浅、亮星闪得明显，才有层次。 */
    var phase = new Float32Array(COUNT);
    var bright = new Float32Array(COUNT);
    for (var pi = 0; pi < COUNT; pi++) {
      phase[pi] = Math.random() * Math.PI * 2;
      bright[pi] = 0.55 + Math.random() * 0.45;
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));

    // 圆形点精灵：默认的方形点在深色背景上很扎眼
    var tex = makeTexture(64, 64, function (g) {
      var grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.4, 'rgba(255,255,255,.7)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    });

    /* 逐颗闪烁只能自己写 shader：
       PointsMaterial 的 opacity 是全局一个值，动它等于「整个星空一起呼吸」，
       很假。这里给每颗星一个相位，各自按不同的节奏明灭。

       ⚠️ gl_PointSize 必须自己做透视衰减（uSize * uScale / -z），
          等价于原材料的 sizeAttenuation —— 直接给固定像素的话，
          1400~4000 单位外的星星会变成一堆大方块。 */
    var mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: tex },
        uTime: { value: 0 },
        uSize: { value: 13 },
        uScale: { value: 400 }
      },
      vertexShader: [
        'attribute float aPhase;',
        'attribute float aBright;',
        'attribute vec3 color;',
        'varying vec3 vColor;',
        'varying float vTwinkle;',
        'uniform float uTime;',
        'uniform float uSize;',
        'uniform float uScale;',
        'void main() {',
        '  vColor = color;',
        '  float w1 = sin(uTime * 1.70 + aPhase) * 0.5 + 0.5;',
        '  float w2 = sin(uTime * 0.63 + aPhase * 2.3) * 0.5 + 0.5;',
        '  float tw = mix(w1, w2, 0.45);',
        '  // 振幅必须够大：星星只有 2~4 像素，28% 的亮度起伏肉眼看不出来。',
        '  // 0.30~1.00 才有「在闪」的感觉。',
        '  vTwinkle = aBright * (0.30 + 0.70 * tw);',
        '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
        '  gl_Position = projectionMatrix * mv;',
        '  // 亮的星顺便大一点点，小尺寸下更容易被眼睛捕捉到',
        '  gl_PointSize = uSize * (uScale / -mv.z) * (0.80 + 0.45 * tw);',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D uMap;',
        'varying vec3 vColor;',
        'varying float vTwinkle;',
        'void main() {',
        '  vec4 t = texture2D(uMap, gl_PointCoord);',
        '  gl_FragColor = vec4(vColor * vTwinkle, t.a);',
        '}'
      ].join('\n'),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    var pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.userData.mat = mat;   // 主循环要驱动 uTime / uScale
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
      // 壳体是**曲面**：舷窗中心贴在半径 rWin 上，但圆盘边缘（x=±0.9）
      // 处的壳体其实已经退到 sqrt(r²-0.81) ≈ 1.19 ——
      // 原来筒只有 0.34 长、中心在 +0.15，内端只到 -0.02，
      // 边缘就露出 0.3 的缝，看起来像悬空的一块玻璃。
      // 现在把筒加长到 1.1 并向内平移，让它从壳体内部穿出来。
      new THREE.CylinderGeometry(0.94, 0.90, 1.10, 40, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0xdfe4f2, roughness: 0.4, metalness: 0.35, side: THREE.DoubleSide
      })
    );
    winBarrel.rotation.x = Math.PI / 2;
    // 内端 -0.82（世界半径 0.68，深深埋进壳体）；
    // 外端 +0.28，刚好停在外圈金环（0.31）后面一点，不露白筒边。
    winBarrel.position.z = -0.27;
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
    /* ------------------------------------------------------------
       ⚠️ 贴花不能随便给弧宽 —— 会被横向拉伸

       圆柱弧面贴图：纹理的 u 从 0 到 1 均匀铺在圆弧上，
       所以贴花的**物理宽度** = 半径 × 弧度。
       如果这个宽度和高度之比，跟画布的宽高比不一致，
       字就会被横向拉长或压扁。

       之前画布是 256×1024（宽高比 0.25），但 height=2.35、arcDeg=44
       算出来的物理宽度是 1.63 × 0.768 = 1.25（宽高比 0.53）——
       字被横向拉伸了 2.1 倍，看起来就是「变形」。

       现在反过来：先定高度和画布，再由宽高比反算需要的弧度，
       保证贴到圆柱上后 1:1，不再变形。
       ------------------------------------------------------------ */
    var NAME_H = 2.35;                  // 贴花高度（世界单位）
    var NAME_CW = 340, NAME_CH = 1024;  // 画布尺寸，宽高比 ≈ 0.332
    var NAME_ASPECT = NAME_CW / NAME_CH;

    var nameTex2 = makeTexture(NAME_CW, NAME_CH, function (g, w, h) {
      g.clearRect(0, 0, w, h);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      var chars = ['奶', '龙', '号'];
      var cell = h / 3;                  // 每个字占一格，格子接近正方形
      for (var k = 0; k < chars.length; k++) {
        var cy = cell * (k + 0.5);
        g.save();
        // 字号按格子宽度给，留一点边距防止描边被裁
        g.font = '900 ' + Math.round(w * 0.78) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
        // 深金字 + 浅色外发光：白箭体上也能压得住
        g.shadowColor = 'rgba(255,255,255,.95)';
        g.shadowBlur = 18;
        g.fillStyle = '#8a6a00';
        g.fillText(chars[k], w / 2, cy + 4);
        // 描一圈亮边，增强立体感
        g.shadowBlur = 0;
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(255,255,255,.5)';
        g.strokeText(chars[k], w / 2, cy + 4);
        g.restore();
      }
    });

    var yName = Y0 + BH * 0.395;
    // 物理宽度 = 高度 × 画布宽高比；再由宽度反算弧度
    var nameW = NAME_H * NAME_ASPECT;
    var nameR = radiusAt(yName) + 0.075;
    var nameArcDeg = (nameW / nameR) * 180 / Math.PI;

    var nameDecal2 = arcDecal(yName, NAME_H, nameArcDeg, nameTex2);
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

    /* ============================================================
       细节增补

       到这里火箭的大形已经有了：箭体、头锥、尾翼、喷管、管线、贴花。
       缺的是「近距离看有没有东西」—— 真实火箭表面全是检修口、
       排气格栅、卡箍、支架这类小件。这里补五组：

         ① 检修口：箭体上一圈小矩形面板，带螺栓点
         ② 排气格栅：级间段附近两块百叶
         ③ 卡箍：每隔一段扣在箭体外的一圈细环
         ④ 矢量支架：喷管两侧的作动筒
         ⑤ 尾翼前缘：给尾翼加一条亮边，切面更清楚
        ============================================================ */
    var detailMat = new THREE.MeshStandardMaterial({
      color: 0xb9c2d8, roughness: 0.42, metalness: 0.78, flatShading: true
    });
    var darkDetail = new THREE.MeshStandardMaterial({
      color: 0x2a3149, roughness: 0.55, metalness: 0.7, flatShading: true
    });

    // ① 检修口：三处，避开贴花和舷窗所在的 +Z / +X 附近
    var hatchAngles = [-1.35, -2.1, 2.55];
    for (var hi = 0; hi < hatchAngles.length; hi++) {
      var ha = hatchAngles[hi];
      var hy = Y0 + BH * (0.24 + hi * 0.17);
      var hr = radiusAt(hy) + 0.012;
      var hatch = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.05), detailMat);
      hatch.position.set(Math.cos(ha) * hr, hy, Math.sin(ha) * hr);
      hatch.rotation.y = -ha + Math.PI / 2;
      rocket.add(hatch);

      // 四个角上的螺栓
      for (var bi = 0; bi < 4; bi++) {
        var bx = (bi % 2 ? 1 : -1) * 0.11;
        var by = (bi < 2 ? 1 : -1) * 0.17;
        var bolt = new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 5), darkDetail);
        bolt.position.set(bx, by, 0.03);
        hatch.add(bolt);
      }
    }

    // ② 排气格栅：级间段下方左右各一块
    for (var gi = 0; gi < 2; gi++) {
      var ga = gi ? Math.PI * 0.62 : -Math.PI * 0.62;
      var gy = Y0 + BH * 0.795;
      var gr = radiusAt(gy) + 0.02;
      var vent = new THREE.Group();
      vent.position.set(Math.cos(ga) * gr, gy, Math.sin(ga) * gr);
      vent.rotation.y = -ga + Math.PI / 2;
      for (var vi = 0; vi < 5; vi++) {
        // 每片百叶都是倾斜的，像真的排气窗
        var slat = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.035, 0.06), darkDetail);
        slat.position.set(0, (vi - 2) * 0.075, 0);
        slat.rotation.x = 0.55;
        vent.add(slat);
      }
      rocket.add(vent);
    }

    // ③ 卡箍：扣在箭体外的一圈细环，位置避开装饰环和贴花
    var clampYs = [Y0 + BH * 0.13, Y0 + BH * 0.33, Y0 + BH * 0.52, Y0 + BH * 0.71];
    for (var ci2 = 0; ci2 < clampYs.length; ci2++) {
      var cy = clampYs[ci2];
      var cr = radiusAt(cy) + 0.022;
      var clamp = new THREE.Mesh(
        new THREE.TorusGeometry(cr, 0.028, 5, SEG * 2), detailMat
      );
      clamp.rotation.x = Math.PI / 2;
      clamp.position.y = cy;
      rocket.add(clamp);
    }

    // ④ 矢量支架：喷管两侧的作动筒（让喷管能摆动的那套东西）
    for (var ai = 0; ai < 2; ai++) {
      var aa = ai ? Math.PI * 0.5 : -Math.PI * 0.5;
      var act = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.075, 0.78, 8), detailMat
      );
      act.position.set(Math.cos(aa) * 1.02, 0.98, Math.sin(aa) * 1.02);
      act.rotation.z = Math.cos(aa) * 0.30;
      act.rotation.x = -Math.sin(aa) * 0.30;
      rocket.add(act);
    }

    // ⑤ 尾翼前缘：沿外缘贴一条亮边，切面更清楚
    var edgeMat = new THREE.MeshStandardMaterial({
      color: 0xfff0a8, roughness: 0.3, metalness: 0.55,
      emissive: 0x3a2c00, emissiveIntensity: 0.4, flatShading: true
    });
    for (var fi2 = 0; fi2 < 3; fi2++) {
      var fa = (fi2 / 3) * Math.PI * 2;
      var holder2 = new THREE.Group();
      holder2.rotation.y = fa;
      var edge = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.05, 0.2), edgeMat);
      // 贴着尾翼的斜边（从 (1.88,0.48) 到 (1.64,1.72) 那一段）
      edge.position.set(RB + 0.78, 1.62, 0);
      edge.rotation.z = Math.atan2(1.72 - 0.48, 1.88 - 1.64) - Math.PI / 2;
      holder2.add(edge);
      rocket.add(holder2);
    }
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
  var flameInner = makePlume(0.58, 4.4, 0xfff6d8, 0.75);
  flameInner.rotation.x = Math.PI;
  flameInner.position.y = -2.3;
  flameGroup.add(flameInner);

  // 外焰：宽而淡，带橙
  var flameOuter = makePlume(1.32, 9.4, 0xff8a1e, 0.52);
  flameOuter.rotation.x = Math.PI;
  flameOuter.position.y = -4.8;
  flameGroup.add(flameOuter);

  /* 冲击钻石（shock diamonds）：
     真实火箭的超音速尾焰里，喷流会周期性压缩、形成一串亮点。
     加上它，尾焰就不是一根光溜溜的圆锥，而是有节奏的。 */
  var shockDiamonds = [];
  (function () {
    var sdTex = makeTexture(128, 128, function (g) {
      var grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.3, 'rgba(255,238,190,.8)');
      grd.addColorStop(0.65, 'rgba(255,170,70,.28)');
      grd.addColorStop(1, 'rgba(255,140,40,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    });
    for (var d = 0; d < 4; d++) {
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: sdTex, transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false
      }));
      sp.position.y = -1.0 - d * 1.35;
      var sc = 1.15 - d * 0.2;
      sp.scale.set(sc, sc * 0.72, 1);
      flameGroup.add(sp);
      shockDiamonds.push(sp);
    }
  })();

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
    var N = Math.round(320 * QUALITY);
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
    var MAX = Math.round(1100 * QUALITY);
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
    earth.userData.atmo = atmo;   // 升空时要动态调它的亮度和尺寸

    earth.userData.globe = globe;
  })();

  /* ============================================================
     广州大学星（终点）
     ============================================================ */
  var planetGroup = new THREE.Group();
  planetGroup.position.set(-70, 330, -2400);
  scene.add(planetGroup);

  /* 星球名字标注
     抵达之前画面上只有「一个很好看的星球」，没有任何文字告诉你它是什么。
     这里给它挂一个名字牌，和主体信息一起出现。 */
  var planetLabel = null;
  (function buildPlanetLabel() {
    var W = 768, H = 256;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var g = cv.getContext('2d');

    // 上：小字「目的地」
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '600 34px ' + FONT;
    g.fillStyle = 'rgba(180, 205, 255, .78)';
    g.fillText('目 的 地', W / 2, 56);

    // 中：大字「广州大学星」
    g.font = '900 92px ' + FONT;
    g.shadowColor = 'rgba(255, 205, 70, .95)';
    g.shadowBlur = 46;
    g.fillStyle = '#fff6d2';
    g.fillText('广 州 大 学 星', W / 2, 140);
    g.shadowBlur = 0;
    g.fillText('广 州 大 学 星', W / 2, 140);

    // 下：一条金线
    var lg = g.createLinearGradient(W * 0.2, 0, W * 0.8, 0);
    lg.addColorStop(0, 'rgba(254,206,14,0)');
    lg.addColorStop(0.5, 'rgba(254,206,14,.85)');
    lg.addColorStop(1, 'rgba(254,206,14,0)');
    g.strokeStyle = lg;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(W * 0.2, 200);
    g.lineTo(W * 0.8, 200);
    g.stroke();

    var tex = new THREE.CanvasTexture(cv);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 4;

    var mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: 0,
      depthWrite: false, depthTest: false, fog: false
    });
    var sp = new THREE.Sprite(mat);
    sp.renderOrder = 60;
    sp.scale.set(680, 227, 1);
    // 摆在星球上方一点
    sp.position.set(0, 210, 0);
    planetGroup.add(sp);
    planetLabel = sp;
  })();

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
    var N = Math.round(46 * QUALITY);
    // 岩石贴图：深灰底 + 颗粒噪声 + 陨石坑 + 裂纹。
    // 纯色低模在太空里像一块白塑料；有了纹理才有「石头」的质感。
    var rockTex = makeTexture(512, 512, function (g, w, h) {
      g.fillStyle = '#3c4050';
      g.fillRect(0, 0, w, h);

      var rnd = 2027;
      function rand() { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; }

      // 颗粒噪声
      var img = g.getImageData(0, 0, w, h);
      var d = img.data;
      for (var i = 0; i < d.length; i += 4) {
        var n = (rand() - 0.5) * 64;
        d[i] = Math.max(0, Math.min(255, d[i] + n));
        d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
        d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * 1.1));
      }
      g.putImageData(img, 0, 0);

      // 陨石坑：暗心 + 亮边
      for (var c = 0; c < 26; c++) {
        var cx = rand() * w, cy = rand() * h;
        var r = 6 + rand() * 34;
        var shadow = g.createRadialGradient(cx + r * 0.25, cy + r * 0.25, 0, cx, cy, r);
        shadow.addColorStop(0, 'rgba(12,14,22,.55)');
        shadow.addColorStop(0.72, 'rgba(30,34,46,.28)');
        shadow.addColorStop(1, 'rgba(30,34,46,0)');
        g.fillStyle = shadow;
        g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();

        g.strokeStyle = 'rgba(178,188,210,.30)';
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(cx, cy, r * 0.94, Math.PI * 1.05, Math.PI * 1.95);
        g.stroke();
      }

      // 裂纹
      g.strokeStyle = 'rgba(16,18,26,.55)';
      for (var k = 0; k < 16; k++) {
        g.lineWidth = 0.8 + rand() * 1.8;
        var x = rand() * w, y = rand() * h;
        g.beginPath();
        g.moveTo(x, y);
        var segs = 3 + Math.floor(rand() * 5);
        for (var s = 0; s < segs; s++) {
          x += (rand() - 0.5) * 90;
          y += (rand() - 0.5) * 90;
          g.lineTo(x, y);
        }
        g.stroke();
      }
    });

    var rockMat = new THREE.MeshStandardMaterial({
      map: rockTex, color: 0x9aa0b4,
      roughness: 0.98, metalness: 0.04, flatShading: true
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
    var N = Math.round(160 * QUALITY);
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
    // 飞跃文字：同样只在太空段出现
    if (flyUpdater) flyUpdater(rz, st.asc >= 1);
  }

  /* ============================================================
     飞跃文字（小号、高透明度）

     和主线那张大卡片同时存在：大卡片讲一个完整节点，
     这些短句从身边掠过，把细节铺开，只在余光里提供信息密度。

     实现：每句一张 canvas 纹理；池子里的精灵回收时重画下一句，
     不新建对象、不新建纹理。
     ============================================================ */
  /* ------------------------------------------------------------
     飞跃文字：主线在讲大段落，同时有大量短句从身边掠过。

     用途是把「七度迁徙」「ESI 13 个学科」这类细节铺开，
     但它们不该抢主线的注意力 —— 所以做得小、淡。

     来源：羊城派对百年校庆公告的报道 + 项目里的校史文档。
     ⚠️ 这张表必须定义在飞字系统之前使用，否则运行到那里是 undefined。
     ------------------------------------------------------------ */
  /* ------------------------------------------------------------
     年代色调

     八个节点原来共用一套金色排版 —— 但 1927 的创立、1944 的抗战迁徙、
     2027 的百年，情绪完全不同，同一套视觉语言会把它们压平。

     这里按年代给一组色：年份的竖向渐变、辉光、小标签各一个色。
     只改颜色，排版结构不动，风险低。
     ------------------------------------------------------------ */
  var ERA_TONES = {
    founding: { a: '#fff8e0', b: '#ffd24a', c: 'rgba(255,198,72,.92)',  label: 'rgba(255,214,150,.80)' },
    war:      { a: '#e6edf8', b: '#93a9c9', c: 'rgba(140,170,215,.85)', label: 'rgba(176,200,235,.70)' },
    build:    { a: '#e2fff8', b: '#4fd2bb', c: 'rgba(70,210,190,.85)',  label: 'rgba(140,238,222,.72)' },
    merge:    { a: '#fffbe6', b: '#ffd93b', c: 'rgba(255,212,60,.92)',  label: 'rgba(255,222,150,.82)' },
    campus:   { a: '#eaf2ff', b: '#7fb0ff', c: 'rgba(110,160,255,.88)', label: 'rgba(168,200,255,.76)' },
    rise:     { a: '#f2ecff', b: '#b493ff', c: 'rgba(160,130,255,.88)', label: 'rgba(200,182,255,.76)' },
    science:  { a: '#e6fbff', b: '#57d8f5', c: 'rgba(80,210,240,.90)',  label: 'rgba(150,232,250,.78)' }
  };

  /* ------------------------------------------------------------
     飞跃文字：按「主线节点」分桶

     b 是桶号，对应 HISTORY 的下标：
       0 1927 创立   1 1944 弦歌不辍   2 1953–1985 五校并起
       3 2000 合并   4 2005 大学城     5 2006 博士授予权
       6 2018 破零   7 2027 百年

     ⚠️ 为什么要分桶：
        原来所有短句排成一条队、按顺序发牌，结果主线在讲 1927 的时候，
        旁边飘的可能是 2018 年的 ESI —— 时间上是乱的。
        现在回收时按「当前主线在第几节」挑对应的桶，
        飞过去的句子就和主线处在同一段时间里。

     素材来源：项目里的《广州大学校史》文档 + 羊城派对百年校庆公告的报道。
     ------------------------------------------------------------ */
  var FLY_FACTS = [
    // —— 0 · 1927 创立 ——
    { b: 0, t: '1927 陈炳权创办私立广州大学' },
    { b: 0, t: '陈炳权：广东台山籍教育家' },
    { b: 0, t: '陈炳权：经济学家' },
    { b: 0, t: '创办即定校训「博学笃行」' },
    { b: 0, t: '校训：博学笃行' },
    { b: 0, t: '1927 年创办于广州' },
    { b: 0, t: '办学渊源可追溯至 1927 年' },
    { b: 0, t: '私立广州大学是最早的源头' },
    { b: 0, t: '民国时期鲜明的办学印记' },
    { b: 0, t: '「博学笃行」延续至今' },

    // —— 1 · 1944 弦歌不辍 ——
    { b: 1, t: '抗战期间几经迁徙' },
    { b: 1, t: '迁徙途中弦歌不辍' },
    { b: 1, t: '1944 全校师生捐献战斗机' },
    { b: 1, t: '特殊的家国情怀' },
    { b: 1, t: '烽火岁月仍坚持办学' },
    { b: 1, t: '1951 参与合并改组' },
    { b: 1, t: '1951 改组为华南联合大学' },
    { b: 1, t: '原校脉并入华南联合大学' },

    // —— 2 · 1953–1985 五校并起 ——
    { b: 2, t: '合并前广州已有多所市属高校' },
    { b: 2, t: '这些市属高校是直接前身' },
    { b: 2, t: '广州教育学院 1953 创办' },
    { b: 2, t: '教育学院：在职教师继续教育' },
    { b: 2, t: '广州师范学院 1958 创办' },
    { b: 2, t: '师范学院：重要的师范本科院校' },
    { b: 2, t: '1978 广州师范学院复办' },
    { b: 2, t: '1983 师范学院获硕士学位授予权' },
    { b: 2, t: '硕士点为合并奠定学科基础' },
    { b: 2, t: '原广州大学 1983 复办' },
    { b: 2, t: '复办初名广州职业大学' },
    { b: 2, t: '后恢复广州大学旧名' },
    { b: 2, t: '1993 与原私立广州大学衔接' },
    { b: 2, t: '接续 1927 年的源头' },
    { b: 2, t: '华南建设学院（西院）1984 创办' },
    { b: 2, t: '华建西院以土木建筑见长' },
    { b: 2, t: '工程抗震研究取得显著成果' },
    { b: 2, t: '广州高等师范专科学校 1985' },
    { b: 2, t: '师专与教育学院一体化办学' },
    { b: 2, t: '「一套人马、两块牌子」' },

    // —— 3 · 2000 五校合并 ——
    { b: 3, t: '2000.7 经教育部批准合并' },
    { b: 3, t: '五校：教育学院·师范学院·原广大' },
    { b: 3, t: '五校：华建西院·广州师专' },
    { b: 3, t: '实际参与合并的还有成人高校' },
    { b: 3, t: '广州市城建职工大学' },
    { b: 3, t: '广州市建筑总公司职工大学' },
    { b: 3, t: '亦有「九校合并」之说' },
    { b: 3, t: '组建为新的广州大学' },
    { b: 3, t: '校训合成：博学笃行、与时俱进' },
    { b: 3, t: '古老渊源与年轻实体的交汇' },

    // —— 4 · 2005 大学城 ——
    { b: 4, t: '2005 主体迁入广州大学城' },
    { b: 4, t: '办学空间得到根本性改善' },
    { b: 4, t: '硬件条件得到根本性改善' },
    { b: 4, t: '与广州城市发展同频' },
    { b: 4, t: '大学城校区成为主校区' },

    // —— 5 · 2006 博士授予权 ——
    { b: 5, t: '2006 增列为博士学位授予单位' },
    { b: 5, t: '办学层次实现重要跃升' },
    { b: 5, t: '博士点建设起步' },
    { b: 5, t: '研究生教育迈向新台阶' },

    // —— 6 · 2018 工程学破零 ——
    { b: 6, t: '2016 全面实施高水平大学建设' },
    { b: 6, t: '发展驶入快车道' },
    { b: 6, t: '2017 入选广州市高水平大学建设高校' },
    { b: 6, t: '2017 入选广东省「冲一流」计划' },
    { b: 6, t: '2018.11 工程学进入 ESI 前 1%' },
    { b: 6, t: '实现 ESI 零的突破' },
    { b: 6, t: 'ESI 前 1% 学科增至 13 个' },
    { b: 6, t: '工程学进入 ESI 全球前 0.5‰' },
    { b: 6, t: '计算机科学等 4 学科进入前 2‰' },
    { b: 6, t: '6 个学科进入 U.S.News 世界百强' },
    { b: 6, t: '网络空间安全、土木工程享誉海内外' },
    { b: 6, t: '「2+5」学科与科研创新平台' },

    // —— 7 · 2027 百年 ——
    { b: 7, t: '2020 合并组建 20 周年' },
    { b: 7, t: '2026.7 发布百年校庆公告' },
    { b: 7, t: '校庆公告（第一号）' },
    { b: 7, t: '2027 建校 100 周年' },
    { b: 7, t: '百年学府迎来百年校庆' },
    { b: 7, t: '博学笃行 · 与时俱进' },
    { b: 7, t: '与城同长' }
  ];

  var FLY_N = Math.max(6, Math.round(16 * QUALITY));

  // 飞字系统的每帧更新函数，由 buildFlyingText 赋值，主循环调用
  var flyUpdater = null;

  var flyingText = [];

  (function buildFlyingText() {
    var CW = 1024, CH = 128;

    function paint(item, text) {
      var g = item.ctx;
      g.clearRect(0, 0, CW, CH);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '700 62px ' + FONT;
      // 冷白字 + 淡蓝辉光，比主线那种金字低调
      g.shadowColor = 'rgba(120,170,255,.75)';
      g.shadowBlur = 26;
      g.fillStyle = 'rgba(226,236,255,.92)';
      g.fillText(text, CW / 2, CH / 2);
      item.tex.needsUpdate = true;
    }

    /* 摆放位置

       之前 rad 取 42~212 —— 相对火箭（半径约 1.7）来说太远了，
       文字在远处只有几个像素，根本看不清。

       现在横向收到 12~72，纵向也贴近航道，飞行距离缩短到 520，
       让它们从「远处的小点」变成「从身边掠过的字」。
       尺度同时缩小，因为离得近了，原来的 22~52 会铺满半个屏幕。 */
    function placeFly(it) {
      var ang = Math.random() * Math.PI * 2;
      // 12 起步：再近就会怼到镜头上挡住火箭
      // 再近一档：11~38。再小就会怼到镜头上挡住火箭。
      var rad = 11 + Math.random() * 27;
      it.sprite.position.set(
        Math.cos(ang) * rad,
        SPACE_Y + Math.sin(ang) * rad * 0.66,
        // ⚠️ 必须相对火箭当前位置放，不能用绝对坐标。
        //    火箭一直在往 -Z 飞，用绝对值的话过了几十秒，
        //    整个航道都会落到它身后 —— 表现就是「飞字全没了」。
        rocket.position.z - (35 + Math.random() * 155)
      );
      // 距离近 → 尺度要小，否则一条短句能占掉屏幕的 1/3
      // 尺度按距离等比给 —— 近的用小号、远的用大号，
      // 这样任何距离看过去字的大小都差不多，不会有一条突然糊满屏幕。
      // ⚠️ 尺度要按「离相机的距离」算，不能只按横向半径。
      //    只按 rad 算的话，飞在正前方 200 单位外的那几句会小到看不见 ——
      //    它的 rad 可能只有 15，但离镜头有 210。
      var dzFly = it.sprite.position.z - camera.position.z;
      var distFly = Math.sqrt(rad * rad + dzFly * dzFly);
      // 取视距的 7.5%：屏幕上大致恒定为画面宽度的 8% 左右
      var s = distFly * (0.070 + Math.random() * 0.016);
      it.sprite.scale.set(s, s * (CH / CW), 1);
      it.sprite.material.opacity = 0.26 + Math.random() * 0.20;
    }

    /* 发牌逻辑：按「当前主线在第几节」挑对应的桶。

       原来是一条队按顺序发，主线讲 1927 的时候旁边可能飘着 2018 的 ESI，
       时间上是乱的。现在每次要新句子时，先看 state.historyIdx 是几，
       就从那一桶里取；桶里拿完了从头再来，保证顺序不乱。

       桶空或越界时往前后找最近的非空桶，不会发不出句子。 */
    var flyBucketPos = {};
    var lastFlyBucket = -99;   // 上一次用的桶，用来检测主线是否换节

    // 把事实按 b 分组，避免每次现算
    var flyPool = {};
    for (var fb = 0; fb < FLY_FACTS.length; fb++) {
      var fbk = FLY_FACTS[fb].b;
      if (!flyPool[fbk]) flyPool[fbk] = [];
      flyPool[fbk].push(FLY_FACTS[fb].t);
    }

    function pickFlyText() {
      // ⚠️ 这个函数在场景搭建阶段就会被调用一次（初始化 16 个精灵时），
      //    而 state 是在那之后才定义的 —— var 提升让它是 undefined，
      //    直接读 state.historyIdx 会抛 "Cannot read properties of undefined"。
      var b = (state && typeof state.historyIdx === "number") ? state.historyIdx : 0;
      if (b < 0) b = 0;
      if (b > 7) b = 7;
      // 往前后找最近的非空桶
      var probe = 0;
      while (!flyPool[b] && probe < 8) {
        b = (b + (probe % 2 ? -1 : 1) + 8) % 8;
        probe++;
      }
      var pool = flyPool[b] || [FLY_FACTS[0].t];
      var pos = flyBucketPos[b] || 0;
      flyBucketPos[b] = (pos + 1) % pool.length;
      return pool[pos];
      // 调试出口：截图/验收时用来确认分桶确实生效
    }

    for (var i = 0; i < FLY_N; i++) {
      var cv = document.createElement('canvas');
      cv.width = CW;
      cv.height = CH;
      var ctx = cv.getContext('2d');
      var tex = new THREE.CanvasTexture(cv);
      tex.encoding = THREE.sRGBEncoding;
      tex.anisotropy = 4;

      var mat = new THREE.SpriteMaterial({
        map: tex, transparent: true, opacity: 0.3,
        depthWrite: false, fog: false, blending: THREE.AdditiveBlending
      });
      var sp = new THREE.Sprite(mat);
      sp.renderOrder = 12;
      scene.add(sp);

      var item = { sprite: sp, ctx: ctx, tex: tex, fact: pickFlyText() };
      paint(item, item.fact);
      placeFly(item);
      flyingText.push(item);
    }

    // 每帧回收：掠过身后就换一句、换个位置再来
    // 挂到模块内变量上，不污染 window（原来叫 window.__updateFlyingText）
    flyUpdater = function (rz, visible) {
      // 主线换到下一节时，把「还很远、看不清」的那些重画成新桶的句子。
      // 近处的不动 —— 换字会看得见，很跳。
      if (state.historyIdx !== lastFlyBucket) {
        lastFlyBucket = state.historyIdx;
        for (var r = 0; r < flyingText.length; r++) {
          var rf = flyingText[r];
          if (rf.sprite.position.z < rz - 125) {
            rf.fact = pickFlyText();
            paint(rf, rf.fact);
          }
        }
      }

      for (var j = 0; j < flyingText.length; j++) {
        var f = flyingText[j];
        f.sprite.visible = visible;
        if (!visible) continue;
        if (f.sprite.position.z > rz + 30) {
          // 按当前主线节点重新取一句
          f.fact = pickFlyText();
          paint(f, f.fact);
          placeFly(f);
        }
      }
    };
  })();

  /* ============================================================
     色彩分级（接上面 colorGrade 的说明）

     用两个贴在相机前面的全屏精灵：
       · lift  —— 加法混合，给暗部垫一点冷色（蓝紫），阴影不再死黑；
       · gain  —— 乘法混合，把整体轻微压暗，提高对比。

     两者都挂在相机下面，跟着镜头走；depthTest 关掉，永远画在最前面。
     ============================================================ */
  (function buildColorGrade() {
    function fullscreenSprite(mode) {
      var tex = makeTexture(4, 4, function (g) {
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, 4, 4);
      });

      var isLift = mode === 'lift';
      var mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        fog: false,
        // lift 用加法、gain 用乘法
        blending: isLift ? THREE.AdditiveBlending : THREE.CustomBlending,
        color: isLift ? 0x140c24 : 0xffffff
      });
      if (!isLift) {
        mat.blendEquation = THREE.AddEquation;
        mat.blendSrc = THREE.ZeroFactor;          // 结果 = 目标 × 源色
        mat.blendDst = THREE.SrcColorFactor;
      }
      // ⚠️ lift 必须压得极低。第一版给了 0.10，整个深空被提成灰紫色，画面发灰。
      //    0.028 只是在阴影里垫一点点冷调，肉眼几乎看不出「加了东西」，
      //    但黑位不再是一块死黑。
      mat.opacity = isLift ? 0.028 : 0.93;

      var sp = new THREE.Sprite(mat);
      sp.renderOrder = 900;
      // 贴到相机前面一点点，尺寸按 FOV 粗算，后面每帧会跟着相机重算
      sp.scale.set(2, 2, 1);
      camera.add(sp);
      return sp;
    }

    colorGrade.liftSprite = fullscreenSprite('lift');
    colorGrade.gainSprite = fullscreenSprite('gain');
    scene.add(camera);   // 相机必须进场景，挂在它下面的精灵才会被渲染
  })();
  var state = {
    // 动画时钟（毫秒）。**不是** performance.now() 的差值 ——
    // 见 tick() 里的说明：卡顿帧不能算进动画进度。
    clock: 0,
    paused: false,        // 空格暂停（见 bindOrbit 末尾）
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

    // 区分「拖动环视」和「轻点跳一节」：
    // 记下按下时的位置和时间，抬手时位移小、时间短就算轻点。
    var downX = 0, downY = 0, downAt = 0, moved = 0;

    function onDown(e) {
      if (e.target && e.target === cv) {
        downX = e.clientX; downY = e.clientY;
        downAt = performance.now();
        moved = 0;
      }
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
      moved += Math.abs(dx) + Math.abs(dy);

      // 0.0042 rad/px ≈ 每 100 像素转 24°，手感比较跟手
      orbit.targetYaw = Math.max(-ORBIT_YAW_MAX,
        Math.min(ORBIT_YAW_MAX, orbit.targetYaw - dx * 0.0042));
      orbit.targetPitch = Math.max(ORBIT_PITCH_MIN,
        Math.min(ORBIT_PITCH_MAX, orbit.targetPitch + dy * 0.0035));
      orbit.lastAt = performance.now();
    }

    function onUp(e) {
      // 画布上不再响应轻点 —— 翻页统一交给下方按钮和方向键。
      // 原来这里调 advanceHistory()，和按钮功能重叠，还容易误触。
      if (e.pointerId !== pid) return;
      orbit.dragging = false;
      pid = null;
      orbit.lastAt = performance.now();
      try { cv.releasePointerCapture(e.pointerId); } catch (err) {}
    }

    // 空格：暂停 / 继续。41 秒的动画，想停下来细看某一节时很有用。
    // 具体逻辑在 togglePause() 里 —— 按钮和空格共用同一份，
    // 免得两边各写一套、状态和图标对不上。
    window.addEventListener('keydown', function (e) {
      if (e.code !== 'Space' && e.key !== ' ') return;
      var t = e.target;
      if (t && (t.tagName === 'BUTTON' || t.tagName === 'A' ||
                t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      togglePause();
    });

    // 方向键：← 上一节、→ 下一节。和「轻点画面」功能对齐，
    // 但键盘用户不需要去猜屏幕可以点。
    window.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var t = e.target;
      if (t && (t.tagName === 'BUTTON' || t.tagName === 'A' ||
                t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) {
        // 焦点在翻页按钮上时让按钮自己处理
        if (t.id === 'hist-next' || t.id === 'hist-prev') return;
      }
      e.preventDefault();
      if (e.key === 'ArrowRight') advanceHistory();
      else rewindHistory();
    });


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
    var el = state.clock;
    var asc = clamp((el - T.PRE) / T.ASCEND, 0, 1);
    var spaceT = Math.max(0, el - T.PRE - T.ASCEND);

    /* ---- 直飞 → 平飞的过渡 ----
       原来：升空段 rotX 一直是 0、z 一直是 0，
             asc 到 1 之后再「原地」开始转 —— 视觉上像急刹车 + 原地转身。

       现在：
         ① 转向提前 PITCH_LEAD 开始，和升空末段重叠，边爬升边压弯；
         ② 高度补一个 sin(pitch·π) 的弧，转的过程中还在往上拱；
         ③ 前进速度从转向一开始就介入（真实火箭是重力转弯，
            不是转完才走），用 pitch² 做缓入，末端正好接上匀速巡航。
    */
    var PITCH_LEAD = 900;
    var pitchSpan = T.PITCH + PITCH_LEAD;
    var pitch = smooth(clamp((el - (T.PRE + T.ASCEND - PITCH_LEAD)) / pitchSpan, 0, 1));

    var y, z, rotX;
    if (el < T.PRE) {
      y = 1.3 + Math.sin(now * 0.045) * 0.03;
      z = 0;
      rotX = 0;
    } else {
      rotX = -Math.PI / 2 * pitch;

      // 升空段爬升 + 转向段的弧线拱起
      y = 1.3 + SPACE_Y * easeIn(asc) + Math.sin(pitch * Math.PI) * 24;
      // 转向过程中保持一点点呼吸感，稳定后幅度变小
      y += Math.sin(now * 0.0011) * (0.6 + 1.8 * pitch);

      // 前进：转向一开始就慢慢加速，转向结束时正好接上匀速
      var settle = Math.max(0, spaceT - T.PITCH);
      z = -(CRUISE * settle / 1000) - 95 * pitch * pitch;
    }
    return { y: y, z: z, rotX: rotX, asc: asc, spaceT: spaceT, pitch: pitch };
  }

  function updateRocket(now) {
    var el = state.clock;
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

    // 三层不同频率的正弦叠出「不规则抖动」——
    // 单一正弦看起来像呼吸，不像火焰。
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
    // 阈值放宽到 0.82：之前 0.6 就开始淡，侧面看尾焰都发虚。
    var plumeFade = Math.max(0, Math.min(1, (0.82 - facing) / 0.42));

    var f1 = Math.sin(now * 0.0210);
    var f2 = Math.sin(now * 0.0573 + 1.3);
    var f3 = Math.sin(now * 0.1130 + 2.7);
    var flick = 0.86 + f1 * 0.09 + f2 * 0.07 + f3 * 0.05;

    flameGroup.visible = ign > 0.02;
    var w = (0.55 + ign * 0.45) * flick;
    // 长度抖动比粗细更明显 —— 火焰是「窜」的
    var flen = thrust * (0.35 + ign * 0.65) * (0.82 + f1 * 0.13 + f3 * 0.08);
    flameGroup.scale.set(w, flen, w);

    // 整束火焰绕轴轻微摆动，避免像一根固定的锥子
    flameGroup.rotation.z = f2 * 0.035;
    flameGroup.rotation.x = f3 * 0.025;

    // 冲击钻石：亮度脉动 + 沿轴线来回窜
    for (var sd = 0; sd < shockDiamonds.length; sd++) {
      var sdp = shockDiamonds[sd];
      var sdPhase = now * 0.006 - sd * 1.15;
      var pulse = 0.55 + 0.45 * Math.sin(sdPhase);
      sdp.material.opacity = ign * (0.30 + 0.55 * pulse) * plumeFade;
      sdp.position.y = -1.0 - sd * 1.35 + Math.sin(sdPhase * 1.7) * 0.16;
      var sc2 = (1.15 - sd * 0.2) * (0.85 + 0.28 * pulse);
      sdp.scale.set(sc2, sc2 * 0.72, 1);
    }



    flameInner.material.opacity = (0.30 + ign * 0.62) * plumeFade;
    flameOuter.material.opacity = ign * 0.55 * plumeFade;

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
    var el = state.clock;
    // 进入太空段（侧倾开始）后才允许拖动环视
    orbit.enabled = !state.arrived && st.asc >= 1;
    var px, py, pz, lx, ly, lz;

    // --- 冲刺阶段：镜头冲向星球 ---
    if (state.arrived) {
      var g = clamp((state.clock - state.arriveAt) / T.GLIDE, 0, 1);
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
    // 地面要比原来淡得早：地球在高度 18 就开始露头，
    // 而原来看板要淡到 136 才消失 —— 两者重叠，地球弧线被草地挡住。
    // 改成 12~67，让位给地球。
    var padFade = 1 - clamp((h - 12) / 55, 0, 1);
    padGroup.visible = padFade > 0.02;
    padGroup.scale.setScalar(1 + (1 - padFade) * 0.18);

    if (padGroup.userData.ring) {
      padGroup.userData.ring.material.opacity = 0.32 + Math.sin(now * 0.003) * 0.18;
    }

    // 星球名字：进入太空后缓缓淡入，抵达瞬间拉到最亮
    if (planetLabel) {
      var nameOn = state.clock >= historyStartAt() + T.HISTORY_GAP * 2 ? 1 : 0;
      var curName = planetLabel.material.opacity;
      // 这里 dt 还没算出来（在下面几行），用固定步长就够 —— 淡入约 1.5 秒
      planetLabel.material.opacity = curName + (nameOn - curName) * 0.016 * 1.6;
      // 极慢的上下浮动，别让牌子像钉死的
      planetLabel.position.y = 210 + Math.sin(now * 0.0009) * 9;
    }

    // 校史翻页按钮：只在「校史已经开始、还没抵达」时出现
    if (els.histNav) {
      // 这里在 updateWorld 里，没有 el 变量，用动画时钟直接比
      var showNav = !state.arrived && state.clock >= historyStartAt();
      if (showNav !== els.histNav._on) {
        els.histNav._on = showNav;
        els.histNav.hidden = !showNav;
      }
      if (showNav && els.histPrev) {
        els.histPrev.disabled = state.historyIdx <= 0;
      }
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
    // 跳节过渡：先用 130ms 快速淡出，藏起来之后换图，再让它自然淡入。
    // 不这样做的话两张文字会在中间硬切一下，很跳。
    if (skipFx) {
      var se = now - skipFx.at;
      if (se < 130) {
        histSprite.material.opacity = Math.max(0, 1 - se / 130);
        histSprite.visible = true;
      } else {
        if (!skipFx.swapped) {
          skipFx.swapped = true;
          showHistory(skipFx.item);          // 此刻不可见，换图不会闪
        }
        if (se > 130 + SKIP_MS * 0.55) skipFx = null;
      }
    } else {
      var cur = histSprite.material.opacity;
      histSprite.material.opacity = cur + (histTargetOpacity - cur) * Math.min(1, dt * 5.5);
      histSprite.visible = histSprite.material.opacity > 0.01;
    }

    // 地球：升到高空才露出来
    // 地球提前出现：原来要到高度 55 才露头，那时已经快进太空了，
    // 整段「冲出大气层」看不到任何参照。改成 18 起步、90 到位。
    var earthVis = clamp((h - 18) / 90, 0, 1);
    earth.visible = earthVis > 0.01;
    earth.position.y = -430 - (1 - earthVis) * 120;
    earth.userData.globe.rotation.y = now * 0.000035;

    // 大气层辉光：穿越那一段明显变亮，过了再收回去 ——
    // 这是整段升空里唯一的「你正在离开地球」的视觉信号。
    if (earth.userData.atmo) {
      var crossBoost = Math.sin(clamp((h - 18) / 150, 0, 1) * Math.PI);
      earth.userData.atmo.material.opacity = 0.34 + crossBoost * 0.55;
      earth.userData.atmo.scale.setScalar(1 + crossBoost * 0.035);
    }

    // 参照物：碎石 + 速度线（让前进感成立）
    updateSpaceField(now, st, CRUISE);

    // 星球自转
    planetGroup.userData.globe.rotation.y = now * 0.00005;

    // 冲刺时星球放大（模拟逼近）
    if (state.arrived) {
      var g = clamp((state.clock - state.arriveAt) / T.GLIDE, 0, 1);
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
  /* ------------------------------------------------------------
     预热（warm-up）

     第一帧要编译全部着色器、上传纹理。实测在无头环境里，
     第一帧 2.4 秒、第二帧 5.6 秒 —— 光靠「固定预热 3 帧」根本挡不住，
     因为每上一批新对象就再编译一次。这几秒要是被算进动画进度，
     一开场就直接跳到「升空完成」，倒计时、校史、按钮全乱。

     所以改成**自适应**：一直只渲染、不推进动画，
     直到某一帧的耗时跌到正常水平（< 120ms），才把 t0 定下来开始计时。
     硬件快的一两帧就过，慢的会自动多等几帧。
     ------------------------------------------------------------ */
  var warmDone = false;
  var frameLast = 0;
  var clockFrozen = false;   // 调试用：冻结动画时钟，方便截图对比
  var warmFrames = 0;
  var warmLast = 0;
  var WARM_FAST_MS = 120;    // 一帧低于这个就算预热完了
  var WARM_MAX = 30;         // 保险：最多等 30 帧，别卡死

  function tick() {
    // 上下文丢了就别再排帧了，等 restored 事件重新拉起
    if (ctxLost) { RAF = null; return; }
    RAF = requestAnimationFrame(tick);
    var now = performance.now();

    // 调色层：撑满视野。放在相机前 1 个单位处，
    // 该距离上的可视高度 = 2 * tan(fov/2) * dist，宽度再乘 aspect。
    if (colorGrade.liftSprite && colorGrade.gainSprite) {
      var dGrade = 1;
      var hGrade = 2 * Math.tan(camera.fov * Math.PI / 360) * dGrade * 1.02;
      var wGrade = hGrade * camera.aspect * 1.02;
      colorGrade.liftSprite.position.set(0, 0, -dGrade);
      colorGrade.gainSprite.position.set(0, 0, -dGrade + 0.001);
      colorGrade.liftSprite.scale.set(wGrade, hGrade, 1);
      colorGrade.gainSprite.scale.set(wGrade, hGrade, 1);
    }

    // 星空闪烁：驱动 uTime；uScale 每帧跟着画布高度走，
    // 窗口缩放时点的大小自动正确，不用另外监听 resize。
    var smat = starField.userData && starField.userData.mat;
    if (smat) {
      smat.uniforms.uTime.value = now * 0.001;
      smat.uniforms.uScale.value = renderer.domElement.height * 0.5;
    }

    if (!warmDone) {
      try { renderer.render(scene, camera); } catch (e) {}
      var frameMs = warmLast ? (now - warmLast) : 0;
      warmLast = now;
      warmFrames++;
      // 第一帧没有上一帧可比，frameMs=0，会立刻达标 —— 所以要求至少跑 2 帧
      if (warmFrames >= 2 && (frameMs < WARM_FAST_MS || warmFrames >= WARM_MAX)) {
        warmDone = true;
        state.clock = 0;
        lastCd = null;
      }
      return;
    }

    /* ------------------------------------------------------------
       动画时钟：**只按被限制的帧间隔累加**，不用 now - t0。

       为什么：第一帧要编译大量着色器，实测单帧能到 2~9 秒。
       如果用墙钟差值，那一帧过去 el 就直接跳 9 秒，
       动画一开场就跳到「升空完成」—— 倒计时、校史、按钮全乱。

       这里把单帧封顶在 100ms：卡顿只让动画「慢一点」，
       不会把它甩到后面去。硬件快的机器完全无感。
       ------------------------------------------------------------ */
    var dtRaw = frameLast ? (now - frameLast) : 16;
    frameLast = now;
    if (clockTween) {
      // smoothstep：两端慢、中间快，比线性更像"滑过去"而不是"弹过去"
      var tk = Math.min(1, (now - clockTween.at) / SKIP_MS);
      var te = tk * tk * (3 - 2 * tk);
      state.clock = clockTween.from + (clockTween.to - clockTween.from) * te;
      if (tk >= 1) {
        state.clock = clockTween.to;
        clockTween = null;
      }
    } else if (!clockFrozen && !state.paused) {
      state.clock += Math.min(dtRaw, 100);
    }
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
    hintOrbit: document.getElementById('hint-orbit'),
    histNav: document.getElementById('hist-nav'),
    histPrev: document.getElementById('hist-prev'),
    histNext: document.getElementById('hist-next'),
    histLive: document.getElementById('hist-live'),
    histPause: document.getElementById('hist-pause')
  };

  var HISTORY = [
    { y: '1927', t: '私立广州大学创立', d: '陈炳权先生创办，定校训「博学笃行」', tone: 'founding' },
    { y: '1944', t: '弦歌不辍', d: '抗战期间七度迁徙仍办学不辍；全校师生为抗日捐献战斗机', tone: 'war' },
    { y: '1953–1985', t: '五校并起', d: '广州教育学院、广州师范学院等五所市属高校相继创办', tone: 'build' },
    { y: '2000', t: '五校合并', d: '组建新的广州大学，校训合成「博学笃行、与时俱进」', tone: 'merge' },
    { y: '2005', t: '迁入大学城', d: '办学空间与硬件条件得到根本性改善', tone: 'campus' },
    { y: '2006', t: '博士授予权', d: '被增列为博士学位授予单位，办学层次跃升', tone: 'rise' },
    { y: '2018', t: '工程学破零', d: '工程学首次进入 ESI 全球前 1%，实现零的突破', tone: 'science' },
    // 终章单独标记：它不是一个「年份节点」，而是整条线的收束，
    // 画的时候给它不同的排场（见 drawHistoryTexture 里的 finale 分支）。
    { y: '2027', t: '建校一百周年', d: '从 1927 到今天，百年学府迎来百年校庆', finale: true }
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
    // ⚠️ depthTest 必须关掉。
    // 这张卡片是一个 3D 精灵，和星球、碎石在同一个坐标系里；
    // 只要它们挡在前面，文字就会被切掉（截图里「私立广州大学创立」的
    // 「立」整个被星球盖住）。校史是这一段的正文，不应该被装饰物遮住。
    depthTest: false,
    fog: false
  }));
  // renderOrder 要大于碎石和飞字，保证它最后画、压在最上面
  histSprite.renderOrder = 50;
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

  /* 描述文字自适应字号：在 maxW 内一行放得下就用最大字号，放不下就降档。
     这样「抗战期间七度迁徙仍办学不辍……」这种长句不会折成两行。 */
  function fitDescFont(g, text, maxW) {
    var sizes = [36, 32, 29, 26];
    for (var i = 0; i < sizes.length; i++) {
      g.font = '600 ' + sizes[i] + 'px ' + FONT;
      if (g.measureText(text).width <= maxW) return sizes[i];
    }
    g.font = '600 26px ' + FONT;
    return 26;
  }

  function drawHistoryTexture(item, idx, total) {
    var g = histCtx, W = histCanvas.width, H = histCanvas.height;
    g.clearRect(0, 0, W, H);
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    var CX = W / 2;

    /* ------------------------------------------------------------
       虚化背景

       文字直接压在星空上时，亮星、碎石、飞字都会从字缝里穿过去，
       读起来很累。这里在文字后面垫一层柔和的暗底。

       做法是两层：
         ① 一个大范围的径向渐变 —— 负责「整体压暗」，边缘完全透明；
         ② 一个椭圆形的模糊块 —— 用 canvas 的 filter: blur() 做真正的
            高斯模糊，让它看起来像「背景被虚化了」而不是「加了块底色」。

       ⚠️ 必须画在文字之前，而且透明度不能太高 —— 太高会变成一张
          黑色卡片，那就退回早期被否掉的「卡片式」了。
       ------------------------------------------------------------ */

    // ① 大范围柔光压暗
    var vign = g.createRadialGradient(CX, H * 0.48, H * 0.10, CX, H * 0.48, W * 0.52);
    vign.addColorStop(0, 'rgba(7, 11, 24, .62)');
    vign.addColorStop(0.45, 'rgba(7, 11, 24, .40)');
    vign.addColorStop(0.75, 'rgba(7, 11, 24, .14)');
    vign.addColorStop(1, 'rgba(7, 11, 24, 0)');
    g.fillStyle = vign;
    g.fillRect(0, 0, W, H);

    // ② 椭圆模糊块：模拟「背景被虚化」
    g.save();
    if (typeof g.filter === 'string') g.filter = 'blur(42px)';
    var pill = g.createRadialGradient(CX, H * 0.46, H * 0.05, CX, H * 0.46, W * 0.34);
    pill.addColorStop(0, 'rgba(6, 10, 22, .52)');
    pill.addColorStop(0.55, 'rgba(6, 10, 22, .34)');
    pill.addColorStop(1, 'rgba(6, 10, 22, 0)');
    g.fillStyle = pill;
    // 画一个比文字范围略大的椭圆
    var ew = W * 0.42, eh = H * 0.46;
    g.beginPath();
    g.ellipse(CX, H * 0.46, ew, eh, 0, 0, Math.PI * 2);
    g.fill();
    if (typeof g.filter === 'string') g.filter = 'none';
    g.restore();

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
    // 这里还没算 tone，先取一次（下面年份那段会复用同一个变量名会有冲突，
    // 所以这里用独立的名字）
    var labelTone = (ERA_TONES[item.tone] || ERA_TONES.founding).label;
    g.fillStyle = labelTone;
    g.shadowColor = (ERA_TONES[item.tone] || ERA_TONES.founding).c;
    g.shadowBlur = 16;
    g.fillText('广 州 大 学 校 史', CX, 76);
    g.restore();

    // ---- 终章（2027 百年校庆）单独排版 ----
    // 它不是一个「年份节点」，而是整条线的收束，所以要给不同的排场：
    // 上下加更宽的金线、标出 1927—2027 的跨度、字号更大、底部加一行祝词。
    if (item.finale) {
      rule(34, 340, 0.75);
      diamond(CX - 348, 34, 7, 'rgba(254,206,14,.95)');
      diamond(CX + 348, 34, 7, 'rgba(254,206,14,.95)');

      g.save();
      g.font = '700 34px ' + FONT;
      g.fillStyle = 'rgba(180,200,255,.8)';
      g.shadowColor = 'rgba(90,140,255,.9)';
      g.shadowBlur = 20;
      g.fillText('1927  —  2027', CX, 78);
      g.restore();

      g.save();
      var fg = g.createLinearGradient(0, 110, 0, 250);
      fg.addColorStop(0, '#fffbe0');
      fg.addColorStop(0.4, '#ffd83a');
      fg.addColorStop(1, '#e08a00');
      g.font = '900 176px ' + FONT;
      g.shadowColor = 'rgba(255,196,32,.95)';
      g.shadowBlur = 92;
      g.fillStyle = fg;
      g.fillText(item.y, CX, 178);
      g.shadowBlur = 0;
      g.fillText(item.y, CX, 178);
      g.restore();

      g.save();
      g.font = '900 78px ' + FONT;
      g.shadowColor = 'rgba(255,190,60,.8)';
      g.shadowBlur = 40;
      g.fillStyle = '#fff6d0';
      g.fillText(item.t, CX, 284);
      g.restore();

      g.save();
      g.font = '600 36px ' + FONT;
      g.shadowColor = 'rgba(0,0,0,.95)';
      g.shadowBlur = 20;
      g.fillStyle = 'rgba(226,234,255,.88)';
      // 按文字长度自动缩字号：一行放得下就用 36px，放不下依次缩到 32/29，
      // 不要折成两行 —— 描述只有一句，折行会把最后两个字挤到第二行，很难看。
      fitDescFont(g, item.d, W - 90);
      wrapText(g, item.d, CX, 350, W - 90, 48);
      g.restore();

      rule(410, 210, 0.5);
      g.save();
      g.font = '700 26px ' + FONT;
      g.fillStyle = 'rgba(254,206,14,.85)';
      g.fillText('百 年 学 府 · 与 城 同 长', CX, 440);
      g.restore();

      // 终章不用进度点，换成一条收束线
      rule(468, 120, 0.28);

      histTex.needsUpdate = true;
      return;
    }

    // ---- 年份：按年代取色 + 双层辉光 ----
    var tone = ERA_TONES[item.tone] || ERA_TONES.founding;
    g.save();
    var yGr = g.createLinearGradient(0, 118, 0, 236);
    yGr.addColorStop(0, tone.a);
    yGr.addColorStop(0.45, tone.b);
    yGr.addColorStop(1, tone.b);
    g.font = '900 150px ' + FONT;
    // 外层柔光
    g.shadowColor = tone.c;
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
    fitDescFont(g, item.d, W - 100);
    wrapText(g, item.d, CX, 344, W - 100, 48);
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
    // 竖屏：卡片要挪到画面上部。
    // 原来 offYFrac 只给 0.15，卡片正好压在火箭身上 ——
    // 手机屏幕窄，火箭纵向占满，中间那块是它的地盘。
    // 现在抬到 0.30，落在火箭鼻锥上方，同时略微收窄避免贴边。
    var wFrac = narrow ? 0.70 : 0.50;
    var offXFrac = narrow ? 0 : -0.16;
    var offYFrac = narrow ? 0.30 : 0.17;

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
    var el = state.clock;

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
    // 暂停时不要每帧把提示改回去，否则「已暂停」一闪就没了
    if (state.paused && els.hint) {
      els.hint.textContent = '已暂停 · 点中间的按钮继续';
    } else if (els.hint && els.hint.textContent.indexOf('飞往') < 0 &&
               els.hint.textContent.indexOf('已暂停') < 0 &&
               els.hint.textContent.indexOf('已跳到') < 0 &&
               els.hint.textContent.indexOf('已讲完') < 0) {
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

    // ① 升空一完成就露出角落按钮 —— 想快点走的人不用等校史
    if (el >= T.PRE + T.ASCEND + 300) revealGoBtn();

    // ② 校史全部讲完，按钮飞到正中。
    // ⚠️ 用时间点判断，不要只在「翻到最后一张」那一刻触发 ——
    //    如果中途被快进/跳帧（比如 reduced-motion、调试钩子），
    //    那个事件就永远等不到。
    if (el >= goRevealAt()) centerGoBtn();

    // --- 抵达收尾 ---
    if (state.arrived) {
      var g = (state.clock - state.arriveAt) / T.GLIDE;
      if (g > 1.05) finishAndGo();
    }
  }

  function showHistory(i) {
    // 读屏播报：校史画在 canvas 上，辅助技术读不到，
    // 所以每换一节就往 aria-live 里写一句。
    if (els.histLive) {
      els.histLive.textContent = '校史第 ' + (i + 1) + ' 节，共 ' + HISTORY.length +
        ' 节：' + HISTORY[i].y + '　' + HISTORY[i].t;
    }
    var h = HISTORY[i];
    // 画到 3D 精灵上（不再用网页卡片）
    drawHistoryTexture(h, i, HISTORY.length);
    histTargetOpacity = 1;
    histFloat = 0;
  }

  /* 按钮分两步出现：
       ① 升空完成 → 右下角一颗小胶囊，想快点走的人立刻可以点；
       ② 主线索全部讲完 → 它飞到屏幕正中放大，作为「正式抵达」的收尾。
     既不用等 30 秒才能走，又保留了叙事节奏。 */
  var goRevealed = false;
  var goCentered = false;

  /* 暂停 / 继续。

     按钮和空格键共用这份逻辑 —— 分开写的话，按空格改了 state 却忘了
     同步按钮的 aria-pressed，图标就会和实际状态对不上。 */
  function togglePause() {
    if (state.arrived) return;
    state.paused = !state.paused;

    // 按钮：图标换（CSS 靠 aria-pressed 切）、读屏标签换
    if (els.histPause) {
      els.histPause.setAttribute('aria-pressed', state.paused ? 'true' : 'false');
      els.histPause.setAttribute('aria-label', state.paused ? '继续' : '暂停');
    }

    if (els.hint) {
      els.hint.textContent = state.paused
        ? '已暂停 · 点中间的按钮继续'
        : '奶龙号正在飞往广州大学星…';
    }
  }

  /* 跳到下一节校史。

     41 秒的纯被动观看太长 —— 想快的人应该能自己跳。

     关键是**不能瞬移时钟**：原来直接把 state.clock 设成目标值，
     火箭、相机、星空参照物全都一帧跳过去，看起来像卡了一下。
     现在改成两件事同时做：

       · 时钟在 SKIP_MS 内用 smoothstep 从当前值缓推到目标值 ——
         火箭会真的"快进"过去，而不是闪现；
       · 文字快速淡出 → 换图 → 淡入，避免两张图在中间硬切。
     */
  var SKIP_MS = 620;

  // 每次快进后的冷却时间：防止连点、误触把整段校史一口气翻完
  var SKIP_COOLDOWN_MS = 800;
  var lastSkipAt = -1e9;

  var clockTween = null;   // { from, to, at }
  var skipFx = null;       // { at, item, swapped }

  function advanceHistory() {
    if (state.arrived) return;

    /* 两道闸，防误触也防「提前点、事后才生效」 */

    // 闸 1：校史还没开始就不要受理。
    // 原来没有这个判断 —— 升空过程中点屏幕，advanceHistory 会立刻
    // 把 clockTween 设好并开始缓推；但那时动画时钟还在升空段，
    // 等升空完成后这个 tween 才真正见效，表现就是「升空一结束就莫名快进一次」。
    if (state.clock < historyStartAt()) return;

    // 闸 2：每次快进后冷却 SKIP_COOLDOWN_MS，防连续点、防手抖。
    var nowMs = performance.now();
    if (nowMs - lastSkipAt < SKIP_COOLDOWN_MS) return;
    var next = state.historyIdx + 1;

    /* 已经在最后一节：点屏幕**不再**直接跳转。
       抵达是一个有仪式感的收尾，应该由用户明确点「出发」来触发，
       而不是在翻完最后一页时被顺手带出去。
       这里只做两件事：把按钮短暂强调一下，并把提示改成指路。 */
    if (next >= HISTORY.length) {
      if (els.goBtn) {
      lastSkipAt = nowMs;
        els.goBtn.classList.add('nudge');
        setTimeout(function () {
          if (els.goBtn) els.goBtn.classList.remove('nudge');
        }, 900);
      }
      if (els.hint) {
        els.hint.textContent = '已讲完 · 点击「出发，前往广州大学星」继续';
      }
      return;
    }

    var target = historyStartAt() + T.HISTORY_GAP * next + 1;

    lastSkipAt = nowMs;
    clockTween = { from: state.clock, to: target, at: performance.now() };
    skipFx = { at: performance.now(), item: next, swapped: false };

    state.historyIdx = next;
    // 用**墙钟**记时间点：updateOverlay 判「该翻下一页了」用的是
    // now - state.historyShownAt，两边必须是同一时间基准。
    // 这里原来写的是动画时钟的目标值，混用会导致刚跳完又被自动翻一页。
    state.historyShownAt = performance.now();
    if (els.hint) els.hint.textContent = '已跳到下一节 · 再次轻点可继续';
  }

  /* 回到上一节校史。
     翻页按钮要能往回走，否则点到下一节就没法回头看了。 */
  function rewindHistory() {
    if (state.arrived) return;
    if (state.clock < historyStartAt()) return;
    var nowMs = performance.now();
    if (nowMs - lastSkipAt < SKIP_COOLDOWN_MS) return;

    var prev = state.historyIdx - 1;
    if (prev < 0) return;

    var target = historyStartAt() + T.HISTORY_GAP * prev + 1;
    lastSkipAt = nowMs;
    clockTween = { from: state.clock, to: target, at: performance.now() };
    skipFx = { at: performance.now(), item: prev, swapped: false };
    state.historyIdx = prev;
    // 用**墙钟**记时间点：updateOverlay 判「该翻下一页了」用的是
    // now - state.historyShownAt，两边必须是同一时间基准。
    // 这里原来写的是动画时钟的目标值，混用会导致刚跳完又被自动翻一页。
    state.historyShownAt = performance.now();
    if (els.hint) els.hint.textContent = '已回到上一节 · 轻点屏幕可继续';
  }

  function revealGoBtn() {
    if (goRevealed) return;
    goRevealed = true;
    if (els.goBtn) {
      els.goBtn.hidden = false;
      els.goBtn.classList.add('corner');
      // 下一帧再加 show，保证 transition 有起点
      requestAnimationFrame(function () {
        if (els.goBtn) els.goBtn.classList.add('show');
      });
    }
  }

  function centerGoBtn() {
    if (goCentered || !goRevealed) return;
    goCentered = true;
    if (els.goBtn) {
      els.goBtn.classList.remove('corner');
      els.goBtn.classList.add('center', 'show');
    }
    if (els.hint) els.hint.textContent = '奶龙号已抵达广州大学星';
  }

  /* ---------- 点击「出发」 ---------- */
  function depart() {
    if (state.arrived) return;
    state.arrived = true;
    state.arriveAt = state.clock;
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
  /* ============================================================
     健壮性

     ① WebGL 上下文丢失
        手机显存紧张、切到微信再切回来、GPU 驱动重置，都会丢上下文。
        原来完全没处理 —— 丢了就是永久黑屏，用户只能刷新。
        这里监听 webglcontextlost / restored，丢失时切到降级页，
        恢复时重建尺寸并重启渲染循环。

     ② 标签页隐藏时暂停
        requestAnimationFrame 在后台仍然会被调度（浏览器只是降频）。
        停掉可以省电省发热，回来时也不会因为时间跳变而错位。
     ============================================================ */
  var ctxLost = false;

  canvas.addEventListener('webglcontextlost', function (e) {
    // preventDefault 是必须的，否则浏览器不会触发 restored
    e.preventDefault();
    ctxLost = true;
    if (RAF) { cancelAnimationFrame(RAF); RAF = null; }
    // 复用已有的降级样式：显示静态页 + 直链，比黑屏强得多
    document.body.classList.add('no-3d');
  }, false);

  canvas.addEventListener('webglcontextrestored', function () {
    ctxLost = false;
    document.body.classList.remove('no-3d');
    try {
      resize();
      renderer.resetState && renderer.resetState();
      frameLast = 0;      // 别让中断期间的时间算进动画
      warmDone = true;    // 已经编译过一次，不用重新预热
      if (!RAF) tick();
    } catch (err) {
      // 恢复失败就留在降级页，不要再抛
    }
  }, false);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (RAF) { cancelAnimationFrame(RAF); RAF = null; }
    } else if (!ctxLost && !RAF) {
      // 回来时把帧计时的基准清掉，避免一帧吃掉几十秒
      frameLast = 0;
      warmLast = performance.now();
      tick();
    }
  }, false);

  // 横竖屏切换：resize 能兜住大部分情况，这里补一次延迟重算，
  // 因为部分移动浏览器在 orientationchange 当下拿到的尺寸还是旧的。
  window.addEventListener('orientationchange', function () {
    setTimeout(function () { try { resize(); } catch (e) {} }, 260);
  }, false);

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
    /* ============================================================
       预热编译

       three.js 的材质是「第一次渲染时才编译着色器」。实测（无头环境）
       首帧 2.4 秒、第二帧 5.6 秒 —— 真机上也会有一两秒的白屏/卡顿。
       renderer.compile() 会把场景里所有材质的程序提前编译好，
       把这段时间从「渲染时卡住」挪到「启动时等一下」。
       配合 #boot 那层遮罩，用户看到的是「正在点火」，而不是黑屏。
       ============================================================ */
    try { renderer.compile(scene, camera); } catch (e) {}

    // 编译完再收起启动遮罩
    var bootEl = document.getElementById("boot");
    if (bootEl) {
      bootEl.classList.add("done");
      setTimeout(function () { if (bootEl.parentNode) bootEl.parentNode.removeChild(bootEl); }, 900);
    }

    // 时钟不在这里起算 —— tick() 会先跑几帧预热（编译着色器），
    // 预热结束才开始计时。否则首帧耗时会被算进动画进度。

    if (els.dots && !els.dots.children.length) {
      for (var i = 0; i < HISTORY.length; i++) {
        els.dots.appendChild(document.createElement("i"));
      }
    }

    // 先摆好相机与火箭，避免第一帧从默认位置弹过来
    var now = performance.now();
    var st = rocketState(now);
    updateCamera(now, st, true);
    updateRocket(now);


    if (els.goBtn) els.goBtn.addEventListener("click", depart);

    // 校史翻页按钮（放在这里而不是 bindOrbit —— els 要到这一节才定义）
    if (els.histNext) {
      els.histNext.addEventListener("click", function (e) {
        e.stopPropagation();
        advanceHistory();
      });
    }
    if (els.histPrev) {
      els.histPrev.addEventListener("click", function (e) {
        e.stopPropagation();
        rewindHistory();
      });
    }
    if (els.histPause) {
      els.histPause.addEventListener("click", function (e) {
        e.stopPropagation();
        togglePause();
      });
    }

    tick();
    window.__launchReady = true;
  }

  window.NailongLaunch = { depart: depart, start: start };

  // 调试用：把内部对象暴露出来，方便在浏览器里逐个隐藏定位问题
  window.__dbg = {
    scene: scene, camera: camera, rocket: rocket, flameGroup: flameGroup,
    embers: embers, planetGroup: planetGroup, earth: earth, padGroup: padGroup,
    trail: trail, state: state,
    trailAlive: function () {
      var n = 0;
      for (var i = 0; i < trail.n; i++) if (trail.age[i] >= 0) n++;
      return n;
    }
  };

  // 调试用：把动画时间跳到指定毫秒（截图验收时精确抓某一帧）。
  // 平时不会被调用，留着也不影响线上。
  // 调试用：冻结/解冻动画时钟（截图时用，线上不会调用）
  window.__freezeClock = function (on) { clockFrozen = !!on; };

  window.__setLaunchTime = function (ms) {
    // 跳过预热，让调试跳转立刻生效
    warmDone = true;
    state.clock = ms;
    // 同时把按钮打回初始态：否则上一次跑到后面留下的「已出现」状态会带过来，
    // 截图就对不上了。
    goRevealed = false;
    goCentered = false;
    if (els.goBtn) {
      els.goBtn.hidden = true;
      els.goBtn.classList.remove('corner', 'center', 'show', 'gone');
    }
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
