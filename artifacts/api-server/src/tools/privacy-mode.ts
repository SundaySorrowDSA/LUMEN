import { eq } from "drizzle-orm";
import { assistantPrivacySettingsTable, db } from "@workspace/db";

const SETTINGS_ID = 1;

export async function getPrivacyMode() {
  const [settings] = await db
    .select()
    .from(assistantPrivacySettingsTable)
    .where(eq(assistantPrivacySettingsTable.id, SETTINGS_ID))
    .limit(1);
  if (settings) return settings;

  const [created] = await db
    .insert(assistantPrivacySettingsTable)
    .values({ id: SETTINGS_ID, darkMode: false })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const [concurrentSettings] = await db
    .select()
    .from(assistantPrivacySettingsTable)
    .where(eq(assistantPrivacySettingsTable.id, SETTINGS_ID))
    .limit(1);
  if (!concurrentSettings) throw new Error("Could not initialize privacy settings");
  return concurrentSettings;
}

export async function setPrivacyMode(darkMode: boolean, now = new Date()) {
  const current = await getPrivacyMode();
  if (current.darkMode === darkMode) return { settings: current, changed: false };

  const [settings] = await db
    .update(assistantPrivacySettingsTable)
    .set({ darkMode, activatedAt: darkMode ? now : null, updatedAt: now })
    .where(eq(assistantPrivacySettingsTable.id, SETTINGS_ID))
    .returning();
  if (!settings) throw new Error("Could not update privacy settings");
  return { settings, changed: true };
}
