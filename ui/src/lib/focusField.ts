export function focusField(button: HTMLElement | null) {
  if (!button) return;
  const group = button.closest("[data-key-scope='studio-field']");
  group?.querySelectorAll<HTMLElement>("[data-kbd]").forEach((node) => {
    delete node.dataset.kbd;
  });
  button.dataset.kbd = "true";
  button.focus();
}
