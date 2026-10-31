/** prefers-reduced-motion, kept live. */
const mq = matchMedia('(prefers-reduced-motion: reduce)');
export const motion = {
  reduced: mq.matches,
};
mq.addEventListener('change', () => (motion.reduced = mq.matches));
