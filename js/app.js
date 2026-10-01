// 平度美食探索 —— 房间式门户
// 三个视图：房间首页 / 美食地图 / 我的动态
// 美食数据来自 data/foods.json；动态数据存 Supabase

const JSON_URL = "data/foods.json?t=" + Date.now();

let foods = [];
let map = null;
let markers = [];
let activeId = null;
let currentCategory = "全部";
let mapInited = false;

const VIEW_HOME = "viewHome";
const VIEW_FOOD = "viewFood";
const VIEW_FEED = "viewFeed";

// ---------- 视图切换 ----------
function showView(name) {
  [VIEW_HOME, VIEW_FOOD, VIEW_FEED].forEach((v) => {
    document.getElementById(v).classList.toggle("hidden", v !== name);
  });

  // 首次进入美食视图时再初始化地图（懒加载）
  if (name === VIEW_FOOD && !mapInited) {
    mapInited = true;
    if (typeof AMap !== "undefined") {
      initMap();
    }
  }

  // 切换后让地图重新计算尺寸
  if (name === VIEW_FOOD && map) {
    setTimeout(() => map.resize?.(), 80);
  }

  // 进入动态视图时刷新动态
  if (name === VIEW_FEED) {
    loadFeed();
  }

  window.scrollTo({ top: 0 });
}

function bindViewNav() {
  document.getElementById("btnFood").addEventListener("click", () => showView(VIEW_FOOD));
  document.getElementById("btnFeed").addEventListener("click", () => showView(VIEW_FEED));
  document.getElementById("backHomeTop").addEventListener("click", () => showView(VIEW_HOME));
  document.getElementById("backHomeBottom").addEventListener("click", () => showView(VIEW_HOME));
}

