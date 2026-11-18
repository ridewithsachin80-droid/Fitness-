// One stack owns focus, background isolation and scroll locking for every
// registered modal. A scope may span sibling portals (the AI thread/composer).
const stack = [];
const hidden = new Map();
let overflow = null, observer = null, redirecting = false;
const top = () => stack[stack.length - 1];
const rootsOf = scope => (scope?.getRoots() || []).filter(node => node?.isConnected);
const contains = (scope, node) => !!node && rootsOf(scope).some(root => root === node || root.contains(node));
const selector = 'a[href],area[href],button,input,select,textarea,iframe,object,embed,[contenteditable]:not([contenteditable="false"]),[tabindex],audio[controls],video[controls],summary';

export function visibleEnabled(node) {
  if (!node?.isConnected || typeof node.focus !== 'function' || node.matches(':disabled,[disabled],[aria-disabled="true"],input[type="hidden"]')) return false;
  if (node.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
  if (!node.getClientRects().length) return false;
  for (let el = node; el && el !== document.body; el = el.parentElement) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  }
  return true;
}

function focusables(scope) {
  const nodes = [...new Set(rootsOf(scope).flatMap(root => [root, ...root.querySelectorAll(selector)]))]
    .filter(node => node.matches(selector) && node.tabIndex >= 0 && visibleEnabled(node));
  // Native Tab visits the checked radio, or the first radio in an empty group.
  return nodes.filter(node => {
    if (!node.matches('input[type="radio"]') || !node.name) return true;
    const group = nodes.filter(other => other.matches('input[type="radio"]') && other.name === node.name && other.form === node.form);
    return node === (group.find(other => other.checked) || group[0]);
  }).sort((a, b) => (a.tabIndex > 0 ? a.tabIndex : Infinity) - (b.tabIndex > 0 ? b.tabIndex : Infinity));
}

function focus(node, preventScroll = true) {
  if (!visibleEnabled(node)) return false;
  node.focus({ preventScroll });
  return document.activeElement === node;
}
function focusInside(scope, preferLast = true) {
  if (!scope || scope !== top()) return;
  const preferred = preferLast && contains(scope, scope.lastFocus) ? scope.lastFocus : scope.initialFocus?.();
  if (contains(scope, preferred) && focus(preferred)) return;
  if (focus(focusables(scope)[0])) return;
  focus(scope.getFocusRoot?.() || rootsOf(scope)[0]);
}
const attribute = (node, name, value) => value === null ? node.removeAttribute(name) : node.setAttribute(name, value);
function restoreHidden() {
  for (const [node, previous] of hidden) {
    // React can reopen an exiting portal (or change a background attribute)
    // while it is isolated. Restore only the values still owned by this stack.
    if (node.hasAttribute('data-modal-exiting')) {
      node.setAttribute('inert', ''); node.setAttribute('aria-hidden', 'true');
    } else {
      if (node.getAttribute('inert') === '') attribute(node, 'inert', previous.inert);
      if (node.getAttribute('aria-hidden') === 'true') attribute(node, 'aria-hidden', previous.ariaHidden);
    }
  }
  hidden.clear();
}
function isolate() {
  restoreHidden();
  const activeRoots = rootsOf(top());
  if (!activeRoots.length) return;
  const visit = parent => {
    for (const node of parent.children) {
      if (activeRoots.includes(node)) continue;
      if (activeRoots.some(root => node.contains(root))) { visit(node); continue; }
      hidden.set(node, { inert: node.getAttribute('inert'), ariaHidden: node.getAttribute('aria-hidden') });
      node.setAttribute('inert', ''); node.setAttribute('aria-hidden', 'true');
    }
  };
  visit(document.body);
}
function layers() {
  stack.forEach((scope, index) => rootsOf(scope).forEach((node, part) => {
    if (!scope.styles.has(node)) scope.styles.set(node, { value: node.style.getPropertyValue('z-index'), priority: node.style.getPropertyPriority('z-index') });
    // Inline important also overrides the existing AI composer CSS layer.
    node.style.setProperty('z-index', String(100 + index * 10 + part), 'important');
  }));
}
function sync() { layers(); isolate(); }
function onFocus(event) {
  const scope = top();
  if (!scope || redirecting) return;
  if (contains(scope, event.target) && visibleEnabled(event.target)) { scope.lastFocus = event.target; return; }
  redirecting = true;
  try { focusInside(scope); } finally { redirecting = false; }
}

