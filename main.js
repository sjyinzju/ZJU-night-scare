/* ===== 浙大夜惊魂 官网 · 交互 ===== */
const REPO = "https://github.com/sjyinzju/ZJU-night-scare";

/* ---------- 人物数据 ---------- */
const CHARACTERS = [
  {
    name: "张超", en: "ZHANG CHAO", role: "目击者 · 主角",
    img: "./site/assets/characters/zhang-chao.png",
    info: "生命科学系 大三 · 白沙 2 幢 123 · 惊魂夜的亲历者",
    tags: ["敏锐", "执拗", "理性", "背负真相"],
    bio: "成绩不好不坏，平时爱打游戏，只有考试前两周才临时抱佛脚。年前挂了一门，刚开学就要补考，才跟着室友林伟去了西南角的医学院图书馆。那一夜之后，敲窗声、镜中人影、飘忽歌声，一件件找上门来。",
    props: ["生命科学笔记", "学生证", "调查记录"],
    quote: "林伟的死不寻常。他一定不是自杀的。"
  },
  {
    name: "林伟", en: "LIN WEI", role: "第一个听见歌声的人",
    img: "./site/assets/characters/lin-yiang.png",
    info: "生命科学系 大三 · 白沙 2 幢 123 · 张超室友",
    tags: ["话不多", "用功", "成绩好", "听见歌声"],
    bio: "和张超同寝、同专业。寝室四人一间，另两个前年转专业搬走了，一直没补人。他话不多，成绩很好，每天晚上必到图书馆自修。十点，一直埋头做题的他忽然转过头：你有没有听到什么声音？",
    props: ["书包", "习题册", "校园卡"],
    quote: "好像有人在唱歌吧？"
  },
  {
    name: "白秋", en: "BAI QIU", role: "沉默离开的人",
    img: "./site/assets/characters/bai-qiu.png",
    info: "经济系 · 白沙 3 幢 · 张超女友",
    tags: ["冷淡", "理性", "独立", "敏感"],
    bio: "性格偏冷淡。两人从大一就认识，却都爱窝在寝室，并不是天天黏在一起。住在白沙 3 幢，和张超的 2 幢隔着白沙小广场对望。那一夜她穿着红色羽绒服等在楼下，脸色苍白，却没有把话说完。",
    props: ["红色羽绒服", "门禁卡"],
    quote: "以后，你不要再去医学院那了。"
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
