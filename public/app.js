const loadFeedback = document.createElement("p");
loadFeedback.className = "load-feedback";
loadFeedback.setAttribute("role", "status");
loadFeedback.style.cssText =
  "position:fixed;bottom:16px;left:16px;right:16px;z-index:9999;background:#fff8dd;color:#222;padding:12px 20px;margin:0;font:14px/1.5 system-ui;border-radius:8px";
document.querySelector("main").prepend(loadFeedback);
let lastLoadArgs = [],
  loadController;
async function load(...args) {
  loadController?.abort();
  const controller = (loadController = new AbortController());
  stop();
  lastLoadArgs = args;
  loadFeedback.hidden = false;
  loadFeedback.textContent = "Загрузка данных…";
  try {
    await loadData(args[0] ?? "all", controller.signal);
    if (controller.signal.aborted) return;
    loadFeedback.textContent = "";
    loadFeedback.hidden = true;
  } catch (error) {
    if (controller.signal.aborted) return;
    sounds = [];
    render();
    select(0);
    loadFeedback.textContent = "Не удалось загрузить данные. ";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Повторить загрузку";
    retry.onclick = () => load(...lastLoadArgs);
    loadFeedback.append(retry);
  }
}
let sounds = [],
  active = 0,
  playing = false,
  timer,
  audio,
  sources = [],
  bus,
  playback = 0,
  starting = false;
