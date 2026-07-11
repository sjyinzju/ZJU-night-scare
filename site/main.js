/* ===== 浙大夜惊魂 官网 · 交互 ===== */
const REPO = "https://github.com/sjyinzju/ZJU-night-scare";

/* ---------- 人物数据 ---------- */
const CHARACTERS = [
  {
    name: "白秋", en: "BAI QIU", role: "沉默离开的人",
    img: "./assets/characters/bai-qiu.png",
    info: "19 岁 · 经济学系 大二 · 班级学习委员",
    tags: ["独立", "理性", "坚韧", "敏感"],
    bio: "外表冷淡，内心细腻。习惯把情绪藏起来，对很多事都有自己的判断。和张超相恋三年，却在一个深夜选择沉默离开。",
    props: ["红色羽绒服", "日记本", "校园卡"],
    quote: "纵使黑夜漫长，也要独自发光。"
  },
  {
    name: "林一昂", en: "LIN YI'ANG", role: "第一个冲上去的人",
    img: "./assets/characters/lin-yiang.png",
    info: "20 岁 · 生命科学系 大二 · 张超同班铁哥们 · 白秋表哥",
    tags: ["嘴碎", "吊儿郎当", "讲义气", "不信邪"],
    bio: "表面没心没肺，整天吐槽一切，其实心思细腻，关键时刻靠得住。对灵异传闻嗤之以鼻，但每次都第一个冲上去。",
    props: ["耳机", "自行车钥匙", "涂鸦头盔", "校园卡"],
    quote: "怕什么啊，老子信科学——但兄弟有事，老先上。"
  },
  {
    name: "张超", en: "ZHANG CHAO", role: "目击者 · 主角",
    img: "./assets/characters/zhang-chao.png",
    info: "生命科学系 大三 · 惊魂夜的亲历者与调查者",
    tags: ["敏锐", "执拗", "理性", "背负真相"],
    bio: "成绩不好不坏，本不爱夜里自修。补考前的一个深夜，他跟着同伴走进医学院图书馆——从那一夜起，敲窗声、镜中人影、飘忽歌声，一件件找上门来。他开始记录：异常行为、可疑地点、关键时间线。真相，只有一个？",
    props: ["生命科学笔记", "学生证", "调查记录"],
    quote: "生命的本质，是秩序，还是混沌？"
  }
];

/* ---------- 渲染人物卡 ---------- */
const grid = document.getElementById("charsGrid");
CHARACTERS.forEach((c, i) => {
  const card = document.createElement("article");
  card.className = "card reveal";
  card.style.transitionDelay = (i * 0.08) + "s";
  card.innerHTML = `
    <div class="card__img">
      <span class="card__role">${c.role}</span>
      <img src="${c.img}" alt="${c.name}" loading="lazy" />
      <div class="card__name"><b>${c.name}</b><i>${c.en}</i></div>
    </div>
    <div class="card__meta">
      <p class="info">${c.info}</p>
      <div class="card__tags">${c.tags.map(t => `<span>${t}</span>`).join("")}</div>
      <p class="card__open">翻开档案 ▸</p>
    </div>`;
  card.addEventListener("click", () => openModal(c));
  grid.appendChild(card);
});

/* ---------- 角色弹窗 ---------- */
const modal = document.createElement("div");
modal.className = "modal";
modal.innerHTML = `
  <div class="modal__box" role="dialog" aria-modal="true">
    <button class="modal__close" aria-label="关闭">✕</button>
    <div class="modal__img"><img alt="" /></div>
    <div class="modal__body"></div>
  </div>`;
document.body.appendChild(modal);
const mImg = modal.querySelector(".modal__img img");
const mBody = modal.querySelector(".modal__body");

function openModal(c) {
  mImg.src = c.img; mImg.alt = c.name;
  mBody.innerHTML = `
    <h3>${c.name}</h3>
    <p class="en">${c.en} · ${c.role}</p>
    <p class="info">${c.info}</p>
    <h4>性格关键词</h4>
    <div class="tags">${c.tags.map(t => `<span>${t}</span>`).join("")}</div>
    <h4>角色简介</h4>
    <p class="bio">${c.bio}</p>
    <h4>关键道具</h4>
    <ul class="props">${c.props.map(p => `<li>${p}</li>`).join("")}</ul>
    <p class="quote">「${c.quote}」</p>`;
  modal.classList.add("is-open");
  document.body.style.overflow = "hidden";
}
function closeModal() {
  modal.classList.remove("is-open");
  document.body.style.overflow = "";
}
modal.addEventListener("click", e => { if (e.target === modal || e.target.closest(".modal__close")) closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

/* ---------- 导航：滚动变实 + 汉堡 ---------- */
const nav = document.getElementById("nav");
const links = document.querySelector(".nav__links");
const burger = document.getElementById("burger");
window.addEventListener("scroll", () => nav.classList.toggle("is-solid", window.scrollY > 60));
burger.addEventListener("click", () => links.classList.toggle("is-open"));
links.querySelectorAll("a").forEach(a => a.addEventListener("click", () => links.classList.remove("is-open")));

/* ---------- 滚动入场 ---------- */
const io = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } });
}, { threshold: 0.15 });
document.querySelectorAll(".section, .card").forEach(el => { el.classList.add("reveal"); io.observe(el); });

/* ---------- 玩法面板：打字机 ---------- */
const LINES = [
  "10:00 P.M. 医学院图书馆，只剩二十来个人。",
  "「你有没有听到…什么声音？」",
  "草地里没有虫鸣。走廊尽头，没有人影。",
  "可你回头时，那扇窗上，多了一个手印。",
  "——欢迎来到紫金港的夜里。"
];
const typedEl = document.getElementById("typed");
let li = 0, ci = 0;
function type() {
  if (!typedEl) return;
  const line = LINES[li];
  typedEl.textContent = line.slice(0, ci);
  if (ci < line.length) { ci++; setTimeout(type, 90); }
  else { setTimeout(() => { ci = 0; li = (li + 1) % LINES.length; type(); }, 2200); }
}
type();

/* ---------- 反馈表单 → GitHub Issue ---------- */
document.getElementById("fbForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const type = document.getElementById("fbType").value;
  const title = document.getElementById("fbTitle").value.trim() || "（未填标题）";
  const body = document.getElementById("fbBody").value.trim();
  const fullTitle = `[${type}] ${title}`;
  const fullBody = `${body}\n\n---\n类型：${type}\n来源：官网反馈入口`;
  const url = `${REPO}/issues/new?title=${encodeURIComponent(fullTitle)}&body=${encodeURIComponent(fullBody)}`;
  window.open(url, "_blank", "noopener");
});