// ---------- 数据加载 ----------
async function loadFoods() {
  try {
    const res = await fetch(JSON_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("加载失败");
    foods = await res.json();
  } catch (e) {
    console.error("无法加载 foods.json：", e);
    foods = [];
  }
}

function showDataError() {
  const list = document.getElementById("foodList");
  if (!list) return;
  list.innerHTML = '<div class="empty">美食数据加载失败，请刷新页面重试 🥲</div>';
  document.getElementById("countLabel").textContent = "共 0 家店铺";
}

// ---------- 高德地图 ----------
function initMap() {
  map = new AMap.Map("map", {
    zoom: 13,
    center: [119.965, 36.768],
    mapStyle: "amap://styles/whitesmoke",
  });

  map.on("complete", () => {
    renderMarkers();
  });

  map.on("zoomend", () => {
    renderMarkers();
  });
}

function renderMarkers() {
  markers.forEach((m) => map.remove(m));
  markers = [];

  const visible = getVisibleFoods();
  const showLabel = map.getZoom() >= 14;

  visible.forEach((f) => {
    if (f.lng == null || f.lat == null) return;

    const marker = new AMap.Marker({
      position: [f.lng, f.lat],
      title: f.name,
      label: showLabel
        ? {
            content: `<div class="map-label">${f.name}</div>`,
            offset: new AMap.Pixel(0, -30),
            direction: "top",
          }
        : undefined,
      icon: new AMap.Icon({
        image: "https://webapi.amap.com/theme/v1.3/markers/n/mark_b.png",
        size: new AMap.Size(22, 32),
        imageSize: new AMap.Size(22, 32),
      }),
    });

    const tip = new AMap.Marker({
      position: [f.lng, f.lat],
      content: `<div class="map-tip">${f.name}</div>`,
      offset: new AMap.Pixel(0, -34),
      zIndex: 200,
      bubble: true,
    });
    tip.setMap(null);

    marker.on("mouseover", () => tip.setMap(map));
    marker.on("mouseout", () => tip.setMap(null));
    marker.on("click", () => {
      selectFood(f.id);
      showDetail(f);
    });

    marker.foodId = f.id;
    marker.tip = tip;
    map.add(marker);
    markers.push(marker);
  });
}

// ---------- 筛选 ----------
function getVisibleFoods() {
  const kw = document.getElementById("searchInput").value.trim().toLowerCase();
  return foods.filter((f) => {
    if (currentCategory !== "全部" && f.category !== currentCategory) return false;
    if (!kw) return true;
    const hay = [f.name, f.category, f.address, f.desc].join(" ").toLowerCase();
    return hay.includes(kw);
  });
}

function getCategories() {
  const set = new Set(foods.map((f) => f.category).filter(Boolean));
  return ["全部", ...Array.from(set)];
}

// ---------- 渲染 ----------
function render() {
  renderList();
  if (map && mapInited) renderMarkers();
  renderCategoryTags();
}

function renderList() {
  const list = document.getElementById("foodList");
  const visible = getVisibleFoods();

  list.innerHTML = "";
  if (visible.length === 0) {
    list.innerHTML = '<div class="empty">没有找到匹配的店铺 🥲</div>';
  } else {
    visible.forEach((f) => {
      const li = document.createElement("li");
      li.className = "food-card" + (f.id === activeId ? " active" : "");
      li.innerHTML = `
        <div class="card-top">
          <span class="food-name">${escapeHtml(f.name)}</span>
          <span class="badge">${escapeHtml(f.category || "未分类")}</span>
        </div>
        <div class="food-address">${escapeHtml(f.address || "地址未知")}</div>
        <div class="food-desc">${escapeHtml(f.desc || "")}</div>`;
      li.addEventListener("click", () => {
        selectFood(f.id);
        if (f.lng != null && f.lat != null) {
          map.setCenter([f.lng, f.lat]);
          map.setZoom(15);
        }
      });
      list.appendChild(li);
    });
  }

  document.getElementById("countLabel").textContent = `共 ${visible.length} 家店铺`;
}

function renderCategoryTags() {
  const container = document.getElementById("categoryTags");
  const categories = getCategories();
  container.innerHTML = categories
    .map(
      (c) =>
        `<span class="tag ${c === currentCategory ? "active" : ""}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</span>`
    )
    .join("");

  container.querySelectorAll(".tag").forEach((tag) => {
    tag.addEventListener("click", () => {
      currentCategory = tag.dataset.cat;
      render();
    });
  });
}

function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function selectFood(id) {
  activeId = id;
  renderList();

  markers.forEach((m) => {
    const isActive = m.foodId === id;
    m.setIcon(
      new AMap.Icon({
        image: isActive
          ? "https://webapi.amap.com/theme/v1.3/markers/n/mark_r.png"
          : "https://webapi.amap.com/theme/v1.3/markers/n/mark_b.png",
        size: new AMap.Size(24, 34),
        imageSize: new AMap.Size(24, 34),
      })
    );
  });
}

// ---------- 详情弹窗 ----------
function showDetail(f) {
  document.getElementById("detailName").textContent = f.name;
  document.getElementById("detailCategory").textContent = f.category || "未分类";
  document.getElementById("detailAddress").textContent = f.address || "地址未知";
  document.getElementById("detailDesc").textContent = f.desc || "暂无简介";

  const link = document.getElementById("detailMapLink");
  if (f.lng != null && f.lat != null) {
    link.href = `https://uri.amap.com/marker?position=${f.lng},${f.lat}&name=${encodeURIComponent(f.name)}&src=pingdufood&coordinate=gaode&callnative=0`;
    link.style.display = "inline-flex";
  } else {
    link.style.display = "none";
  }

  document.getElementById("detailModal").classList.remove("hidden");
}

function closeDetail() {
  document.getElementById("detailModal").classList.add("hidden");
}

// ---------- 事件绑定 ----------
function bindEvents() {
  document.getElementById("searchInput").addEventListener("input", () => {
    render();
  });
  document.getElementById("modalClose").addEventListener("click", closeDetail);
  document.querySelector(".modal-mask").addEventListener("click", closeDetail);
}

// ================================================================
// 我的动态（Supabase，只读浏览；发布管理在独立管理页）
// ================================================================
const SUPABASE_URL = "https://pxheapromvigpggfeslz.supabase.co";
const SUPABASE_KEY = "sb_publishable_8sMLifYG6cnCxg2pJi_hyw_4M9o0dlF";

const sb = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// ---------- 加载与渲染 ----------
async function loadFeed() {
  const list = document.getElementById("feedList");
  if (!sb) {
    list.innerHTML = '<div class="feed-empty">动态服务加载失败，请刷新页面重试</div>';
    return;
  }
  list.innerHTML = '<div class="feed-empty">加载中…</div>';
  try {
    const { data, error } = await sb
      .from("posts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    renderFeed(data || []);
  } catch (e) {
    console.error("动态加载失败：", e);
    list.innerHTML = '<div class="feed-empty">动态加载失败，请刷新页面重试</div>';
  }
}

// 合并新旧字段，返回一条动态的所有图片 URL
function imagesOf(p) {
  const urls = [];
  if (p.image_url) urls.push(p.image_url);
  if (Array.isArray(p.images)) urls.push(...p.images);
  return urls;
}

// 图片九宫格 HTML：单张全宽，多张网格
function imagesHtml(urls) {
  if (!urls.length) return "";
  if (urls.length === 1) {
    const u = escapeHtml(urls[0]);
    return `<a href="${u}" target="_blank" rel="noopener noreferrer"><img class="post-image" loading="lazy" src="${u}" alt="动态图片" /></a>`;
  }
  const items = urls
    .map((u) => `<a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer"><img loading="lazy" src="${escapeHtml(u)}" alt="动态图片" /></a>`)
    .join("");
  return `<div class="post-images">${items}</div>`;
}

function renderFeed(posts) {
  const list = document.getElementById("feedList");
  if (!posts.length) {
    list.innerHTML = '<div class="feed-empty">还没有动态</div>';
    return;
  }
  list.innerHTML = "";
  posts.forEach((p) => {
    const card = document.createElement("div");
    card.className = "post-card";
    const media = [];
    if (p.audio_url) {
      media.push(`<audio class="post-audio" controls preload="metadata" src="${escapeHtml(p.audio_url)}"></audio>`);
    }
    if (p.video_url) {
      media.push(`<video class="post-video" controls playsinline preload="metadata" src="${escapeHtml(p.video_url)}"></video>`);
    }
    media.push(imagesHtml(imagesOf(p)));
    card.innerHTML = `
      <div class="post-date">${fmtDate(p.created_at)}</div>
      ${p.content ? `<div class="post-content">${escapeHtml(p.content)}</div>` : ""}
      ${media.join("")}`;
    list.appendChild(card);
  });
}

function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

// ---------- 启动 ----------
(async function init() {
  await loadFoods();
  bindViewNav();
  bindEvents();

  if (!foods.length) {
    showDataError();
  } else {
    render();
  }
})();
