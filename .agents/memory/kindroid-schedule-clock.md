---
name: Kindroid schedule clock
description: Preventing Kindroid's internal date context from contradicting authoritative calendar results.
---

For next-shift answers, validate generated weekday references against the selected calendar event and correct only conflicting weekday words.

**Why:** Kindroid repeatedly replaced a supplied Friday calendar date with its internal Sunday clock while preserving the correct shift label and hours, even after explicit prompt instructions.

**How to apply:** Keep the calendar parser authoritative, place structured schedule facts at the end of provider context, and apply the narrow factual guard only when one next-shift event was selected.