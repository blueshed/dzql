# Streaks - Don't Break the Chain!

## The Idea

Build habits with friends. Log daily wins, share progress, keep each other accountable. Like Duolingo streaks meets Strava kudos.

## What You Can Do

### Track Habits
- Create streaks: "Morning jog", "No snacking", "Call mom"
- Share with specific people or keep private
- Log once per day (can't cheat - database won't let you)

### Sharing Control
- Share "Morning meditation" with just your wife
- Share "Homework help" with your kids
- Share "Running" with your whole crew
- Keep "Quit smoking" completely private
- Change who can see it anytime

### The Streak Counter
- Log today → streak +1
- Miss a day → back to zero (harsh but honest!)
- "Best streak" saved forever
- Hit milestones (7, 30, 100 days) → shared-with people get notified

### Social Features
- See streaks people have shared with you
- React with 🔥, ❤️, 👏
- Leave comments: "You got this!"
- See feed of activity from people you follow

## Example

Alice starts "Morning Run" 🏃‍♀️. Shares with Bob and her sister. Logs 3 days. Misses day 4. Streak resets to 0, but "best: 3" stays.

She keeps going. Day 7 → Bob and sister get notified → Bob drops a 🔥 → Alice feels motivated.

Day 30 → Bob and sister cheer. She adds "Meditation" 🧘‍♀️ and shares only with her sister. Bob can't see it.

Later she adds her running buddy to "Morning Run". He can see all the history.

## The Entities

### Users
People using the app. Profile with username, email, timezone.

### Streaks
The habits people are tracking. Name, description, icon, counters (current streak, best streak, total logs).

### Streak Shares
Who can see which streaks. One row = one person can see one streak. No rows = completely private (only creator sees).

### Streak Logs
Daily check-ins. One per streak per day. Has date, optional notes, timestamp.

### Streak Reactions
Cheers from friends. Fire, heart, clap, like. Optional comment. Can't give same reaction type twice.

## Rules

- One log per streak per day (composite PK)
- Only creator can log their streak
- Only people with share access can see/react to a streak
- Can't share with yourself (you already own it)
- Can't share twice with same person
- Your timezone = your "today"
- Streak counters auto-update on log (no manual editing)

## Workflows

### Creating and Sharing
1. Create streak "Morning Run"
2. Share with Bob (creates streak_share row)
3. Share with Sarah (creates another row)
4. Bob and Sarah can now see it

### Revoking Access
1. Delete the streak_share row for Bob
2. Bob can no longer see the streak
3. Sarah still can

### Logging and Milestones
1. Log today
2. Streak counter updates automatically
3. If milestone (7, 30, 50, 100, 365) → everyone with share access gets notified

### Reacting
1. See someone's streak (you must have share access)
2. Add a 🔥 reaction
3. They get notified
4. Can't give same reaction twice

## Not Building (Yet)

- Metrics like distance/time (just notes field for now)
- Leaderboards
- Group streaks where multiple people log same habit
- Freeze days or grace periods
- Public discovery (all sharing is explicit)

---

Habits are hard. Share with the right people to make them easier.
