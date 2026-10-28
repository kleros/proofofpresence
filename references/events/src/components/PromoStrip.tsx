/** A short introduction to Kleros for visitors who don't know it yet. */
export default function PromoStrip({ lead = "New to Kleros?" }: { lead?: string }) {
  return (
    <aside className="promo">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="promo-sym" src="/kleros-symbol.svg" alt="" aria-hidden />
      <div className="promo-text">
        <b>{lead}</b>
        <span>Kleros is a decentralized court: randomly drawn jurors review the evidence and settle disputes on-chain, with appeals to larger juries.</span>
      </div>
      <div className="promo-links">
        <a className="btn sm" href="https://kleros.io" target="_blank" rel="noopener">How it works ↗</a>
        <a className="btn sm" href="https://court.kleros.io" target="_blank" rel="noopener">Become a juror ↗</a>
        <a className="btn sm" href="https://x.com/kleros_io" target="_blank" rel="noopener">Follow on X ↗</a>
      </div>
    </aside>
  );
}