const positions = [
  ["23%", "27%"],
  ["58%", "38%"],
  ["71%", "20%"],
  ["76%", "67%"],
  ["28%", "72%"],
  ["13%", "45%"],
  ["82%", "48%"],
  ["48%", "16%"],
];
const fmt = (s) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
async function loadData(mood = "all", signal) {
  sounds = await fetch(`/api/sounds?mood=${encodeURIComponent(mood)}`, {
    signal,
  }).then((r) => {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  });
  active = 0;
  render();
  select(0);
  const stats = await fetch("/api/stats", { signal }).then((r) => {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  });
  document.querySelector("#stats").textContent =
    `${stats.summary.recordings} записей · ${stats.summary.cities} города · ${stats.summary.minutes} минут`;
  document.querySelector("#minutes").textContent = stats.summary.minutes;
}
function render() {
  document.querySelector("#markers").innerHTML = sounds
    .map(
      (s, i) =>
        `<button class="marker ${i === active ? "active" : ""}" style="--x:${positions[i % positions.length][0]};--y:${positions[i % positions.length][1]};--color:${s.color}" data-index="${i}" title="${s.title}"></button>`,
    )
    .join("");
  document.querySelector("#sound-list").innerHTML =
    sounds
      .map(
        (s, i) =>
          `<article class="sound-row" data-index="${i}" style="--color:${s.color}"><i>${String(i + 1).padStart(2, "0")}</i><div><h3>${s.title}</h3><small>${s.city.toUpperCase()} · ${s.district.toUpperCase()}</small></div><span>${s.texture}</span><span>${new Date(s.recorded_at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}</span><button>Слушать ${fmt(s.duration)}</button></article>`,
      )
      .join("") || '<p role="status">По выбранному настроению записей нет.</p>';
  document
    .querySelectorAll("[data-index]")
    .forEach(
      (el) =>
        (el.onclick = () =>
          select(Number(el.dataset.index), el.classList.contains("sound-row"))),
    );
}
function select(index, autoplay = false) {
  stop();
  active = index;
  const s = sounds[index];
  document.querySelector(".play").disabled = !s;
  document.querySelector(".next").disabled = !s;
  document.querySelector(".previous").disabled = !s;
  document.querySelector("#audio-status").textContent = "";
  document.querySelector("#cover-photo").hidden = !s;
  if (!s) {
    document.querySelector("#title").textContent = "Нет записей";
    document.querySelector("#description").textContent =
      "Выберите другое настроение";
    document.querySelector("#meta").textContent = "";
    document.querySelector("#duration").textContent = "00:00";
    document.querySelector("#elapsed").textContent = "00:00";
    document.querySelector("#progress").style.width = "0";
    return;
  }
  document.querySelector("#cover").style.setProperty("--cover", s.color);
  document.querySelector("#cover-photo").src =
    `photos/${{ human: "pulse", wind: "calm" }[s.mood] ?? s.mood}.webp`;
  document.querySelector("#cover-number").textContent = String(
    index + 1,
  ).padStart(2, "0");
  document.querySelector("#meta").textContent =
    `${s.city.toUpperCase()} · ${s.district.toUpperCase()}`;
  document.querySelector("#title").textContent = s.title;
  document.querySelector("#description").textContent = s.description;
  document.querySelector("#duration").textContent = fmt(s.duration);
  document.querySelector("#elapsed").textContent = "00:00";
  document.querySelector("#progress").style.width = "0";
  document
    .querySelectorAll(".marker")
    .forEach((button) =>
      button.classList.toggle("active", Number(button.dataset.index) === index),
    );
  document
    .querySelectorAll(".sound-row button")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(Number(button.closest("[data-index]").dataset.index) === index),
      ),
    );
  if (autoplay) play();
}
async function play() {
  if (playing || starting) {
    stop();
    return;
  }
  const s = sounds[active];
  if (!s) return;
  const version = ++playback;
  starting = true;
  const status = document.querySelector("#audio-status");
  document.querySelector(".play").textContent = "…";
  document.querySelector(".play").setAttribute("aria-label", "Отменить запуск");
  status.textContent = "Разрешите воспроизведение звука в браузере…";
  try {
    if (!audio || audio.state === "closed") {
      audio = new AudioContext();
      const context = audio;
      context.addEventListener("statechange", () => {
        if (context === audio && context.state !== "running" && playing) {
          stop();
          status.textContent =
            "Звук приостановлен браузером. Нажмите воспроизведение снова.";
        }
      });
    }
    await audio.resume();
    if (version !== playback) return;
    if (audio.state !== "running") throw Error("Audio suspended");
    const master = audio.createGain();
    bus = master;
    master.gain.value = 0.07;
    master.connect(audio.destination);
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = s.texture === "metal" ? "square" : "sine";
    osc.frequency.value = s.frequency;
    gain.gain.value = 0.32;
    osc.connect(gain).connect(master);
    osc.start();
    sources.push(osc);
    const buffer = audio.createBuffer(
      1,
      audio.sampleRate * 2,
      audio.sampleRate,
    );
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++)
      data[i] = (Math.random() * 2 - 1) * (0.2 + Math.sin(i / 18000) * 0.15);
    const noise = audio.createBufferSource();
    const ng = audio.createGain();
    ng.gain.value = s.texture === "rain" ? 1.1 : 0.35;
    noise.buffer = buffer;
    noise.loop = true;
    noise.connect(ng).connect(master);
    noise.start();
    sources.push(noise);
    playing = true;
    starting = false;
    status.textContent = "";
    document.querySelector(".play").setAttribute("aria-pressed", "true");
    document
      .querySelector(".play")
      .setAttribute("aria-label", "Остановить воспроизведение");
    document.querySelector("#elapsed").textContent = "00:00";
    document.querySelector("#progress").style.width = "0";
    document.querySelector(".play").textContent = "■";
    let elapsed = 0;
    timer = setInterval(() => {
      elapsed++;
      document.querySelector("#elapsed").textContent = fmt(elapsed);
      document.querySelector("#progress").style.width =
        `${(elapsed / s.duration) * 100}%`;
      if (elapsed >= s.duration) stop();
    }, 1000);
  } catch {
    if (version === playback) {
      stop();
      status.textContent =
        "Не удалось включить звук. Проверьте разрешение браузера и повторите.";
    }
  }
}
function stop() {
  playback++;
  starting = false;
  playing = false;
  if (timer) clearInterval(timer);
  timer = null;
  for (const source of sources) {
    source.stop();
    source.disconnect();
  }
  sources = [];
  if (bus) {
    bus.disconnect();
    bus = null;
  }
  if (audio && audio.state !== "closed") audio.suspend().catch(() => {});
  document.querySelector(".play").textContent = "▶";
  document.querySelector(".play").setAttribute("aria-label", "Воспроизвести");
  document.querySelector(".play").setAttribute("aria-pressed", "false");
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stop();
});
window.addEventListener("pagehide", () => {
  stop();
  const context = audio;
  audio = null;
  if (context && context.state !== "closed") context.close().catch(() => {});
});

document.querySelector(".play").onclick = play;
document.querySelector(".next").onclick = () =>
  select((active + 1) % sounds.length);
document.querySelector(".previous").onclick = () =>
  select((active - 1 + sounds.length) % sounds.length);
document.querySelectorAll("[data-mood]").forEach(
  (b) =>
    (b.onclick = () => {
      document
        .querySelectorAll("[data-mood]")
        .forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      load(b.dataset.mood);
    }),
);
load();
