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
let sounds = [], active = 0, playing = false, playback = 0, starting = false;
const audio = new Audio();
audio.preload = "none";

const locationMap = L.map("location-map", { scrollWheelZoom: false }).setView([55.756, 37.623], 12);
const mapCaption = document.querySelector(".map-caption");
const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(locationMap);
tiles.on("tileerror", () => { mapCaption.textContent = "Подложка временно недоступна. Точки и список остаются доступны."; });
tiles.on("tileload", () => { mapCaption.textContent = "OpenStreetMap · прокрутка карты кнопками + / −"; });
const mapMarkers = L.layerGroup().addTo(locationMap);
new ResizeObserver(() => locationMap.invalidateSize()).observe(document.querySelector("#location-map"));
function renderMarkers() {
  mapMarkers.clearLayers();
  sounds.forEach((sound, index) => {
    const pin = L.marker([sound.lat, sound.lng], {
      icon: L.divIcon({ className: "location-pin" + (index === active ? " selected" : ""), html: String(index + 1), iconSize: [40,40] }),
      title: sound.title, alt: sound.title,
    }).addTo(mapMarkers).on("click", () => select(index));
    pin.getElement().dataset.index = index;
    pin.getElement().addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") { L.DomEvent.stop(event); select(index); }
    });
    pin.bindTooltip(document.createTextNode(sound.title));
  });
}
const fmt = (s) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
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
  renderMarkers();
  document.querySelector("#sound-list").innerHTML =
    sounds
      .map(
        (s, i) =>
          `<article class="sound-row" data-index="${i}" style="--color:${s.color}"><i>${String(i + 1).padStart(2, "0")}</i><div><h3>${s.title}</h3><small>${s.city.toUpperCase()} · ${s.district.toUpperCase()}</small></div><span>${s.texture}</span><span>${"MP3 · CC0"}</span><button>Слушать ${fmt(s.duration)}</button></article>`,
      )
      .join("") || '<p role="status">По выбранному настроению записей нет.</p>';
  document
    .querySelectorAll(".sound-row[data-index]")
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
  document.querySelector("#recording-source").hidden = !s;
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
  locationMap.fitBounds(sounds.filter(sound => sound.city === s.city).map(sound => [sound.lat, sound.lng]), {padding:[40,40],maxZoom:13,animate:false});
  mapMarkers.eachLayer(marker => marker.getElement()?.classList.toggle("selected", Number(marker.getElement().dataset.index) === index));
  const source = document.querySelector("#recording-source");
  source.href = s.source_url;
  source.textContent = "Источник записи · CC0";
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
  if (playing || starting) { stop(); return; }
  const sound = sounds[active];
  if (!sound?.audio_url) return;
  const version = ++playback;
  starting = true;
  const status = document.querySelector("#audio-status");
  const control = document.querySelector(".play");
  control.textContent = "…";
  control.setAttribute("aria-label", "Отменить запуск");
  status.textContent = "Загружаем аудиозапись…";
  audio.src = sound.audio_url;
  audio.volume = 0.6;
  try {
    await audio.play();
    if (version !== playback) return;
    starting = false; playing = true;
    status.textContent = "";
    control.textContent = "■";
    control.setAttribute("aria-pressed", "true");
    control.setAttribute("aria-label", "Остановить воспроизведение");
  } catch {
    if (version !== playback) return;
    stop();
    status.textContent = "Не удалось загрузить аудиозапись. Повторите воспроизведение.";
  }
}
function stop() {
  playback++; starting = false; playing = false;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  const control = document.querySelector(".play");
  control.textContent = "▶";
  control.setAttribute("aria-label", "Воспроизвести");
  control.setAttribute("aria-pressed", "false");
}
audio.addEventListener("timeupdate", () => {
  const duration = audio.duration;
  document.querySelector("#elapsed").textContent = fmt(audio.currentTime);
  document.querySelector("#progress").style.width = Number.isFinite(duration) && duration > 0 ? `${audio.currentTime / duration * 100}%` : "0";
});
audio.addEventListener("loadedmetadata", () => {
  if (Number.isFinite(audio.duration)) document.querySelector("#duration").textContent = fmt(audio.duration);
});
audio.addEventListener("ended", stop);
audio.addEventListener("error", () => {
  if (!playing && !starting) return;
  stop();
  document.querySelector("#audio-status").textContent = "Не удалось загрузить аудиозапись. Повторите воспроизведение.";
});
document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); });
window.addEventListener("pagehide", stop);

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
