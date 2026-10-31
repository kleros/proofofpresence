// Presentation helpers only. Wallet connection, review and financial actions are
// owned by the separate, event-scoped controller.
import { EVENT, LEGACY_EVENT, firstEventById, firstEventRecoveryPath } from './event.js';
const copyButton = document.querySelector('[data-copy-address]');
const address = document.querySelector('[data-contract-address]');
const copyStatus = document.querySelector('[data-copy-status]');
const requestedId = new URLSearchParams(location.hash.slice(1)).get('event') ?? new URLSearchParams(location.search).get('event');
if (requestedId && requestedId !== EVENT.id) {
  const requested = firstEventById(requestedId);
  if (requested) location.replace(firstEventRecoveryPath(requested));
  else {
    document.querySelector('main').hidden = true;
    const message = document.createElement('p'); message.textContent = 'This event link is unavailable. Open the event from the home page.';
    document.querySelector('.page-shell').append(message);
  }
}
const date = document.querySelector('[data-event-date]');
if (date) {
  const time = date.querySelector('time');
  if (time && EVENT.startsAt) { time.dateTime = EVENT.startsAt; time.textContent = EVENT.dateLabel; }
  const hours = date.querySelector('[data-event-hours]');
  if (hours) hours.textContent = EVENT.hoursLabel;
}
const closes = document.querySelector('[data-deposit-closes]');
if (closes) closes.textContent = EVENT.depositClosesLabel;
const manage = document.querySelector('[data-manage-event]');
if (manage) manage.href = firstEventRecoveryPath(EVENT);
const legacy = document.querySelector('[data-legacy-event]');
if (legacy && EVENT.id !== LEGACY_EVENT.id) {
  legacy.hidden = false;
  legacy.querySelector('a').href = firstEventRecoveryPath(LEGACY_EVENT);
}
// A mismatched static QR/address must never offer a manual transfer to a stale child.
const qr = document.querySelector('[data-qr-contract]');
if (address?.textContent.trim().toLowerCase() !== EVENT.contract.toLowerCase() || qr?.dataset.qrContract?.toLowerCase() !== EVENT.contract.toLowerCase()) {
  if (copyButton) copyButton.disabled = true;
  document.querySelector('.manual-deposit')?.setAttribute('hidden', '');
  document.querySelector('.address-box')?.setAttribute('hidden', '');
  if (copyStatus) copyStatus.textContent = 'Reload this page to refresh the event deposit address.';
}

copyButton?.addEventListener('click', async () => {
  const value = address?.textContent?.trim();
  if (!/^0x[0-9a-f]{40}$/i.test(value ?? '')) return;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(value);
    copyStatus.textContent = 'Address copied.';
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(address);
    selection?.removeAllRanges();
    selection?.addRange(range);
    address.focus();
    copyStatus.textContent = 'Address selected. Copy the selected text below.';
  }
});
