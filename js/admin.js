// 动态管理页 —— 登录、发布（文字/语音/视频）、删除动态
// 该页面不被站点任何位置链接，仅管理员知晓地址

const SUPABASE_URL = "https://pxheapromvigpggfeslz.supabase.co";
const SUPABASE_KEY = "sb_publishable_8sMLifYG6cnCxg2pJi_hyw_4M9o0dlF";
const MAX_VIDEO_MB = 50;

const sb = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

let pendingAudio = null; // { file, label }
let pendingVideo = null; // { file, label }
let mediaRecorder = null;
let audioChunks = [];
let recording = false;
let recTimer = null;
let recSeconds = 0;
let publishing = false;

// ---------- 工具 ----------
function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function fmtDur(sec) {
  sec = Math.round(sec || 0);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function urlToStoragePath(url) {
  // https://xxx.supabase.co/storage/v1/object/public/media/<path> → <path>
  const m = String(url).match(/\/storage\/v1\/object\/public\/media\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

// ---------- 登录态 ----------
async function checkSession() {
  if (!sb) {
    alert("动态服务加载失败，请刷新页面重试");
    return;
  }
  const { data } = await sb.auth.getSession();
  const logged = !!(data && data.session);
  document.getElementById("loginBox").classList.toggle("hidden", logged);
  document.getElementById("adminBox").classList.toggle("hidden", !logged);
  if (logged) loadAdminFeed();
}

async function doLogin() {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPwd").value;
  const errEl = document.getElementById("loginError");
  const btn = document.getElementById("loginBtn");
  btn.disabled = true;
  btn.textContent = "登录中…";
  try {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      errEl.classList.remove("hidden");
      return;
    }
    errEl.classList.add("hidden");
    document.getElementById("loginPwd").value = "";
    await checkSession();
  } catch (e) {
    console.error("登录失败：", e);
    errEl.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "登录";
  }
}

async function doLogout() {
  try { await sb.auth.signOut(); } catch (e) {}
  document.getElementById("feedText").value = "";
  pendingAudio = null;
  pendingVideo = null;
  renderComposerPreview();
  await checkSession();
}

// ---------- 动态列表（管理版，带删除） ----------
async function loadAdminFeed() {
  const list = document.getElementById("adminFeedList");
  list.innerHTML = '<div class="feed-empty">加载中…</div>';
  try {
    const { data, error } = await sb
      .from("posts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    renderAdminFeed(data || []);
  } catch (e) {
    console.error("动态加载失败：", e);
    list.innerHTML = '<div class="feed-empty">动态加载失败，请刷新页面重试</div>';
  }
}

function renderAdminFeed(posts) {
  const list = document.getElementById("adminFeedList");
  if (!posts.length) {
    list.innerHTML = '<div class="feed-empty">还没有动态，发布第一条吧</div>';
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
    card.innerHTML = `
      <div class="post-head">
        <div class="post-date">${fmtDate(p.created_at)}</div>
        <button class="post-del" data-id="${p.id}" data-audio="${escapeHtml(p.audio_url || "")}" data-video="${escapeHtml(p.video_url || "")}" type="button">删除</button>
      </div>
      ${p.content ? `<div class="post-content">${escapeHtml(p.content)}</div>` : ""}
      ${media.join("")}`;
    list.appendChild(card);
  });
}

async function deletePost(btn) {
  const id = btn.dataset.id;
  if (!confirm("确定删除这条动态吗？")) return;
  btn.disabled = true;
  try {
    // 先删关联媒体文件
    for (const url of [btn.dataset.audio, btn.dataset.video]) {
      const path = urlToStoragePath(url);
      if (path) {
        await sb.storage.from("media").remove([path]);
      }
    }
    const { error } = await sb.from("posts").delete().eq("id", id);
    if (error) throw error;
    await loadAdminFeed();
  } catch (e) {
    console.error("删除失败：", e);
    alert("删除失败：" + (e.message || "请稍后重试"));
    btn.disabled = false;
  }
}

// ---------- 录音 ----------
async function toggleRecording() {
  if (recording) {
    stopRecording();
    return;
  }
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    document.getElementById("audioFile").click();
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    alert("无法访问麦克风，可选择本地音频文件上传");
    document.getElementById("audioFile").click();
    return;
  }
  audioChunks = [];
  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size) audioChunks.push(e.data);
  };
  mediaRecorder.onstop = onRecStop;
  mediaRecorder.start();
  recording = true;
  recSeconds = 0;
  setRecBtn(true);
  recTimer = setInterval(() => {
    recSeconds++;
    setRecBtn(true);
    if (recSeconds >= 60) stopRecording(); // 最长 60 秒
  }, 1000);
}