// Called by each React scope root after its editor/menu handlers. This also
// works inside portals whose outer React ancestors stop key propagation.
export function handleModalKey(scope, event) {
  if (scope !== top() || !contains(scope, event.target) || event.defaultPrevented || event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return;
  if (event.key === 'Escape') {
    event.preventDefault(); event.stopPropagation(); scope.onClose?.();
  } else if (event.key === 'Tab') {
    const nodes = focusables(scope), active = document.activeElement;
    if (!nodes.length) { event.preventDefault(); focusInside(scope, false); return; }
    const index = nodes.indexOf(active);
    // Native Tab can visit aria-hidden/aria-disabled controls. Advance through
    // the same filtered sequence used by focus containment, including portals.
    const next = index < 0 ? event.shiftKey ? nodes.length - 1 : 0
      : (index + (event.shiftKey ? -1 : 1) + nodes.length) % nodes.length;
    event.preventDefault(); focus(nodes[next], false);
  }
}
function onKey(event) { if (top()) handleModalKey(top(), event); }
function start() {
  overflow = ['overflow', 'overflow-x', 'overflow-y'].map(name => ({ name, value: document.body.style.getPropertyValue(name), priority: document.body.style.getPropertyPriority(name) }));
  document.body.style.setProperty('overflow', 'hidden', 'important');
  document.addEventListener('focusin', onFocus, true);
  document.addEventListener('keydown', onKey);
  observer = new MutationObserver(() => { sync(); if (top() && !contains(top(), document.activeElement)) focusInside(top()); });
  observer.observe(document.body, { childList: true, subtree: true });
}
function stop() {
  observer?.disconnect(); observer = null;
  document.removeEventListener('focusin', onFocus, true);
  document.removeEventListener('keydown', onKey);
  document.body.style.removeProperty('overflow');
  for (const previous of overflow) if (previous.value) document.body.style.setProperty(previous.name, previous.value, previous.priority);
  overflow = null;
}

export function registerModal(options) {
  const scope = { ...options, opener: options.opener || document.activeElement, styles: new Map(), lastFocus: null };
  if (!stack.length) start();
  // Child portals mount layout effects before their parents. Parent scopes
  // belong beneath already registered descendants, even on an initial mount.
  const descendant = stack.findIndex(candidate => {
    for (let parent = candidate.token?.parent; parent; parent = parent.parent) if (parent === scope.token) return true;
    return false;
  });
  stack.splice(descendant < 0 ? stack.length : descendant, 0, scope);
  sync(); focusInside(scope, false);
  return scope;
}
export function refreshModal(scope) { if (stack.includes(scope)) sync(); }
export function isTopModal(scope) { return !!scope && scope === top(); }
export function unregisterModal(scope) {
  const index = stack.indexOf(scope);
  if (index < 0) return;
  const wasTop = scope === top();
  // If a lower modal is removed first, its launcher is the surviving return
  // path for descendants whose own launchers are about to disappear.
  const removedRoots = [...scope.styles.keys(), ...(scope.getRoots() || []).filter(Boolean)];
  for (const child of stack.slice(index + 1)) if (removedRoots.some(root => root === child.opener || root.contains(child.opener))) child.opener = scope.opener;
  stack.splice(index, 1);
  for (const [node, previous] of scope.styles) node.style.setProperty('z-index', previous.value, previous.priority);
  sync();
  if (!stack.length) stop();
  if (!wasTop) return;
  if (top()) {
    if (!(contains(top(), scope.opener) && focus(scope.opener))) focusInside(top());
  } else if (!focus(scope.opener)) {
    // A route change can remove the launcher. Never leave focus on an exiting
    // or disconnected dialog, and do not invent a different action to focus.
    const previous = document.body.getAttribute('tabindex');
    document.body.setAttribute('tabindex', '-1'); document.body.focus({ preventScroll: true });
    attribute(document.body, 'tabindex', previous);
  }
}
