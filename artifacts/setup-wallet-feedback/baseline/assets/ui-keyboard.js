const controlSelector = [
  "a[href]",
  "area[href]",
  "button",
  'input:not([type="hidden"])',
  "select",
  "textarea",
  "summary",
  "iframe",
  "audio[controls]",
  "video[controls]",
  '[contenteditable]:not([contenteditable="false"])',
  "[tabindex]",
].join(",");

// Layout rectangles alone can include descendants hidden by a closed disclosure.
// Each closed ancestor must expose this node through its first direct summary.
function visibleInDisclosures(element) {
  for (
    let ancestor = element.parentElement;
    ancestor;
    ancestor = ancestor.parentElement
  ) {
    if (ancestor.localName !== "details" || ancestor.open) continue;
    const summary = [...ancestor.children].find(
      (child) => child.localName === "summary",
    );
    if (!summary || !summary.contains(element)) return false;
  }
  return true;
}

function visible(element) {
  if (
    !element.isConnected ||
    element.closest("[hidden], [inert]") ||
    !visibleInDisclosures(element) ||
    !element.getClientRects().length
  )
    return false;
  const style = element.ownerDocument.defaultView.getComputedStyle(element);
  return style.visibility !== "hidden" && style.visibility !== "collapse";
}

function tabOrder(element) {
  // Editable regions participate in native Tab order without an explicit tabindex.
  if (!element.hasAttribute("tabindex") && element.isContentEditable) return 0;
  return element.tabIndex;
}

/** Visible light-DOM controls in sequential keyboard order; excludes the root itself. */
export function focusableControls(root) {
  if (!root?.querySelectorAll) return [];
  return [...root.querySelectorAll(controlSelector)]
    .filter(
      (element) =>
        typeof element.focus === "function" &&
        tabOrder(element) >= 0 &&
        !element.hasAttribute("disabled") &&
        !element.matches(":disabled") &&
        visible(element),
    )
    .map((element, index) => ({ element, index, order: tabOrder(element) }))
    .sort((a, b) => {
      if (a.order > 0 && b.order > 0)
        return a.order - b.order || a.index - b.index;
      if (a.order > 0) return -1;
      if (b.order > 0) return 1;
      return a.index - b.index;
    })
    .map(({ element }) => element);
}

/** Contain unmodified Tab/Shift+Tab in an open native dialog. Escape remains native. */
export function trapDialogTab(event, dialog) {
  if (
    !dialog?.open ||
    event?.key !== "Tab" ||
    event.defaultPrevented ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  )
    return false;
  const controls = focusableControls(dialog);
  const active = dialog.ownerDocument.activeElement;
  const index = controls.indexOf(active);
  if (controls.length && index >= 0) {
    if (event.shiftKey ? index > 0 : index < controls.length - 1) return false;
  }
  event.preventDefault();
  if (controls.length) {
    (event.shiftKey ? controls.at(-1) : controls[0]).focus();
  } else {
    const heading = [...dialog.querySelectorAll("h1,h2,h3,h4,h5,h6")].find(
      visible,
    );
    if (heading && !heading.hasAttribute("tabindex")) heading.tabIndex = -1;
    (heading ?? dialog).focus();
  }
  return true;
}

/** Give a skip link's main target real focus while preserving modified-link clicks. */
export function focusMain(event, main) {
  if (
    !main?.isConnected ||
    typeof main.focus !== "function" ||
    event?.defaultPrevented ||
    event?.altKey ||
    event?.ctrlKey ||
    event?.metaKey ||
    (typeof event?.button === "number" && event.button !== 0) ||
    !visible(main)
  )
    return false;
  if (!main.hasAttribute("tabindex")) main.tabIndex = -1;
  main.focus({ preventScroll: true });
  if (main.ownerDocument.activeElement !== main) return false;
  event?.preventDefault();
  main.scrollIntoView({ block: "start" });
  return true;
}