function setRecBtn(on) {
  const t = document.getElementById("btnAudioText");
  const btn = document.getElementById("btnAudio");
  if (on) {
    btn.classList.add("recording");
    t.textContent = `结束 ${fmtDur(recSeconds)}`;
  } else {
    btn.classList.remove("recording");
    t.textContent = "语音";
  }
}

function stopRecording() {
  if (!recording) return;
  recording = false;
  clearInterval(recTimer);
  setRecBtn(false);
  const rec = mediaRecorder;
  try { rec && rec.state !== "inactive" && rec.stop(); } catch (e) {}
  if (rec && rec.stream) {
    rec.stream.getTracks().forEach((t) => t.stop());
  }
}

function onRecStop() {
  const type = mediaRecorder.mimeType || "audio/webm";
  const blob = new Blob(audioChunks, { type });
  if (!blob.size) return;
  const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
  const file = new File([blob], `audio_${Date.now()}.${ext}`, { type });
  pendingAudio = { file, label: `语音 ${fmtDur(recSeconds)}` };
  renderComposerPreview();
}

// ---------- 待发布媒体 ----------
function renderComposerPreview() {
  const pv = document.getElementById("composerPreview");
  const parts = [];
  if (pendingAudio) {
    parts.push(`<span class="pv-item">${escapeHtml(pendingAudio.label)}<button type="button" class="pv-remove" data-remove="audio">&times;</button></span>`);
  }
  if (pendingVideo) {
    parts.push(`<span class="pv-item">${escapeHtml(pendingVideo.label)}<button type="button" class="pv-remove" data-remove="video">&times;</button></span>`);
  }
  pv.innerHTML = parts.join("");
  pv.classList.toggle("hidden", parts.length === 0);
}

// ---------- 发布 ----------
async function uploadMedia(file) {
  const safe = String(file.name).replace(/[^\w.-]/g, "_");
  const path = `${Date.now()}_${safe}`;
  const { error } = await sb.storage.from("media").upload(path, file);
  if (error) throw error;
  const { data } = sb.storage.from("media").getPublicUrl(path);
  return data.publicUrl;
}

async function doPublish() {
  if (publishing) return;
  const content = document.getElementById("feedText").value.trim();
  if (!content && !pendingAudio && !pendingVideo) {
    alert("写点文字或添加语音 / 视频再发布吧");
    return;
  }
  publishing = true;
  const btn = document.getElementById("btnPublish");
  btn.disabled = true;
  btn.textContent = "发布中…";
  try {
    let audio_url = null;
    let video_url = null;
    if (pendingAudio) audio_url = await uploadMedia(pendingAudio.file);
    if (pendingVideo) video_url = await uploadMedia(pendingVideo.file);
    const { error } = await sb
      .from("posts")
      .insert({ content, audio_url, video_url });
    if (error) throw error;
    document.getElementById("feedText").value = "";
    pendingAudio = null;
    pendingVideo = null;
    renderComposerPreview();
    await loadAdminFeed();
    window.scrollTo({ top: 0 });
  } catch (e) {
    console.error("发布失败：", e);
    alert("发布失败：" + (e.message || "请稍后重试"));
  } finally {
    publishing = false;
    btn.disabled = false;
    btn.textContent = "发布";
  }
}

// ---------- 事件绑定 ----------
function bindEvents() {
  // 登录
  document.getElementById("loginBtn").addEventListener("click", doLogin);
  document.getElementById("loginPwd").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doLogin();
  });
  // 退出
  document.getElementById("btnLogout").addEventListener("click", doLogout);
  // 录音 / 选音频文件
  document.getElementById("btnAudio").addEventListener("click", toggleRecording);
  document.getElementById("audioFile").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) {
      pendingAudio = { file, label: file.name };
      renderComposerPreview();
    }
    e.target.value = "";
  });
  // 视频
  document.getElementById("btnVideo").addEventListener("click", () => {
    document.getElementById("videoFile").click();
  });
  document.getElementById("videoFile").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) {
      if (file.size > MAX_VIDEO_MB * 1024 * 1024) {
        alert(`视频不能超过 ${MAX_VIDEO_MB}MB，请压缩后再上传`);
      } else {
        pendingVideo = { file, label: file.name };
        renderComposerPreview();
      }
    }
    e.target.value = "";
  });
  // 移除待发布媒体
  document.getElementById("composerPreview").addEventListener("click", (e) => {
    const btn = e.target.closest(".pv-remove");
    if (!btn) return;
    if (btn.dataset.remove === "audio") pendingAudio = null;
    if (btn.dataset.remove === "video") pendingVideo = null;
    renderComposerPreview();
  });
  // 发布
  document.getElementById("btnPublish").addEventListener("click", doPublish);
  // 删除动态（事件委托）
  document.getElementById("adminFeedList").addEventListener("click", (e) => {
    const btn = e.target.closest(".post-del");
    if (btn) deletePost(btn);
  });
}

// ---------- 启动 ----------
bindEvents();
checkSession();
