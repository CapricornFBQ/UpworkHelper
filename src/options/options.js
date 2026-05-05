const form = document.querySelector("#settingsForm");
const saveStatus = document.querySelector("#saveStatus");
const fields = {
  apiKey: document.querySelector("#apiKey"),
  extractModel: document.querySelector("#extractModel"),
  scoreModel: document.querySelector("#scoreModel"),
  language: document.querySelector("#language"),
  reasoningEffort: document.querySelector("#reasoningEffort")
};

init();

async function init() {
  const { settings } = await send({ type: "settings:get" });
  for (const [key, field] of Object.entries(fields)) {
    field.value = settings[key] || "";
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    saveStatus.textContent = "Saving...";
    const settings = Object.fromEntries(
      Object.entries(fields).map(([key, field]) => [key, field.value])
    );
    try {
      await send({ type: "settings:save", settings });
      saveStatus.textContent = "Saved";
    } catch (error) {
      saveStatus.textContent = error.message;
    }
  });
}

function send(message) {
  return chrome.runtime.sendMessage(message).then((response) => {
    if (!response?.ok) throw new Error(response?.error || "Extension request failed");
    return response;
  });
}
