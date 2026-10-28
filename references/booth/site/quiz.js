// Kleros 101: the Gold tier quiz on the final screen. All three must end up right: a wrong pick shows why it's
// wrong and the visitor picks again. `right` is the index of the correct option, `art` the little diagram shown
// once it's answered (draw, triage or appeal). Under a right answer, "Want to know more?" opens `deep` (a short
// paragraph, or a list of steps) and then the `more` docs link. Keep it about how Kleros works: no token,
// staking or earning talk (Devcon Booth Guidelines). Plain words: visitors read this on a phone at the booth.
window.KLEROS_QUIZ = [
  {
    q: 'A dispute goes to Kleros. Who decides it?',
    options: [
      ['The Kleros team', 'No. The Kleros team never rules on cases. No company or admin can pick the outcome.'],
      ['Jurors drawn at random, who review the evidence and vote', 'Right. Jurors are picked at random from a big pool. Each one reads the evidence and votes privately.'],
      ['Whoever pays the most', 'No. Money can’t buy a ruling. Jurors are picked at random and decide on the evidence.']
    ],
    right: 1,
    art: 'draw',
    deep: 'Random picks mean nobody chooses who judges a case: not the parties, not Kleros. Votes stay hidden until everyone has voted, so jurors can’t copy or pressure each other. When each juror decides alone, the answer they tend to land on is the one the evidence supports.',
    more: ['Why nobody can pick the jury', 'https://docs.kleros.io/concepts/credible-neutrality']
  },
  {
    q: 'Your AI agent paid another agent $2.40 for a market report. The money sits in escrow, and the report comes back empty. Your agent opens a dispute. What happens next?',
    options: [
      ['A Kleros employee checks it and refunds you', 'No. Nobody at Kleros rules on cases. Your agent sends the dispute straight to the court, with no person or website in between.'],
      ['One AI model rules instantly, and its answer is final', 'No. One model can be wrong or tricked. Kleros has the case read several times, and when the reads disagree, human jurors decide. They can overrule the AI.'],
      ['Independent AI reads settle it if they agree; if not, human jurors decide', 'Exactly. AI reads the case nine separate times. If the reads agree, it’s settled in minutes. If not, human jurors decide. Then the escrow refunds you or pays the seller.']
    ],
    right: 2,
    art: 'triage',
    deep: [
      'Before the job: the payment is locked in escrow, and the seller agent can be checked against Kleros’s verified-agent registry.',
      'The job fails: your agent opens the dispute itself, with Kleros’s agent tools. No website, no form.',
      'Triage: AI reads the case nine separate times. When the reads agree, the case settles on its own, fast and cheap.',
      'Close calls go to human jurors. They have the final say and can reverse the AI.',
      'The ruling goes back to the escrow: refund the buyer or pay the seller.'
    ],
    more: ['Kleros for AI agents', 'https://ai.kleros.io']
  },
  {
    q: 'One side thinks the jury got it wrong. What happens next?',
    options: [
      ['They appeal, and a bigger jury looks at the case again', 'Yes. Anyone can fund an appeal. Each round has a bigger jury, about twice the size, so the final call comes from more people.'],
      ['Nothing: the first ruling is final', 'No. Rulings can be appealed, so one unlucky jury isn’t the end of it.'],
      ['The Kleros team overrides it', 'No. There’s no override button, for the team or anyone else. The contract carries out the final ruling.']
    ],
    right: 0,
    art: 'appeal',
    deep: 'Appeals are what make random juries safe. Each round roughly doubles the jury, so a wrong result gets harder to keep. Once nobody appeals in time, the ruling is final and the contract carries it out by itself. Agent disputes work the same way: humans can reverse an AI decision.',
    more: ['How appeals work', 'https://docs.kleros.io/concepts/dispute-resolution']
  }
];
