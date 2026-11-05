const $ = (id) => document.getElementById(id);

async function render() {
  const s = await chrome.storage.local.get({ irbisUrl: "", token: "", running: false, status: "", log: [] });
  if (document.activeElement !== $("url")) $("url").value = s.irbisUrl;
  if (document.activeElement !== $("token")) $("token").value = s.token;
  $("status").textContent = s.running ? `Идёт сбор — ${s.status}` : `Остановлен${s.status ? ` — ${s.status}` : ""}`;
  $("log").textContent = s.log.join("\n");
  $("start").disabled = s.running;
  $("stop").disabled = !s.running;
}

$("url").addEventListener("change", () => chrome.storage.local.set({ irbisUrl: $("url").value.trim() }));
$("token").addEventListener("change", () => chrome.storage.local.set({ token: $("token").value.trim() }));
$("start").addEventListener("click", async () => {
  await chrome.storage.local.set({ irbisUrl: $("url").value.trim(), token: $("token").value.trim() });
  await chrome.runtime.sendMessage({ kind: "start" });
  render();
});
$("stop").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ kind: "stop" });
  render();
});
chrome.storage.onChanged.addListener(render);
render();
