// Advice is a snapshot of saved data, never an acknowledgement of a write.
// A slow/unavailable answer must not discard a successfully parsed review.
async function mixedRequestAnswer(question, { context, answer, timeoutMs = 10000 }) {
  if (typeof question !== 'string' || !question.trim()) return null;
  const cleanQuestion = question.trim().slice(0, 300);
  let timer;
  try {
    const text = await Promise.race([
      (async () => answer(cleanQuestion, await context()))(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Answer timed out')), timeoutMs); }),
    ]);
    if (typeof text !== 'string' || !text.trim()) throw new Error('Empty answer');
    return { question: cleanQuestion, text: text.trim().slice(0, 700), basis: 'saved_snapshot' };
  } catch {
    return { question: cleanQuestion, text: 'Your review is ready. I couldn’t answer the question just now. You can ask it again after reviewing your entries.', basis: 'saved_snapshot', unavailable: true };
  } finally {
    clearTimeout(timer);
  }
}
module.exports = { mixedRequestAnswer };
