// Presentation of an existing hash only. Never creates or changes a payment.
export function renderDepositReceipt(container, { message = '', hash = null, status = 'submitted' } = {}) {
  if (!container) return;
  container.replaceChildren();
  if (typeof hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(hash)) {
    container.textContent = message;
    return;
  }
  const states = { confirmed: 'Deposit confirmed', recorded: 'Deposit recorded', submitted: 'Transaction submitted', failed: 'Transaction reverted' };
  const state = Object.hasOwn(states, status) ? status : 'submitted';
  const card = document.createElement('section'); card.className = 'deposit-receipt'; card.dataset.status = state;
  const heading = document.createElement('div'); heading.className = 'receipt-heading';
  const icon = document.createElement('span'); icon.className = 'receipt-icon'; icon.setAttribute('aria-hidden', 'true');
  icon.textContent = ['confirmed', 'recorded'].includes(state) ? '✓' : state === 'failed' ? '!' : '↗';
  const title = document.createElement('strong'); title.className = 'receipt-state'; title.textContent = states[state];
  heading.append(icon, title);
  const description = document.createElement('p'); description.className = 'receipt-message'; description.textContent = message;
  const caption = document.createElement('span'); caption.className = 'eyebrow'; caption.textContent = 'YOUR TRANSACTION ID · ETHEREUM';
  const link = document.createElement('a'); link.className = 'receipt-hash';
  link.href = `https://etherscan.io/tx/${hash}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = hash;
  const actions = document.createElement('div'); actions.className = 'receipt-actions';
  const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'button button-secondary'; copy.dataset.copyTx = '';
  copy.textContent = 'Copy transaction ID';
  const explorer = document.createElement('a'); explorer.className = 'button button-secondary'; explorer.href = link.href;
  explorer.target = '_blank'; explorer.rel = 'noopener noreferrer'; explorer.textContent = 'View on Etherscan ↗';
  const fallback = document.createElement('input'); fallback.type = 'text'; fallback.readOnly = true; fallback.value = hash;
  fallback.hidden = true; fallback.className = 'receipt-hash'; fallback.setAttribute('aria-label', 'Transaction ID to copy');
  const copyStatus = document.createElement('span'); copyStatus.className = 'receipt-copy-status';
  copyStatus.setAttribute('role', 'status'); copyStatus.setAttribute('aria-live', 'polite');
  copy.addEventListener('click', async () => {
    copy.disabled = true;
    const current = () => copy.isConnected && container.contains(card) && card.contains(copy);
    try {
      if (!navigator.clipboard?.writeText) throw Error('Clipboard unavailable');
      await navigator.clipboard.writeText(hash);
      if (current()) { copy.textContent = 'Transaction ID copied'; copyStatus.textContent = 'Paste this transaction ID into Luma.'; }
    } catch {
      if (current()) { fallback.hidden = false; fallback.focus(); fallback.select(); copyStatus.textContent = 'Copy the selected transaction ID, then paste it into Luma.'; }
    } finally { if (current()) copy.disabled = false; }
  });
  actions.append(copy, explorer); card.append(heading, description, caption, link, actions, fallback, copyStatus); container.append(card);
}
