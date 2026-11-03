const $ = (id) => document.getElementById(id);
let ownerKey = "";
const message = (text, error = false) => {
  $("status").textContent = text;
  $("status").className = error ? "error" : "";
};
const el = (tag, text) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = String(text ?? "");
  return node;
};
async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    cache: "no-store",
    headers: {
      Authorization: "Bearer " + ownerKey,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      body.message || "Не удалось выполнить запрос: " + response.status,
    );
  }
  return response.status === 204 ? null : response.json();
}
function table(container, headings, rows) {
  const wrap = el("div");
  wrap.className = "scroll";
  const t = el("table"),
    thead = el("thead"),
    tr = el("tr");
  headings.forEach((h) => tr.append(el("th", h)));
  thead.append(tr);
  t.append(thead);
  const body = el("tbody");
  for (const cells of rows) {
    const row = el("tr");
    for (const item of cells) {
      const cell = el("td");
      item instanceof Node
        ? cell.append(item)
        : (cell.textContent = String(item ?? "—"));
      row.append(cell);
    }
    body.append(row);
  }
  t.append(body);
  wrap.append(t);
  container.replaceChildren(wrap);
  if (!rows.length) container.append(el("p", "Пока нет записей."));
}
function action(text, run) {
  const button = el("button", text);
  button.type = "button";
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await run();
    } catch (error) {
      message(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  return button;
}
$("login").addEventListener("submit", async (event) => {
  event.preventDefault();
  ownerKey = $("owner-key").value.trim();
  $("owner-key").value = "";
  try {
    await load();
    $("workspace").hidden = false;
    $("login").hidden = true;
    $("logout").hidden = false;
    message("Данные обновлены.");
  } catch (error) {
    ownerKey = "";
    message(error.message, true);
  }
});
$("logout").addEventListener("click", () => {
  ownerKey = "";
  location.reload();
});
$("refresh").addEventListener("click", async () => {
  try {
    await load();
    message("Данные обновлены.");
  } catch (error) {
    message(error.message, true);
  }
});
const previews = new Set();
function clearPreviews() {
  for (const url of previews) URL.revokeObjectURL(url);
  previews.clear();
}
window.addEventListener("pagehide", clearPreviews);
async function load() {
  const rows = await api("/api/owner/uploads");
  clearPreviews();
  table(
    $("uploads"),
    ["Запись", "Автор", "Статус", "Прослушать", "Решение"],
    rows.map((r) => {
      const audio = el("div");
      audio.append(
        action("Загрузить аудио", async () => {
          const response = await fetch(
            "/api/owner/uploads/" + r.sound_id + "/audio",
            {
              cache: "no-store",
              headers: { Authorization: "Bearer " + ownerKey },
            },
          );
          if (!response.ok) throw new Error("Запись недоступна");
          const url = URL.createObjectURL(await response.blob());
          previews.add(url);
          const player = el("audio");
          player.controls = true;
          player.src = url;
          audio.replaceChildren(player);
        }),
      );
      const actions = el("div");
      actions.className = "actions";
      if (r.status === "pending")
        for (const [label, status] of [
          ["Опубликовать", "approved"],
          ["Отклонить", "rejected"],
        ])
          actions.append(
            action(label, async () => {
              await api("/api/owner/uploads/" + r.sound_id, {
                method: "PATCH",
                body: JSON.stringify({ status }),
              });
              await load();
              message(
                status === "approved"
                  ? "Запись опубликована."
                  : "Запись отклонена.",
              );
            }),
          );
      return [r.title + " · " + r.city, r.owner_id, r.status, audio, actions];
    }),
  );
}
