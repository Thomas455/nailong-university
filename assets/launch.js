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
    GLIDE: 2800        // 点击后冲向星球
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
    var groundTex = makeTexture(1024, 1024, function (g, w, h) {
      var grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grd.addColorStop(0, '#141b30');
      grd.addColorStop(0.42, '#0b1020');
      grd.addColorStop(1, '#05070f');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
      // 同心圆刻度，给个「发射场」的暗示
      g.strokeStyle = 'rgba(254,206,14,.07)';
      g.lineWidth = 3;
      for (var r = 70; r < w / 2; r += 78) {
        g.beginPath(); g.arc(w / 2, h / 2, r, 0, Math.PI * 2); g.stroke();
      }
      // 放射状刻度
      g.strokeStyle = 'rgba(120,160,255,.05)';
      g.lineWidth = 2;
      for (var a = 0; a < 36; a++) {
        var ang = (a / 36) * Math.PI * 2;
        g.beginPath();
        g.moveTo(w / 2 + Math.cos(ang) * 120, h / 2 + Math.sin(ang) * 120);
        g.lineTo(w / 2 + Math.cos(ang) * (w / 2 - 10), h / 2 + Math.sin(ang) * (w / 2 - 10));
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
        color: 0x4a5270,
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
    var white = new THREE.MeshStandardMaterial({
      color: 0xdfe4f2, roughness: 0.34, metalness: 0.28
    });
    var gold = new THREE.MeshStandardMaterial({
      color: 0xfece0e, roughness: 0.28, metalness: 0.62,
      emissive: 0x3a2c00, emissiveIntensity: 0.35
    });
    var dark = new THREE.MeshStandardMaterial({
      color: 0x1c2236, roughness: 0.42, metalness: 0.85
    });

    // ---- 箭体：上细下粗，一点点锥度更像真火箭 ----
    var body = new THREE.Mesh(new THREE.CylinderGeometry(1.46, 1.74, 5.6, 48), white);
    body.position.y = 3.5;
    rocket.add(body);

    // 箭体上两道细金环（视觉分段，避免一大片白）
    for (var b = 0; b < 2; b++) {
      var band = new THREE.Mesh(
        new THREE.CylinderGeometry(1.62 - b * 0.05, 1.66 - b * 0.05, 0.1, 48), gold
      );
      band.position.y = 1.35 + b * 3.4;
      rocket.add(band);
    }

    // ---- 头锥 ----
    var nose = new THREE.Mesh(new THREE.ConeGeometry(1.46, 2.9, 48), gold);
    nose.position.y = 7.75;
    rocket.add(nose);

    // 头锥根部的过渡环（收口，不然圆锥和圆柱直接撞在一起很生硬）
    var collar = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.24, 48), gold);
    collar.position.y = 6.32;
    rocket.add(collar);

    // 顶尖小天线
    var antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.1, 8),
      new THREE.MeshStandardMaterial({ color: 0xbfc7dd, roughness: 0.3, metalness: 0.9 }));
    antenna.position.y = 9.7;
    rocket.add(antenna);
    var tip = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xff4d4d, fog: false }));
    tip.position.y = 10.28;
    rocket.add(tip);
    rocket.userData.tip = tip;

    // ---- 尾喷管 ----
    // 外层：上窄下宽的开口锥
    var bell = new THREE.Mesh(
      new THREE.CylinderGeometry(1.02, 1.62, 1.25, 40, 1, true), dark
    );
    bell.position.y = 0.16;
    bell.material.side = THREE.DoubleSide;
    rocket.add(bell);

    // 内层：暖色，点火后靠它发光
    var bellInner = new THREE.Mesh(
      new THREE.CylinderGeometry(0.72, 1.25, 1.2, 32, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffb45c, transparent: true, opacity: 0, fog: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    bellInner.position.y = 0.18;
    rocket.add(bellInner);
    rocket.userData.bellInner = bellInner;

    // ---- 尾翼：3 片，后掠梯形 ----
    // 形状画在 XY 平面：x 是「离箭体的距离」，y 是高度。
    // 上边短、下边长 → 后掠感。
    var finShape = new THREE.Shape();
    finShape.moveTo(0, 2.55);
    finShape.lineTo(0, 0.05);
    finShape.lineTo(1.62, 0.42);
    finShape.lineTo(1.42, 1.42);
    finShape.closePath();

    var finGeo = new THREE.ExtrudeGeometry(finShape, {
      depth: 0.15, bevelEnabled: true, bevelSize: 0.035,
      bevelThickness: 0.035, bevelSegments: 2
    });
    finGeo.translate(0, 0, -0.075);   // 让厚度居中

    for (var i = 0; i < 3; i++) {
      var a = (i / 3) * Math.PI * 2;
      // holder 只管绕 Y 转，翼片自己负责贴到箭体表面
      var holder = new THREE.Group();
      holder.rotation.y = a;
      var finMesh = new THREE.Mesh(finGeo, gold);
      finMesh.position.set(1.72, 0.15, 0);
      finMesh.rotation.z = 0;
      holder.add(finMesh);
      rocket.add(holder);
    }

    // ---- 舷窗：奶龙坐在里面 ----
    var winGroup = new THREE.Group();
    winGroup.position.set(0, 4.55, 1.66);

    var winTex = new THREE.TextureLoader().load('core.webp');
    winTex.encoding = THREE.sRGBEncoding;

    var winDisc = new THREE.Mesh(
      new THREE.CircleGeometry(0.88, 40),
      new THREE.MeshBasicMaterial({ map: winTex, transparent: true, fog: false })
    );
    winGroup.add(winDisc);

    var winRim = new THREE.Mesh(
      new THREE.TorusGeometry(0.9, 0.1, 14, 56),
      new THREE.MeshStandardMaterial({ color: 0xfece0e, roughness: 0.42, metalness: 0.45, emissive: 0x2a1f00, emissiveIntensity: 0.6 })
    );
    winGroup.add(winRim);

    // 舷窗外一圈柔光，像舱内透出来的
    var winGlow = new THREE.Mesh(
      new THREE.CircleGeometry(1.5, 36),
      new THREE.MeshBasicMaterial({
        color: 0xffe9a8, transparent: true, opacity: 0.16, fog: false,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    winGlow.position.z = -0.02;
    winGroup.add(winGlow);
    rocket.add(winGroup);

    // ---- 箭体侧面「奶龙号」 ----
    var nameTex = makeTexture(256, 1024, function (g, w, h) {
      g.clearRect(0, 0, w, h);
      g.fillStyle = '#2a2000';
      g.font = 'bold 140px "PingFang SC","Microsoft YaHei",sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      var chars = ['奶', '龙', '号'];
      for (var k = 0; k < chars.length; k++) {
        g.fillText(chars[k], w / 2, 240 + k * 205);
      }
    });
    var nameDecal = new THREE.Mesh(
      new THREE.PlaneGeometry(0.95, 3.8),
      new THREE.MeshBasicMaterial({
        map: nameTex, transparent: true, depthWrite: false, fog: false
      })
    );
    // 贴在 -Z 面（舷窗背面），从后面也看得到字
    nameDecal.position.set(0, 3.9, -1.72);
    nameDecal.rotation.y = Math.PI;
    rocket.add(nameDecal);
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
      var k = Math.pow(1 - tv, 2.3) * 0.42;
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
  var flameInner = makePlume(0.66, 4.6, 0xfff2cc, 0.30);
  flameInner.rotation.x = Math.PI;
  flameInner.position.y = -2.4;
  flameGroup.add(flameInner);

  // 外焰：宽而淡，带橙
  var flameOuter = makePlume(1.42, 8.4, 0xff9422, 0.20);
  flameOuter.rotation.x = Math.PI;
  flameOuter.position.y = -4.5;
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

    flameInner.material.opacity = (0.10 + ign * 0.34) * plumeFade;
    flameOuter.material.opacity = ign * 0.24 * plumeFade;

    // 喷管内壁发光
    if (rocket.userData.bellInner) {
      rocket.userData.bellInner.material.opacity = ign * 0.14;
    }

    // 喷口辉光（billboard）跟着点火强度走
    if (flameGroup.userData.glow) {
      flameGroup.userData.glow.material.opacity = ign * (0.30 + 0.1 * flick) * (0.35 + 0.65 * plumeFade);
      var gs = (0.5 + ign * 0.85) * (0.9 + 0.1 * flick);
      flameGroup.userData.glow.scale.set(gs, gs, 1);
    }

    // 引擎点光源跟着喷口走
    var wp = flameGroup.getWorldPosition(new THREE.Vector3());
    engineLight.position.copy(wp);
    engineLight.intensity = ign * 4.2 * flick;

    // 顶尖红灯闪
    if (rocket.userData.tip) {
      rocket.userData.tip.material.color.setHex(
        (Math.sin(now * 0.005) > 0) ? 0xff4d4d : 0x551515
      );
    }

    updateEmbers(now, ign);
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
      px = lerp(14, 11.5, k);
      pz = lerp(19, 15, k);

      lx = 0;
      ly = st.y + 5.0;
      lz = 0;
    } else {
      // --- C：太空追尾 ---
      // 混合系数：侧倾过程中从 B 平滑挪到 C
      var m = smooth(st.pitch);

      // B 的收尾机位（asc = 1 时，和上面那组 lerp 的终值一致）
      var bX = 11.5, bY = SPACE_Y + 1.3 - 1.6, bZ = 15;

      // C：箭体后上方 + 侧偏。
      // ⚠️ 不要正对 -Z 后方：那样只能看到一个喷口圆盘，
      //    偏到侧面才能看到箭体轮廓、尾翼和尾焰。
      var cX = 14.5;
      var cY = st.y + 4.6;
      var cZ = st.z + 12;

      px = lerp(bX, cX, m);
      py = lerp(bY, cY, m);
      pz = lerp(bZ, cZ, m);

      lx = 0;
      ly = lerp(SPACE_Y + 4.7, st.y + 6.5, m);
      lz = lerp(0, st.z - 8, m);
    }

    // 平滑跟随（snap = true 时直接落位，用于首帧和还原）
    var f = snap ? 1 : (state.arrived ? 0.18 : 0.1);
    camera.position.x = lerp(camera.position.x, px, f);
    camera.position.y = lerp(camera.position.y, py, f);
    camera.position.z = lerp(camera.position.z, pz, f);

    camLook.x = lerp(camLook.x, lx, snap ? 1 : 0.12);
    camLook.y = lerp(camLook.y, ly, snap ? 1 : 0.12);
    camLook.z = lerp(camLook.z, lz, snap ? 1 : 0.12);
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
    hint: document.getElementById('hint')
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

  function drawHistoryTexture(item) {
    var g = histCtx, W = histCanvas.width;
    g.clearRect(0, 0, W, histCanvas.height);
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    // ---- 年份：金色，带辉光 ----
    g.save();
    g.font = '900 148px ' + FONT;
    g.shadowColor = 'rgba(254,206,14,.9)';
    g.shadowBlur = 56;
    g.fillStyle = '#fece0e';
    g.fillText(item.y, W / 2, 104);
    // 再描一遍加强辉光
    g.shadowBlur = 92;
    g.fillStyle = 'rgba(254,206,14,.55)';
    g.fillText(item.y, W / 2, 104);
    g.restore();

    // ---- 标题：白色，冷色辉光 ----
    g.save();
    g.font = '800 72px ' + FONT;
    g.shadowColor = 'rgba(110,160,255,.85)';
    g.shadowBlur = 40;
    g.fillStyle = '#eef1ff';
    g.fillText(item.t, W / 2, 226);
    g.restore();

    // ---- 描述：浅灰，深色描边保证在星空上也读得清 ----
    g.save();
    g.font = '600 38px ' + FONT;
    g.shadowColor = 'rgba(0,0,0,.95)';
    g.shadowBlur = 22;
    g.fillStyle = 'rgba(226,233,255,.86)';
    wrapText(g, item.d, W / 2, 300, W - 110, 54);
    g.restore();

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

  // 校史从升空进行到一半时开始放，让起飞那几秒画面干净
  function historyStartAt() {
    return T.PRE + T.ASCEND * 0.45;
  }

  // 最后一页校史放完的时刻 —— 到了就亮出「出发」按钮
  function goRevealAt() {
    return historyStartAt() + T.HISTORY_GAP * HISTORY.length;
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
    drawHistoryTexture(h);
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
    if (veil) setTimeout(function () { veil.classList.add('on'); }, T.GLIDE * 0.72);
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
    embers: embers, planetGroup: planetGroup, earth: earth, padGroup: padGroup
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
