/* Life cycle of a post (Figure 5): only these transitions are allowed (FR-9.1, FR-9.2). */
const TRANSITIONS = {
  OPEN: ['CLAIMED', 'CLOSED', 'REMOVED'],
  CLAIMED: ['OPEN', 'RETURNED'],
  RETURNED: ['CLOSED'],
  CLOSED: [],
  REMOVED: [],
};

const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

module.exports = { TRANSITIONS, canTransition };
