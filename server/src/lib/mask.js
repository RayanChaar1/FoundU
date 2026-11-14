/* FR-17.3, FR-17.4: detect sequences of eight or more digits (card, ID, or account numbers) and mask them,
   keeping only the last two digits.  Spaces and dashes inside a number are part of the sequence. */
const DIGIT_RUN = /\d(?:[ -]?\d){7,}/g;

function maskDigits(text) {
  return text.replace(DIGIT_RUN, (run) => {
    const digits = run.replace(/\D/g, '');
    return '•'.repeat(digits.length - 2) + digits.slice(-2);
  });
}

const hasLongDigitRun = (text) => new RegExp(DIGIT_RUN.source).test(text);

module.exports = { maskDigits, hasLongDigitRun };
