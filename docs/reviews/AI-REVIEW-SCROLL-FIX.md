# AI review scroll fix

User reported difficulty scrolling back through a nine-food photo review. A real Chromium regression reproduced the forced jump to the bottom after editing the first item at 390px/1280px in light/dark themes. Native wheel scrolling itself was reachable in the controlled fixture, so the report must distinguish the reproduced jump from an unconfirmed universal wheel lock.

Only newly appended messages now position the conversation. New AI replies begin at their first item. Quantity, macro and receipt mutations preserve position. Reopening the assistant starts at its last reply; one-tap capture remains within the original gesture. The bounded review region has keyboard access, visible scrollbars and vertical touch/pinch-zoom support.

UAT237 covers long photo replies, upper-item editing, macro-dialog return, end/start traversal and explicit Save. Physical device touch acceptance remains separate from browser fixtures.

The scroll region ends above the fixed composer, including enlarged-text layouts, so the final review controls and Save remain reachable.
