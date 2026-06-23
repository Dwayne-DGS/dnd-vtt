// Reference lookups. Typing a spell or item name opens a targeted search of the
// community D&D 5e wiki (dnd5e.wikidot.com) in a new tab. We use a site-scoped
// search so partial/loose names still land on the right page.

export function initReference() {
  const q = document.getElementById("ref-query");

  function open(kind) {
    const term = q.value.trim();
    if (!term) { q.focus(); return; }
    const hint = kind === "spell" ? "spell" : "magic item";
    const url =
      "https://duckduckgo.com/?q=" +
      encodeURIComponent(`site:dnd5e.wikidot.com ${term} ${hint}`);
    window.open(url, "_blank", "noopener");
  }

  document.getElementById("ref-spell").addEventListener("click", () => open("spell"));
  document.getElementById("ref-item").addEventListener("click", () => open("item"));
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") open("spell"); });
}
