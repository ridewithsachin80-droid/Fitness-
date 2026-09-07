import { Children } from 'react';
import { motion, useReducedMotion } from 'motion/react';

/**
 * Stagger — a list whose items arrive one after another.
 *
 *   <Stagger className="space-y-2">
 *     {rows.map(r => <Row key={r.id} {...r} />)}
 *   </Stagger>
 *
 * Each child fades up 8px with a 40ms offset from the previous one. Short
 * enough that a 10-row list finishes in under half a second; long enough
 * that the list reads as "written" rather than "dumped". Under reduce-motion
 * everything appears at once.
 *
 * `keyed` children (every child has a key) are required for AnimatePresence
 * elsewhere; here keys just keep React happy on re-render.
 */
export default function Stagger({ children, step = 0.04, y = 8, className = '', as: Tag = 'div', ...rest }) {
  const reduce = useReducedMotion();
  const items = Children.toArray(children);
  return (
    <Tag className={className} {...rest}>
      {items.map((child, i) => (
        <motion.div
          key={child.key ?? i}
          initial={reduce ? false : { opacity: 0, y }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: reduce ? 0 : i * step, ease: [0.22, 1, 0.36, 1] }}>
          {child}
        </motion.div>
      ))}
    </Tag>
  );
}
