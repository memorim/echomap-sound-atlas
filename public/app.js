const escapeText=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const loadFeedback = document.createElement("p");
loadFeedback.className = "load-feedback";
loadFeedback.setAttribute("role", "status");
loadFeedback.style.cssText =
  "position:fixed;bottom:16px;left:16px;right:16px;z-index:9999;background:#f1f0ea;color:#292a2c;padding:12px 20px;margin:0;font:14px/1.5 system-ui;border-radius:8px";
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
const seek = document.querySelector("#seek");
const volume = document.querySelector("#volume");
try {
  const saved = localStorage.getItem("echomap-volume");
  if (saved !== null && /^(100|[1-9]?\d)$/.test(saved)) volume.value = saved;
} catch { /* Private sessions can still use the slider. */ }
audio.volume = volume.valueAsNumber / 100;
volume.oninput = () => {
  audio.volume = volume.valueAsNumber / 100;
  try { localStorage.setItem("echomap-volume", volume.value); } catch { /* Session only. */ }
};
seek.oninput = () => {
  if (Number.isFinite(audio.duration)) audio.currentTime = Math.min(audio.duration, seek.valueAsNumber);
};

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
          `<article class="sound-row" data-index="${i}" style="--color:${s.color}"><i>${String(i + 1).padStart(2, "0")}</i><div><h3>${escapeText(s.title)}</h3><small>${escapeText(s.city.toUpperCase())} · ${escapeText(s.district.toUpperCase())}</small></div><span>${escapeText(s.texture)}</span><span>${"MP3 · CC0"}</span><button>Слушать ${fmt(s.duration)}</button></article>`,
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
  void loadNotes(s?.id);
  document.querySelector(".play").disabled = !s;
  document.querySelector(".next").disabled = !s;
  document.querySelector(".previous").disabled = !s;
  document.querySelector("#audio-status").textContent = "";
  document.querySelector("#cover-photo").hidden = !s;
  document.querySelector("#recording-source").hidden = !s;
  const credit = document.querySelector("#photo-credit");
  credit.hidden = true;
  if (!s) {
    document.querySelector("#title").textContent = "Нет записей";
    document.querySelector("#description").textContent =
      "Выберите другое настроение";
    document.querySelector("#meta").textContent = "";
    document.querySelector("#duration").textContent = "00:00";
    document.querySelector("#elapsed").textContent = "00:00";
    seek.value = "0";
    return;
  }
  locationMap.fitBounds(sounds.filter(sound => sound.city === s.city).map(sound => [sound.lat, sound.lng]), {padding:[40,40],maxZoom:13,animate:false});
  mapMarkers.eachLayer(marker => marker.getElement()?.classList.toggle("selected", Number(marker.getElement().dataset.index) === index));
  const source = document.querySelector("#recording-source");
  source.href = s.source_url;
  source.textContent = "Источник записи · CC0";
  document.querySelector("#cover").style.setProperty("--cover", s.color);
  const photo = {2: "tunnel", 5: "schoolyard"}[s.id] ?? ({human: "pulse", wind: "calm"}[s.mood] ?? s.mood);
  document.querySelector("#cover-photo").src = `photos/${photo}.webp`;
  document.querySelector("#cover-photo").alt = {2: "Пешеходный тоннель под Шелепихинским мостом", 5: "Школьный двор в Верее"}[s.id] ?? "Городской пейзаж";
  if (s.id === 2 || s.id === 5) {
    credit.href = s.id === 2 ? "https://commons.wikimedia.org/wiki/File:Moscow,_Shelepikhinsky_Bridge_stairs_and_tunnels,_May_2025_01.jpg" : "https://commons.wikimedia.org/wiki/File:Vereya_school_yard_01.JPG";
    credit.textContent = s.id === 2 ? "Фото: Retired electrician · CC0" : "Фото: NVO · CC BY-SA 3.0";
    credit.hidden = false;
  }
  document.querySelector("#cover-number").textContent = String(
    index + 1,
  ).padStart(2, "0");
  document.querySelector("#meta").textContent =
    `${s.city.toUpperCase()} · ${s.district.toUpperCase()}`;
  document.querySelector("#title").textContent = s.title;
  document.querySelector("#description").textContent = s.description;
  document.querySelector("#duration").textContent = fmt(s.duration);
  document.querySelector("#elapsed").textContent = "00:00";
  seek.value = "0";
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
  seek.disabled = true;
  seek.value = "0";
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
  if (Number.isFinite(duration)) seek.value = String(audio.currentTime);
});
audio.addEventListener("loadedmetadata", () => {
  if (Number.isFinite(audio.duration)) {
    seek.disabled = false;
    seek.max = String(audio.duration);
    document.querySelector("#duration").textContent = fmt(audio.duration);
  }
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
const notesPanel = document.createElement('section');
notesPanel.className = 'field-notes';
notesPanel.innerHTML = `<h2>Полевые заметки</h2><p id="notes-status" role="status"></p><ul id="notes-list"></ul><form id="notes-form"><label>Ключ автора для публичного сервера <input name="accessKey" type="password" autocomplete="off"></label><label>Ваше имя <input name="author" required minlength="2" maxlength="50" autocomplete="name"></label><label>Заметка <textarea name="note" required minlength="5" maxlength="300"></textarea></label><button type="submit">Добавить заметку</button></form>`;
document.querySelector('main').append(notesPanel);
const notesForm = document.querySelector('#notes-form');
let noteSoundId, notesRequest = 0;
const drafts = new Map();
async function loadNotes(soundId) {
  if (noteSoundId) drafts.set(noteSoundId, notesForm.elements.note.value);
  noteSoundId = soundId;
  notesForm.elements.note.value = drafts.get(soundId) || '';
  notesPanel.hidden = !soundId;
  const version = ++notesRequest;
  if (!soundId) return;
  const status = document.querySelector('#notes-status');
  const list = document.querySelector('#notes-list');
  list.replaceChildren();
  status.textContent = 'Загружаем заметки…';
  try {
    const response = await fetch(`/api/sounds/${soundId}`);
    if (!response.ok) throw new Error();
    const sound = await response.json();
    if (version !== notesRequest) return;
    for (const note of sound.notes) {
      const item = document.createElement('li');
      item.textContent = `${note.author}: ${note.note}`;
      list.append(item);
    }
    status.textContent = sound.notes.length ? '' : 'Пока нет заметок. Добавьте первую.';
  } catch {
    if (version !== notesRequest) return;
    status.textContent = 'Не удалось загрузить заметки. ';
    const retry = document.createElement('button');
    retry.type = 'button'; retry.textContent = 'Повторить';
    retry.onclick = () => loadNotes(soundId); status.append(retry);
  }
}
notesForm.onsubmit = async (event) => {
  event.preventDefault();
  const soundId = noteSoundId;
  if (!soundId) return;
  const submit = notesForm.querySelector('button');
  submit.disabled = true;
  const draft = notesForm.elements.note.value;
  try {
    const response = await fetch('/api/notes', { method:'POST', headers:{'Content-Type':'application/json',...(notesForm.elements.accessKey.value?{Authorization:'Bearer '+notesForm.elements.accessKey.value}:{})},
      body:JSON.stringify({soundId, author:notesForm.elements.author.value, note:draft}) });
    if (!response.ok) throw new Error();
    const receipt = await response.json();
    drafts.delete(soundId);
    if (noteSoundId === soundId) {
      if (notesForm.elements.note.value === draft) notesForm.elements.note.value = '';
      await loadNotes(soundId);
      if(receipt.status==='pending') document.querySelector('#notes-status').textContent='Заметка отправлена на модерацию.';
    }
  } catch {
    if (noteSoundId === soundId) document.querySelector('#notes-status').textContent = 'Не удалось сохранить заметку. Текст сохранён в форме; повторите отправку.';
  } finally { submit.disabled = false; }
};
load();

const uploadPanel=document.createElement('section');uploadPanel.className='field-notes';
uploadPanel.innerHTML='<h2>Добавить аудиозапись</h2><p>Несжатый PCM WAV, 1–600 секунд, до 20 МБ. Перед публикацией запись проверит модератор.</p><form id="upload-audio"><label>Ключ автора<input name="token" type="password" minlength="32" required autocomplete="off"></label><label>Название<input name="title" required minlength="3" maxlength="100"></label><label>Город<input name="city" required minlength="2" maxlength="80"></label><label>Широта<input name="lat" type="number" step="any" min="-90" max="90" required></label><label>Долгота<input name="lng" type="number" step="any" min="-180" max="180" required></label><label>Аудиофайл<input name="audio" type="file" accept="audio/wav,.wav" required></label><label><input name="consent" type="checkbox" required> Я автор записи и разрешаю её публикацию по CC0.</label><button type="submit">Отправить на модерацию</button><p role="status"></p></form>';
document.querySelector('main').append(uploadPanel);
uploadPanel.querySelector('form').onsubmit=async event=>{event.preventDefault();const form=event.target,button=form.querySelector('button'),status=form.querySelector('p'),file=form.elements.audio.files[0];if(!file||file.size>20*1024*1024){status.textContent='Выберите WAV до 20 МБ';return;}button.disabled=true;try{const query=new URLSearchParams({title:form.elements.title.value,city:form.elements.city.value,lat:form.elements.lat.value,lng:form.elements.lng.value,license:'CC0-1.0'});const response=await fetch('/api/uploads?'+query,{method:'POST',headers:{'Content-Type':'audio/wav',Authorization:'Bearer '+form.elements.token.value},body:file});const data=await response.json();status.textContent=response.ok?'Запись №'+data.id+' отправлена на модерацию':data.message;if(response.ok)form.elements.audio.value='';}catch{status.textContent='Не удалось загрузить запись. Повторите позже.';}finally{button.disabled=false;}};
