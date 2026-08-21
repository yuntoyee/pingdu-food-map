// 平度美食探索 —— 房间式门户
// 三个视图：房间首页 / 美食地图 / 扫街
// 数据来自 data/foods.json，前端只读，编辑需改 JSON 文件

const JSON_URL = "data/foods.json?t=" + Date.now();

let foods = [];
let map = null;
let markers = [];
let activeId = null;
let currentCategory = "全部";
let mapInited = false;

const VIEW_HOME = "viewHome";
const VIEW_FOOD = "viewFood";
const VIEW_STREET = "viewStreet";

// ---------- 视图切换 ----------
function showView(name) {
  [VIEW_HOME, VIEW_FOOD, VIEW_STREET].forEach((v) => {
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

  window.scrollTo({ top: 0 });
}

function bindViewNav() {
  document.getElementById("btnFood").addEventListener("click", () => showView(VIEW_FOOD));
  document.getElementById("btnStreet").addEventListener("click", () => showView(VIEW_STREET));
  document.getElementById("backHomeTop").addEventListener("click", () => showView(VIEW_HOME));
  document.getElementById("backHomeBottom").addEventListener("click", () => showView(VIEW_HOME));
}

// ---------- 数据加载 ----------
async function loadFoods() {
  try {
    const res = await fetch(JSON_URL);
    if (!res.ok) throw new Error("加载失败");
    foods = await res.json();
  } catch (e) {
    console.error("无法加载 foods.json：", e);
    foods = [];
  }
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

// ---------- 启动 ----------
(async function init() {
  await loadFoods();
  bindViewNav();
  bindEvents();
  render();
})();
