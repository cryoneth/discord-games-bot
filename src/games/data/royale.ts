/**
 * Event text for the battle royale. Kept light and workplace-friendly.
 * {a} and {b} are replaced with player mentions.
 */
export const ELIMINATIONS = [
  '{a} launched a perfectly timed water balloon at {b}. {b} is out!',
  '{a} out-debated {b} on pineapple pizza. {b} leaves in shame.',
  '{a} sent {b} a 47-slide deck. {b} could not recover.',
  '{a} beat {b} at rock-paper-scissors, best of seven.',
  '{a} tagged {b} with a foam dart from across the room.',
  '{a} booked {b} into a surprise 7 AM meeting. {b} did not make it.',
  '{a} won a staring contest against {b}. {b} blinked first.',
  '{a} lured {b} away with free donuts. {b} is out!',
  '{a} bonked {b} with a rubber chicken. Critical hit!',
  '{a} reply-all\'d {b} into oblivion.',
  '{a} and {b} raced for the last coffee. {a} got there first.',
  '{a} challenged {b} to a pun-off. {b} groaned too loudly.',
  '{a} hid {b}\'s favorite mug. {b} rage-quit.',
  '{a} pulled a uno reverse card on {b}.',
  '{a} gave {b} a really, really long code review.',
] as const;

export const SOLO_ELIMINATIONS = [
  '{a} tripped over a loose cable and is out.',
  '{a} went looking for the bathroom and never came back.',
  '{a} fell asleep during a webinar.',
  '{a} forgot to unmute and was disqualified.',
  '{a} got lost in a spreadsheet with 40 tabs.',
  '{a} stopped to pet a dog and missed the rest of the game.',
  '{a} wandered into the wrong video call.',
  '{a}\'s laptop decided this was the moment to install updates.',
  '{a} took a "quick" coffee break. It was not quick.',
] as const;

export const REVIVALS = [
  '{a} turned it off and on again — and is back in the game! 🔄',
  '{a} found a spare life in the snack drawer and returns! 🍫',
  '{a} was only on mute. Welcome back! 🎙️',
] as const;

export const FLAVOR = [
  '{a} found a stapler. It might come in handy.',
  '{a} is hiding behind the office plant. 🪴',
  '{a} built a fort out of cardboard boxes.',
  '{a} drank three espressos and is now vibrating.',
  '{a} is quietly practicing a victory speech.',
  '{a} and {b} formed an alliance… for now. 🤝',
  '{a} and {b} are sharing snacks. Suspicious.',
  '{a} is stretching. Very professional.',
] as const;
